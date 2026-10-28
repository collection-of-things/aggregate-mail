import { createCipheriv, createDecipheriv, randomBytes, scrypt, createHash } from "node:crypto";
import packageInfo from "../package.json" with { type: "json" };
import { trackMailWork } from "./mail-actions.js";
import type express from "express";
import { z } from "zod";
import { all, get, put, transaction, workspaceMailFlags, type Records } from "./store.js";
import { contentSchema, MAX_DRAFTS_PER_ACCOUNT } from "./drafts.js";
import { ruleSchema } from "./workspace.js";
import { BACKUP_MAX_BYTES, type BackupPreview } from "../shared/workspace-backup.js";

const derive = (password: string, salt: Buffer) => new Promise<Buffer>((resolve, reject) =>
  scrypt(password, salt, 32, { ...parameters, maxmem: 256 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
const parameters = { N: 131072, r: 8, p: 1 } as const;
const appVersion = packageInfo.version;
const text = z.string().max(1000000);
const id = z.string().min(1).max(2000);
const time = z.number().int().nonnegative().max(253402300799999);
const ids = z.array(id).max(10000);
const status = z.enum(["needs-reply", "needs-work", "waiting", "done", "cancelled"]);
const deadline = { dueAt: time.optional(), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), followUpAt: time.optional() };
const history = z.object({ at: time, status, ...deadline, reason: text, text, evidenceMailIds: ids });
const schemas = {
  commitment: z.object({ id, accountId: id, sourceMailId: id, text, reason: text, status, ...deadline, evidenceMailIds: ids, projectId: id.optional(), revision: time, updatedAt: time, history: z.array(history), sourceUnavailable: z.boolean().optional() }),
  project: z.object({ id, name: text, sourceMailIds: ids, accountIds: ids, crossAccountConfirmed: z.boolean(), revision: time, updatedAt: time }),
  decision: z.object({ id, projectId: id, text, sourceMailIds: ids, createdAt: time }),
  rule: ruleSchema.omit({ accountId: true }).extend({ id, accountId: id.optional(), createdAt: time.optional(), excludedMailIds: ids.optional() }),
  draft: contentSchema.safeExtend({ id, accountId: id, revision: time, updatedAt: time, sendUnknown: z.boolean(), calendarContext: z.object({ eventId: id, revision: time, sourceMailId: id.optional(), sourceFingerprint: text.optional() }).optional() }),
  proposal: z.object({ id, agentId: id, accountId: id, action: z.enum(["send", "draft", "archive", "read"]), payload: z.union([contentSchema.safeExtend({ accountId: id }), z.object({ mailId: id })]), sourceMailId: id.optional(), sourceFingerprint: text.optional(), sourceChanged: z.boolean().optional(), digest: text, createdAt: time, status: z.enum(["pending", "executing", "succeeded", "failed", "unknown", "rejected"]), receipt: z.object({ at: time, message: text, draftId: id.optional() }).optional() }),
  template: z.object({ id, name: text, subject: text, body: text }),
  signature: z.object({ accountId: id, body: text }),
  workspaceMailState: z.object({ id, accountId: id, pinned: z.boolean().optional(), snoozedUntil: time.nullable() }),
};
type Kind = keyof typeof schemas;
type Entry = { kind: Kind; id: string; value: unknown };
const kinds = Object.keys(schemas) as Kind[];
const accountSchema = z.object({ id, email: z.string().max(320), provider: z.enum(["gmail", "gmail-imap", "icloud", "fastmail", "yahoo", "imap"]) }).strict();
const payloadSchema = z.object({
  manifest: z.object({ formatVersion: z.literal(1), appVersion: z.string().max(100), createdAt: z.iso.datetime(), counts: z.record(z.string(), z.number().int().nonnegative()) }).strict(),
  accounts: z.array(accountSchema),
  records: z.array(z.object({ kind: z.enum(kinds as [Kind, ...Kind[]]), id, value: z.unknown() }).strict()).max(100000),
}).strict();
type Payload = z.infer<typeof payloadSchema>;
const counts = (records: Entry[]) => Object.fromEntries(kinds.map(kind => [kind, records.filter(row => row.kind === kind).length]));
const invalid = () => new Error("Wrong passphrase or damaged backup file. Nothing was imported.");
function passphrase(value: unknown): string {
  if (typeof value !== "string" || value.length < 12 || value.length > 1024) throw Error("Use a passphrase of 12 to 1024 characters.");
  return value;
}
function validate(input: unknown): Payload {
  if ((input as Payload)?.manifest?.formatVersion !== 1) throw Error("Unsupported backup format version. Update Emc² before importing this file.");
  const payload = payloadSchema.parse(input);
  const seen = new Set<string>();
  payload.records = payload.records.map(row => {
    const key = `${row.kind}:${row.id}`;
    if (seen.has(key)) throw invalid();
    seen.add(key);
    // Older profiles stored a single recipient string. Normalize only typed fields.
    const input = structuredClone(row.value) as Record<string, any>;
    if (row.kind === "draft" && typeof input?.to === "string") input.to = [input.to];
    if (row.kind === "proposal" && typeof input?.payload?.to === "string") input.payload.to = [input.payload.to];
    const value = schemas[row.kind].parse(input);
    if (("id" in value && value.id !== row.id) || (row.kind === "signature" && (value as { accountId: string }).accountId !== row.id)) throw invalid();
    return { ...row, value };
  });
  if (JSON.stringify(Object.entries(payload.manifest.counts).sort()) !== JSON.stringify(Object.entries(counts(payload.records)).sort())) throw invalid();
  if (new Set(payload.accounts.map(a => a.id)).size !== payload.accounts.length) throw invalid();
  return payload;
}
export function captureBackup(): Payload {
  const records: Entry[] = [];
  for (const kind of ["commitment", "project", "decision", "rule", "draft", "proposal"] as const)
    for (const value of all(kind)) records.push({ kind, id: value.id, value });
  const compose = get("compose", "preferences");
  for (const value of compose?.templates ?? []) records.push({ kind: "template", id: value.id, value });
  for (const [accountId, body] of Object.entries(compose?.signatures ?? {})) records.push({ kind: "signature", id: accountId, value: { accountId, body } });
  for (const value of workspaceMailFlags()) records.push({ kind: "workspaceMailState", id: value.id, value });
  const payload = validate({ manifest: { formatVersion: 1, appVersion, createdAt: new Date().toISOString(), counts: counts(records) }, accounts: all("account").map(({ id, email, provider }) => ({ id, email, provider })), records });
  if (prepare(payload).missingAccounts) throw Error("Backup contains retained work for a removed account. Reassign or remove that work before exporting.");
  return payload;
}
export async function sealBackup(input: unknown, password: unknown): Promise<string> {
  const payload = validate(input);
  const salt = randomBytes(32), iv = randomBytes(12);
  const key = await derive(passphrase(password), salt);
  try {
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from("emc2-workspace-backup:1"));
    const data = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
    const file = JSON.stringify({ format: "emc2-workspace-backup", version: 1, kdf: { name: "scrypt", ...parameters, salt: salt.toString("base64") }, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") });
    if (Buffer.byteLength(file) > BACKUP_MAX_BYTES) throw Error("Backup exceeds the 32 MiB file limit.");
    return file;
  } finally { key.fill(0); }
}
export async function openBackup(file: unknown, password: unknown): Promise<Payload> {
  const secret = passphrase(password);
  if (typeof file !== "string" || Buffer.byteLength(file) > BACKUP_MAX_BYTES) throw invalid();
  let envelope;
  try { envelope = JSON.parse(file); } catch { throw invalid(); }
  if (envelope?.version !== 1) throw Error("Unsupported backup format version. Update Emc² before importing this file.");
  // Avoid a repeated-group regexp on multi-megabyte ciphertext strings.
  const base64 = z.string().refine(value => value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value) && Buffer.from(value, "base64").toString("base64") === value);
  const parsed = z.object({ format: z.literal("emc2-workspace-backup"), version: z.literal(1), kdf: z.object({ name: z.literal("scrypt"), N: z.literal(parameters.N), r: z.literal(parameters.r), p: z.literal(parameters.p), salt: base64 }), iv: base64, tag: base64, data: base64 }).safeParse(envelope);
  if (!parsed.success) throw invalid();
  const { kdf, iv, tag, data } = parsed.data;
  const salt = Buffer.from(kdf.salt, "base64"), nonce = Buffer.from(iv, "base64"), auth = Buffer.from(tag, "base64");
  if (salt.length !== 32 || nonce.length !== 12 || auth.length !== 16) throw invalid();
  const key = await derive(secret, salt);
  let plaintext;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(Buffer.from("emc2-workspace-backup:1"));
    decipher.setAuthTag(auth);
    plaintext = JSON.parse(Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8"));
  } catch { throw invalid(); } finally { key.fill(0); }
  try { return validate(plaintext); } catch (error) {
    if ((plaintext as Payload)?.manifest?.formatVersion !== 1) throw error;
    throw invalid();
  }
}

// Rebind only typed identity/reference fields, never user-authored text.
function prepare(payload: Payload) {
  const accounts = all("account");
  const mapping = new Map<string, string>();
  for (const source of payload.accounts) {
    const matches = accounts.filter(a => a.provider === source.provider && a.email.toLowerCase() === source.email.toLowerCase());
    if (matches.length === 1) mapping.set(source.id, matches[0].id);
  }
  const accountId = (source: string) => mapping.get(source) ?? source;
  const mailId = (source: string) => {
    const original = payload.accounts.find(a => source.startsWith(`${a.id}:`));
    return original ? `${accountId(original.id)}:${source.slice(original.id.length + 1)}` : source;
  };
  const required = new Set<string>();
  const mapAccount = (source: string) => { required.add(source); return accountId(source); };
  const records = payload.records.map(row => {
    // Schemas above whitelist all fields before reaching this identity transform.
    const v = structuredClone(row.value) as Record<string, any>;
    if (typeof v.accountId === "string") v.accountId = mapAccount(v.accountId);
    if (v.accountIds) v.accountIds = v.accountIds.map(mapAccount);
    for (const field of ["sourceMailId"]) if (v[field]) v[field] = mailId(v[field]);
    for (const field of ["sourceMailIds", "evidenceMailIds", "excludedMailIds"]) if (v[field]) v[field] = v[field].map(mailId);
    if (v.history) for (const entry of v.history) entry.evidenceMailIds = entry.evidenceMailIds.map(mailId);
    if (v.calendarContext?.sourceMailId) v.calendarContext.sourceMailId = mailId(v.calendarContext.sourceMailId);
    if (row.kind === "proposal") {
      if (v.payload.accountId) v.payload.accountId = mapAccount(v.payload.accountId);
      if (v.payload.mailId) v.payload.mailId = mailId(v.payload.mailId);
      // Imported history is inert; never resume a pending or interrupted action.
      if (v.status === "pending" || v.status === "executing") v.status = "unknown";
    }
    if (row.kind === "workspaceMailState") v.id = mailId(v.id);
    return { ...row, id: row.kind === "signature" ? v.accountId : row.kind === "workspaceMailState" ? v.id : row.id, value: v };
  });
  return { records, missingAccounts: [...required].filter(source => !mapping.has(source)).length };
}
export function mergeBackup(payload: Payload, commit = false): BackupPreview {
  return transaction(() => {
    const { records, missingAccounts } = prepare(validate(payload));
    const result: BackupPreview = { manifest: payload.manifest, added: counts([]), skipped: counts([]), missingAccounts };
    if (commit && missingAccounts) throw Error("Connect each backup account first, with one matching email address and provider. Nothing was imported.");
    const compose = structuredClone(get("compose", "preferences") ?? { templates: [], signatures: {} });
    // Preview and commit both check the deduplicated destination inside the transaction.
    const drafts = new Map(all("draft").map(draft => [draft.id, draft.accountId]));
    const templates = new Set(compose.templates.map(template => template.id));
    for (const row of records) {
      if (row.kind === "draft" && !drafts.has(row.id)) drafts.set(row.id, row.value.accountId);
      if (row.kind === "template") templates.add(row.id);
    }
    const draftCounts = new Map<string, number>();
    for (const accountId of drafts.values()) draftCounts.set(accountId, (draftCounts.get(accountId) ?? 0) + 1);
    if ([...draftCounts.values()].some(count => count > MAX_DRAFTS_PER_ACCOUNT))
      throw Error("Backup would exceed the 100-draft account limit. Remove drafts before importing. Nothing was imported.");
    if (templates.size > 50) throw Error("Backup would exceed the 50-template limit. Remove templates before importing. Nothing was imported.");
    for (const row of records) {
      let exists: boolean;
      if (row.kind === "template") exists = compose.templates.some(t => t.id === row.id);
      else if (row.kind === "signature") exists = Object.hasOwn(compose.signatures, row.id);
      else if (row.kind === "workspaceMailState") {
        const mail = get("mail", row.id);
        exists = !!get("workspaceMailState", row.id) || !!(mail && (mail.pinned || mail.snoozedUntil !== null));
      } else exists = !!get(row.kind, row.id);
      result[exists ? "skipped" : "added"][row.kind]++;
      if (exists) continue;
      if (row.kind === "template") compose.templates.push(row.value as Records["compose"]["templates"][number]);
      else if (row.kind === "signature") compose.signatures[row.id] = row.value.body;
      else if (commit) {
        if (row.kind === "workspaceMailState") {
          const mail = get("mail", row.id);
          if (mail && mail.accountId === row.value.accountId) put("mail", row.id, { ...mail, pinned: row.value.pinned, snoozedUntil: row.value.snoozedUntil });
          else put("workspaceMailState", row.id, row.value as Records["workspaceMailState"]);
        } else put(row.kind, row.id, row.value as Records[typeof row.kind]);
      }
    }
    if (commit) put("compose", "preferences", compose);
    return result;
  });
}

export function mountWorkspaceBackup(app: express.Express, changed: () => void, available: () => void) {
  // One KDF at a time bounds memory and prevents concurrent import confirmations.
  let running = false;
  let preview: { token: string; digest: string; expires: number } | undefined;
  for (const action of ["export", "preview", "import"] as const) app.post(`/api/workspace-backup/${action}`, async (req, res) => trackMailWork(async () => {
    if (running) return res.status(409).json({ error: "A backup operation is already running." });
    running = true;
    try {
      available();
      if (action === "export") return res.json({ file: await sealBackup(captureBackup(), req.body?.passphrase) });
      const payload = await openBackup(req.body?.file, req.body?.passphrase);
      available();
      const digest = createHash("sha256").update(req.body.file).digest("hex");
      if (action === "import") {
        if (!preview || preview.expires < Date.now() || preview.token !== req.body.previewToken || preview.digest !== digest)
          throw Error("Preview this backup again before importing.");
        preview = undefined;
      }
      const result = mergeBackup(payload, action === "import");
      if (action === "preview") {
        preview = { token: randomBytes(32).toString("hex"), digest, expires: Date.now() + 10 * 60 * 1000 };
        return res.json({ ...result, previewToken: preview.token });
      }
      if (action === "import") changed();
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error instanceof z.ZodError ? "Invalid backup records. Nothing was imported." : (error as Error).message });
    } finally { running = false; }
  }).catch(() => { if (!res.headersSent) res.status(503).json({ error: "Backup unavailable. Try again after the current operation." }); }));
}
