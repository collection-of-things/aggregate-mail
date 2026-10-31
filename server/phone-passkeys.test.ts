import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { once } from "node:events";
import { request, type IncomingHttpHeaders } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import QRCode from "qrcode";
import { verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import type { PhoneCredential } from "../shared/phone-access.js";
import { browserAccess } from "./browser-access.js";
import { phonePasskeys } from "./phone-passkeys.js";

const local = "http://127.0.0.1:3002";
const remote = "https://mail.synthetic-tailnet.ts.net:8444";
const password = "synthetic-recovery-passphrase";
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest();
const b64 = (value: Uint8Array | string) => Buffer.from(value).toString("base64url");
async function fixture(t: TestContext, verifiers: Partial<Pick<Parameters<typeof phonePasskeys>[0], "verifyRegistration" | "verifyAuthentication">> = {}) {
  let time = 1000, invitation = "";
  t.mock.method(QRCode, "toDataURL", (async (value: string) => { invitation = value; return "data:image/png;base64,c3ludGhldGlj"; }) as any);
  const gate = browserAccess(password, local, () => time); gate.setTailnetOrigin(remote, 10_000_000);
  const credentials = new Map<string, PhoneCredential>();
  const app = express(); app.use(gate); app.use(express.json({ inflate: false }));
  app.use("/api", (req, res, next) => {
    if (req.method === "POST" && req.headers["x-csrf-token"] !== "synthetic-csrf") return res.sendStatus(403);
    next();
  });
  phonePasskeys({ gate, list: () => [...credentials.values()].map((value) => structuredClone(value)), save: (value) => { credentials.set(value.id, value); }, remove: (id) => { credentials.delete(id); }, now: () => time, ...verifiers }).mount(app);
  app.get("/api/synthetic", (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const call = (route: string, origin = remote, cookie = "", body?: unknown, extra: Record<string, string> = {}) => new Promise<{ status: number; body: any; cookies: string[]; headers: IncomingHttpHeaders }>((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port: address.port, path: route, method: body === undefined ? "GET" : "POST", headers: { Host: new URL(origin).host, Origin: origin, Cookie: cookie, "Content-Type": "application/json", "X-CSRF-Token": "synthetic-csrf", ...extra } }, (res) => {
      let data = ""; res.on("data", (chunk) => { data += chunk; }); res.on("end", () => { let parsed: any = data; try { parsed = JSON.parse(data); } catch {} resolve({ status: res.statusCode!, body: parsed, cookies: res.headers["set-cookie"] || [], headers: res.headers }); });
    }); req.on("error", reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  const login = await new Promise<string>((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port: address.port, path: "/auth/login", method: "POST", headers: { Host: new URL(local).host, Origin: local, "Content-Type": "application/x-www-form-urlencoded" } }, (res) => {
      res.resume(); res.on("end", () => resolve(res.headers["set-cookie"]![0].split(";")[0]));
    }); req.on("error", reject); req.end(`password=${password}`);
  });
  const host = (action?: string, body?: unknown, extra?: Record<string, string>) => call(`/api/phone-devices${action ? `/${action}` : ""}`, local, login, body, extra);
  const connect = async () => {
    const result = await host("connect", { confirm: true }); assert.equal(result.status, 200);
    assert.equal(result.body.pairing.url, invitation, "the direct link and QR claim the same invitation");
    assert.equal(new URL(invitation).pathname, "/auth/pair"); assert.equal(new URL(invitation).search, "");
    return { id: result.body.pairing.id as string, token: new URL(invitation).hash.slice(1) };
  };
  t.after(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  return { call, host, connect, gate, credentials, login, advance: (ms: number) => { time += ms; } };
}
test("phone access pages load the public passkey client from a hidden installation directory", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "emc2-phone-assets-"));
  const assets = path.join(directory, ".private-install", "dist");
  await mkdir(assets, { recursive: true });
  const client = "globalThis.syntheticPasskeyClient = true;";
  await writeFile(path.join(assets, "auth-passkey.js"), client);
  await writeFile(path.join(assets, ".hidden.js"), "synthetic-private-file");
  const previous = process.env.MAIL_STATIC_DIR;
  process.env.MAIL_STATIC_DIR = assets;
  t.after(async () => {
    if (previous === undefined) delete process.env.MAIL_STATIC_DIR;
    else process.env.MAIL_STATIC_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  });
  const f = await fixture(t);
  for (const route of ["/auth", "/auth/pair"])
    assert.match((await f.call(route)).body, /src="\/auth\/passkey\.js"/);
  const script = await f.call("/auth/passkey.js");
  assert.equal(script.status, 200);
  assert.match(script.headers["content-type"] || "", /(?:application|text)\/javascript/);
  assert.equal(script.body, client);
  assert.deepEqual(script.cookies, []);
  assert.equal((await f.call("/api/synthetic")).status, 401);
  assert.equal((await f.call("/auth/passkey.js", remote, "", undefined, { Host: "foreign.example.test" })).status, 403);
  assert.doesNotMatch((await f.call("/auth/.hidden.js")).body, /synthetic-private-file/);
});
function authenticator() {
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = keys.publicKey.export({ format: "jwk" });
  const id = randomBytes(32).toString("base64url");
  const cose = isoCBOR.encode(new Map<number, any>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x!, "base64url")], [-3, Buffer.from(jwk.y!, "base64url")]]));
  const client = (type: string, challenge: string, origin: string) => Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  return { id,
    registration(challenge: string, origin = remote, uv = true) {
      const idBytes = Buffer.from(id, "base64url"), length = Buffer.alloc(2); length.writeUInt16BE(idBytes.length);
      const authData = Buffer.concat([sha(new URL(remote).hostname), Buffer.from([uv ? 0x45 : 0x41]), Buffer.alloc(4), Buffer.alloc(16), length, idBytes, Buffer.from(cose)]);
      return { id, rawId: id, type: "public-key", clientExtensionResults: {}, response: { clientDataJSON: b64(client("webauthn.create", challenge, origin)), attestationObject: b64(isoCBOR.encode(new Map<string, any>([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]))), transports: ["internal"] } };
    },
    assertion(challenge: string, userHandle: string, counter = 1, origin = remote, uv = true, rp = new URL(remote).hostname) {
      const count = Buffer.alloc(4); count.writeUInt32BE(counter);
      const authData = Buffer.concat([sha(rp), Buffer.from([uv ? 5 : 1]), count]);
      const data = client("webauthn.get", challenge, origin);
      return { id, rawId: id, type: "public-key", clientExtensionResults: {}, response: { clientDataJSON: b64(data), authenticatorData: b64(authData), signature: b64(sign("sha256", Buffer.concat([authData, sha(data)]), keys.privateKey)), userHandle } };
    },
  };
}
const getCookie = (response: {cookies: string[]}, name: string) => response.cookies.find((value) => value.startsWith(`${name}=`))!.split(";")[0];
async function enroll(f: Awaited<ReturnType<typeof fixture>>) {
  const invite = await f.connect();
  const claim = await f.call("/auth/passkey/pair", remote, "", { token: invite.token }); assert.equal(claim.status, 200);
  const cookie = getCookie(claim, "__Host-emc2_pair");
  const status = await f.host(); assert.equal(status.body.pairing.code, claim.body.code);
  assert.equal((await f.host("approve", { confirm: true, id: invite.id })).status, 200);
  const options = await f.call("/auth/passkey/register/options", remote, cookie, {}); assert.equal(options.status, 200);
  const auth = authenticator();
  const result = await f.call("/auth/passkey/register/verify", remote, cookie, auth.registration(options.body.challenge)); assert.equal(result.status, 200);
  return { auth, cookie, result, userId: options.body.user.id as string };
}
test("scan, matching host approval and real WebAuthn registration grant a credential-bound phone session", async (t) => {
  const f = await fixture(t); const { result, auth, userId } = await enroll(f);
  const cookie = getCookie(result, "__Host-emc2_browser_session");
  const raw = result.cookies.find((value) => value.startsWith("__Host-emc2_browser_session="))!;
  assert.match(raw, /Secure/); assert.match(raw, /HttpOnly/); assert.match(raw, /SameSite=Strict/);
  assert.equal((await f.call("/api/synthetic", remote, cookie)).status, 200);
  assert.equal((await f.host()).status, 200, "phone login retains the host session");
  assert.equal((await f.call("/api/phone-devices", remote, cookie)).status, 403);
  assert.equal((await f.call("/auth/passkey/register/verify", remote, cookie, {})).status, 400);
  const challenge = await f.call("/auth/passkey/login/options", remote, "", {});
  const ceremony = getCookie(challenge, "__Host-emc2_ceremony");
  const assertion = auth.assertion(challenge.body.challenge, userId);
  const unlocked = await f.call("/auth/passkey/login/verify", remote, ceremony, assertion); assert.equal(unlocked.status, 200);
  assert.equal(f.credentials.get(auth.id)?.counter, 1);
  assert.equal((await f.call("/auth/passkey/login/verify", remote, ceremony, assertion)).status, 400, "challenge replay denied");
  const phone = getCookie(unlocked, "__Host-emc2_browser_session");
  assert.equal((await f.host("revoke", { confirm: true, id: auth.id })).status, 200);
  assert.equal((await f.call("/api/synthetic", remote, phone)).status, 401);
  assert.equal((await f.host()).status, 200);
});
test("unapproved, expired, reused and cancelled invitations grant no access", async (t) => {
  const f = await fixture(t); const invite = await f.connect();
  assert.equal((await f.call("/api/phone-devices/connect", local, "", { confirm: true })).status, 401);
  assert.equal((await f.host("approve", { confirm: true, id: invite.id }, { "X-CSRF-Token": "" })).status, 403);
  assert.equal((await f.call("/auth/passkey/pair", local, f.login, { token: invite.token })).status, 403);
  const claim = await f.call("/auth/passkey/pair", remote, "", { token: invite.token });
  const cookie = getCookie(claim, "__Host-emc2_pair");
  assert.equal((await f.call("/auth/passkey/pair", remote, "", { token: invite.token })).status, 400);
  assert.equal((await f.call("/auth/passkey/register/options", remote, cookie, {})).status, 400);
  assert.equal((await f.call("/auth/passkey/register/options", remote, "", {})).status, 400);
  await f.host("cancel", { confirm: true, id: invite.id });
  assert.equal((await f.call("/auth/passkey/pair/status", remote, cookie, {})).status, 400);
  const next = await f.connect(); f.advance(120_001);
  assert.equal((await f.call("/auth/passkey/pair", remote, "", { token: next.token })).status, 400);
  assert.equal(f.credentials.size, 0);
});
test("tampered WebAuthn challenge, origin, RP and missing user verification are rejected", async (t) => {
  const f = await fixture(t); const { auth, userId } = await enroll(f);
  for (const mode of ["challenge", "origin", "uv", "rp", "user"] as const) {
    const options = await f.call("/auth/passkey/login/options", remote, "", {});
    const cookie = getCookie(options, "__Host-emc2_ceremony");
    const response = auth.assertion(mode === "challenge" ? "wrong-challenge" : options.body.challenge, mode === "user" ? "other-user" : userId, 1, mode === "origin" ? "https://evil.test" : remote, mode !== "uv", mode === "rp" ? "evil.test" : new URL(remote).hostname);
    assert.equal((await f.call("/auth/passkey/login/verify", remote, cookie, response)).status, 400, mode);
  }
  assert.equal(f.credentials.get(auth.id)?.counter, 0);
});
test("ceremony cookies cannot swap challenges; route loss cancels setup but preserves paired browser trust", async (t) => {
  const f = await fixture(t); const { auth, userId, result } = await enroll(f);
  const first = await f.call("/auth/passkey/login/options", remote, "", {});
  const second = await f.call("/auth/passkey/login/options", remote, "", {});
  assert.equal((await f.call("/auth/passkey/login/verify", remote, getCookie(second, "__Host-emc2_ceremony"), auth.assertion(first.body.challenge, userId))).status, 400);
  const invite = await f.connect();
  f.gate.setTailnetOrigin(undefined);
  assert.equal((await f.call("/api/synthetic", remote, getCookie(result, "__Host-emc2_browser_session"))).status, 403);
  f.gate.setTailnetOrigin(remote, 10_000_000);
  assert.equal((await f.call("/api/synthetic", remote, getCookie(result, "__Host-emc2_browser_session"))).status, 200);
  // An intervening lease loss must invalidate an invitation, even after the same origin recovers.
  assert.equal((await f.call("/auth/passkey/pair", remote, "", { token: invite.token })).status, 400);
});

test("registration is cookie-bound, consumes approval once and requires user verification", async (t) => {
  const f = await fixture(t);
  for (const uv of [false, true]) {
    const invite = await f.connect();
    const claimed = await f.call("/auth/passkey/pair", remote, "", { token: invite.token });
    const cookie = getCookie(claimed, "__Host-emc2_pair");
    await f.host("approve", { confirm: true, id: invite.id });
    const options = await f.call("/auth/passkey/register/options", remote, cookie, {});
    const auth = authenticator(); const response = auth.registration(options.body.challenge, remote, uv);
    assert.equal((await f.call("/auth/passkey/register/verify", remote, "", response)).status, 400);
    if (!uv) {
      assert.equal((await f.call("/auth/passkey/register/verify", remote, cookie, response)).status, 400);
      assert.equal(f.credentials.size, 0);
    } else {
      const results = await Promise.all([f.call("/auth/passkey/register/verify", remote, cookie, response), f.call("/auth/passkey/register/verify", remote, cookie, response)]);
      assert.deepEqual(results.map(({ status }) => status).sort(), [200, 400]); assert.equal(f.credentials.size, 1);
    }
  }
});
test("host cancellation and credential revocation win against in-flight cryptographic verification", async (t) => {
  let registrationEntered!: () => void, releaseRegistration!: () => void;
  const registrationEntry = new Promise<void>((resolve) => { registrationEntered = resolve; });
  const registrationHold = new Promise<void>((resolve) => { releaseRegistration = resolve; });
  let holdRegistration = true;
  let authEntered!: () => void, releaseAuth!: () => void;
  const authEntry = new Promise<void>((resolve) => { authEntered = resolve; });
  const authHold = new Promise<void>((resolve) => { releaseAuth = resolve; });
  const f = await fixture(t, {
    verifyRegistration: async (options) => { const result = await verifyRegistrationResponse(options); if (holdRegistration) { registrationEntered(); await registrationHold; } return result; },
    verifyAuthentication: async (options) => { const result = await verifyAuthenticationResponse(options); authEntered(); await authHold; return result; },
  });
  t.after(() => { releaseRegistration(); releaseAuth(); });
  const invite = await f.connect();
  const claimed = await f.call("/auth/passkey/pair", remote, "", { token: invite.token }); const cookie = getCookie(claimed, "__Host-emc2_pair");
  await f.host("approve", { confirm: true, id: invite.id });
  const options = await f.call("/auth/passkey/register/options", remote, cookie, {});
  const pending = f.call("/auth/passkey/register/verify", remote, cookie, authenticator().registration(options.body.challenge)); await registrationEntry;
  await f.host("cancel", { confirm: true, id: invite.id }); releaseRegistration();
  assert.equal((await pending).status, 400); assert.equal(f.credentials.size, 0);
  holdRegistration = false;
  const enrolled = await enroll(f);
  const authOptions = await f.call("/auth/passkey/login/options", remote, "", {});
  const authenticating = f.call("/auth/passkey/login/verify", remote, getCookie(authOptions, "__Host-emc2_ceremony"), enrolled.auth.assertion(authOptions.body.challenge, enrolled.userId)); await authEntry;
  await f.host("revoke", { confirm: true, id: enrolled.auth.id }); releaseAuth();
  assert.equal((await authenticating).status, 400); assert.equal(f.credentials.size, 0);
});

 test("a claimed invitation allows time for host approval, but still expires and grants no early access", async (t) => {
  const f = await fixture(t); const invite = await f.connect();
  const result = await f.call("/auth/passkey/pair", remote, "", { token: invite.token });
  const cookie = getCookie(result, "__Host-emc2_pair");
  f.advance(120001);
  assert.equal((await f.call("/auth/passkey/pair/status", remote, cookie, {})).status, 200);
  assert.equal((await f.call("/auth/passkey/register/options", remote, cookie, {})).status, 400);
  assert.equal((await f.call("/api/synthetic", remote, cookie)).status, 401);
  assert.equal((await f.host("approve", { confirm: true, id: invite.id })).status, 200);
  assert.equal((await f.call("/auth/passkey/register/options", remote, cookie, {})).status, 200);
  f.advance(480000);
  assert.equal((await f.call("/auth/passkey/pair/status", remote, cookie, {})).status, 400);
});

test("phone-initiated setup still requires matching localhost approval and verified registration", async (t) => {
  const f = await fixture(t);
  const requested = await f.call("/auth/passkey/request", remote, "", {});
  assert.equal(requested.status, 200);
  const cookie = getCookie(requested, "__Host-emc2_pair");
  assert.equal((await f.call("/api/synthetic", remote, cookie)).status, 401);
  assert.equal((await f.call("/auth/passkey/register/options", remote, cookie, {})).status, 400);
  const host = await f.host(); assert.equal(host.body.pairing.code, requested.body.code);
  assert.equal((await f.call("/auth/passkey/request", remote, "", {})).status, 400, "another browser cannot replace the request");
  assert.equal((await f.call("/auth/passkey/request", remote, cookie, {})).body.code, requested.body.code);
  assert.equal((await f.call("/auth/passkey/request", local, f.login, {})).status, 403);
  assert.equal((await f.call("/auth/passkey/request", remote, "", {}, {Origin:"https://evil.test"})).status, 403);
  assert.equal((await f.host("approve", {confirm:true,id:host.body.pairing.id})).status, 200);
  const options = await f.call("/auth/passkey/register/options", remote, cookie, {});
  const auth = authenticator();
  const result = await f.call("/auth/passkey/register/verify", remote, cookie, auth.registration(options.body.challenge));
  assert.equal(result.status, 200);
  assert.equal((await f.call("/api/synthetic", remote, getCookie(result,"__Host-emc2_browser_session"))).status, 200);
});
