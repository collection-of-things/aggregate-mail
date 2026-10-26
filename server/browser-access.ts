import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import express from "express";

export function browserConfiguration(env: NodeJS.ProcessEnv, root = process.cwd()) {
  const password = env.MAIL_WEB_PASSWORD;
  if (!password || password.length < 16 || password.length > 256)
    throw new Error("Browser mode requires MAIL_WEB_PASSWORD with 16 to 256 characters.");
  if (!env.MAIL_DATA_KEY || !/^[A-Za-z0-9+/]{43}=$/.test(env.MAIL_DATA_KEY) || Buffer.from(env.MAIL_DATA_KEY, "base64").length !== 32)
    throw new Error("Browser mode requires an externally supplied 32-byte base64 MAIL_DATA_KEY.");
  browserProfileDirectory(env, root);
  const port = Number(env.MAIL_WEB_PORT || "3001");
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("MAIL_WEB_PORT must be an integer between 1024 and 65535.");
  const url = new URL(env.APP_URL || `http://127.0.0.1:${port}`);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash)
    throw new Error("Browser APP_URL must be a plain loopback HTTP origin.");
  return { password, origin: url.origin, port };
}

export function browserProfileDirectory(env: NodeJS.ProcessEnv, root = process.cwd()) {
  const directory = env.MAIL_DATA_DIR;
  if (!directory || !path.isAbsolute(directory))
    throw new Error("Browser mode requires an absolute, separate MAIL_DATA_DIR.");
  // Resolve existing parents too, so a symlink cannot move private data into assets.
  const canonical = (value: string): string => {
    const resolved = path.resolve(value);
    if (existsSync(resolved)) return realpathSync(resolved);
    return path.join(canonical(path.dirname(resolved)), path.basename(resolved));
  };
  const data = canonical(directory);
  for (const protectedRoot of [root, env.MAIL_STATIC_DIR || path.join(root, "dist")]) {
    const relative = path.relative(canonical(protectedRoot), data);
    if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)))
      throw new Error("Browser data must be outside the source and frontend directories.");
  }
  if (["key", "key.protected", "key.local", ".renamed-to-emc2"].some((name) => existsSync(path.join(data, name))))
    throw new Error("Browser mode needs a separate profile without desktop or legacy key files.");
  return data;
}

export function tailnetOrigin(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !/^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/.test(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash)
    throw new Error("Phone access requires an exact Tailscale HTTPS origin.");
  return url.origin;
}
const idleLifetime = 30 * 60_000;
const totalLifetime = 8 * 60 * 60_000;

export function browserAccess(password: string, origin: string, now = Date.now) {
  const router = express.Router();
  let remoteOrigin: string | undefined;
  let remoteProofUntil = 0;
  let remoteGeneration = 0;
  const sessions = new Map<string, { origin: string; credentialId?: string; created: number; touched: number }>();
  const expireRemoteSession = () => {
    const time = now();
    for (const [token, session] of sessions) if (
      (session.origin === remoteOrigin && time >= remoteProofUntil) ||
      time - session.created >= totalLifetime || time - session.touched >= idleLifetime
    ) sessions.delete(token);
    if (remoteOrigin && time >= remoteProofUntil) { remoteOrigin = undefined; remoteGeneration++; }
  };
  const originFor = (req: express.Request) => {
    expireRemoteSession();
    if (remoteOrigin && now() < remoteProofUntil && req.headers.host === new URL(remoteOrigin).host) return remoteOrigin;
    const hosts = [`127.0.0.1:${req.socket.localPort}`, `localhost:${req.socket.localPort}`, new URL(origin).host];
    return hosts.includes(req.headers.host || "") ? origin : undefined;
  };
  const cookie = (req: express.Request) => {
    const secure = originFor(req)?.startsWith("https:") === true;
    return { name: secure ? "__Host-emc2_browser_session" : "emc2_browser_session", options: { httpOnly: true, sameSite: "strict" as const, path: "/", secure } };
  };
  const salt = randomBytes(32);
  const passwordHash = scryptSync(password, salt, 32);
  let attempts = 0;
  let windowStart = now();
  const sessionFor = (req: express.Request) => {
    const requestOrigin = originFor(req);
    const cookieName = cookie(req).name;
    const cookies = req.headers.cookie?.split(";").map((entry) => entry.trim()).filter((entry) => entry.startsWith(`${cookieName}=`)) || [];
    if (cookies.length !== 1) return;
    const token = cookies[0].slice(cookieName.length + 1);
    if (!/^[a-f0-9]{64}$/.test(token)) return;
    const session = sessions.get(token);
    if (session && session.origin === requestOrigin) return { token, session };
  };
  const authenticated = (req: express.Request, touch = true) => {
    const current = sessionFor(req);
    if (!current) return false;
    if (touch) current.session.touched = now();
    return true;
  };
  const issueSession = (req: express.Request, res: express.Response, credentialId?: string) => {
    expireRemoteSession();
    const requestOrigin = originFor(req);
    if (!requestOrigin) throw new Error("Origin unavailable");
    // Password logins still rotate other password sessions; each paired phone is independent.
    for (const [token, session] of sessions) if (session.credentialId === credentialId) sessions.delete(token);
    if (sessions.size >= 16) sessions.delete(sessions.keys().next().value!);
    const token = randomBytes(32).toString("hex");
    sessions.set(token, { origin: requestOrigin, credentialId, created: now(), touched: now() });
    const { name, options } = cookie(req);
    res.cookie(name, token, { ...options, maxAge: totalLifetime });
    return requestOrigin;
  };
  const authRouter = express.Router();
  const page = (res: express.Response, unlocked = false, error = "") => {
    const local = originFor(res.req) === origin && res.req.headers.host === new URL(origin).host;
    return res.type("html").send(`<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Unlock Emc²</title>
<body><main><h1>${unlocked ? "Emc² is unlocked" : "Unlock Emc²"}</h1>
<p>${unlocked ? "Lock this browser session when you finish." : "Unlock with a passkey, or use your host recovery passphrase."}</p>
${unlocked || local ? "" : '<button type="button" id="passkey-unlock">Unlock with passkey</button><p id="passkey-status" role="status"></p><p>First visit? Scan Connect phone in Settings on your host.</p>'}
${error ? `<p role="alert">${error}</p>` : ""}
${unlocked || local ? `<form method="post" action="/auth/${unlocked ? "lock" : "login"}">
${unlocked ? '<p><a href="/">Open inbox</a></p>' : '<label for="password">Password</label> <input id="password" name="password" type="password" minlength="16" maxlength="256" autocomplete="current-password" required autofocus>'}
<button type="submit">${unlocked ? "Lock inbox" : "Unlock inbox"}</button></form>` : ""}
<p>Sessions lock after 30 minutes without a request and after eight hours total. To lock now, open <a href="/auth">Browser access</a>.</p>
<script src="/auth/passkey.js" defer></script>
<script src="/auth/client.js" defer></script></main></body></html>`);
  };
  router.use((req, res, next) => {
    res.set({
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; script-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    });
    const requestOrigin = originFor(req);
    res.set("X-Emc2-Browser", "1");
    if (!requestOrigin || (req.headers.origin && req.headers.origin !== requestOrigin))
      return res.status(403).type("text").send("Local origin required.");
    next();
  });
  router.use(authRouter);
  router.get("/auth/session", (req, res) => res.json({ authenticated: authenticated(req, false) }));
  router.get("/auth/client.js", (_req, res) => res.type("application/javascript").send(
    'fetch("/auth/session", { cache: "no-store" }).then(r => r.json()).then(s => { if (!s.authenticated && typeof BroadcastChannel !== "undefined") { const channel = new BroadcastChannel("emc2-browser-access"); channel.postMessage("locked"); channel.close(); } }).catch(() => {});',
  ));
  router.get("/auth", (req, res) => page(res, authenticated(req)));
  router.post(["/auth/login", "/auth/lock"], (req, res, next) => {
    if (req.headers.origin !== originFor(req)) return res.status(403).type("text").send("Local origin required.");
    next();
  });
  router.post("/auth/login", (req, res, next) => {
    if (originFor(req) !== origin || req.headers.host !== new URL(origin).host) return res.status(403).send("Use passkeys on the phone. Recovery sign-in is available only on localhost.");
    next();
  }, express.urlencoded({ extended: false, limit: "2kb", inflate: false }), (req, res) => {
    if (now() - windowStart >= 60_000) { attempts = 0; windowStart = now(); }
    if (attempts >= 5) {
      res.set("Retry-After", String(Math.max(1, Math.ceil((60_000 - (now() - windowStart)) / 1000))));
      res.status(429);
      return page(res, false, "Too many attempts. Wait a minute and try again.");
    }
    attempts++;
    const supplied = req.body?.password;
    if (typeof supplied !== "string" || supplied.length > 256 || !timingSafeEqual(scryptSync(supplied, salt, 32), passwordHash)) {
      res.status(401);
      return page(res, false, "Unable to unlock. Check your password.");
    }
    const returnOrigin = issueSession(req, res);
    res.redirect(303, returnOrigin);
  });
  router.post("/auth/lock", (req, res) => {
    if (!authenticated(req)) return res.status(401).type("text").send("Unlock the inbox first.");
    const current = sessionFor(req);
    if (current) sessions.delete(current.token);
    const { name, options } = cookie(req);
    res.clearCookie(name, options);
    res.redirect(303, "/auth");
  });
  router.use((req, res, next) => {
    // MCP has its own bearer gate. OAuth return still requires its one-use state.
    if (req.path === "/mcp" || req.path.startsWith("/mcp/") || (req.method === "GET" && req.path === "/api/oauth/google/callback")) return next();
    if (authenticated(req)) return next();
    if (req.path === "/api" || req.path.startsWith("/api/"))
      return res.status(401).json({ error: "Unlock Emc² at /auth to access this inbox." });
    if (req.method === "GET" || req.method === "HEAD") return page(res);
    res.status(401).type("text").send("Unlock the inbox first.");
  });
  router.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    // Parser errors must never echo a submitted password or request body.
    res.status(400).type("text").send("Unable to process browser access request.");
  });
  return Object.assign(router, {
    originFor, authRouter, authenticated, issueSession,
    phoneEpoch() { expireRemoteSession(); return remoteGeneration; },
    phoneOrigin() { expireRemoteSession(); return remoteOrigin && now() < remoteProofUntil ? remoteOrigin : undefined; },
    revokeCredential(id: string) { for (const [token, session] of sessions) if (session.credentialId === id) sessions.delete(token); },
    localOrigin: origin,
    setTailnetOrigin(value: string | undefined, validUntil = now() + 60_000) {
      expireRemoteSession();
      const next = value ? tailnetOrigin(value) : undefined;
      if (next !== remoteOrigin) for (const [token, session] of sessions) if (session.origin === remoteOrigin) sessions.delete(token);
      if (next !== remoteOrigin) remoteGeneration++;
      remoteOrigin = next;
      remoteProofUntil = validUntil;
    },
  });
}
