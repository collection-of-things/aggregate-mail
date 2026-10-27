import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

test("the browser target requires its expiring gate session before serving /api", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "emc2-browser-session-"));
  const password = "synthetic-browser-session-password";
  const env: NodeJS.ProcessEnv = { ...process.env, MAIL_DATA_DIR: directory, MAIL_CONFIG_PATH: path.join(directory, "absent.env"),
    MAIL_DATA_KEY: Buffer.alloc(32, 61).toString("base64"), MAIL_WEB_PASSWORD: password, MAIL_DESKTOP_TOKEN: "",
    GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "", TYPESAFE_API_KEY: "", OPENAI_API_KEY: "" };
  delete env.NODE_TEST_CONTEXT;
  // Choose an ephemeral port in the child; never use another service's fixed port.
  const source = `import net from "node:net";
    const probe = net.createServer();
    await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
    const port = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    process.env.MAIL_WEB_PORT = String(port);
    process.env.APP_URL = "http://127.0.0.1:" + port;
    await import("./server/index.ts");`;
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", source], { env, stdio: ["ignore", "pipe", "pipe"] });
  try {
    const origin = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Browser test server did not start")), 60000);
      let output = "";
      child.stdout.on("data", chunk => {
        output += chunk;
        const match = output.match(/Mail server listening at (http:\/\/127\.0\.0\.1:\d+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
      // Do not copy server diagnostics or credentials into assertion output.
      child.stderr.resume();
      child.once("exit", code => { clearTimeout(timer); reject(new Error(`Browser test server exited (${code})`)); });
    });
    const request = (route: string, options: RequestInit = {}) => fetch(`${origin}${route}`, { ...options, redirect: "manual" });
    assert.equal((await request("/api/state")).status, 401);
    assert.equal((await request("/api/state", { headers: { Cookie: `emc2_browser_session=${"0".repeat(64)}` } })).status, 401);
    const opened = await request("/auth/login", { method: "POST", headers: { Origin: origin, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ password }) });
    assert.equal(opened.status, 303);
    const cookie = opened.headers.get("set-cookie")!.split(";")[0];
    const state = await request("/api/state", { headers: { Cookie: cookie } });
    assert.equal(state.status, 200);
    const { csrf } = await state.json();
    assert.equal(typeof csrf, "string");
    assert.equal((await request("/api/oauth/google/start", { method: "POST", headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" }, body: "{}" })).status, 403);
    assert.equal((await request("/api/oauth/google/start", { method: "POST", headers: { Cookie: cookie, Origin: origin, "X-CSRF-Token": csrf, "Content-Type": "application/json" }, body: "{}" })).status, 400);
    assert.equal((await request("/api/state", { headers: { Cookie: cookie, Origin: "https://other.example.test" } })).status, 403);
    assert.equal((await request("/auth/lock", { method: "POST", headers: { Cookie: cookie, Origin: origin } })).status, 303);
    assert.equal((await request("/api/state", { headers: { Cookie: cookie } })).status, 401);
  } finally {
    child.kill();
    if (child.exitCode === null) await new Promise(resolve => child.once("exit", resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});
