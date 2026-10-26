import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import { request } from "node:http";
import express from "express";
import { browserAccess } from "./browser-access.js";
import { mountPhoneAccess, phoneAccess } from "./phone-access.js";
import type { PhoneAccessRecord } from "../shared/phone-access.js";

const dns = "mail.synthetic-tailnet.ts.net";
const origin = `https://${dns}:8444`;
function fixture() {
  let record: PhoneAccessRecord | undefined;
  let config: Record<string, any> = { TCP: { "443": { HTTPS: true } }, Web: { [`${dns}:443`]: { Handlers: { "/other": { Proxy: "http://127.0.0.1:9999" } } } } };
  const original = structuredClone(config);
  const calls: string[][] = [];
  let failProbe = false;
  let failRemove = false;
  let time = 1000;
  const gate = browserAccess("synthetic-browser-password-only", "http://127.0.0.1:3002", () => time);
  const run = async (args: string[]) => {
    calls.push(args);
    if (args[0] === "status") return JSON.stringify({ BackendState: "Running", Self: { Online: true, DNSName: `${dns}.` } });
    if (args[1] === "status") return JSON.stringify(config);
    const port = args.find((arg) => arg.startsWith("--https="))!.slice(8);
    if (args.at(-1) === "off") {
      if (failRemove) throw new Error("synthetic permission failure");
      delete config.TCP[port]; delete config.Web[`${dns}:${port}`];
    } else {
      config.TCP[port] = { HTTPS: true };
      config.Web[`${dns}:${port}`] = { Handlers: { "/": { Proxy: args.at(-1) } } };
    }
    return "";
  };
  const service = phoneAccess({ gate, load: () => record, save: (value) => { record = value; }, port: () => 3002, run,
    probe: async () => { if (failProbe) throw new Error("synthetic TLS failure"); }, now: () => time });
  return { service, gate, calls, original, config, record: () => record, setRecord: (value: PhoneAccessRecord) => { record = value; }, failProbe: () => { failProbe = true; }, failRemove: () => { failRemove = true; }, advance: () => { time += 60_001; } };
}
test("enable verifies a private owned route, preserves foreign mappings, and disable removes only it", async () => {
  const f = fixture();
  await f.service.enable();
  assert.equal(f.record()?.phase, "ready");
  const status = await f.service.status(true);
  assert.equal(status.url, `${origin}/auth`);
  assert.equal(status.state, "ready");
  assert.deepEqual(f.calls.find((args) => args.includes("--bg")), ["serve", "--bg", "--https=8444", "http://127.0.0.1:3002"]);
  await f.service.disable();
  assert.equal(f.record(), undefined);
  assert.deepEqual(f.config, f.original);
});
test("missing CLI and signed-out hosts fail closed without mutation", async () => {
  for (const run of [async () => { throw new Error("ENOENT"); }, async () => JSON.stringify({ BackendState: "NeedsLogin" })]) {
    const service = phoneAccess({ gate: browserAccess("synthetic-password", "http://127.0.0.1:3002"), load: () => undefined, save: () => assert.fail("must not save"), port: () => 3002, run });
    assert.notEqual((await service.status(true)).state, "ready");
    await assert.rejects(service.enable());
  }
});
test("TLS failure rolls back only the created mapping; failed cleanup retains pending ownership", async () => {
  for (const failCleanup of [false, true]) {
    const f = fixture(); f.failProbe(); if (failCleanup) f.failRemove();
    await assert.rejects(f.service.enable());
    assert.equal(f.record()?.phase, failCleanup ? "pending" : undefined);
    assert.notEqual((await f.service.status(true)).state, "ready");
    if (!failCleanup) assert.deepEqual(f.config, f.original);
    else { await assert.rejects(f.service.enable()); assert.equal(f.record()?.phase, "pending"); }
  }
});
test("Funnel or foreign route changes suspend access and block destructive cleanup", async () => {
  for (const change of ["funnel", "target", "extra"]) {
    const f = fixture(); await f.service.enable();
    if (change === "funnel") f.config.AllowFunnel = { [`${dns}:8444`]: true };
    if (change === "target") f.config.Web[`${dns}:8444`].Handlers["/"].Proxy = "http://127.0.0.1:9998";
    if (change === "extra") f.config.Web["other.synthetic-tailnet.ts.net:8444"] = { Handlers: {} };
    const before = structuredClone(f.config);
    assert.equal((await f.service.status(true)).state, "error");
    await assert.rejects(f.service.disable());
    assert.deepEqual(f.config, before);
    assert.equal(f.gate.originFor({ headers: { host: `${dns}:8444` }, socket: {} } as any), undefined);
  }
});
test("restore verifies TLS before admission and a failed renewal revokes admission", async () => {
  const f = fixture(); await f.service.enable(); f.service.close();
  await f.service.start();
  assert.equal((await f.service.status(true)).state, "ready");
  f.failProbe(); f.advance();
  assert.equal((await f.service.status(true)).state, "error");
  assert.equal(f.gate.originFor({ headers: { host: `${dns}:8444` }, socket: {} } as any), undefined);
  f.service.close();
});
test("malformed saved ownership never invokes route removal", async () => {
  const f = fixture();
  f.setRecord({ origin: "invalid", httpsPort: 443, backendPort: 3002, phase: "pending" });
  await assert.rejects(f.service.disable());
  assert.ok(!f.calls.some((args) => args.at(-1) === "off"));
});

test("all occupied ports leave routes intact; Funnel-only reservations are not overwritten", async () => {
  const f = fixture();
  f.config.AllowFunnel = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`${dns}:${8444 + i}`, false]));
  const before = structuredClone(f.config);
  await assert.rejects(f.service.enable(), /No unused/);
  assert.equal(f.record(), undefined);
  assert.deepEqual(f.config, before);
  assert.ok(!f.calls.some((args) => args.includes("--bg")));
});
test("startup verification serializes Settings mutations and close prevents late admission", async () => {
  const f = fixture(); await f.service.enable(); f.service.close();
  let release!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  let entered!: () => void;
  const entry = new Promise<void>((resolve) => { entered = resolve; });
  const gate = browserAccess("synthetic-password-only", "http://127.0.0.1:3002");
  const service = phoneAccess({ gate, load: f.record, save: () => {}, port: () => 3002,
    run: async (args) => args[0] === "status" ? JSON.stringify({ BackendState: "Running", Self: { Online: true, DNSName: dns } }) : JSON.stringify(f.config),
    probe: async () => { entered(); await hold; } });
  const starting = service.start(); await entry;
  await assert.rejects(service.disable(), /already running/);
  await assert.rejects(service.enable(), /already running/);
  service.close(); release(); await starting;
  assert.equal(gate.originFor({ headers: { host: `${dns}:8444` }, socket: {} } as any), undefined);
});
test("management requires authenticated exact localhost Host and Origin plus explicit confirmation", async () => {
  const f = fixture();
  const local = "http://127.0.0.1:3002";
  const app = express(); app.use(f.gate); app.use(express.json()); mountPhoneAccess(app, f.service, f.gate);
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const call = (path: string, method = "GET", headers: Record<string, string> = {}, body = "") => new Promise<{ status: number; cookie?: string; body: string }>((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port: address.port, path, method, headers: { Host: new URL(local).host, ...headers } }, (res) => {
      let data = ""; res.on("data", (chunk) => { data += chunk; }); res.on("end", () => resolve({ status: res.statusCode!, cookie: res.headers["set-cookie"]?.[0]?.split(";")[0], body: data }));
    }); req.on("error", reject); req.end(body);
  });
  const change = (cookie: string, origin?: string, host?: string, body = '{"confirm":true}') => call("/api/phone-access/enable", "POST", { Cookie: cookie, "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}), ...(host ? { Host: host } : {}) }, body);
  try {
    assert.equal((await change("", local)).status, 401);
    const login = await call("/auth/login", "POST", { Origin: local, "Content-Type": "application/x-www-form-urlencoded" }, "password=synthetic-browser-password-only");
    assert.equal(login.status, 303);
    const cookie = login.cookie!;
    assert.equal((await change(cookie)).status, 403);
    assert.equal((await change(cookie, "http://evil.test")).status, 403);
    assert.equal((await change(cookie, local, "localhost:3002")).status, 403);
    assert.equal((await change(cookie, local, undefined, "{}")).status, 400);
    assert.equal((await change(cookie, local)).status, 200);
    const remote = await call("/auth/login", "POST", { Host: new URL(origin).host, Origin: origin, "Content-Type": "application/x-www-form-urlencoded" }, "password=synthetic-browser-password-only");
    assert.equal(remote.status, 303);
    assert.equal((await change(remote.cookie!, origin, new URL(origin).host)).status, 403);
    const status = await call("/api/phone-access", "GET", { Host: new URL(origin).host, Cookie: remote.cookie! });
    assert.equal(status.status, 200); assert.equal(JSON.parse(status.body).canManage, false);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});
