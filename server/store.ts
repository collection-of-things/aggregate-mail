import { conversationMembers } from "./conversation-members.js";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID, createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Account, Mail, MailAttachment, MailSummary, MailChanges, MailSearchResult, Rule, McpSettings, GmailLabel, Draft, DraftSummary } from "../shared/types.js";
import type { ComposePreferences } from "../shared/mail-features.js";
import { storageNeedsVacuum } from "./storage-maintenance.js";
import { inboxTab } from "../shared/inbox-tabs.js";
import { compileMailSearch } from "../shared/mail-search.js";

const dataPath = process.env.MAIL_DATA_DIR || ".data";
mkdirSync(dataPath, { recursive: true, mode: 0o700 });
const keyPath = path.join(dataPath, "key");
if (!process.env.MAIL_DATA_KEY && !existsSync(keyPath)) {
  if (existsSync(path.join(dataPath, "mail.sqlite"))) throw new Error("The existing mail store key is unavailable. Restore its original key before opening it.");
  writeFileSync(keyPath, randomBytes(32), { mode: 0o600, flag: "wx" });
}
const key = process.env.MAIL_DATA_KEY
  ? Buffer.from(process.env.MAIL_DATA_KEY, "base64")
  : readFileSync(keyPath);
if (key.length !== 32) throw new Error("The mail store key is invalid. Restore its original key before opening it.");
const db = new DatabaseSync(path.join(dataPath, "mail.sqlite"));
db.exec(
  "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS records (kind TEXT, id TEXT, value TEXT NOT NULL, PRIMARY KEY(kind,id))",
);

// Account secrets and message content are encrypted with a local installation key.
export function encrypt(value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}
function decrypt(value: string): unknown {
  const data = Buffer.from(value, "base64");
  const cipher = createDecipheriv("aes-256-gcm", key, data.subarray(0, 12));
  cipher.setAuthTag(data.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString(
      "utf8",
    ),
  );
}
export type Records = {
  savedView: import("../shared/saved-views.js").SavedView;
  phoneCredential: import("../shared/phone-access.js").PhoneCredential;
  phoneAccess: import("../shared/phone-access.js").PhoneAccessRecord;
  workspaceMailState: { id: string; accountId: string; pinned?: boolean; snoozedUntil: number | null };
  availability: import("../shared/availability.js").AvailabilitySettings;
  calendarOffer: import("../shared/offers.js").CalendarOffer;
  calendarOperation: { id: string; accountId: string; eventId: string; revision: number; kind: string; draftId?: string; state: "complete" | "unknown"; remoteId?: string; result?: import("../shared/calendar.js").CalendarEvent; input?: string; requestId?: string; response?: import("../shared/calendar.js").CalendarResponse; sourceMailId?: string; sourceFingerprint?: string };
  commitment: import("../shared/workspace.js").Commitment;
  googleCalendar: import("../shared/calendar.js").GoogleCalendarConnection;
  googleCalendarWindow: import("../shared/calendar.js").GoogleCalendarWindow;
  calendarEvent: import("../shared/calendar.js").CalendarEvent;
  project: import("../shared/workspace.js").Project;
  decision: import("../shared/workspace.js").ProjectDecision;
  coverage: import("../shared/workspace.js").SentCoverage;
  proposal: import("../shared/workspace.js").AgentProposal;
  agent: import("../shared/workspace.js").AgentGrant;
  agentProvider: import("./agent-provider.js").StoredAgentProvider;
  maintenance: { lastInventoryAt: number };
  config: Partial<Record<"GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET" | "OPENAI_API_KEY" | "TYPESAFE_API_KEY" | "TYPESAFE_PROVIDER", string>>;
  attachment: { accountId: string; content: string };
  upload: { accountId: string; filename: string; contentType: string; size: number; reservedBytes?: number; createdAt: number; complete: boolean };
  attachmentHold: { id: string; accountId: string; attachments: { id: string }[] };
  compose: ComposePreferences;
  account: StoredAccount;
  mail: Mail;
  mailSummary: StoredMailSummary;
  label: GmailLabel;
  rule: Rule;
  meta: { lastSync: number };
  mcp: McpSettings;
  draft: Draft;
  contact: import("../shared/contacts.js").SavedContact;
  recentRecipient: import("../shared/contacts.js").RecentRecipient;
  outbox: import("./outbox.js").OutboxRecord;
};
export type StoredAccount = Account & {
  hasSynced?: boolean;
  credentials: {
    refreshToken?: string;
    password?: string;
    imapHost?: string;
    smtpHost?: string;
    imapPort?: number;
    smtpPort?: number;
    username?: string;
  };
};
// The attachment fields a summary carries; kept in one place so projection and
// comparison can never disagree about the shape.
const summaryAttachment = ({ id, filename, contentType, size, unavailable, contentId, uploadId, sourceIndex, remotePart, sizeIsEstimate }: MailAttachment) =>
  ({ id, filename, contentType, size, unavailable, contentId, uploadId, sourceIndex, remotePart, sizeIsEstimate });
export function mailSummary(mail: Mail, rules: Rule[] = all("rule")): MailSummary {
  return {
    id: mail.id, accountId: mail.accountId, remoteId: mail.remoteId, sender: mail.sender,
    address: mail.address, to: mail.to, cc: mail.cc, replyTo: mail.replyTo,
    subject: mail.subject, preview: mail.preview, date: mail.date, unread: mail.unread,
    pinned: mail.pinned, labelIds: mail.labelIds && [...mail.labelIds], category: mail.category, relevance: mail.relevance,
    reason: mail.reason, archived: mail.archived, snoozedUntil: mail.snoozedUntil,
    messageId: mail.messageId, threadId: mail.threadId, references: mail.references && [...mail.references],
    direction: mail.direction, inReplyTo: mail.inReplyTo, mailbox: mail.mailbox && { ...mail.mailbox },
    attachments: mail.attachments?.map(summaryAttachment),
    contentVersion: createHash("sha256").update(JSON.stringify(mail)).digest("hex"),
    inboxTab: typeof mail.address === "string" ? inboxTab(mail, rules) : "primary",
  };
}
// Every field mailSummary projects, except the derived contentVersion and
// inboxTab. Used to ask "would saving this row change the summary?"
const summaryFields = ["id", "accountId", "remoteId", "sender", "address", "to", "cc", "replyTo", "subject", "preview", "date", "unread", "pinned", "labelIds", "category", "relevance", "reason", "archived", "snoozedUntil", "messageId", "threadId", "references", "direction", "inReplyTo", "mailbox", "attachments"] as const;
// True when a would-be saved record is identical on every summary field. Sync
// uses it to report presence without reopening the encrypted record.
export function sameMailSummary(incoming: Partial<Mail>, summary: MailSummary): boolean {
  for (const key of summaryFields) {
    const value = key === "attachments" ? incoming.attachments?.map(summaryAttachment) : incoming[key];
    if (!isDeepStrictEqual(value, summary[key])) return false;
  }
  return true;
}
type StoredMailSummary = { version: 1; sourceDigest: string; rulesDigest: string; summary: MailSummary };
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const ruleDigest = (rules: Rule[]) => digest(JSON.stringify([...rules].sort((a, b) => a.id.localeCompare(b.id))));
// Retain metadata only. Full ciphertext and search documents live for one row scan.
type MailRow = { summary: MailSummary; revision: number };
let mailRows: Map<string, MailRow> | undefined;
let loadingMail: Promise<void> | undefined;
let generation = randomUUID();
let mailRevision = 0;
let historyFloor = 0;
const mailHistory = new Map<string, number>();
const coldWrites = new Map<string, MailRow | null>();
let pendingMail: Map<string, Omit<MailRow, "revision"> | null> | undefined;
let pendingRules = false;
let draftToken = randomUUID();
let pendingDrafts = false;
let cachedSearch: { key: string; result: MailSearchResult } | undefined;
export function draftChangeToken() { checkMailVersion(); return draftToken; }
function changeDrafts() { draftToken = randomUUID(); cachedSearch = undefined; }
let dataVersion = Number(db.prepare("PRAGMA data_version").get()!.data_version);
const yieldMail = () => new Promise<void>((resolve) => setImmediate(resolve));
function invalidateMail() {
  changeDrafts();
  mailRows = undefined;
  coldWrites.clear();
  mailHistory.clear();
  mailRevision = historyFloor = 0;
  generation = randomUUID();
}
function checkMailVersion() {
  const version = Number(db.prepare("PRAGMA data_version").get()!.data_version);
  if (version === dataVersion) return;
  dataVersion = version;
  invalidateMail();
}
function publishMail(id: string, row: Omit<MailRow, "revision"> | null) {
  const revision = ++mailRevision;
  const next = row ? { ...row, revision } : null;
  if (mailRows) {
    if (next) mailRows.set(id, next);
    else mailRows.delete(id);
  } else coldWrites.set(id, next);
  mailHistory.set(id, revision);
  // shortcut: retain 4096 distinct changed IDs; older cursors receive a complete snapshot.
  if (mailHistory.size > 4096) { historyFloor = revision; mailHistory.clear(); }
}
async function ensureMailRows() {
  checkMailVersion();
  if (mailRows) return;
  if (!loadingMail) loadingMail = (async () => {
    const startedGeneration = generation;
    const reader = new DatabaseSync(path.join(dataPath, "mail.sqlite"), { readOnly: true });
    const rows = new Map<string, MailRow>();
    const rules = all("rule");
    const rulesDigest = ruleDigest(rules);
    try {
      // A separate WAL reader holds one snapshot while the main writer remains available.
      reader.exec("BEGIN");
      const select = "SELECT m.id,m.value,s.value AS summary FROM records m LEFT JOIN records s ON s.kind='mailSummary' AND s.id=m.id WHERE m.kind='mail'";
      const first = reader.prepare(`${select} ORDER BY m.id LIMIT 32`);
      const page = reader.prepare(`${select} AND m.id>? ORDER BY m.id LIMIT 32`);
      let batch = first.all();
      while (batch.length) {
        const repairs: { id: string; source: string; value: StoredMailSummary }[] = [];
        for (const row of batch) {
          const id = String(row.id);
          const source = String(row.value);
          const sourceDigest = digest(source);
          const saved = row.summary ? decrypt(String(row.summary)) as StoredMailSummary : undefined;
          const valid = saved?.version === 1 && saved.sourceDigest === sourceDigest && saved.rulesDigest === rulesDigest && saved.summary.id === id;
          const summary = valid ? saved.summary : mailSummary(decrypt(source) as Mail, rules);
          rows.set(id, { summary, revision: 0 });
          if (!valid) repairs.push({ id, source, value: { version: 1, sourceDigest, rulesDigest, summary } });
        }
        // Upgrade old caches in bounded transactions. A changed source always wins.
        if (repairs.length) transaction(() => {
          const current = db.prepare("SELECT value FROM records WHERE kind='mail' AND id=?");
          for (const repair of repairs)
            if (current.get(repair.id)?.value === repair.source) put("mailSummary", repair.id, repair.value);
        });
        const last = String(batch[batch.length - 1].id);
        await yieldMail();
        batch = page.all(last);
      }
      reader.exec("COMMIT");
      checkMailVersion();
      if (generation !== startedGeneration) throw new Error("Mail changed during cache initialization. Reload the app and try again.");
      for (const [id, row] of coldWrites) {
        if (row) rows.set(id, row);
        else rows.delete(id);
      }
      coldWrites.clear();
      mailRows = rows;
    } finally { reader.close(); }
  })().finally(() => { loadingMail = undefined; });
  await loadingMail;
}
async function captureMailRows<T>(capture: (rows: Map<string, MailRow>) => T | Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    await ensureMailRows();
    // Another consumer may invalidate the index before this continuation runs.
    checkMailVersion();
    if (mailRows) return capture(mailRows);
  }
  throw new Error("Mail changed during cache initialization. Reload the app and try again.");
}
async function scanMail<T>(ids: string[], visit: (mail: Mail) => T | undefined, signal?: AbortSignal): Promise<T[]> {
  const expectedGeneration = generation;
  const reader = new DatabaseSync(path.join(dataPath, "mail.sqlite"), { readOnly: true });
  const results: T[] = [];
  try {
    reader.exec("BEGIN");
    // Establish the SQLite snapshot before the first asynchronous yield.
    reader.prepare("SELECT COUNT(*) FROM records").get();
    checkMailVersion();
    if (generation !== expectedGeneration) throw new Error("Mail changed during read. Reload the app and try again.");
    const select = reader.prepare("SELECT value FROM records WHERE kind='mail' AND id=?");
    for (let i = 0; i < ids.length; i++) {
      signal?.throwIfAborted();
      const row = select.get(ids[i]);
      if (!row) throw new Error("Mail changed during read. Reload the app and try again.");
      const result = visit(decrypt(String(row.value)) as Mail);
      if (result !== undefined) results.push(result);
      if ((i + 1) % 32 === 0) await yieldMail();
    }
    signal?.throwIfAborted();
    reader.exec("COMMIT");
    return results;
  } finally { reader.close(); }
}
export async function readMail(accountId?: string): Promise<Mail[]> {
  return captureMailRows(rows => scanMail([...rows].filter(([, row]) => accountId === undefined || row.summary.accountId === accountId).map(([id]) => id), mail => mail));
}
// Choose IDs from the captured metadata without yielding. scanMail establishes
// its WAL snapshot before its first yield and checks external invalidation.
export async function readConversationMail(sourceIds: readonly string[]): Promise<Mail[]> {
  return captureMailRows(rows => {
    const sources = [...new Set(sourceIds)].flatMap(id => {
      const row = rows.get(id);
      return row ? [row.summary] : [];
    });
    const selected = conversationMembers(sources, [...rows.values()].map(row => row.summary));
    return scanMail(selected.map(mail => mail.id), mail => mail);
  });
}
// Sync needs mailbox identity up front, but full bodies only for its current batch.
export async function syncMailCache(accountId: string) {
  const summaries = await captureMailRows(rows => new Map([...rows]
    .filter(([, row]) => row.summary.accountId === accountId && row.summary.direction !== "sent")
    .map(([id, row]) => [id, row.summary])));
  const identities = new Map([...summaries].map(([id, summary]) => [`${accountId}:${summary.remoteId}`, id]));
  return {
    summaries,
    size: summaries.size,
    has: (id: string) => summaries.has(id) || identities.has(id),
    peek: (id: string) => summaries.get(identities.get(id) ?? id),
    get: (id: string) => {
      id = identities.get(id) ?? id;
      const summary = summaries.get(id);
      if (!summary) return undefined;
      const mail = get("mail", id);
      return mail?.accountId === accountId && mail.remoteId === summary.remoteId && mail.messageId === summary.messageId ? mail : undefined;
    },
  };
}
async function changedMail<T>(cursor: string | undefined, captureStatus: (() => void) | undefined, signal: AbortSignal | undefined,
  decode: (rows: Map<string, MailRow>, signal?: AbortSignal) => Promise<T[]>): Promise<MailChanges<T>> {
  return captureMailRows(async current => {
    signal?.throwIfAborted();
    const [previousGeneration, previousRevision, extra] = (cursor || "").split(":");
    const since = Number(previousRevision);
    const delta = extra === undefined && previousGeneration === generation && /^\d+$/.test(previousRevision || "") && Number.isSafeInteger(since) && since >= historyFloor && since <= mailRevision;
    const mailCursor = `${generation}:${mailRevision}`;
    const rows = !delta ? new Map(current) : since === mailRevision ? new Map<string, MailRow>()
      : new Map([...current].filter(([, row]) => row.revision > since));
    const removedMailIds = delta ? [...mailHistory].filter(([id, revision]) => revision > since && !current.has(id)).map(([id]) => id) : [];
    captureStatus?.();
    return { mailCursor, mailMode: delta ? "delta" : "snapshot", removedMailIds, messages: await decode(rows, signal) };
  });
}
// Internal full-mail contract, including body-sensitive callers and fingerprints.
export async function mailChanges(cursor?: string, captureStatus?: () => void, signal?: AbortSignal): Promise<MailChanges<Mail>> {
  return changedMail(cursor, captureStatus, signal, (rows, signal) => scanMail([...rows.keys()], mail => mail, signal));
}
export async function mailSummaryChanges(cursor?: string, captureStatus?: () => void, signal?: AbortSignal): Promise<MailChanges> {
  return changedMail(cursor, captureStatus, signal, async (rows, signal) => {
    const summaries: MailSummary[] = [];
    let i = 0;
    for (const row of rows.values()) {
      signal?.throwIfAborted();
      // Summary metadata has only these four mutable children. Copy them without
      // the general structured-clone traversal, keeping callers isolated.
      const summary = { ...row.summary };
      if (summary.labelIds) summary.labelIds = [...summary.labelIds];
      if (summary.references) summary.references = [...summary.references];
      if (summary.mailbox) summary.mailbox = { ...summary.mailbox };
      if (summary.attachments) summary.attachments = summary.attachments.map(attachment => ({ ...attachment }));
      summaries.push(summary);
      if (++i % 32 === 0) await yieldMail();
    }
    signal?.throwIfAborted();
    return summaries;
  });
}
export function draftSummary({ id, accountId, revision, updatedAt, to, cc, subject, body, attachments, sendUnknown }: Draft): DraftSummary {
  return { id, accountId, revision, updatedAt, to: Array.isArray(to) ? to : [to], cc, subject, sendUnknown,
    preview: body.replace(/\s+/g, " ").trim().slice(0, 200), attachmentCount: attachments?.length || 0 };
}
export async function searchMail(query: string, accounts: Account[], signal?: AbortSignal): Promise<MailSearchResult> {
  return captureMailRows(async rows => {
    signal?.throwIfAborted();
    const mailCursor = `${generation}:${mailRevision}`;
    const token = draftToken;
    const key = JSON.stringify([query, mailCursor, token, accounts.map(a => [a.id, a.email, a.name])]);
    if (cachedSearch?.key === key) return cachedSearch.result;
    const search = compileMailSearch(query, accounts);
    const result: MailSearchResult = { mailCursor, draftToken: token, error: search.error, matches: [] };
    if (search.error) return result;
    const entries = [...rows].map(([id, row]) => [id, row.summary] as const);
    const connected = new Map(accounts.map(account => [account.id, account]));
    const reader = new DatabaseSync(path.join(dataPath, "mail.sqlite"), { readOnly: true });
    try {
      reader.exec("BEGIN");
      // Both kinds share one encrypted-record snapshot, including across yields.
      reader.prepare("SELECT COUNT(*) FROM records").get();
      checkMailVersion();
      if (mailCursor !== `${generation}:${mailRevision}` || token !== draftToken) throw new Error("Cache changed during search. Refresh and try again.");
      const select = reader.prepare("SELECT value FROM records WHERE kind='mail' AND id=?");
      let scanned = 0;
      for (const [id, summary] of entries) {
        const version = summary.contentVersion;
        signal?.throwIfAborted();
        if (!connected.has(summary.accountId)) continue;
        const known = search.matchesSummary(summary);
        if (known !== undefined) {
          if (known) result.matches.push({ kind: "mail", id, accountId: summary.accountId, contentVersion: version });
          if (++scanned % 32 === 0) await yieldMail();
          continue;
        }
        const row = select.get(id);
        if (!row) throw new Error("Mail changed during read. Reload the app and try again.");
        const mail = decrypt(String(row.value)) as Mail;
        if (connected.has(mail.accountId) && search.matches(mail)) result.matches.push({ kind: "mail", id, accountId: mail.accountId, contentVersion: version });
        if (++scanned % 32 === 0) await yieldMail();
      }
      for (const row of reader.prepare("SELECT value FROM records WHERE kind='draft' ORDER BY id").iterate()) {
        signal?.throwIfAborted();
        const draft = decrypt(String(row.value)) as Draft;
        const account = connected.get(draft.accountId);
        if (account && search.matchesDraft(draft, account)) result.matches.push({ kind: "draft", ...draftSummary(draft) });
        if (++scanned % 32 === 0) await yieldMail();
      }
      signal?.throwIfAborted();
      reader.exec("COMMIT");
      // A concurrent writer may advance either input while this snapshot yields.
      if (mailCursor === `${generation}:${mailRevision}` && token === draftChangeToken()) cachedSearch = { key, result };
      return result;
    } finally { reader.close(); }
  });
}
export function all<K extends keyof Records>(kind: K): Records[K][] {
  return db
    .prepare("SELECT value FROM records WHERE kind=?")
    .all(kind)
    .map((row) => decrypt(String(row.value)) as Records[K]);
}
// Scan one message at a time so a backup never hydrates the whole body cache.
export function workspaceMailFlags(): Records["workspaceMailState"][] {
  const flags = new Map(all("workspaceMailState").map(value => [value.id, value]));
  for (const row of db.prepare("SELECT value FROM records WHERE kind='mail'").iterate()) {
    const mail = decrypt(String(row.value)) as Mail;
    if (mail.pinned || mail.snoozedUntil != null)
      flags.set(mail.id, { id: mail.id, accountId: mail.accountId, pinned: mail.pinned, snoozedUntil: mail.snoozedUntil ?? null });
  }
  return [...flags.values()];
}
export function count(kind: keyof Records): number {
  return (db.prepare("SELECT COUNT(*) AS total FROM records WHERE kind = ?").get(kind) as { total: number }).total;
}
export function get<K extends keyof Records>(kind: K, id: string): Records[K] | undefined {
  const row = db.prepare("SELECT value FROM records WHERE kind=? AND id=?").get(kind, id);
  return row ? decrypt(String(row.value)) as Records[K] : undefined;
}
// Ciphertext changes on every write, so Undo rejects intervening writes and ABA.
export function mailRecordVersion(id: string): string | undefined {
  const row = db.prepare("SELECT value FROM records WHERE kind='mail' AND id=?").get(id);
  return row ? digest(String(row.value)) : undefined;
}
// Keep revision checks and writes under the same SQLite writer lock.
export function transaction<T>(work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  pendingMail = new Map();
  pendingRules = false;
  pendingDrafts = false;
  try {
    const result = work();
    db.exec("COMMIT");
    for (const [id, row] of pendingMail!) publishMail(id, row);
    if (pendingRules) invalidateMail();
    if (pendingDrafts) changeDrafts();
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally { pendingMail = undefined; pendingRules = false; pendingDrafts = false; }
}
export function put<K extends keyof Records>(
  kind: K,
  id: string,
  value: Records[K],
): void {
  if (kind === "mail" && !pendingMail) return transaction(() => put(kind, id, value));
  // Restore flags once when the provider cache is first materialized. Later
  // user actions and ordinary sync keep their existing semantics.
  if (kind === "mail") {
    const flags = get("workspaceMailState", id);
    if (flags && flags.accountId === (value as Mail).accountId && !get("mail", id)) {
      value = { ...value, pinned: flags.pinned, snoozedUntil: flags.snoozedUntil };
      remove("workspaceMailState", id);
    }
  }
  const encrypted = encrypt(value);
  const rules = kind === "mail" ? all("rule") : [];
  const summary = kind === "mail" ? mailSummary(value as Mail, rules) : undefined;
  db.prepare("INSERT OR REPLACE INTO records VALUES (?,?,?)").run(kind, id, encrypted);
  if (kind === "mail") {
    put("mailSummary", id, { version: 1, sourceDigest: digest(encrypted), rulesDigest: ruleDigest(rules), summary: summary! });
    const row = { summary: summary! };
    if (pendingMail) pendingMail.set(id, row);
    else publishMail(id, row);
  }
  if (kind === "draft") { if (pendingMail) pendingDrafts = true; else changeDrafts(); }
  if (kind === "rule") { if (pendingMail) pendingRules = true; else invalidateMail(); }
}
export function putBatch<K extends keyof Records>(kind: K, values: [string, Records[K]][]) {
  if (!values.length) return;
  transaction(() => { for (const [id, value] of values) put(kind, id, value); });
}
export function remove(kind: keyof Records, id: string): void {
  if (kind === "mail" && !pendingMail) return transaction(() => remove(kind, id));
  const result = db.prepare("DELETE FROM records WHERE kind=? AND id=?").run(kind, id);
  if (kind === "mail") db.prepare("DELETE FROM records WHERE kind='mailSummary' AND id=?").run(id);
  if (kind === "mail" && result.changes) {
    if (pendingMail) pendingMail.set(id, null);
    else publishMail(id, null);
  }
  if ((kind === "draft" || kind === "account") && result.changes) { if (pendingMail) pendingDrafts = true; else changeDrafts(); }
  if (kind === "rule" && result.changes) { if (pendingMail) pendingRules = true; else invalidateMail(); }
}
export function account(id: string) {
  const found = all("account").find((a) => a.id === id);
  if (!found) throw new Error("Account not found.");
  return found;
}
export function closeStore() {
  db.close();
}

export function removeAccountAttachments(accountId: string) {
  // Explicit account removal also purges its drafts/outbox, so its uploads and
  // uncertainty holds must not keep private bytes after the account is gone.
  for (const row of db.prepare("SELECT id,value FROM records WHERE kind='upload'").all())
    if ((decrypt(String(row.value)) as Records["upload"]).accountId === accountId) eraseUpload(String(row.id));
  for (const hold of all("attachmentHold")) if (hold.accountId === accountId) remove("attachmentHold", hold.id);
  for (const row of db.prepare("SELECT id,value FROM records WHERE kind='attachment'").all()) {
    const attachment = decrypt(String(row.value)) as Records["attachment"];
    if (attachment.accountId === accountId) remove("attachment", String(row.id));
  }
}

export function storageStats() {
  return {
    pageCount: Number(db.prepare("PRAGMA page_count").get()!.page_count),
    freePages: Number(db.prepare("PRAGMA freelist_count").get()!.freelist_count),
    pageSize: Number(db.prepare("PRAGMA page_size").get()!.page_size),
  };
}

// Maintenance runs only after the service blocks admission and drains provider work.
// VACUUM copies the existing encrypted values; it never exports decrypted records.
export function compactStore(options: { cleanupOrphans?: boolean; vacuum?: boolean | "if-needed"; inventoryAt?: number; isDrained: () => boolean }) {
  if (!options.isDrained() || pendingMail) throw new Error("Drain mail work before storage maintenance.");
  if (loadingMail) throw new Error("A mail reader is loading. Try maintenance after it finishes.");
  const checkpoint = () => {
    const result = db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
    if (!result || Number(result.busy) !== 0) throw new Error("Storage is busy with another reader. Try maintenance after it closes.");
  };
  // Fail before deleting anything when another reader holds the WAL snapshot.
  checkpoint();
  const size = () => Number(db.prepare("PRAGMA page_count").get()!.page_count) * Number(db.prepare("PRAGMA page_size").get()!.page_size);
  const beforeBytes = size();
  let removedAttachments = 0;
  let cleanupSkipped: "unknown-record-kind" | "incomplete-mail-metadata" | "incomplete-attachment-metadata" | undefined;
  if (options.cleanupOrphans) transaction(() => {
    const knownKinds: (keyof Records)[] = ["upload", "attachmentHold", "workspaceMailState", "savedView", "outbox", "availability", "calendarOffer", "calendarOperation", "commitment", "googleCalendar", "googleCalendarWindow", "calendarEvent", "project", "decision", "coverage", "proposal", "agent", "agentProvider", "attachment", "config", "maintenance", "compose", "account", "mail", "mailSummary", "label", "rule", "meta", "mcp", "draft", "contact", "recentRecipient"];
    if (db.prepare("SELECT DISTINCT kind FROM records").all().some(row => !knownKinds.includes(String(row.kind) as keyof Records))) {
      cleanupSkipped = "unknown-record-kind";
      return;
    }
    const references = new Set<string>();
    for (const row of db.prepare("SELECT id,value FROM records WHERE kind='mail'").iterate()) {
      const mail = decrypt(String(row.value)) as Mail;
      if (!mail || mail.id !== row.id || typeof mail.accountId !== "string" || !Array.isArray(mail.attachments) || mail.attachments.some(a => !a || typeof a.id !== "string" || !a.id)) {
        cleanupSkipped = "incomplete-mail-metadata";
        return;
      }
      // Archive and Sent are ordinary mail records and keep their exact references.
      for (const attachment of mail.attachments) references.add(`${row.id}:${attachment.id}`);
    }
    const orphans: string[] = [];
    for (const row of db.prepare("SELECT id,value FROM records WHERE kind='attachment'").iterate()) {
      const attachment = decrypt(String(row.value)) as Records["attachment"];
      if (!attachment || typeof attachment.accountId !== "string" || typeof attachment.content !== "string") {
        cleanupSkipped = "incomplete-attachment-metadata";
        return;
      }
      if (!references.has(String(row.id))) orphans.push(String(row.id));
    }
    // Legacy attachments remain inline. Upload references are inventoried separately.
    for (const id of orphans) remove("attachment", id);
    removedAttachments = orphans.length;
  });
  if (options.cleanupOrphans) cleanupUploads();
  // SQLite's own transaction makes a failed/interrupted VACUUM recoverable. Cleanup
  // is a separate committed transaction because VACUUM cannot run inside one.
  // An empty freelist has no already-free pages to reclaim. Explicit force
  // still permits repacking partially filled pages; automatic thresholds are unchanged.
  const vacuumed = options.vacuum === "if-needed" ? storageNeedsVacuum(storageStats())
    : options.vacuum === true || (options.vacuum === undefined && storageStats().freePages > 0);
  if (vacuumed) db.exec("VACUUM");
  checkpoint();
  if (options.cleanupOrphans && options.inventoryAt !== undefined)
    put("maintenance", "storage", { lastInventoryAt: options.inventoryAt });
  return { beforeBytes, afterBytes: size(), removedAttachments, cleanupSkipped, vacuumed };
}

// Chunk rows contain only authenticated ciphertext, never plaintext spool files.
db.exec("CREATE TABLE IF NOT EXISTS attachment_chunks (id TEXT, seq INTEGER, value TEXT NOT NULL, PRIMARY KEY(id,seq))");
const activeUploads = new Set<string>();
const attachmentReaders = new Map<string, number>();
export function beginUpload(accountId: string, filename: string, contentType: string, limit = 25 * 1024 * 1024) {
  const inventory = all("upload");
  // Backup imports can overlap an admitted stream, including before its first chunk.
  const occupied = (x: Records["upload"]) => x.complete ? x.size : Math.max(x.size, x.reservedBytes ?? 35 * 1024 * 1024);
  if (inventory.filter(x => x.accountId === accountId).reduce((n, x) => n + occupied(x), 0) + limit > 256 * 1024 * 1024 || inventory.reduce((n, x) => n + occupied(x), 0) + limit > 1024 * 1024 * 1024 || inventory.length >= 2000)
    throw new Error("Attachment storage limit reached. Discard unused drafts and compact storage.");
  const id = randomUUID();
  put("upload", id, { accountId, filename, contentType, size: 0, reservedBytes: limit, createdAt: Date.now(), complete: false });
  activeUploads.add(id);
  return id;
}
export function appendUpload(id: string, seq: number, bytes: Buffer) {
  if (bytes.length > 65536) throw new Error("Attachment chunk limit exceeded.");
  db.prepare("INSERT INTO attachment_chunks VALUES(?,?,?)").run(id, seq, encrypt(bytes.toString("base64")));
}
export function finishUpload(id: string, size: number) {
  const value = get("upload", id);
  if (!value) throw new Error("Attachment upload missing.");
  put("upload", id, { ...value, size, complete: true });
  activeUploads.delete(id);
}
export function eraseUpload(id: string) {
  db.prepare("DELETE FROM attachment_chunks WHERE id=?").run(id);
  remove("upload", id); activeUploads.delete(id);
}
export async function* uploadBytes(id: string) {
  const meta = get("upload", id);
  if (!meta?.complete) throw new Error("Attachment upload is incomplete.");
  attachmentReaders.set(id, (attachmentReaders.get(id) || 0) + 1);
  try {
    let size = 0;
    // No long-lived SQL iterator across awaits or writes.
    const select = db.prepare("SELECT value FROM attachment_chunks WHERE id=? AND seq=?");
    for (let seq = 0; ; seq++) {
      const row = select.get(id, seq);
      if (!row) break;
      const bytes = Buffer.from(decrypt(String(row.value)) as string, "base64");
      size += bytes.length;
      yield bytes;
    }
    if (size !== meta.size) throw new Error("Attachment bytes are incomplete.");
  } finally {
    const remaining = (attachmentReaders.get(id) || 1) - 1;
    if (remaining) attachmentReaders.set(id, remaining); else attachmentReaders.delete(id);
  }
}
export function validateAttachmentRefs(accountId: string, attachments: import("../shared/types.js").DraftAttachment[] = []) {
  for (const file of attachments) {
    if (!file.id) continue;
    const saved = get("upload", file.id);
    if (!saved?.complete || saved.accountId !== accountId || saved.size !== file.size || saved.filename !== file.filename || saved.contentType !== file.contentType)
      throw new Error("Attachment identity changed or belongs to another account. Choose the file again.");
  }
}
export function holdAttachments(accountId: string, attachments: import("../shared/types.js").DraftAttachment[] = []) {
  validateAttachmentRefs(accountId, attachments);
  if (!attachments.some(file => file.id)) return;
  const id = randomUUID();
  put("attachmentHold", id, { id, accountId, attachments: attachments.flatMap(f => f.id ? [{ id: f.id }] : []) });
  return id;
}
export function releaseAttachmentHold(id: string | undefined) { if (id) remove("attachmentHold", id); }
export function cleanupUploads(now = Date.now()) {
  const cleanup = () => {
    const candidates = new Set(db.prepare("SELECT id FROM records WHERE kind='upload'").all().map(row => String(row.id)));
    const references = new Set([...activeUploads, ...attachmentReaders.keys()]);
    // Trace every encrypted record, including opaque outbox payloads and unknown
    // record kinds. A decryption failure aborts before any deletion.
    const visit = (value: unknown): void => {
      if (typeof value === "string") { if (candidates.has(value)) references.add(value); }
      else if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") Object.values(value).forEach(visit);
    };
    for (const row of db.prepare("SELECT value FROM records WHERE kind!='upload'").iterate()) visit(decrypt(String(row.value)));
    const orphans: string[] = [];
    for (const row of db.prepare("SELECT id,value FROM records WHERE kind='upload'").iterate()) {
      const value = decrypt(String(row.value)) as Records["upload"];
      if (!references.has(String(row.id)) && now - value.createdAt >= 3600000) orphans.push(String(row.id));
    }
    for (const id of orphans) eraseUpload(id);
    return orphans.length;
  };
  return db.isTransaction ? cleanup() : transaction(cleanup);
}

// Backups are explicit bounded in-memory files; ordinary sends remain streamed.
export function backupUploadContent(accountId: string, file: import("../shared/types.js").DraftAttachment): string {
  validateAttachmentRefs(accountId, [file]);
  const chunks: Buffer[] = [];
  for (const row of db.prepare("SELECT value FROM attachment_chunks WHERE id=? ORDER BY seq").iterate(file.id!))
    chunks.push(Buffer.from(decrypt(String(row.value)) as string, "base64"));
  const content = Buffer.concat(chunks);
  if (content.length !== file.size) throw new Error("Attachment bytes are incomplete. Backup was not created.");
  return content.toString("base64");
}
export function restoreBackupUpload(accountId: string, file: { filename: string; contentType: string; content: string }) {
  const bytes = Buffer.from(file.content, "base64");
  const id = beginUpload(accountId, file.filename, file.contentType, bytes.length);
  try {
    for (let offset = 0, seq = 0; offset < bytes.length; offset += 65536, seq++) appendUpload(id, seq, bytes.subarray(offset, offset + 65536));
    finishUpload(id, bytes.length);
    return { id, filename: file.filename, contentType: file.contentType, size: bytes.length };
  } catch (error) { eraseUpload(id); throw error; }
}
