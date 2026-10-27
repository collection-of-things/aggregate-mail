import { z } from "zod";
import type { LocalMailUndo } from "../shared/local-mail-undo.js";
import { updateLocalMail, restoreLocalMail } from "./local-mail-undo.js";
import { MAX_MAIL_BATCH, type MailBatchResponse } from "../shared/bulk-mail.js";
import { all, get, account, put, remove } from "./store.js";
import { providers, sendSchema, SentCopyError, updateGmailLabels, type SendInput } from "./providers.js";
import { recordRecentRecipients } from "./contacts.js";

let mailWork = Promise.resolve();
let quiesced = false;
const activeWork = new Set<Promise<unknown>>();
let queuedWork = 0;
let admittedWork = 0;
let lastCompletedAt = Date.now();
export function mailWorkActivity(): Readonly<{ queued: number; active: number; lastCompletedAt: number }> {
  return { queued: queuedWork, active: admittedWork - queuedWork, lastCompletedAt };
}
export function assertMailAvailable() {
  if (quiesced) throw new Error("Mail is paused for an application update. Try again shortly.");
}
export function mailIsQuiesced() { return quiesced; }
export function trackMailWork<T>(task: () => Promise<T>): Promise<T> {
  try { assertMailAvailable(); } catch (error) { return Promise.reject(error); }
  admittedWork++;
  let result: Promise<T>;
  try { result = Promise.resolve(task()); } catch (error) { result = Promise.reject(error); }
  activeWork.add(result);
  const completed = () => { activeWork.delete(result); admittedWork--; lastCompletedAt = Date.now(); };
  void result.then(completed, completed);
  return result;
}
export async function quiesceMailWork(timeout: number) {
  quiesced = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.allSettled([...activeWork, mailWork]),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Mail work did not finish before the update deadline.")), timeout);
      }),
    ]);
  } finally { clearTimeout(timer); }
}
export function resumeMailWork() { quiesced = false; }
// Sync and provider mutations must finish in order so stale metadata cannot undo a read.
export function runMailWork<T>(task: () => Promise<T>): Promise<T> {
  return trackMailWork(() => {
    queuedWork++;
    const result = mailWork.then(() => { queuedWork--; return task(); });
    mailWork = result.then(() => {}, () => {});
    return result;
  });
}

export const messageActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["pin", "unpin"]) }).strict(),
  z.object({
    action: z.enum(["read", "unread", "inbox", "archive", "snooze", "unsnooze", "trash"]),
    until: z
      .number()
      .int()
      .refine(
        (until) => until >= Date.now() && until <= Date.now() + 366 * 86400000,
        "Choose a snooze time within the next year.",
      )
      .optional(),
  }),
  z.object({
    action: z.literal("labels"),
    labelIds: z.array(z.string().min(1).max(200)).max(100),
  }),
]);

export function findMail(id: string) {
  const mail = get("mail", id);
  if (!mail) throw new Error("Message not found.");
  return mail;
}

export async function updateMessage(
  id: string,
  input: z.infer<typeof messageActionSchema>,
  beforeExecution?: () => void,
  providerStarted?: () => void,
  captureUndo?: (receipt: LocalMailUndo) => void,
) {
  return runMailWork(async () => {
    beforeExecution?.();
    const m = findMail(id);
    if (input.action === "pin" || input.action === "unpin" || input.action === "snooze" || input.action === "unsnooze")
      return updateLocalMail(id, input.action, "until" in input ? input.until : undefined, captureUndo);
    if (input.action === "read" && !m.unread || input.action === "unread" && m.unread || input.action === "inbox" && !m.archived) return m;
    if (input.action === "trash") {
      const a = account(m.accountId);
      providerStarted?.();
      await providers[a.provider].update(a, m, "trash");
      remove("mail", m.id);
      return m;
    }
    if (input.action === "labels") {
      const a = account(m.accountId);
      if (a.provider !== "gmail") throw new Error("Labels are only supported for Gmail accounts.");
      const customIds = all("label")
        .filter((label) => label.accountId === a.id && label.type === "user")
        .map((label) => label.id);
      if (input.labelIds.some((labelId) => !customIds.includes(labelId)))
        throw new Error("Choose custom labels from this Gmail account. Sync if a label is missing.");
      const labelIds = await updateGmailLabels(a, m, [...new Set(input.labelIds)], customIds);
      const updated = { ...findMail(id), labelIds, unread: labelIds.includes("UNREAD"), archived: !labelIds.includes("INBOX") };
      put("mail", m.id, updated);
      return updated;
    }
    let identity: void | { remoteId: string } = undefined;
    if (input.action === "read" || input.action === "unread" || input.action === "inbox" || input.action === "archive") {
      const a = account(m.accountId);
      providerStarted?.();
      identity = await providers[a.provider].update(a, m, input.action);
    }
    const latest = findMail(id);
    const removedLabel = input.action === "read" ? "UNREAD" : input.action === "archive" ? "INBOX" : null;
    const updated = {
      ...latest,
      ...(identity || {}),
      labelIds: removedLabel ? latest.labelIds?.filter((labelId) => labelId !== removedLabel) : input.action === "unread" || input.action === "inbox" ? [...new Set([...(latest.labelIds || []), input.action === "unread" ? "UNREAD" : "INBOX"])] : latest.labelIds,
      unread: input.action === "read" ? false : input.action === "unread" ? true : latest.unread,
      archived: input.action === "inbox" ? false : input.action === "archive" || latest.archived,
      snoozedUntil: latest.snoozedUntil,
    };
    put("mail", m.id, updated);
    return updated;
  });
}

export async function sendMail(value: unknown, beforeExecution?: () => void) {
  return trackMailWork(async () => {
    const input = sendSchema.parse(value);
    const a = account(input.accountId);
    beforeExecution?.();
    try {
      await providers[a.provider].send(a, input);
    } catch (error) {
      if (error instanceof SentCopyError) {
        rememberRecipients(input);
        return { ok: true, warning: error.message };
      }
      throw error;
    }
    rememberRecipients(input);
    return { ok: true };
  });
}

// Delivery already succeeded, so a failed contact write must not turn it into a send error.
function rememberRecipients(input: SendInput) {
  try { recordRecentRecipients(input.accountId, [...input.to, ...(input.cc ?? []), ...(input.bcc ?? [])]); } catch { /* suggestions are optional */ }
}

export const mailBatchSchema = z.object({
  items: z.array(z.object({ id: z.string().min(1).max(500), accountId: z.string().min(1).max(500) }).strict())
    .min(1).max(MAX_MAIL_BATCH).refine(items => new Set(items.map(item => item.id)).size === items.length, "Choose each message once."),
  operation: messageActionSchema.refine(input => ["read", "unread", "archive", "inbox", "snooze", "pin", "unpin", "trash"].includes(input.action), "Unsupported batch action."),
}).strict();

export function updateMessages(value: unknown, beforeExecution?: () => void): Promise<MailBatchResponse> {
  const input = mailBatchSchema.parse(value);
  return trackMailWork(async () => {
    const results: MailBatchResponse["results"] = [];
    for (const item of input.items) {
      let providerAttempted = false;
      try {
        await updateMessage(item.id, input.operation, () => {
          beforeExecution?.();
          const mail = findMail(item.id);
          if (mail.accountId !== item.accountId) throw new Error("Message account changed.");
          if (mail.archived && input.operation.action === "snooze")
            throw new Error("Archived mail cannot be snoozed. Move it to Inbox first.");
          if (mail.direction === "sent" && !["pin", "unpin", "trash"].includes(input.operation.action))
            throw new Error("This action is unavailable for Sent mail.");
        }, () => { providerAttempted = true; });
        results.push({ ...item, status: "done" });
      } catch {
        // Provider errors can follow a committed remote mutation. Never guess or retry.
        results.push({ ...item, status: providerAttempted ? "unknown" : "failed" });
      }
    }
    return { results };
  });
}

export function undoMessage(id: string, accountId: string, token: string, beforeExecution?: () => void) {
  return runMailWork(() => { beforeExecution?.(); return restoreLocalMail(id, accountId, token); });
}
