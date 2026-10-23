import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID, createCipheriv, createDecipheriv, createHash } from "node:crypto";
import type { Account, Mail, MailSummary, MailChanges, MailSearchResult, Rule, McpSettings, GmailLabel, Draft } from "../shared/types.js";
import type { ComposePreferences } from "../shared/mail-features.js";
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
type Records = {
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
  config: Partial<Record<"GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET" | "OPENAI_API_KEY" | "TYPESAFE_API_KEY" | "TYPESAFE_PROVIDER", string>>;
  attachment: { accountId: string; content: string };
  compose: ComposePreferences;
  account: StoredAccount;
  mail: Mail;
  mailSummary: StoredMailSummary;
  label: GmailLabel;
  rule: Rule;
  meta: { lastSync: number };
  mcp: McpSettings;
  draft: Draft;
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
export function mailSummary(mail: Mail, rules: Rule[] = all("rule")): MailSummary {
  return {
    id: mail.id, accountId: mail.accountId, remoteId: mail.remoteId, sender: mail.sender,
    address: mail.address, to: mail.to, cc: mail.cc, replyTo: mail.replyTo,
    subject: mail.subject, preview: mail.preview, date: mail.date, unread: mail.unread,
    pinned: mail.pinned, labelIds: mail.labelIds && [...mail.labelIds], category: mail.category, relevance: mail.relevance,
    reason: mail.reason, archived: mail.archived, snoozedUntil: mail.snoozedUntil,
    messageId: mail.messageId, threadId: mail.threadId, references: mail.references && [...mail.references],
    direction: mail.direction, inReplyTo: mail.inReplyTo, mailbox: mail.mailbox && { ...mail.mailbox },
    attachments: mail.attachments?.map(({ id, filename, contentType, size, unavailable }) => ({ id, filename, contentType, size, unavailable })),
    contentVersion: createHash("sha256").update(JSON.stringify(mail)).digest("hex"),
    inboxTab: typeof mail.address === "string" ? inboxTab(mail, rules) : "primary",
  };
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
let dataVersion = Number(db.prepare("PRAGMA data_version").get()!.data_version);
const yieldMail = () => new Promise<void>((resolve) => setImmediate(resolve));
function invalidateMail() {
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
async function changedMail<T>(cursor: string | undefined, captureStatus: (() => void) | undefined, signal: AbortSignal | undefined,
  decode: (rows: Map<string, MailRow>, signal?: AbortSignal) => Promise<T[]>): Promise<MailChanges<T>> {
  return captureMailRows(async current => {
    signal?.throwIfAborted();
    const [previousGeneration, previousRevision, extra] = (cursor || "").split(":");
    const since = Number(previousRevision);
    const delta = extra === undefined && previousGeneration === generation && /^\d+$/.test(previousRevision || "") && Number.isSafeInteger(since) && since >= historyFloor && since <= mailRevision;
    const mailCursor = `${generation}:${mailRevision}`;
    const rows = new Map([...current].filter(([, row]) => !delta || row.revision > since));
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
      summaries.push(structuredClone(row.summary));
      if (++i % 32 === 0) await yieldMail();
    }
    signal?.throwIfAborted();
    return summaries;
  });
}
export async function searchMail(query: string, accounts: Account[], signal?: AbortSignal): Promise<MailSearchResult> {
  return captureMailRows(async rows => {
    signal?.throwIfAborted();
    const search = compileMailSearch(query, accounts);
    const mailCursor = `${generation}:${mailRevision}`;
    const versions = new Map([...rows].map(([id, row]) => [id, row.summary.contentVersion]));
    return { mailCursor, error: search.error, matches: search.error ? [] : await scanMail([...rows.keys()], mail =>
      search.matches(mail) ? { id: mail.id, accountId: mail.accountId, contentVersion: versions.get(mail.id)! } : undefined, signal) };
  });
}
export function all<K extends keyof Records>(kind: K): Records[K][] {
  return db
    .prepare("SELECT value FROM records WHERE kind=?")
    .all(kind)
    .map((row) => decrypt(String(row.value)) as Records[K]);
}
export function count(kind: keyof Records): number {
  return (db.prepare("SELECT COUNT(*) AS total FROM records WHERE kind = ?").get(kind) as { total: number }).total;
}
export function get<K extends keyof Records>(kind: K, id: string): Records[K] | undefined {
  const row = db.prepare("SELECT value FROM records WHERE kind=? AND id=?").get(kind, id);
  return row ? decrypt(String(row.value)) as Records[K] : undefined;
}
// Keep revision checks and writes under the same SQLite writer lock.
export function transaction<T>(work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  pendingMail = new Map();
  pendingRules = false;
  try {
    const result = work();
    db.exec("COMMIT");
    for (const [id, row] of pendingMail!) publishMail(id, row);
    if (pendingRules) invalidateMail();
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally { pendingMail = undefined; pendingRules = false; }
}
export function put<K extends keyof Records>(
  kind: K,
  id: string,
  value: Records[K],
): void {
  if (kind === "mail" && !pendingMail) return transaction(() => put(kind, id, value));
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
  for (const row of db.prepare("SELECT id,value FROM records WHERE kind='attachment'").all()) {
    const attachment = decrypt(String(row.value)) as Records["attachment"];
    if (attachment.accountId === accountId) remove("attachment", String(row.id));
  }
}

// Maintenance runs only after the service blocks admission and drains provider work.
// VACUUM copies the existing encrypted values; it never exports decrypted records.
export function compactStore(options: { cleanupOrphans?: boolean; isDrained: () => boolean }) {
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
    const knownKinds: (keyof Records)[] = ["availability", "calendarOffer", "calendarOperation", "commitment", "googleCalendar", "googleCalendarWindow", "calendarEvent", "project", "decision", "coverage", "proposal", "agent", "agentProvider", "attachment", "config", "compose", "account", "mail", "mailSummary", "label", "rule", "meta", "mcp", "draft"];
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
    // Draft attachments are inline in the encrypted draft. No draft is rewritten.
    for (const id of orphans) remove("attachment", id);
    removedAttachments = orphans.length;
  });
  // SQLite's own transaction makes a failed/interrupted VACUUM recoverable. Cleanup
  // is a separate committed transaction because VACUUM cannot run inside one.
  db.exec("VACUUM");
  checkpoint();
  return { beforeBytes, afterBytes: size(), removedAttachments, cleanupSkipped };
}
