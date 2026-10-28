import { AttachmentPreflightError } from "./attachment-bytes.js";
import { readDraft } from "./drafts.js";
import { networkInterfaces } from "node:os";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { Draft, OutboxStatus } from "../shared/types.js";
import { all, get, put, remove, transaction, account } from "./store.js";
import { sendSchema, type SendInput } from "./providers.js";
import { assertMailAvailable, mailIsQuiesced, sendMail, trackMailWork } from "./mail-actions.js";

export type OutboxRecord = OutboxStatus & { payload: SendInput; draft: Draft };
export const outboxRequest = z.object({
  payload: z.unknown(),
  sourceDraftId: z.uuid(),
  sourceRevision: z.number().int().positive(),
  scheduleAt: z.number().int().positive().optional(),
}).strict();
export function outboxStatuses(): OutboxStatus[] {
  return all("outbox").sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)).map(({ payload: _payload, draft: _draft, ...status }) => status);
}
export function requireOutbox(id: string): OutboxRecord {
  const record = get("outbox", id);
  if (!record) throw new Error("Outbox entry not found. Refresh before continuing.");
  return record;
}
// Only explicit protocol rejections establish failure. Timeouts and disconnects
// remain unknown even if they happened before the provider actually accepted.
export function rejectedBeforeAcceptance(error: unknown): boolean {
  if (error instanceof AttachmentPreflightError) return true;
  if (!error || typeof error !== "object") return false;
  const e = error as { responseCode?: number; code?: string; response?: { status?: number } };
  return (typeof e.responseCode === "number" && e.responseCode >= 400 && e.responseCode <= 599) ||
    (["EAUTH", "EENVELOPE"].includes(e.code || "")) ||
    (typeof e.response?.status === "number" && [400, 401, 403, 404, 413, 429].includes(e.response.status));
}
export class Outbox {
  private timer?: ReturnType<typeof setInterval>;
  private previousTick: number;
  constructor(private changed: () => void = () => {}, private now = Date.now,
    private deliver: typeof sendMail = sendMail,
    private online = () => Object.values(networkInterfaces()).some(entries => entries?.some(entry => !entry.internal))) { this.previousTick = now(); }
  recover() {
    transaction(() => {
      for (const entry of all("outbox")) {
        if (entry.state === "pending") put("outbox", entry.id, { ...entry, review: true, updatedAt: this.now() });
        if (entry.state === "submitting") put("outbox", entry.id, { ...entry, state: "unknown", review: true, updatedAt: this.now() });
      }
    });
  }
  start() {
    this.recover();
    this.previousTick = this.now();
    this.timer = setInterval(() => {
      void this.tick().catch(() => this.hold());
    }, 250);
    this.timer.unref();
  }
  setOnlineCheck(check: () => boolean) { this.online = check; }
  async tick() {
    // A suspended process must not silently send a missed deadline on wake.
    const now = this.now();
    if (now - this.previousTick > 2000 || now < this.previousTick) this.hold();
    this.previousTick = now;
    await this.dispatchDue();
  }
  close() { clearInterval(this.timer); this.hold(); }
  hold(): number {
    const pending = all("outbox").filter(entry => entry.state === "pending");
    if (!pending.length) return 0;
    transaction(() => {
      for (const entry of pending) put("outbox", entry.id, { ...entry, review: true, updatedAt: this.now() });
    });
    if (pending.length) this.changed();
    return pending.length;
  }
  enqueue(value: unknown): OutboxStatus {
    assertMailAvailable();
    const request = outboxRequest.parse(value);
    const payload = sendSchema.parse(request.payload);
    account(payload.accountId);
    const entry = transaction(() => {
      const existing = all("outbox").find(entry => entry.sourceDraftId === request.sourceDraftId && entry.sourceRevision === request.sourceRevision);
      if (existing) {
        if (!isDeepStrictEqual(existing.payload, payload) || existing.scheduledFor !== request.scheduleAt) throw new Error("This draft revision already has a different send attempt.");
        return existing;
      }
      if (all("outbox").filter(entry => entry.accountId === payload.accountId).length >= 100)
        throw new Error("Outbox limit reached. Review and dismiss old entries before sending.");
      const draft = readDraft(payload.accountId, request.sourceDraftId);
      if (draft.revision !== request.sourceRevision)
        throw new Error("Draft changed. Recover the saved draft before sending.");
      const expected = sendSchema.parse({ ...draft, ...(draft.invitation ? { calendarDraft: { id: draft.id, revision: draft.revision } } : {}) });
      if (!isDeepStrictEqual(expected, payload)) throw new Error("Send must match the saved draft.");
      if (all("outbox").some(entry => entry.sourceDraftId === draft.id)) throw new Error("Review this draft's existing outbox entry first.");
      const now = this.now();
      if (request.scheduleAt !== undefined) this.requireFuture(request.scheduleAt);
      const delay = get("compose", "preferences")?.undoSendSeconds ?? 10;
      const entry: OutboxRecord = { id: randomUUID(), accountId: payload.accountId,
        sourceDraftId: draft.id, sourceRevision: draft.revision, payload, draft,
        state: "pending", review: false, createdAt: now, updatedAt: now, dueAt: request.scheduleAt ?? now + delay * 1000,
        ...(request.scheduleAt !== undefined ? { scheduledFor: request.scheduleAt } : {}) };
      put("outbox", entry.id, entry);
      return entry;
    });
    this.changed();
    const { payload: _payload, draft: _draft, ...status } = entry;
    return status;
  }
  private requireFuture(at: number) {
    if (!Number.isSafeInteger(at) || at <= this.now() || at > this.now() + 366 * 86400000)
      throw new Error("Choose a future time within one year.");
  }
  reschedule(id: string, at: number) {
    assertMailAvailable();
    this.requireFuture(at);
    const entry = requireOutbox(id);
    if (entry.state !== "pending") throw new Error("Only pending mail can be rescheduled. Check uncertain outcomes with your provider.");
    if (entry.scheduledFor === undefined) throw new Error("Only scheduled mail can be rescheduled.");
    put("outbox", id, { ...entry, scheduledFor: at, dueAt: at, review: false, updatedAt: this.now() });
    this.changed();
  }
  async dispatchDue() {
    if (mailIsQuiesced()) return;
    for (const entry of all("outbox")) {
      const latest = get("outbox", entry.id);
      if (latest?.state === "pending" && !latest.review && latest.dueAt <= this.now()) {
        if (latest.scheduledFor !== undefined && !this.online()) {
          put("outbox", latest.id, { ...latest, review: true, updatedAt: this.now() });
          this.changed();
        } else await this.submit(entry.id);
      }
    }
  }
  submit(id: string) { return trackMailWork(() => this.attempt(id)); }
  private async attempt(id: string) {
    assertMailAvailable();
    const entry = requireOutbox(id);
    if (entry.state !== "pending") throw new Error("Only pending mail can be sent. Check your provider for unknown outcomes.");
    put("outbox", id, { ...entry, state: "submitting", updatedAt: this.now() });
    // Calendar MIME validation uses the durable uncertainty marker. Set it only
    // once cancellation is no longer possible, without changing the frozen revision.
    const source = get("draft", entry.sourceDraftId);
    if (source?.revision === entry.sourceRevision) put("draft", source.id, { ...source, sendUnknown: true });
    this.changed();
    let state: OutboxStatus["state"] = "unknown";
    let warning: string | undefined;
    try {
      const result = await this.deliver(entry.payload);
      state = "sent"; warning = result.warning;
    } catch (error) { state = rejectedBeforeAcceptance(error) ? "failed" : "unknown"; }
    transaction(() => {
      put("outbox", id, { ...entry, state, review: true, warning, updatedAt: this.now() });
      if (state === "sent") {
        const current = get("draft", entry.sourceDraftId);
        if (current?.revision === entry.sourceRevision) remove("draft", current.id);
      }
    });
    this.changed();
  }
  edit(id: string): Draft {
    return transaction(() => {
      const entry = requireOutbox(id);
      if (entry.state === "submitting" || entry.state === "sent") throw new Error("This send cannot be undone.");
      const current = get("draft", entry.sourceDraftId);
      if (!current || current.revision !== entry.sourceRevision) throw new Error("Source draft changed. Recover it separately.");
      const restored = { ...entry.draft, revision: current.revision + 1, updatedAt: this.now(),
        sendUnknown: entry.state === "unknown" || entry.draft.sendUnknown };
      put("draft", restored.id, restored);
      remove("outbox", id);
      this.changed();
      return restored;
    });
  }
  discard(id: string, confirmUnknown = false) {
    transaction(() => {
      const entry = requireOutbox(id);
      if (entry.state === "submitting") throw new Error("Wait for the current send to finish.");
      if (entry.state === "unknown" && !confirmUnknown) throw new Error("Confirm discarding mail that may already have been sent.");
      if (entry.state !== "sent") {
        const current = get("draft", entry.sourceDraftId);
        if (current?.revision === entry.sourceRevision) remove("draft", current.id);
      }
      remove("outbox", id);
    });
    this.changed();
  }
}
