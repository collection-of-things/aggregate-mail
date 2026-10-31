import { createHash, randomBytes, randomInt } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import path from "node:path";
import express from "express";
import QRCode from "qrcode";
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse,
  type RegistrationResponseJSON, type AuthenticationResponseJSON } from "@simplewebauthn/server";
import { browserAuthPage } from "./browser-auth-page.js";
import type { PhoneCredential, PhoneDevices, PhonePairing } from "../shared/phone-access.js";
import type { browserAccess } from "./browser-access.js";

type Gate = ReturnType<typeof browserAccess>;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const secret = () => randomBytes(32).toString("base64url");
const cookieOptions = { secure: true, httpOnly: true, sameSite: "strict" as const, path: "/", maxAge: 120_000 };
const claimCookie = "__Host-emc2_pair";
const ceremonyCookie = "__Host-emc2_ceremony";
const readCookie = (req: express.Request, name: string) => {
  const values = req.headers.cookie?.split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`));
  if (values?.length !== 1) return "";
  const value = values[0].slice(name.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? hash(value) : "";
};
export function phonePasskeys(options: {
  gate: Gate;
  list: () => PhoneCredential[];
  save: (credential: PhoneCredential) => void;
  remove: (id: string) => void;
  now?: () => number;
  verifyRegistration?: typeof verifyRegistrationResponse;
  verifyAuthentication?: typeof verifyAuthenticationResponse;
}) {
  const { gate } = options;
  gate.trustPairedBrowsers({ list: options.list, save: options.save });
  const now = options.now || Date.now;
  let pairing: (PhonePairing & { origin: string; epoch: number; inviteHash?: string; claimHash?: string; challenge?: string; userId?: string; verifying?: boolean }) | undefined;
  const ceremonies = new Map<string, { challenge: string; origin: string; epoch: number; expiresAt: number }>();
  const authenticating = new Set<string>();
  let attemptStart = now(), attempts = 0;
  const remote = (req: express.Request) => {
    const origin = gate.phoneOrigin();
    if (!origin || gate.originFor(req) !== origin) throw new Error("remote");
    return origin;
  };
  const pending = () => {
    if (pairing && (pairing.expiresAt <= now() || pairing.origin !== gate.phoneOrigin() || pairing.epoch !== gate.phoneEpoch())) pairing = undefined;
    return pairing;
  };
  const claim = (req: express.Request) => {
    const value = pending();
    if (!value || value.origin !== remote(req) || !value.claimHash || value.claimHash !== readCookie(req, claimCookie)) throw new Error("claim");
    return value;
  };
  const limit = () => {
    if (now() - attemptStart >= 60_000) { attemptStart = now(); attempts = 0; }
    if (++attempts > 10) throw new Error("limit");
    for (const [key, value] of ceremonies) if (value.expiresAt <= now() || value.origin !== gate.phoneOrigin() || value.epoch !== gate.phoneEpoch()) ceremonies.delete(key);
  };
  const host = (req: express.Request, write = false) => {
    if (!gate.authenticated(req) || gate.originFor(req) !== gate.localOrigin || req.headers.host !== new URL(gate.localOrigin).host || (write && req.headers.origin !== gate.localOrigin)) throw new Error("host");
  };
  const snapshot = (): PhoneDevices => {
    const value = pending();
    return { devices: options.list().map(({ id, name, createdAt }) => ({ id, name, createdAt })),
      ...(value ? { pairing: { id: value.id, phase: value.phase, code: value.code, expiresAt: value.expiresAt } } : {}) };
  };
  const auth = express.Router();
  auth.get("/auth/passkey.js", (_req, res) => res.sendFile("auth-passkey.js", { root: path.resolve(process.env.MAIL_STATIC_DIR || "dist") }));
  auth.get("/auth/pair", (req, res) => {
    try { remote(req); } catch { return res.status(403).send("Open the private phone address from the QR code."); }
    res.type("html").send(browserAuthPage("Connect phone to Emc²", `<h1>Connect this phone</h1><p>One approval. Then unlock with your screen lock.</p><p id="passkey-status" role="status" aria-live="polite">Checking invitation…</p><p id="pair-code" aria-label="Matching code"></p><button type="button" id="passkey-connect" hidden>Connect this device</button><button type="button" id="passkey-register" disabled>Save passkey and open inbox</button><ol class="steps"><li>Compare this code with the host.</li><li>Approve this device on the host.</li><li>Save a passkey using your screen lock.</li></ol><a class="secondary" href="/auth#first-time">Back to unlock and setup help</a>`));
  });
  auth.use("/auth/passkey", (req, res, next) => {
    try { remote(req); if (req.method !== "POST" || req.headers.origin !== gate.phoneOrigin()) throw new Error("origin"); next(); }
    catch { res.status(403).json({ error: "Use the private phone address." }); }
  }, express.json({ limit: "64kb", inflate: false }));
  const post = (route: string, action: (req: express.Request, res: express.Response) => Promise<void>) => auth.post(`/auth/passkey/${route}`, async (req, res) => {
    try { await action(req, res); }
    catch { res.status(400).json({ error: "Unable to verify phone access. Reconnect from Settings on the host." }); }
  });
  post("request", async (req, res) => {
    limit();
    let existing;
    try { existing = claim(req); } catch { /* A new browser has no claim yet. */ }
    if (existing && ["claimed", "approved"].includes(existing.phase)) {
      res.json({ code: existing.code, approved: existing.phase === "approved" }); return;
    }
    if (pending() && pending()!.phase !== "complete") throw new Error("active");
    if (options.list().length >= 8) throw new Error("capacity");
    const token = secret();
    pairing = { id: randomBytes(16).toString("hex"), origin: remote(req), epoch: gate.phoneEpoch(),
      expiresAt: now() + 10 * 60_000, phase: "claimed", claimHash: hash(token), code: String(randomInt(100000, 1000000)) };
    res.cookie(claimCookie, token, { ...cookieOptions, maxAge: 10 * 60_000 }).json({ code: pairing.code, approved: false });
  });
  post("pair", async (req, res) => {
    limit();
    const value = pending();
    if (!value || value.phase !== "waiting" || typeof req.body?.token !== "string" || req.body.token.length !== 43 || hash(req.body.token) !== value.inviteHash) throw new Error("invite");
    const token = secret();
    value.inviteHash = undefined; value.claimHash = hash(token); value.phase = "claimed";
    value.code = String(randomInt(100000, 1000000));
    // Scanning consumes the short-lived invitation; allow time for host approval and the OS prompt.
    value.expiresAt = now() + 10 * 60_000;
    res.cookie(claimCookie, token, { ...cookieOptions, maxAge: 10 * 60_000 }).json({ code: value.code, approved: false });
  });
  post("pair/status", async (req, res) => {
    const value = claim(req);
    res.json({ code: value.code, approved: value.phase === "approved" });
  });
  post("register/options", async (req, res) => {
    const value = claim(req);
    if (value.phase !== "approved" || value.verifying || options.list().length >= 8) throw new Error("approval");
    // Mark in-flight before awaiting option generation, so cancellation cannot revive it.
    value.verifying = true;
    try {
      const result = await generateRegistrationOptions({ rpName: "Emc²", rpID: new URL(value.origin).hostname,
        userName: "Emc² phone", userID: randomBytes(32), userDisplayName: "Emc²", attestationType: "none", timeout: 60_000,
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
        supportedAlgorithmIDs: [-7, -257], excludeCredentials: options.list().map(({ id, transports }) => ({ id, transports })) });
      if (pending() !== value || claim(req) !== value) throw new Error("cancelled");
      value.challenge = result.challenge; value.userId = result.user.id;
      res.json(result);
    } finally { value.verifying = false; }
  });
  post("register/verify", async (req, res) => {
    const value = claim(req);
    const challenge = value.challenge;
    if (value.phase !== "approved" || value.verifying || !challenge || !value.userId) throw new Error("challenge");
    value.challenge = undefined; value.verifying = true;
    try {
      const result = await (options.verifyRegistration || verifyRegistrationResponse)({ response: req.body as RegistrationResponseJSON,
        expectedChallenge: challenge, expectedOrigin: value.origin, expectedRPID: new URL(value.origin).hostname,
        requireUserVerification: true, supportedAlgorithmIDs: [-7, -257] });
      if (!result.verified || !result.registrationInfo.userVerified || pending() !== value || claim(req) !== value || options.list().length >= 8) throw new Error("verification");
      const credential = result.registrationInfo.credential;
      if (options.list().some(({ id }) => id === credential.id)) throw new Error("duplicate");
      let number = 1;
      while (options.list().some(({ name }) => name === `Phone ${number}`)) number++;
      options.save({ id: credential.id, name: `Phone ${number}`, createdAt: now(), origin: value.origin,
        publicKey: Buffer.from(credential.publicKey).toString("base64url"), counter: credential.counter, transports: credential.transports, userId: value.userId });
      value.phase = "complete"; value.claimHash = undefined; value.userId = undefined;
      gate.issueSession(req, res, credential.id);
      res.clearCookie(claimCookie, cookieOptions).json({ ok: true });
    } catch (error) { if (pairing === value) pairing = undefined; throw error; }
    finally { value.verifying = false; }
  });
  post("login/options", async (req, res) => {
    limit();
    const origin = remote(req);
    const result = await generateAuthenticationOptions({ rpID: new URL(origin).hostname, userVerification: "required", timeout: 60_000 });
    if (remote(req) !== origin) throw new Error("origin");
    const token = secret();
    if (ceremonies.size >= 32) ceremonies.delete(ceremonies.keys().next().value!);
    ceremonies.set(hash(token), { challenge: result.challenge, origin, epoch: gate.phoneEpoch(), expiresAt: now() + 60_000 });
    res.cookie(ceremonyCookie, token, cookieOptions).json(result);
  });
  post("login/verify", async (req, res) => {
    const key = readCookie(req, ceremonyCookie);
    const ceremony = ceremonies.get(key); ceremonies.delete(key);
    const credential = options.list().find(({ id }) => id === req.body?.id);
    const origin = remote(req);
    if (!ceremony || ceremony.origin !== origin || ceremony.epoch !== gate.phoneEpoch() || ceremony.expiresAt <= now() || !credential || credential.origin !== origin || authenticating.has(credential.id)) throw new Error("credential");
    if (req.body?.response?.userHandle !== credential.userId) throw new Error("user");
    authenticating.add(credential.id);
    try {
      const result = await (options.verifyAuthentication || verifyAuthenticationResponse)({ response: req.body as AuthenticationResponseJSON,
        expectedChallenge: ceremony.challenge, expectedOrigin: origin, expectedRPID: new URL(origin).hostname, requireUserVerification: true,
        credential: { id: credential.id, publicKey: Buffer.from(credential.publicKey, "base64url"), counter: credential.counter, transports: credential.transports } });
      if (!result.verified || !result.authenticationInfo.userVerified || remote(req) !== origin || ceremony.epoch !== gate.phoneEpoch() || ceremony.expiresAt <= now() || !isDeepStrictEqual(credential, options.list().find(({ id }) => id === credential.id))) throw new Error("verification");
      options.save({ ...credential, counter: result.authenticationInfo.newCounter });
      gate.issueSession(req, res, credential.id);
      res.clearCookie(ceremonyCookie, cookieOptions).json({ ok: true });
    } finally { authenticating.delete(credential.id); }
  });
  gate.authRouter.use(auth);
  return {
    mount(app: express.Express) {
      app.get("/api/phone-devices", (req, res) => {
        try { host(req); res.json(snapshot()); } catch { res.status(403).json({ error: "Manage phones from localhost on the host." }); }
      });
      app.post("/api/phone-devices/:action", async (req, res) => {
        try { host(req, true); } catch { return res.status(403).json({ error: "Manage phones from localhost on the host." }); }
        if (req.body?.confirm !== true) return res.status(400).json({ error: "Confirm this phone change." });
        try {
          const value = pending();
          switch (req.params.action) {
            case "connect": {
              const origin = gate.phoneOrigin();
              if (!origin || options.list().length >= 8) throw new Error("unavailable");
              const token = secret();
              const next = { id: randomBytes(16).toString("hex"), origin, epoch: gate.phoneEpoch(), expiresAt: now() + 120_000, phase: "waiting" as const, inviteHash: hash(token) };
              pairing = next;
              const url = `${origin}/auth/pair#${token}`;
              const qr = await QRCode.toDataURL(url, { errorCorrectionLevel: "M", width: 240, margin: 2 });
              if (pending() !== next) throw new Error("cancelled");
              res.json({ ...snapshot(), pairing: { ...snapshot().pairing!, qr, url } }); return;
            }
            case "approve":
              if (!value || value.id !== req.body.id || value.phase !== "claimed") throw new Error("request");
              value.phase = "approved"; break;
            case "cancel":
              if (!value || value.id !== req.body.id) throw new Error("request");
              pairing = undefined; break;
            case "revoke":
              if (typeof req.body.id !== "string" || !options.list().some(({ id }) => id === req.body.id)) throw new Error("device");
              options.remove(req.body.id); gate.revokeCredential(req.body.id); break;
            default: throw new Error("action");
          }
          res.json(snapshot());
        } catch { res.status(400).json({ error: "Phone setup expired or is unavailable. Refresh and connect again." }); }
      });
    },
  };
}
