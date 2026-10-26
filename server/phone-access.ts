import { execFile } from "node:child_process";
import { isDeepStrictEqual, promisify } from "node:util";
import type express from "express";
import type { PhoneAccessRecord, PhoneAccessStatus } from "../shared/phone-access.js";
import { tailnetOrigin, type browserAccess } from "./browser-access.js";

const execute = promisify(execFile);
type Run = (args: string[]) => Promise<string>;
type ServeConfig = {
  TCP?: Record<string, { HTTPS?: boolean; HTTP?: boolean }>;
  Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }>;
  AllowFunnel?: Record<string, boolean>;
};
const runTailscale: Run = async (args) => {
  const env = Object.fromEntries(["PATH", "HOME", "USERPROFILE", "SystemRoot", "SYSTEMROOT", "LOCALAPPDATA", "TEMP", "TMP", "XDG_RUNTIME_DIR"].flatMap((name) => process.env[name] ? [[name, process.env[name]!]] : []));
  const { stdout } = await execute(process.platform === "win32" ? "tailscale.exe" : "tailscale", args, { env, timeout: 10_000, maxBuffer: 262144, windowsHide: true });
  return stdout;
};
const probeHttps = async (origin: string, expected: number) => {
  const response = await fetch(`${origin}/auth`, { redirect: "error", signal: AbortSignal.timeout(5000) });
  try {
    if (response.status !== expected || response.headers.get("x-emc2-browser") !== "1") throw new Error("probe");
  } finally { await response.body?.cancel(); }
};
class PhoneError extends Error {
  constructor(readonly state: PhoneAccessStatus["state"], message: string) { super(message); }
}
const unavailable = () => new PhoneError("unavailable", "Tailscale is unavailable. Install its CLI on this host and check the host user's permission.");

export function phoneAccess(options: {
  gate: ReturnType<typeof browserAccess>;
  load: () => PhoneAccessRecord | undefined;
  save: (value: PhoneAccessRecord | undefined) => void;
  port: () => number;
  run?: Run;
  probe?: (origin: string, expected: number) => Promise<void>;
  now?: () => number;
}) {
  const run = options.run || runTailscale;
  const probe = options.probe || probeHttps;
  const now = options.now || Date.now;
  let busy = false;
  let generation = 0;
  let verified = false;
  let proofUntil = 0;
  let closed = false;
  let warning = "";
  const config = async (): Promise<ServeConfig> => {
    try {
      const value: unknown = JSON.parse(await run(["serve", "status", "--json"]));
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("config");
      return value as ServeConfig;
    } catch { throw unavailable(); }
  };
  const dnsName = async () => {
    let status: { BackendState?: string; Self?: { Online?: boolean; DNSName?: string } };
    try { status = JSON.parse(await run(["status", "--json"])); } catch { throw unavailable(); }
    if (status.BackendState !== "Running" || status.Self?.Online !== true)
      throw new PhoneError("needs-login", "Open Tailscale on this host, sign in and connect before enabling phone access.");
    const dns = status.Self.DNSName?.replace(/\.$/, "");
    try { return new URL(tailnetOrigin(`https://${dns}`)).hostname; }
    catch { throw new PhoneError("unavailable", "This host needs a Tailscale MagicDNS name and HTTPS support."); }
  };
  const endpoint = (record: PhoneAccessRecord) => new URL(record.origin).host;
  const target = (record: PhoneAccessRecord) => `http://127.0.0.1:${record.backendPort}`;
  const matches = (value: ServeConfig, record: PhoneAccessRecord) =>
    isDeepStrictEqual(value.TCP?.[String(record.httpsPort)], { HTTPS: true }) &&
    Object.keys(value.Web || {}).filter((key) => key.endsWith(`:${record.httpsPort}`)).length === 1 &&
    isDeepStrictEqual(value.Web?.[endpoint(record)]?.Handlers, { "/": { Proxy: target(record) } }) &&
    (value.AllowFunnel?.[endpoint(record)] === undefined || value.AllowFunnel[endpoint(record)] === false);
  const withoutOwned = (value: ServeConfig, record: PhoneAccessRecord) => {
    const copy = structuredClone(value);
    if (copy.TCP) { delete copy.TCP[String(record.httpsPort)]; if (!Object.keys(copy.TCP).length) delete copy.TCP; }
    if (copy.Web) { delete copy.Web[endpoint(record)]; if (!Object.keys(copy.Web).length) delete copy.Web; }
    if (copy.AllowFunnel) { delete copy.AllowFunnel[endpoint(record)]; if (!Object.keys(copy.AllowFunnel).length) delete copy.AllowFunnel; }
    return copy;
  };
  const revoke = () => { generation++; verified = false; options.gate.setTailnetOrigin(undefined); };
  const validRecord = (value: PhoneAccessRecord) => {
    try {
      return tailnetOrigin(value.origin) === value.origin && Number.isInteger(value.httpsPort) && value.httpsPort >= 8444 && value.httpsPort <= 8454 &&
        new URL(value.origin).port === String(value.httpsPort) && value.backendPort === options.port() && ["pending", "ready"].includes(value.phase);
    } catch { return false; }
  };
  const check = async (record: PhoneAccessRecord) => {
    if (!validRecord(record) || new URL(record.origin).hostname !== await dnsName() || !matches(await config(), record))
      throw new PhoneError("error", "The saved private route changed or Funnel is enabled. Phone access is suspended; check Tailscale on the host.");
  };
  const removeOwned = async (record: PhoneAccessRecord) => {
    if (!validRecord(record)) throw new PhoneError("error", "The saved route is invalid. It was left unchanged.");
    const before = await config();
    if (!before.TCP?.[String(record.httpsPort)] && !Object.keys(before.Web || {}).some((key) => key.endsWith(`:${record.httpsPort}`)) && !Object.keys(before.AllowFunnel || {}).some((key) => key.endsWith(`:${record.httpsPort}`))) return;
    if (!validRecord(record) || !matches(before, record)) throw new PhoneError("error", "The route no longer matches Emc². It was left unchanged.");
    await run(["serve", `--https=${record.httpsPort}`, "off"]);
    const after = await config();
    if (after.TCP?.[String(record.httpsPort)] || after.Web?.[endpoint(record)] || !isDeepStrictEqual(withoutOwned(before, record), withoutOwned(after, record)))
      throw new PhoneError("error", "Route removal could not be verified. Check Tailscale on the host.");
  };
  const refresh = async () => {
    if (busy || closed) return;
    busy = true;
    const version = generation;
    const record = options.load();
    try {
      if (!record || record.phase !== "ready") { revoke(); return; }
      await check(record);
      await probe(record.origin, verified && now() < proofUntil ? 200 : 403);
      if (closed || version !== generation || !isDeepStrictEqual(record, options.load())) return;
      proofUntil = now() + 60_000;
      options.gate.setTailnetOrigin(record.origin, proofUntil);
      await probe(record.origin, 200);
      if (closed || version !== generation) return;
      verified = true;
      warning = "";
    } catch (error) { if (version === generation) revoke(); throw error; }
    finally { busy = false; }
  };
  const status = async (canManage: boolean): Promise<PhoneAccessStatus> => {
    try {
      if (busy) return { supported: true, state: "error", canManage: false, message: "Phone access setup is in progress. Refresh when it finishes." };
      await dnsName();
      const record = options.load();
      if (record?.phase === "ready") await refresh();
      if (record?.phase === "pending") return { supported: true, state: "error", canManage, hasRoute: true, message: warning || "A previous setup did not finish. Disable its matching route before trying again." };
      return { supported: true, state: verified ? "ready" : "off", canManage, hasRoute: !!record,
        message: verified ? "Private HTTPS access is ready. Sign in to the same Tailscale network on your phone, then use your paired passkey to unlock Emc²." : "Enable a private HTTPS address on this host. Connect your phone and save a passkey from Settings.",
        ...(verified && record ? { url: `${record.origin}/auth` } : {}) };
    } catch (error) {
      revoke();
      return { supported: true, state: error instanceof PhoneError ? error.state : "error", canManage, hasRoute: !!options.load(), message: error instanceof PhoneError ? error.message : "Phone access could not be verified. Check Tailscale on the host." };
    }
  };
  const enable = async () => {
    if (busy) throw new PhoneError("error", "Phone access setup is already running.");
    if (closed) throw new PhoneError("error", "Phone access is stopped.");
    busy = true;
    generation++;
    let created: PhoneAccessRecord | undefined;
    let savedPending = false;
    try {
      if (options.load()) throw new PhoneError("error", "Disable the saved route before setting up another.");
      const dns = await dnsName();
      const before = await config();
      const port = Array.from({ length: 11 }, (_, i) => 8444 + i).find((number) => !before.TCP?.[String(number)] && !Object.keys(before.Web || {}).some((key) => key.endsWith(`:${number}`)) && !Object.keys(before.AllowFunnel || {}).some((key) => key.endsWith(`:${number}`)));
      if (!port) throw new PhoneError("error", "No unused private HTTPS port is available. Existing routes were left unchanged.");
      const record: PhoneAccessRecord = { origin: tailnetOrigin(`https://${dns}:${port}`), httpsPort: port, backendPort: options.port(), phase: "pending" };
      // Preserve cleanup ownership across errors and restarts, without trusting it.
      options.save(record);
      savedPending = true;
      if (!isDeepStrictEqual(before, await config())) throw new PhoneError("error", "Tailscale routes changed during setup. Refresh and try again.");
      created = record;
      await run(["serve", "--bg", `--https=${port}`, target(record)]);
      const after = await config();
      if (!matches(after, record) || !isDeepStrictEqual(withoutOwned(before, record), withoutOwned(after, record)))
        throw new PhoneError("error", "The private route could not be verified. Existing routes must remain unchanged.");
      await probe(record.origin, 403);
      if (closed) throw new Error("closed");
      proofUntil = now() + 60_000;
      options.gate.setTailnetOrigin(record.origin, proofUntil);
      await probe(record.origin, 200);
      if (closed) throw new Error("closed");
      options.save({ ...record, phase: "ready" });
      verified = true;
      warning = "";
    } catch (error) {
      revoke();
      if (created) {
        try { await removeOwned(created); options.save(undefined); }
        catch { warning = "Setup failed and its route could not be safely removed. Phone access is suspended. Check Tailscale on the host."; }
      } else if (savedPending) options.save(undefined);
      throw new PhoneError("error", warning || (error instanceof PhoneError ? error.message : "Private HTTPS setup failed. Check Tailscale HTTPS and host permissions."));
    } finally { busy = false; }
  };
  const disable = async () => {
    if (busy) throw new PhoneError("error", "Phone access setup is already running.");
    busy = true;
    revoke();
    try { const record = options.load(); if (record) { await removeOwned(record); options.save(undefined); } warning = ""; }
    finally { busy = false; }
  };
  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    status, enable, disable,
    async start() {
      closed = false;
      try { await refresh(); }
      catch { revoke(); warning = "The saved route is unavailable. Phone access is suspended; localhost remains available."; }
      if (closed) return;
      timer = setInterval(() => { if (!busy && options.load()?.phase === "ready") void refresh().catch(() => {}); }, 30_000);
      timer.unref();
    },
    close() { closed = true; if (timer) clearInterval(timer); revoke(); },
  };
}

export function mountPhoneAccess(app: express.Express, service: ReturnType<typeof phoneAccess> | undefined, gate: ReturnType<typeof browserAccess> | false | undefined) {
  const local = (req: express.Request) => !!gate && gate.originFor(req) === gate.localOrigin && req.headers.host === new URL(gate.localOrigin).host && req.headers.origin === gate.localOrigin;
  app.get("/api/phone-access", async (req, res) => {
    if (!service) return res.json({ supported: false, state: "unavailable", canManage: false, message: "Phone access is configured in the browser web app running on a Tailscale host." } satisfies PhoneAccessStatus);
    const canManage = !!gate && gate.originFor(req) === gate.localOrigin && req.headers.host === new URL(gate.localOrigin).host;
    res.json(await service.status(canManage));
  });
  for (const action of ["enable", "disable"] as const) app.post(`/api/phone-access/${action}`, async (req, res) => {
    if (!service || !local(req)) return res.status(403).json({ error: "Manage phone access from the signed-in localhost browser on the host." });
    if (req.body?.confirm !== true || Object.keys(req.body).length !== 1) return res.status(400).json({ error: "Confirm this phone access change." });
    try { await service[action](); res.json(await service.status(true)); }
    catch (error) { res.status(400).json({ error: error instanceof PhoneError ? error.message : "Phone access could not be changed. Existing routes were left unchanged." }); }
  });
}
