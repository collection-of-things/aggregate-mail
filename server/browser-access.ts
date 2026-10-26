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
  const url = new URL(env.APP_URL || "http://127.0.0.1:3001");
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash)
    throw new Error("Browser APP_URL must be a plain loopback HTTP origin.");
  return { password, origin: url.origin };
}

const cookieName = "emc2_browser_session";
const cookieOptions = { httpOnly: true, sameSite: "strict" as const, path: "/" };
const idleLifetime = 30 * 60_000;
const totalLifetime = 8 * 60 * 60_000;

export function browserAccess(password: string, origin: string, now = Date.now) {
  const router = express.Router();
  const salt = randomBytes(32);
  const passwordHash = scryptSync(password, salt, 32);
  let session: { token: string; created: number; touched: number } | undefined;
  let attempts = 0;
  let windowStart = now();
  const authenticated = (req: express.Request, touch = true) => {
    if (!session) return false;
    const time = now();
    if (time - session.created >= totalLifetime || time - session.touched >= idleLifetime) {
      session = undefined;
      return false;
    }
    const cookies = req.headers.cookie?.split(";").map((entry) => entry.trim()).filter((entry) => entry.startsWith(`${cookieName}=`)) || [];
    if (cookies.length !== 1) return false;
    const token = cookies[0].slice(cookieName.length + 1);
    if (!/^[a-f0-9]{64}$/.test(token) || !timingSafeEqual(Buffer.from(token), Buffer.from(session.token))) return false;
    if (touch) session.touched = time;
    return true;
  };
  const page = (res: express.Response, unlocked = false, error = "") => res.type("html").send(`<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Unlock Emc²</title>
<body><main><h1>${unlocked ? "Emc² is unlocked" : "Unlock Emc²"}</h1>
<p>${unlocked ? "Lock this browser session when you finish." : "Enter your local browser password to access your inbox."}</p>
${error ? `<p role="alert">${error}</p>` : ""}
<form method="post" action="/auth/${unlocked ? "lock" : "login"}">
${unlocked ? '<p><a href="/">Open inbox</a></p>' : '<label for="password">Password</label> <input id="password" name="password" type="password" minlength="16" maxlength="256" autocomplete="current-password" required autofocus>'}
<button type="submit">${unlocked ? "Lock inbox" : "Unlock inbox"}</button></form>
<p>Sessions lock after 30 minutes without a request and after eight hours total. To lock now, open <a href="/auth">Browser access</a>.</p>
<script src="/auth/client.js" defer></script></main></body></html>`);
  router.use((req, res, next) => {
    res.set({
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; script-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    });
    const host = req.headers.host;
    const validHosts = [`127.0.0.1:${req.socket.localPort}`, `localhost:${req.socket.localPort}`, new URL(origin).host];
    if (!host || !validHosts.includes(host) || (req.headers.origin && req.headers.origin !== origin))
      return res.status(403).type("text").send("Local origin required.");
    next();
  });
  router.get("/auth/session", (req, res) => res.json({ authenticated: authenticated(req, false) }));
  router.get("/auth/client.js", (_req, res) => res.type("application/javascript").send(
    'fetch("/auth/session", { cache: "no-store" }).then(r => r.json()).then(s => { if (!s.authenticated && typeof BroadcastChannel !== "undefined") { const channel = new BroadcastChannel("emc2-browser-access"); channel.postMessage("locked"); channel.close(); } }).catch(() => {});',
  ));
  router.get("/auth", (req, res) => page(res, authenticated(req)));
  router.post(["/auth/login", "/auth/lock"], (req, res, next) => {
    if (req.headers.origin !== origin) return res.status(403).type("text").send("Local origin required.");
    next();
  });
  router.post("/auth/login", express.urlencoded({ extended: false, limit: "2kb" }), (req, res) => {
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
    // A new login replaces the single session; no credentials persist to disk.
    const time = now();
    session = { token: randomBytes(32).toString("hex"), created: time, touched: time };
    res.cookie(cookieName, session.token, { ...cookieOptions, maxAge: totalLifetime });
    res.redirect(303, origin);
  });
  router.post("/auth/lock", (req, res) => {
    if (!authenticated(req)) return res.status(401).type("text").send("Unlock the inbox first.");
    session = undefined;
    res.clearCookie(cookieName, cookieOptions);
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
  return router;
}
