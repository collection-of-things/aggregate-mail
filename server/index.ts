import { needsEmbeddedContentRecovery } from "../shared/mail-content.js";
import { browserGate, browserPort } from "./browser-preflight.js";
import { LocalMailUndoConflict } from "./local-mail-undo.js";
import { phonePasskeys } from "./phone-passkeys.js";
import { phoneAccess, mountPhoneAccess } from "./phone-access.js";
import { Outbox, outboxStatuses } from "./outbox.js";
import { mountWorkspaceBackup } from "./workspace-backup.js";
import { downloadProviderAttachment } from "./attachment-download.js";
import { attachmentWork, storeAttachmentBytes } from "./attachment-bytes.js";
import { ATTACHMENT_BYTES } from "../shared/attachments.js";
import { attachmentMetadataSchema } from "./providers.js";
import { notificationMail, type MailArrival, type NotificationMail } from "../shared/notifications.js";
import { isDeepStrictEqual } from "node:util";
import { EventEmitter } from "node:events";
import type { Server } from "node:http";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import path from "node:path";
import express from "express";
import { google } from "./google-api.js";
import { z } from "zod";
import { all, get, syncMailCache, mailSummaryChanges, mailSummary, searchMail, draftChangeToken, count, put, putBatch, remove, removeAccountAttachments, account, transaction, compactStore, storageStats, type StoredAccount, eraseUpload } from "./store.js";
import { matchesRule } from "../shared/rules.js";
import { mountWorkspace } from "./workspace.js";
import { mountAgentProvider } from "./agent-provider.js";
import { mountProviderSearch } from "./provider-search.js";
import { mountDrafts } from "./drafts.js";
import { mountContacts, removeAccountContacts } from "./contacts.js";
import { mountSavedViews } from "./saved-views.js";
import { mountUnsubscribe } from "./unsubscribe.js";
import { calendarScopes, removeGoogleCalendar, saveCalendarAccess } from "./google-calendar.js";
import { mountInvitations } from "./invitations.js";
import { mountOffers } from "./offers.js";
import { mountCalendar } from "./calendar.js";
import { oauth, providers, presets, validateImap, listGmailLabels, syncError } from "./providers.js";
import { ImapWatch, sameImapAccount, type ImapWatchFactory } from "./imap-watch.js";
import { GmailWatch } from "./gmail-watch.js";
import {
  updateMessage,
  updateMessages,
  undoMessage,
  messageActionSchema,
  runMailWork,
  findMail,
  assertMailAvailable,
  mailIsQuiesced,
  mailWorkActivity,
  trackMailWork,
  quiesceMailWork,
  resumeMailWork,
} from "./mail-actions.js";
import { StorageMaintenance } from "./storage-maintenance.js";
import { mountMcp, authorizeMcp } from "./mcp.js";
import { classify, sortMail, SortingUnavailable } from "./sorting.js";
import { companyLogo } from "./avatars.js";
import { companySvg, isFreeMail, normalizeDomain, syncLogos } from "./logos.js";
import { jevProviderOf, type Provider, type Mail, type StateResponse, type BootstrapResponse, type SyncFailure } from "../shared/types.js";
import { emptyComposePreferences } from "../shared/mail-features.js";
import { loadConfiguration, saveConfiguration } from "./config.js";

loadConfiguration();
const desktopEvents = new EventEmitter();
const outbox = new Outbox(() => desktopEvents.emit("mail-changed"));
export function setOutboxOnlineCheck(check: () => boolean) { outbox.setOnlineCheck(check); }
export function holdPendingOutbox() { return outbox.hold(); }
const app = express();
if (browserGate) app.use(browserGate);
const appUrl = process.env.APP_URL || (browserGate ? browserGate.localOrigin : "http://127.0.0.1:5173");
const allowedOrigins = new Set([
  new URL(appUrl).origin,
  "http://127.0.0.1:3001",
  ...(process.env.MAIL_RENDERER_ORIGIN
    ? [process.env.MAIL_RENDERER_ORIGIN]
    : []),
]);
const csrf = randomBytes(32).toString("hex");
const sameSecret = (value: unknown, secret: string) => {
  if (typeof value !== "string") return false;
  const given = Buffer.from(value), expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
};
const authenticatedSession = (req: express.Request) =>
  process.env.MAIL_DESKTOP_TOKEN
    ? sameSecret(req.headers["x-desktop-token"], process.env.MAIL_DESKTOP_TOKEN)
    : !!browserGate?.authenticated(req);
let syncing = false;
let unreadArrivals = 0;
let mailArrivals: MailArrival[] = [];
let syncRun: Promise<string[]> | undefined;
let wakeSync: (() => void) | undefined;
let imapWatch: ImapWatch | undefined;
let gmailWatch: GmailWatch | undefined;
const pendingAccounts = new Set<string>();
const scheduledAccounts = new Set<string>();
const activeAccounts = new Set<string>();
const accountSyncStatus = (id: string) => activeAccounts.has(id) ? "running" as const : pendingAccounts.has(id) ? "queued" as const : undefined;
let scanningLogos = false;
const assertNotSyncing = () => {
  assertMailAvailable();
  if (syncing)
    throw new Error("Wait for the current sync to finish, then try again.");
};
app.use("/mcp", authorizeMcp);
app.use((req, res, next) => req.path.startsWith("/api/workspace-backup/") ? next() : express.json({ limit: "2mb" })(req, res, next));
app.use("/mcp", (_req, res, next) => {
  if (mailIsQuiesced())
    return res.status(503).json({ error: "Mail is paused for an application update. Try again shortly." });
  next();
});
const mailRequest = (handler: (req: express.Request, res: express.Response) => Promise<unknown>): express.RequestHandler =>
  (req, res, next) => { void trackMailWork(() => handler(req, res)).catch(next); };
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  const host = req.hostname;
  if (host !== "127.0.0.1" && host !== "localhost" && !(browserGate && browserGate.originFor(req)))
    return res
      .status(403)
      .json({ error: "This app only accepts local requests." });
  if (req.headers.origin && !(browserGate ? req.headers.origin === browserGate.originFor(req) : allowedOrigins.has(req.headers.origin)))
    return res.status(403).json({ error: "Origin not allowed." });
  if (
    req.path !== "/oauth/google" &&
    req.path !== "/oauth/google/callback" &&
    !authenticatedSession(req)
  )
    return res
      .status(403)
      .json({ error: process.env.MAIL_DESKTOP_TOKEN ? "Open this inbox in Emc²." : "Open the browser link printed by the mail server." });
  if (
    !["GET", "HEAD"].includes(req.method) &&
    req.headers["x-csrf-token"] !== csrf
  )
    return res.status(403).json({ error: "Reload the app and try again." });
  if (mailIsQuiesced() && (req.path.startsWith("/oauth/") || !["GET", "HEAD"].includes(req.method)))
    return res.status(503).json({ error: "Mail is paused for an application update. Try again shortly." });
  if (
    syncing &&
    !["GET", "HEAD"].includes(req.method) &&
    !/^\/accounts\/[^/]+\/drafts(?:\/[^/]+)?\/?$/.test(req.path) &&
    !req.path.startsWith("/calendar/") &&
    !req.path.startsWith("/contacts") &&
    !req.path.startsWith("/send") &&
    !req.path.startsWith("/outbox") &&
    req.path !== "/mcp" &&
    req.path !== "/storage/compact" &&
    !(req.method === "PATCH" && /^\/accounts\/[^/]+$/.test(req.path)) &&
    !(req.method === "PATCH" && /^\/messages\/[^/]+$/.test(req.path) && ["read", "pin", "unpin"].includes(req.body?.action)) &&
    !(req.method === "POST" && (["/accounts/imap", "/sync", "/oauth/google/start"].includes(req.path) || /^\/accounts\/[^/]+\/reconnect$/.test(req.path)))
  )
    return res
      .status(409)
      .json({ error: "Wait for the current sync to finish, then try again." });
  next();
});
let activeBrowserPort = browserPort;
const phoneService = browserGate ? phoneAccess({ gate: browserGate, port: () => activeBrowserPort,
  load: () => get("phoneAccess", "host"),
  save: (value) => value ? put("phoneAccess", "host", value) : remove("phoneAccess", "host"),
}) : undefined;
mountPhoneAccess(app, phoneService, browserGate);
if (browserGate) phonePasskeys({ gate: browserGate, list: () => all("phoneCredential"),
  save: (value) => put("phoneCredential", value.id, value), remove: (id) => remove("phoneCredential", id),
}).mount(app);
app.use("/api/workspace-backup", express.json({ limit: "34mb" }));
app.use("/api/workspace-backup", (_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(400).json({ error: "Invalid backup request or file exceeds the size limit." });
});
mountWorkspaceBackup(app, () => desktopEvents.emit("mail-changed"), assertNotSyncing);
app.post("/api/messages/:id/attachments/:attachmentId/download", mailRequest(async (req, res) => {
  await attachmentWork(async () => {
    const m = findMail(z.string().parse(req.params.id));
    const file = m.attachments?.find(f => f.id === req.params.attachmentId);
    if (!file) throw new Error("Attachment metadata unavailable. The message may not have been parsed.");
    if (!file.unavailable) return res.json({ ok: true });
    const a = account(m.accountId);
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 60000);
    const cancel = () => { if (!res.writableEnded) abort.abort(); };
    res.once("close", cancel);
    let saved: Awaited<ReturnType<typeof downloadProviderAttachment>> | undefined;
    try {
      saved = await downloadProviderAttachment(a, m, file, abort.signal);
      abort.signal.throwIfAborted();
      const current = findMail(m.id);
      const currentFile = current.attachments?.find(f => f.id === file.id);
      if (!sameImapAccount(account(a.id), a) || current.accountId !== m.accountId || current.remoteId !== m.remoteId || current.messageId !== m.messageId || !isDeepStrictEqual(current.mailbox, m.mailbox) || !isDeepStrictEqual(currentFile, file))
        throw new Error("Account or attachment identity changed. Download was not cached.");
      put("mail", m.id, { ...current, attachments: current.attachments!.map(f => f.id === file.id ? { ...f, unavailable: false, uploadId: saved!.id, size: saved!.size, sizeIsEstimate: false } : f) });
      saved = undefined;
      res.json({ ok: true });
    } finally {
      if (saved) eraseUpload(saved.id);
      clearTimeout(timer); res.off("close", cancel);
    }
  });
}));
app.post("/api/accounts/:accountId/attachments", mailRequest(async (req, res) => {
  if (!req.is("application/octet-stream")) throw new Error("Upload raw attachment bytes.");
  const a = account(z.string().parse(req.params.accountId));
  const metadata = attachmentMetadataSchema.parse(req.query);
  const declared = Number(req.headers["content-length"]);
  if (!Number.isSafeInteger(declared) || declared < 0 || declared > ATTACHMENT_BYTES) throw new Error("Attachment upload must declare at most 25 MiB.");
  await attachmentWork(async () => {
    const abort = new AbortController();
    const timer = setTimeout(() => { abort.abort(); req.destroy(); }, 60000);
    const cancel = () => abort.abort();
    req.once("aborted", cancel);
    let file: Awaited<ReturnType<typeof storeAttachmentBytes>> | undefined;
    try {
      file = await storeAttachmentBytes(a.id, metadata.filename, metadata.contentType, req, abort.signal);
      if (file.size !== declared || !sameImapAccount(account(a.id), a)) throw new Error("Attachment upload identity or length changed.");
      res.status(201).json(file);
      file = undefined;
    } finally {
      if (file) eraseUpload(file.id);
      clearTimeout(timer); req.off("aborted", cancel);
    }
  });
}));
mountDrafts(app, () => desktopEvents.emit("mail-changed"));
mountWorkspace(app);
mountCalendar(app);
mountOffers(app);
mountInvitations(app);
mountAgentProvider(app);
mountContacts(app);
mountSavedViews(app);
mountUnsubscribe(app);
mountProviderSearch(app, () => desktopEvents.emit("mail-changed"));
function stateStatus(includeArrivals = true): BootstrapResponse & Partial<Pick<StateResponse, "unreadArrivals" | "mailArrivals">> {
  return {
    draftCount: count("draft"),
    draftToken: draftChangeToken(),
    composePreferences: all("compose")[0] ?? emptyComposePreferences,
    ...(includeArrivals ? { unreadArrivals, mailArrivals } : {}),
    csrf,
    accounts: all("account").map(({ credentials: _credentials, ...a }) => ({ ...a, syncStatus: accountSyncStatus(a.id) })),
    labels: all("label"),
    rules: all("rule"),
    googleConfigured: !!(
      process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    ),
    googleClientId: process.env.GOOGLE_CLIENT_ID || null,
    jevConfigured: !!process.env.TYPESAFE_API_KEY,
    jevProvider: jevProviderOf(process.env.TYPESAFE_PROVIDER),
    aiConfigured: !!process.env.OPENAI_API_KEY,
    lastSync: all("meta")[0]?.lastSync || null,
    syncing,
  };
}
// Status deliberately avoids the mail index, bodies and arrival validation scans.
app.get("/api/bootstrap", (_req, res) => res.json(stateStatus(false)));
app.get("/api/state", async (req, res) => {
  if (res.destroyed) return;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  res.once("close", cancel);
  try {
    let status!: Omit<StateResponse, "messages" | "mailCursor" | "mailMode" | "removedMailIds">;
    const changes = await mailSummaryChanges(typeof req.query.mailCursor === "string" ? req.query.mailCursor : undefined, () => {
      // Capture status at the same boundary as the encrypted mail view, before decoding yields.
      mailArrivals = mailArrivals.filter((arrival) => !!get("mail", arrival.mail.id));
      status = stateStatus();
    }, controller.signal);
    if (res.destroyed) return;
    const { messages, ...mailStatus } = changes;
    // Serialize bounded records so a large initial snapshot does not monopolize the main loop.
    res.type("json");
    res.write(JSON.stringify({ ...status, ...mailStatus }).slice(0, -1) + ',"messages":[');
    for (let i = 0; i < messages.length; i++) {
      if (res.destroyed) return;
      const ready = res.write((i ? "," : "") + JSON.stringify(messages[i]));
      if (!ready) await new Promise<void>((resolve) => { const done = () => { res.off("drain", done); res.off("close", done); resolve(); }; res.once("drain", done); res.once("close", done); });
      if ((i + 1) % 32 === 0) await new Promise<void>(resolve => setImmediate(resolve));
    }
    if (!res.destroyed) res.end("]}");
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally { res.off("close", cancel); }
});
app.get("/api/messages/search", async (req, res) => {
  if (res.destroyed) return;
  const query = z.string().max(8192).parse(req.query.query);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  res.once("close", cancel);
  try {
    const result = await searchMail(query, all("account"), controller.signal);
    if (!res.destroyed) res.json(result);
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally { res.off("close", cancel); }
});
app.get("/api/messages/:id/body", (req, res) => {
  const input = z.object({ accountId: z.string().min(1), contentVersion: z.string().min(1) }).parse(req.query);
  const mail = get("mail", z.string().parse(req.params.id));
  if (!mail || mail.accountId !== input.accountId) return res.status(404).json({ error: "Message not found." });
  const contentVersion = mailSummary(mail).contentVersion;
  if (contentVersion !== input.contentVersion) return res.status(409).json({ error: "Email changed. Reload before opening its content." });
  // This endpoint reads only the local encrypted record, including legacy plain text.
  res.json({ mail, contentVersion });
});
app.get("/api/compose-preferences", (_req, res) => {
  res.json(all("compose")[0] ?? emptyComposePreferences);
});
app.put("/api/compose-preferences", (req, res) => {
  const input = z.object({
    undoSendSeconds: z.union([z.literal(0), z.literal(5), z.literal(10), z.literal(30)]).optional(),
    templates: z.array(z.object({
      id: z.string().min(1).max(80),
      name: z.string().trim().min(1).max(80),
      subject: z.string().max(998).refine((value) => !/[\r\n]/.test(value)),
      body: z.string().max(50000),
    }).strict()).max(50),
    signatures: z.record(z.string().min(1).max(200), z.string().max(10000)),
  }).strict().parse(req.body);
  if (new Set(input.templates.map((template) => template.id)).size !== input.templates.length)
    return res.status(400).json({ error: "Template identifiers must be unique." });
  const ids = new Set(all("account").map((a) => a.id));
  if (Object.keys(input.signatures).some((id) => !ids.has(id)))
    return res.status(400).json({ error: "Choose a connected account for each signature." });
  if (input.undoSendSeconds === undefined) input.undoSendSeconds = get("compose", "preferences")?.undoSendSeconds;
  put("compose", "preferences", input);
  res.json(input);
});
app.post("/api/config", (req, res) => {
  const value = z
    .string()
    .trim()
    .max(2000)
    .refine((v) => !/[\r\n]/.test(v), "Use a single-line credential");
  const input = z
    .object({
      googleClientId: value.optional(),
      googleClientSecret: value.optional(),
      openaiApiKey: value.optional(),
      jevApiKey: value.optional(),
      jevProvider: z
        .enum(["typesafe", "vercel", "openrouter"])
        .optional(),
    })
    .parse(req.body);
  const updates = {
    GOOGLE_CLIENT_ID: input.googleClientId,
    GOOGLE_CLIENT_SECRET: input.googleClientSecret,
    OPENAI_API_KEY: input.openaiApiKey,
    TYPESAFE_API_KEY: input.jevApiKey,
    TYPESAFE_PROVIDER: input.jevProvider,
  };
  saveConfiguration(updates);
  res.json({ ok: true });
});
let storageMaintenance = false;
let mailServerStopping = false;
async function maintainStorage(options: { cleanupOrphans: boolean; vacuum?: "if-needed"; inventoryAt?: number }) {
  if (storageMaintenance || mailIsQuiesced() || mailServerStopping) return false;
  storageMaintenance = true;
  try {
    await drainMail(30000);
    if (mailServerStopping) return false;
    return compactStore({ ...options, isDrained: () => {
      const activity = mailWorkActivity();
      return mailIsQuiesced() && !syncing && !activity.active && !activity.queued;
    } });
  } finally {
    storageMaintenance = false;
    if (!mailServerStopping) resumeMail();
  }
}
app.post("/api/storage/compact", async (req, res) => {
  z.object({ confirm: z.literal(true) }).strict().parse(req.body);
  if (storageMaintenance || mailIsQuiesced())
    return res.status(409).json({ error: "Wait for paused mail work to finish before storage maintenance." });
  const result = await maintainStorage({ cleanupOrphans: true });
  if (result === false) return res.status(409).json({ error: "Storage maintenance is unavailable. Try again shortly." });
  res.json(result);
});
app.get("/api/logo/:domain", async (req, res) => {
  // theSVG first, then the favicon service: a brand the library knows gets a
  // proper logo, and everything else keeps the mark its mail host publishes.
  const image =
    (await companySvg(req.params.domain)) ||
    (await companyLogo(req.params.domain));
  if (!image) {
    // Cacheable so a row without a logo is not asked for on every render.
    res.set("Cache-Control", "public, max-age=600");
    return res.status(404).end();
  }
  res.set("Content-Type", image.type);
  res.set("Cache-Control", "public, max-age=604800");
  // Third-party vector bytes are served from this origin, so they are kept
  // inert if the URL is ever opened as a document rather than as an image.
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  return res.send(image.body);
});
app.post("/api/logos/sync", mailRequest(async (_req, res) => {
  if (scanningLogos)
    return res.status(409).json({ error: "A logo scan is already running." });
  scanningLogos = true;
  try {
    const domains = new Set<string>();
    for (const m of all("mail")) {
      const domain = normalizeDomain(m.address);
      if (domain && !isFreeMail(domain)) domains.add(domain);
    }
    res.json(await syncLogos([...domains]));
  } finally {
    scanningLogos = false;
  }
}));
type PendingOAuth = { expiry: number; calendar: boolean; accountId?: string; origin: string };
// Single-use launch values from the authenticated start route, and the states
// they become. Both are capped and expire, so neither can grow without bound.
const oauthLaunches = new Map<string, PendingOAuth>();
const oauthStates = new Map<string, PendingOAuth>();
const oauthPendingLimit = 8;
function rememberOAuth(pending: Map<string, PendingOAuth>, value: Omit<PendingOAuth, "expiry">, ttl: number) {
  const now = Date.now();
  // Entries share a lifetime, so insertion order is expiry order.
  for (const [key, entry] of pending) {
    if (entry.expiry >= now && pending.size < oauthPendingLimit) break;
    pending.delete(key);
  }
  const key = randomBytes(32).toString("hex");
  pending.set(key, { ...value, expiry: now + ttl });
  return key;
}
function takeOAuth(pending: Map<string, PendingOAuth>, key: unknown) {
  if (typeof key !== "string") return undefined;
  const entry = pending.get(key);
  pending.delete(key);
  return entry && entry.expiry >= Date.now() ? entry : undefined;
}
class AccountConnectionError extends Error {}
function existingAccount(email: string, provider: Provider) {
  const matches = all("account").filter((a) => a.email.toLowerCase() === email.toLowerCase());
  if (matches.some((a) => a.provider !== provider))
    throw new AccountConnectionError("This email is already connected using another connection method. Keep that connection, or disconnect it before switching. Disconnecting removes its local mail cache.");
  return matches[0];
}
const googleUnconfigured = "Save your Google client ID and secret in Emc² Settings, then try again.";
app.post("/api/oauth/google/start", (req, res) => {
  const { calendar = false, accountId } = z.object({
    calendar: z.boolean().optional(),
    accountId: z.string().max(200).optional(),
  }).strict().parse(req.body ?? {});
  const target = accountId ? get("account", accountId) : undefined;
  if (accountId && (!target || target.provider !== "gmail")) return res.status(400).json({ error: "Choose a connected Gmail account." });
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return res.status(400).json({ error: googleUnconfigured });
  const launch = rememberOAuth(oauthLaunches, { calendar, accountId, origin: (browserGate && browserGate.originFor(req)) || appUrl }, 120000);
  res.json({ url: `/api/oauth/google?${new URLSearchParams({ launch })}` });
});
app.get("/api/oauth/google", (req, res) => {
  const returnOrigin = (browserGate && browserGate.originFor(req)) || appUrl;
  const refuse = (message: string) => process.env.MAIL_DESKTOP_TOKEN
    ? res.status(400).type("text").send(message)
    : res.redirect(`${returnOrigin}/?error=${encodeURIComponent(message)}`);
  const consent = takeOAuth(oauthLaunches, req.query.launch);
  if (!consent || consent.origin !== returnOrigin) return refuse("This sign-in link has expired or was already used. Start Google sign-in again from Emc².");
  const { calendar, accountId } = consent;
  const target = accountId ? get("account", accountId) : undefined;
  if (accountId && (!target || target.provider !== "gmail")) return refuse("Choose a connected Gmail account.");
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET)
    return refuse(process.env.MAIL_DESKTOP_TOKEN ? googleUnconfigured : "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env and restart the server.");
  const state = rememberOAuth(oauthStates, { calendar, accountId, origin: returnOrigin }, 600000);
  res.cookie("oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: returnOrigin.startsWith("https:"),
    maxAge: 600000,
    path: "/api/oauth/google/callback",
  });
  res.redirect(
    oauth(returnOrigin).generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      state,
      include_granted_scopes: true,
      login_hint: target?.email,
      scope: ["https://www.googleapis.com/auth/gmail.modify", ...(calendar ? calendarScopes : [])],
    }),
  );
});
app.get("/api/oauth/google/callback", mailRequest(async (req, res) => {
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const cookie = req.headers.cookie
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("oauth_state="))
    ?.slice(12);
  const consent = takeOAuth(oauthStates, state);
  res.clearCookie("oauth_state", { path: "/api/oauth/google/callback", httpOnly: true, sameSite: "lax", secure: consent?.origin.startsWith("https:") === true });
  if (!consent || state !== cookie || (browserGate && consent.origin !== browserGate.originFor(req)))
    return res
      .status(400)
      .send("Invalid or expired sign-in. Return to the app and try again.");
  let safeError = "Google connection failed. Reconnect and try again.";
  const refuse = (message: string): never => { safeError = message; throw new Error(message); };
  try {
    if (req.query.error) refuse("Google sign-in was cancelled.");
    const code = z.string().parse(req.query.code);
    const auth = oauth(consent.origin);
    const { tokens } = await auth.getToken(code);
    auth.setCredentials(tokens);
    const { data } = await google
      .gmail({ version: "v1", auth })
      .users.getProfile({ userId: "me" });
    const email = z.email().parse(data.emailAddress);
    const target = consent.accountId ? get("account", consent.accountId) : undefined;
    if (consent.accountId && (!target || target.email.toLowerCase() !== email.toLowerCase())) refuse("Sign in with the Gmail account you chose in Emc².");
    const old = existingAccount(email, "gmail");
    const refreshToken = tokens.refresh_token || old?.credentials.refreshToken;
    if (!refreshToken)
      refuse("Google did not return offline access. Reconnect and grant consent.");
    const id = old?.id || randomUUID();
    put("account", id, {
      ...old,
      id,
      email,
      provider: "gmail",
      credentials: { refreshToken },
    });
    saveCalendarAccess(id, tokens.scope, consent.calendar);
    if (!mailIsQuiesced()) gmailWatch?.reconcile(all("account"));
    void requestSync([id], true);
    if (process.env.MAIL_DESKTOP_TOKEN) {
      desktopEvents.emit("oauth", null);
      res
        .type("text")
        .send(
          "Account connected. You can close this tab and return to Emc².",
        );
    } else res.redirect(`${consent.origin}/?connected=1`);
  } catch (error) {
    if (error instanceof AccountConnectionError) safeError = error.message;
    if (process.env.MAIL_DESKTOP_TOKEN) {
      const message = safeError;
      desktopEvents.emit("oauth", message);
      res
        .status(400)
        .type("text")
        .send(`${message} Return to Emc² to try again.`);
      return;
    }
    res.redirect(
      `${consent.origin}/?error=${encodeURIComponent(safeError)}`,
    );
  }
}));
const imapSchema = z.object({
  provider: z.enum(["gmail-imap", "icloud", "fastmail", "yahoo", "imap"]),
  email: z.email(),
  password: z.string().min(1).max(1000),
  username: z.string().max(320).optional(),
  imapHost: z
    .string()
    .regex(/^[a-zA-Z0-9.-]+$/)
    .max(253)
    .optional(),
  smtpHost: z
    .string()
    .regex(/^[a-zA-Z0-9.-]+$/)
    .max(253)
    .optional(),
  imapPort: z.number().int().min(1).max(65535).default(993),
  smtpPort: z.union([z.literal(465), z.literal(587)]).default(465),
});
app.post("/api/accounts/imap", mailRequest(async (req, res) => {
  const input = imapSchema.parse(req.body);
  if (input.provider === "gmail-imap") {
    input.password = input.password.replace(/ /g, "");
    if (!/^[a-z]{16}$/.test(input.password))
      throw new Error("Enter the 16-letter Google app password. Do not use your regular Google password.");
  }
  const old = existingAccount(input.email, input.provider);
  const id = old?.id || randomUUID();
  const credentials = {
    ...input,
    ...(input.provider === "imap" ? {} : presets[input.provider]),
    username: input.provider === "imap" ? input.username : input.email,
  };
  if (!credentials.imapHost || !credentials.smtpHost)
    throw new Error("Enter both IMAP and SMTP server names.");
  const a: StoredAccount = {
    id,
    email: input.email,
    provider: input.provider,
    credentials,
  };
  await validateImap(a);
  // Validation awaits the network; another connection can finish meanwhile.
  const current = existingAccount(input.email, input.provider);
  a.id = current?.id || id;
  put("account", a.id, { ...current, ...a });
  if (!mailIsQuiesced()) imapWatch?.reconcile(all("account"));
  void requestSync([a.id], true);
  res.json({ ok: true });
}));
app.patch("/api/accounts/:id", (req, res) => {
  const { name } = z.object({
    name: z.string()
      .refine((value) => !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value), "Use a single-line name without control characters.")
      .trim().max(80),
  }).strict().parse(req.body);
  const current = all("account").find((a) => a.id === req.params.id);
  if (!current) return res.status(404).json({ error: "Account not found." });
  put("account", current.id, { ...current, name: name || undefined });
  res.json({ ok: true });
});
app.post("/api/accounts/:id/reconnect", (req, res) => {
  const a = all("account").find((a) => a.id === req.params.id);
  if (!a) return res.status(404).json({ error: "Account not found." });
  if (req.body !== undefined && (!req.body || typeof req.body !== "object" || Array.isArray(req.body) || Object.keys(req.body).length))
    return res.status(400).json({ error: "Retry uses the saved account credentials. Do not include account data." });
  // A completed account can retry while peers run; active/pending clicks still share work.
  if (!activeAccounts.has(a.id) && !pendingAccounts.has(a.id)) scheduledAccounts.delete(a.id);
  void requestSync([a.id]);
  res.status(202).json({ status: accountSyncStatus(a.id), error: a.error, syncFailure: a.syncFailure });
});
app.delete("/api/accounts/:id", (req, res) => {
  transaction(() => {
    account(req.params.id);
    if (all("outbox").some(entry => entry.accountId === req.params.id && entry.state === "submitting"))
      throw new Error("Wait for this account's send to finish before removing it.");
    for (const entry of all("outbox")) if (entry.accountId === req.params.id) remove("outbox", entry.id);
    remove("account", req.params.id);
    const preferences = all("compose")[0];
    if (preferences && Object.hasOwn(preferences.signatures, req.params.id)) {
      const signatures = { ...preferences.signatures };
      delete signatures[req.params.id];
      put("compose", "preferences", { ...preferences, signatures });
    }
    for (const draft of all("draft").filter((draft) => draft.accountId === req.params.id))
      remove("draft", draft.id);
    removeAccountAttachments(req.params.id);
    removeAccountContacts(req.params.id);
    remove("coverage", req.params.id);
    removeGoogleCalendar(req.params.id);
    for (const offer of all("calendarOffer")) if (offer.accountId === req.params.id) remove("calendarOffer", offer.id);
    for (const operation of all("calendarOperation")) if (operation.accountId === req.params.id) remove("calendarOperation", operation.id);
    for (const rule of all("rule").filter((rule) => rule.accountId === req.params.id)) remove("rule", rule.id);
    for (const proposal of all("proposal").filter((proposal) => proposal.accountId === req.params.id)) remove("proposal", proposal.id);
    for (const grant of all("agent").filter((grant) => grant.accountIds.includes(req.params.id)))
      put("agent", grant.id, { ...grant, accountIds: grant.accountIds.filter((id) => id !== req.params.id) });
    for (const m of all("mail").filter((m) => m.accountId === req.params.id))
      remove("mail", m.id);
    for (const label of all("label").filter((label) => label.accountId === req.params.id))
      remove("label", `${label.accountId}:${label.id}`);
  });
  imapWatch?.reconcile(all("account"));
  gmailWatch?.reconcile(all("account"));
  res.json({ ok: true });
});
app.post("/api/sync", async (_req, res) => {
  res.json(await syncMail());
});
// The desktop process starts its own run while the window is hidden, so a
// background sync reports the same errors a request would.
export async function syncMail(): Promise<{ errors: string[] }> {
  assertMailAvailable();
  imapWatch?.reconcile(all("account"));
  gmailWatch?.reconcile(all("account"));
  return { errors: await requestSync(all("account").map((a) => a.id)) };
}

function requestSync(ids: string[], reconnect = false): Promise<string[]> {
  if (mailIsQuiesced()) return Promise.resolve([]);
  for (const id of ids) {
    if (reconnect || !scheduledAccounts.has(id)) pendingAccounts.add(id);
    scheduledAccounts.add(id);
  }
  if (syncRun) {
    wakeSync?.();
    return syncRun;
  }
  syncing = true;
  const newUnread: NotificationMail[] = [];
  syncRun = runMailWork(async () => {
    const errors: string[] = [];
    const active = new Map<string, Promise<void>>();
    try {
      while (pendingAccounts.size || active.size) {
        for (const id of pendingAccounts) {
          if (active.size >= 2) break;
          if (active.has(id)) continue;
          pendingAccounts.delete(id);
          const a = all("account").find((a) => a.id === id);
          if (!a) continue;
          activeAccounts.add(id);
          active.set(id, syncAccount(a, errors, (messages) => { newUnread.push(...messages); })
            .catch((error) => {
              const failure = syncError(error, a.provider, "sync");
              const message = `${a.email}: ${failure.message}`;
              errors.push(message);
              const current = all("account").find((current) => current.id === a.id);
              if (current && isDeepStrictEqual(current.credentials, a.credentials))
                put("account", a.id, { ...current, error: message, syncFailure: failure.failure });
            })
            .finally(() => { active.delete(id); activeAccounts.delete(id); if (active.size || pendingAccounts.size) desktopEvents.emit("mail-changed"); }));
        }
        if (active.size) {
          // Wake for a new account too; keep every active run until it settles.
          await Promise.race([...active.values(), new Promise<void>((resolve) => { wakeSync = resolve; })]);
          wakeSync = undefined;
        }
      }
      put("meta", "sync", { lastSync: Date.now() });
      return errors;
    } finally {
      syncing = false;
      syncRun = undefined;
      scheduledAccounts.clear();
      for (const mail of newUnread) mailArrivals.push({ sequence: ++unreadArrivals, mail });
      desktopEvents.emit("mail-changed");
      if (newUnread.length) desktopEvents.emit("new-mail", newUnread.length, newUnread);
    }
  });
  return syncRun;
}

async function syncAccount(
  a: StoredAccount,
  errors: string[],
  onNewUnread: (messages: NotificationMail[]) => void,
) {
  const currentAccount = () => all("account").find((current) => sameImapAccount(current, a));
  const existing = await syncMailCache(a.id);
  if (!currentAccount()) return;
  const hasSynced = a.hasSynced ?? existing.size > 0;
  const rules = all("rule");
  const fresh = new Set<string>();
  const received = new Set<string>();
  const saveBatch: NonNullable<Parameters<typeof providers.gmail.list>[2]> = (batch) => {
    if (!currentAccount()) return;
    const changed: [string, Mail][] = [];
    for (const incoming of batch) {
      const previous = existing.get(incoming.id);
      const m = previous ? { ...incoming, id: previous.id } : incoming;
      if (received.has(m.id)) continue;
      received.add(m.id);
      const saved = {
        ...m,
        ...(previous
          ? { category: previous.category, relevance: previous.relevance, reason: previous.reason }
          : sortMail(m, rules)),
        archived: false,
        snoozedUntil: previous?.snoozedUntil || null,
        ...(previous?.pinned ? { pinned: true } : {}),
      };
      if (!isDeepStrictEqual(previous, saved)) changed.push([m.id, saved]);
    }
    putBatch("mail", changed);
    for (const [id] of changed) if (!existing.has(id)) fresh.add(id);
    if (changed.length) desktopEvents.emit("mail-changed");
  };
  let error: string | undefined;
  let syncFailure: SyncFailure | undefined;
  let syncWarning: SyncFailure | undefined;
  try {
    const labels = a.provider === "gmail" ? await listGmailLabels(a) : undefined;
    if (!currentAccount()) return;
    if (labels) {
      putBatch("label", labels.map((label) => [`${a.id}:${label.id}`, label]));
      for (const old of all("label").filter((label) => label.accountId === a.id && !labels.some((current) => current.id === label.id)))
        remove("label", `${a.id}:${old.id}`);
    }
    const incoming = await providers[a.provider].list(a, existing, saveBatch, (warning) => { syncWarning = warning; }, labels, false);
    if (!currentAccount()) return;
    // Also support a provider returning its final batch without a progress callback.
    saveBatch(incoming);
    let archived: [string, Mail][] = [];
    let archivedCount = 0;
    for (const summary of existing.summaries.values()) {
      if (summary.archived || received.has(summary.id)) continue;
      const mail = existing.get(summary.id);
      if (!mail || mail.archived) continue;
      archived.push([mail.id, { ...mail, archived: true, labelIds: mail.labelIds?.filter((id) => id !== "INBOX") }]);
      archivedCount++;
      if (archived.length === 32) { putBatch("mail", archived); archived = []; }
    }
    putBatch("mail", archived);
    if (archivedCount) desktopEvents.emit("mail-changed");
  } catch (failure) {
    const safe = syncError(failure, a.provider, "sync");
    error = `${a.email}: ${safe.message}`;
    syncFailure = safe.failure;
    errors.push(error);
  }
  if (fresh.size && (process.env.TYPESAFE_API_KEY || process.env.OPENAI_API_KEY)) {
    const messages = [...fresh];
    let cursor = 0;
    let stopped = false;
    await Promise.all(Array.from({ length: Math.min(6, messages.length) }, async () => {
      while (cursor < messages.length && !stopped && currentAccount()) {
        const m = get("mail", messages[cursor++]);
        if (!m || m.accountId !== a.id) continue;
        try {
          const sorting = await classify(m, rules);
          if (currentAccount()) put("mail", m.id, { ...m, ...sorting });
        } catch (sortingFailure) {
          if (stopped) return;
          stopped = true;
          const warning = sortingFailure instanceof SortingUnavailable
            ? sortingFailure.message
            : "AI sorting unavailable. Mail was synced using local sorting.";
          errors.push(warning);
          if (!error) error = warning;
        }
      }
    }));
  }
  // A first import fills an empty cache, so only a later sync reports arrivals.
  if (!error && currentAccount()) {
    const arrived = [...fresh].flatMap((id) => { const mail = get("mail", id); return mail?.accountId === a.id && mail.unread ? [notificationMail(mail)] : []; });
    if (arrived.length && hasSynced) onNewUnread(arrived);
  }
  const current = currentAccount();
  // A reconnect owns its new credentials and status, even if the old run finishes later.
  if (current && isDeepStrictEqual(current.credentials, a.credentials))
    put("account", a.id, {
      ...current,
      hasSynced: error ? current.hasSynced ?? hasSynced : true,
      error,
      syncFailure,
      syncWarning,
    });
}
app.post("/api/messages/:id/images", mailRequest(async (req, res) => {
  const mail = findMail(z.string().parse(req.params.id));
  if (mail.images !== undefined) return res.json({ images: mail.images });
  const a = account(mail.accountId);
  const images = await providers[a.provider].images(a, mail);
  // Read current state again so an overlapping mail action is not overwritten.
  assertNotSyncing();
  const current = findMail(mail.id);
  put("mail", mail.id, { ...current, images });
  res.json({ images });
}));
app.post("/api/messages/:id/content", mailRequest(async (req, res) => {
  const mail = findMail(z.string().parse(req.params.id));
  if (mail.html !== undefined && mail.attachments !== undefined && !needsEmbeddedContentRecovery(mail)) return res.json({ html: mail.html, images: mail.images, attachments: mail.attachments });
  const a = account(mail.accountId);
  const content = await providers[a.provider].content(a, mail);
  assertNotSyncing();
  const current = findMail(mail.id);
  if (current.accountId !== mail.accountId || current.remoteId !== mail.remoteId || current.messageId !== mail.messageId)
    throw new Error("Email identity changed. Content was not cached.");
  // Preserve image recovery and mail actions completed during the source fetch.
  const recoverEmbedded = needsEmbeddedContentRecovery(current);
  const updated = { ...current, html: current.html === undefined || recoverEmbedded ? content.html : current.html,
    invitation: current.invitation ?? content.invitation,
    images: current.images ?? content.images, attachments: recoverEmbedded ? content.attachments ?? [] : current.attachments ?? content.attachments ?? [] };
  put("mail", mail.id, updated);
  res.json({ html: updated.html, images: updated.images, attachments: updated.attachments });
}));
app.post("/api/messages/batch", mailRequest(async (req, res) => {
  assertNotSyncing();
  res.json(await updateMessages(req.body, assertNotSyncing));
}));
app.post("/api/messages/:id/undo", mailRequest(async (req, res) => {
  const id = z.string().min(1).max(500).parse(req.params.id);
  const input = z.object({ accountId: z.string().min(1).max(500), token: z.string().min(1).max(4096) }).strict().parse(req.body);
  assertNotSyncing();
  try { await undoMessage(id, input.accountId, input.token, assertNotSyncing); }
  catch (error) {
    if (error instanceof LocalMailUndoConflict) return res.status(409).json({ error: error.message });
    throw error;
  }
  res.json({ ok: true });
}));
app.patch("/api/messages/:id", async (req, res) => {
  const input = messageActionSchema.parse(req.body);
  if (!get("mail", req.params.id))
    return res.status(404).json({ error: "Message not found." });
  let undo: import("../shared/local-mail-undo.js").LocalMailUndo | undefined;
  await updateMessage(req.params.id, input, undefined, undefined, receipt => { undo = receipt; });
  res.json({ ok: true, ...(undo ? { undo } : {}) });
});
app.post("/api/send", (req, res) => {
  res.status(202).json({ queued: true, entry: outbox.enqueue(req.body) });
});
app.get("/api/outbox", (_req, res) => { res.json(outboxStatuses()); });
app.post("/api/outbox/:id/send", async (req, res) => {
  await outbox.submit(z.uuid().parse(req.params.id));
  res.json({ ok: true });
});
app.post("/api/outbox/:id/reschedule", (req, res) => {
  const input = z.object({ at: z.number().int().positive() }).strict().parse(req.body);
  outbox.reschedule(z.uuid().parse(req.params.id), input.at);
  res.json({ ok: true });
});
app.post("/api/outbox/:id/edit", (req, res) => {
  res.json(outbox.edit(z.uuid().parse(req.params.id)));
});
app.delete("/api/outbox/:id", (req, res) => {
  const input = z.object({ confirmUnknown: z.boolean().optional() }).strict().parse(req.body);
  outbox.discard(z.uuid().parse(req.params.id), input.confirmUnknown);
  res.json({ ok: true });
});
app.delete("/api/rules/:id", (req, res) => {
  const removed = all("rule").find((rule) => rule.id === req.params.id);
  remove("rule", req.params.id);
  const rules = all("rule");
  for (const m of all("mail"))
    if (removed && matchesRule(m, removed)) put("mail", m.id, { ...m, ...sortMail(m, rules) });
  res.json({ ok: true });
});
mountMcp(app, assertNotSyncing, () => desktopEvents.emit("mail-changed"));
const staticPath = process.env.MAIL_STATIC_DIR || path.resolve("dist");
app.use((_req, res, next) => {
  res.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data: https:; worker-src 'self'; connect-src 'self'; object-src 'none'; media-src data:; base-uri 'none'; frame-ancestors 'none'",
  );
  next();
});
app.use(express.static(staticPath));
app.get("/{*path}", (_req, res) =>
  res.sendFile(path.join(staticPath, "index.html")),
);
app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const message =
      error instanceof z.ZodError
        ? error.issues.map((x) => x.message).join("; ")
        : error instanceof Error
          ? error.message
          : "Request failed.";
    res.status(400).json({ error: message });
  },
);
export function startServer(
  port: number,
  onAccountConnected?: (error: string | null) => void,
  onMailChanged?: () => void,
  onNewMail?: (count: number, messages: NotificationMail[]) => void,
  watchClient?: ImapWatchFactory,
  gmailRevision?: (account: StoredAccount) => Promise<string>,
): Promise<Server> {
  if (onAccountConnected) desktopEvents.on("oauth", onAccountConnected);
  if (onMailChanged) desktopEvents.on("mail-changed", onMailChanged);
  if (onNewMail) desktopEvents.on("new-mail", onNewMail);
  return new Promise((resolve, reject) => {
    let automaticMaintenance: StorageMaintenance | undefined;
    const server = app.listen(port, "127.0.0.1", () => {
      mailServerStopping = false;
      outbox.start();
      imapWatch = new ImapWatch((a) => {
        if (all("account").some((current) => sameImapAccount(current, a)))
          void requestSync([a.id], true);
      }, watchClient);
      imapWatch.reconcile(all("account"));
      gmailWatch = new GmailWatch(async (a) => {
        if (mailIsQuiesced() || !all("account").some((current) => sameImapAccount(current, a))) return false;
        await requestSync([a.id], true);
        const current = all("account").find((current) => sameImapAccount(current, a));
        return !!current && !current.error;
      }, gmailRevision);
      gmailWatch.reconcile(all("account"));
      automaticMaintenance = new StorageMaintenance({
        activity: mailWorkActivity,
        unavailable: () => storageMaintenance || mailIsQuiesced() || mailServerStopping,
        stats: storageStats,
        lastInventoryAt: () => get("maintenance", "storage")?.lastInventoryAt,
        maintain: maintainStorage,
        report: (code) => console.warn("Automatic storage maintenance:", code),
      });
      const bound = server.address();
      if (bound && typeof bound !== "string") activeBrowserPort = bound.port;
      if (phoneService) void phoneService.start().then(() => resolve(server), reject);
      else resolve(server);
    });
    server.once("error", reject);
    // A restarted server, such as the macOS keychain relaunch, must not leave
    // the previous window's listeners subscribed.
    server.once("close", () => {
      phoneService?.close();
      mailServerStopping = true;
      outbox.close();
      automaticMaintenance?.close();
      imapWatch?.close();
      imapWatch = undefined;
      gmailWatch?.close();
      gmailWatch = undefined;
      if (onAccountConnected) desktopEvents.off("oauth", onAccountConnected);
      if (onMailChanged) desktopEvents.off("mail-changed", onMailChanged);
      if (onNewMail) desktopEvents.off("new-mail", onNewMail);
    });
  });
}
export async function quiesceMail(timeout: number) {
  if (storageMaintenance) throw new Error("Storage maintenance is in progress. Try the update after it finishes.");
  await drainMail(timeout);
}
async function drainMail(timeout: number) {
  // Block admission before closing watchers, including already queued sync and MCP sends.
  outbox.hold();
  const drained = quiesceMailWork(timeout);
  imapWatch?.close();
  gmailWatch?.close();
  await drained;
}
export function resumeMail() {
  if (storageMaintenance) return;
  resumeMailWork();
  imapWatch?.reconcile(all("account"));
  gmailWatch?.reconcile(all("account"));
}
if (!process.env.MAIL_DESKTOP_TOKEN)
  void startServer(browserPort)
    .then(() => console.log(`Mail server listening at http://127.0.0.1:${browserPort}`))
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
