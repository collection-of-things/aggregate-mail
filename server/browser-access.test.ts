import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import express from "express";
import { browserAccess, browserConfiguration } from "./browser-access.js";

const password = "synthetic-browser-password-only";

test("browser startup rejects missing secrets, unsafe roots, symlinks and desktop profiles", () => {
  const root = mkdtempSync(path.join(tmpdir(), "emc2-browser-source-"));
  const outside = mkdtempSync(path.join(tmpdir(), "emc2-browser-private-"));
  const env = { MAIL_WEB_PASSWORD: password, MAIL_DATA_KEY: Buffer.alloc(32, 37).toString("base64"), MAIL_DATA_DIR: path.join(outside, "mail") };
  try {
    assert.equal(browserConfiguration(env, root).origin, "http://127.0.0.1:3001");
    for (const changes of [
      { MAIL_WEB_PASSWORD: "" }, { MAIL_WEB_PASSWORD: "too-short" },
      { MAIL_DATA_KEY: "" }, { MAIL_DATA_KEY: "malformed" },
      { MAIL_DATA_DIR: "relative" }, { MAIL_DATA_DIR: root },
      { MAIL_DATA_DIR: path.join(root, "private") },
      { MAIL_DATA_DIR: path.join(outside, "mail"), MAIL_STATIC_DIR: outside },
      { APP_URL: "https://example.test" }, { APP_URL: "http://127.0.0.1:3001/path" },
      { APP_URL: "http://user:password@localhost:3001" },
    ]) assert.throws(() => browserConfiguration({ ...env, ...changes }, root));
    symlinkSync(root, path.join(outside, "source-link"), "dir");
    assert.throws(() => browserConfiguration({ ...env, MAIL_DATA_DIR: path.join(outside, "source-link", "new-mail") }, root));
    mkdirSync(env.MAIL_DATA_DIR);
    for (const name of ["key", "key.protected", "key.local", ".renamed-to-emc2"]) {
      writeFileSync(path.join(env.MAIL_DATA_DIR, name), "synthetic-marker");
      assert.throws(() => browserConfiguration(env, root));
      rmSync(path.join(env.MAIL_DATA_DIR, name));
    }
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});

test("invalid browser entrypoint stops before any storage access", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "emc2-browser-preflight-"));
  const data = path.join(directory, "must-not-exist");
  try {
    const result = spawnSync(process.execPath, ["--import", "tsx", "server/index.ts"], {
      env: { ...process.env, MAIL_DESKTOP_TOKEN: "", MAIL_WEB_PASSWORD: "", MAIL_DATA_KEY: "", MAIL_DATA_DIR: data, MAIL_CONFIG_PATH: path.join(directory, "absent.env") },
      encoding: "utf8", timeout: 10_000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Browser mode requires MAIL_WEB_PASSWORD/);
    assert.equal(existsSync(data), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("browser gate protects reads, writes and assets, with origin checks, rotation, lock and expiry", async () => {
  let time = 1000;
  const app = express();
  // A known origin also models the development frontend's separate port.
  const origin = "http://127.0.0.1:5173";
  app.use(browserAccess(password, origin, () => time));
  app.use((_req, res) => res.json({ synthetic: "protected-content" }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const call = (target: string, method = "GET", headers: Record<string, string> = {}, body = "") => new Promise<{ status: number; headers: import("node:http").IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port: address.port, path: target, method, headers }, (res) => {
      let result = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { result += chunk; });
      res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body: result }));
    });
    req.on("error", reject);
    req.end(body);
  });
  const login = (value = password) => call("/auth/login", "POST", { Origin: origin, "Content-Type": "application/x-www-form-urlencoded" }, `password=${encodeURIComponent(value)}`);
  const session = async () => {
    const response = await login();
    assert.equal(response.status, 303);
    assert.equal(response.headers.location, origin);
    const cookie = response.headers["set-cookie"]?.[0];
    assert.ok(cookie);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.doesNotMatch(response.body, new RegExp(password));
    return cookie.split(";")[0];
  };
  try {
    for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
      const result = await call("/api/state", method);
      assert.equal(result.status, 401);
      assert.doesNotMatch(result.body, /protected-content/);
      assert.equal(result.headers["cache-control"], "no-store");
    }
    for (const target of ["/", "/assets/main.js", "/.data/key", "/@fs/private/key"]) {
      const result = await call(target);
      assert.match(result.body, /Unlock Emc²/);
      assert.doesNotMatch(result.body, /protected-content/);
      assert.match(String(result.headers["content-security-policy"]), /frame-ancestors 'none'/);
    }
    assert.equal((await call("/api/state", "GET", { Host: `evil.test:${address.port}` })).status, 403);
    assert.equal((await call("/auth", "GET", { Origin: "http://evil.test" })).status, 403);
    assert.equal((await call("/auth/login", "POST")).status, 403);
    assert.equal((await call("/auth/login", "POST", { Origin: "null" })).status, 403);
    const wrong = await login("wrong-password");
    assert.equal(wrong.status, 401);
    assert.equal(wrong.headers["set-cookie"], undefined);
    assert.doesNotMatch(wrong.body, /wrong-password/);
    let cookie = await session();
    assert.equal((await call("/api/state", "GET", { Cookie: cookie })).status, 200);
    assert.equal((await call("/api/state", "GET", { Cookie: `${cookie}; ${cookie}` })).status, 401);
    assert.equal((await call("/api/state", "GET", { Cookie: `${cookie}wrong` })).status, 401);
    assert.equal((await call("/api/state", "GET", { Cookie: cookie, Origin: "http://evil.test" })).status, 403);
    const replacement = await session();
    assert.equal((await call("/api/state", "GET", { Cookie: cookie })).status, 401);
    cookie = replacement;
    assert.equal((await call("/auth/lock", "POST", { Cookie: cookie })).status, 403);
    assert.equal((await call("/auth/lock", "POST", { Cookie: cookie, Origin: origin })).status, 303);
    assert.equal((await call("/api/state", "GET", { Cookie: cookie })).status, 401);
    cookie = await session();
    time += 29 * 60_000;
    assert.equal(JSON.parse((await call("/auth/session", "GET", { Cookie: cookie })).body).authenticated, true);
    time += 60_000;
    assert.equal((await call("/api/state", "GET", { Cookie: cookie })).status, 401);
    cookie = await session();
    for (let hour = 0; hour < 16; hour++) {
      time += 29 * 60_000;
      assert.equal((await call("/api/state", "GET", { Cookie: cookie })).status, 200);
    }
    time += 16 * 60_000;
    assert.equal((await call("/api/state", "GET", { Cookie: cookie })).status, 401);
    // Only consent return bypasses the session; downstream still validates state.
    assert.equal((await call("/api/oauth/google")).status, 401);
    assert.equal((await call("/api/oauth/google/callback")).status, 200);
    assert.equal((await call("/api/oauth/google/callback", "POST")).status, 401);
    assert.equal((await call("/api/oauth/google/callback/extra")).status, 401);
    assert.equal((await call("/mcp")).status, 200);
    assert.equal((await call("/mcpevil")).body.includes("protected-content"), false);
    time += 60_000;
    const attempts = await Promise.all(Array.from({ length: 8 }, () => login("wrong-password")));
    assert.equal(attempts.filter((result) => result.status === 401).length, 5);
    assert.equal(attempts.filter((result) => result.status === 429).length, 3);
    assert.equal((await login()).status, 429);
    time += 60_000;
    await session();
    const oversized = await call("/auth/login", "POST", { Origin: origin, "Content-Type": "application/x-www-form-urlencoded" }, `password=${"x".repeat(3000)}`);
    assert.equal(oversized.status, 400);
    assert.doesNotMatch(oversized.body, /xxx/);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});

test("tailnet sessions use Secure host cookies, bind origins and cannot revive after proof expiry", async () => {
  let time = 1000;
  const remote = "https://mail.synthetic-tailnet.ts.net:8444";
  const local = "http://127.0.0.1:3002";
  const gate = browserAccess(password, local, () => time);
  gate.setTailnetOrigin(remote, time + 60_000);
  const app = express(); app.use(gate); app.get("/api/synthetic", (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const call = (path: string, method: string, host: string, cookie = "", origin?: string) => new Promise<{status: number; cookie?: string}>((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port: address.port, path, method, headers: { Host: host, Cookie: cookie, ...(origin ? { Origin: origin } : {}), "Content-Type": "application/x-www-form-urlencoded" } }, (res) => {
      res.resume(); res.on("end", () => resolve({ status: res.statusCode!, cookie: res.headers["set-cookie"]?.[0] }));
    }); req.on("error", reject); req.end(method === "POST" ? `password=${password}` : "");
  });
  try {
    const login = await call("/auth/login", "POST", new URL(remote).host, "", remote);
    assert.equal(login.status, 303);
    assert.match(login.cookie!, /^__Host-emc2_browser_session=/);
    assert.match(login.cookie!, /; Secure/); assert.match(login.cookie!, /HttpOnly/); assert.match(login.cookie!, /SameSite=Strict/);
    const cookie = login.cookie!.split(";")[0];
    assert.equal((await call("/api/synthetic", "GET", new URL(remote).host, cookie)).status, 200);
    assert.equal((await call("/api/synthetic", "GET", new URL(local).host, cookie)).status, 401);
    time += 60_001;
    // Renew without an intervening request: expiry must still destroy the session.
    gate.setTailnetOrigin(remote, time + 60_000);
    assert.equal((await call("/api/synthetic", "GET", new URL(remote).host, cookie)).status, 401);
    gate.setTailnetOrigin(undefined);
    assert.equal((await call("/auth", "GET", new URL(remote).host)).status, 403);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});
