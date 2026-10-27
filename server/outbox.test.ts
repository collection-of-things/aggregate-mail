import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

test("encrypted local outbox never retries or submits cancelled or recovered pending mail", async t => {
  const directory = mkdtempSync(path.join(tmpdir(), "emc2-outbox-"));
  process.env.MAIL_DATA_DIR = directory;
  process.env.MAIL_DATA_KEY = Buffer.alloc(32, 9).toString("base64");
  const store = await import("./store.js");
  const { Outbox, outboxStatuses, rejectedBeforeAcceptance } = await import("./outbox.js");
  const { createDraft, saveDraft, deleteDraft } = await import("./drafts.js");
  const { quiesceMailWork, resumeMailWork } = await import("./mail-actions.js");
  store.put("account", "synthetic", { id: "synthetic", email: "sender@example.test", provider: "imap", credentials: {} });
  let clock = 100000;
  let calls = 0;
  let deliver: () => Promise<{ ok: boolean; warning?: string }> = async () => ({ ok: true });
  const box = new Outbox(() => {}, () => clock, async () => { calls++; return deliver(); });
  const content = {
    to: ["to@example.test", "other@example.test"], cc: ["cc@example.test"], bcc: ["hidden@example.test"],
    subject: "Opaque synthetic subject", body: "Synthetic body", html: "<p>Synthetic body</p>",
    attachments: [{ filename: "sample.txt", contentType: "text/plain", content: "c2FtcGxl" }],
    references: ["<source@example.test>"], inReplyTo: "<source@example.test>", threadId: "synthetic-thread",
  };
  const queue = () => {
    const draft = createDraft("synthetic", content);
    const payload = { accountId: draft.accountId, ...content };
    const request = { payload, sourceDraftId: draft.id, sourceRevision: draft.revision };
    return { draft, request, entry: box.enqueue(request) };
  };
  const clean = () => {
    for (const entry of store.all("outbox")) store.remove("outbox", entry.id);
    for (const draft of store.all("draft")) store.remove("draft", draft.id);
    store.remove("compose", "preferences"); calls = 0; resumeMailWork();
    deliver = async () => ({ ok: true });
  };
  try {
    await t.test("legacy string-To admission normalizes without saving or changing the frozen revision", () => {
      const draft = createDraft("synthetic", { ...content, to: [content.to[0]] });
      const raw = { ...draft, to: content.to[0], revision: 7, sendUnknown: true };
      store.put("draft", draft.id, raw as unknown as typeof draft);
      const payload = { accountId: draft.accountId, ...content, to: [content.to[0]] };
      const entry = box.enqueue({ payload, sourceDraftId: draft.id, sourceRevision: 7 });
      assert.deepEqual(store.get("draft", draft.id), raw, "admission must not rewrite legacy storage");
      assert.deepEqual(store.get("outbox", entry.id)!.draft, { ...raw, to: [raw.to] });
      assert.deepEqual(store.get("outbox", entry.id)!.payload, payload);
      const restored = box.edit(entry.id);
      assert.equal(restored.revision, 8);
      assert.equal(restored.sendUnknown, true);
      assert.deepEqual(restored.to, [raw.to]);
      assert.equal(calls, 0);
      clean();
    });
    await t.test("status order keeps the newest pending send last regardless of UUID order", () => {
      const first = queue();
      clock += 1;
      const second = queue();
      const olderId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
      const newerId = "00000000-0000-4000-8000-000000000000";
      for (const [entry, id] of [[first.entry, olderId], [second.entry, newerId]] as const) {
        const record = store.get("outbox", entry.id)!;
        store.remove("outbox", entry.id);
        store.put("outbox", id, { ...record, id });
      }
      try { assert.deepEqual(outboxStatuses().map(entry => entry.id), [olderId, newerId]); }
      finally { clean(); }
    });
    await t.test("Undo restores the exact draft with Bcc, html and attachments with zero provider calls", async () => {
      const { draft, entry, request } = queue();
      assert.equal(entry.dueAt, clock + 10000, "Default delay is ten seconds");
      assert.equal(box.enqueue(request).id, entry.id, "Lost queue acknowledgements cannot duplicate a revision");
      assert.throws(() => saveDraft(draft.accountId, draft.id, { ...content, revision: draft.revision }), /Outbox/);
      assert.throws(() => deleteDraft(draft.accountId, draft.id, { revision: draft.revision }), /Outbox/);
      const restored = box.edit(entry.id);
      assert.deepEqual(restored, { ...draft, revision: 2, updatedAt: clock });
      clock += 30000; await box.dispatchDue(); assert.equal(calls, 0);
      clean();
    });
    await t.test("delay expiration submits once and persists sent acceptance before cleaning the draft", async () => {
      const { draft, entry } = queue();
      await box.dispatchDue(); assert.equal(calls, 0);
      clock += 10000; await box.dispatchDue(); await box.dispatchDue();
      assert.equal(calls, 1); assert.equal(store.get("outbox", entry.id)?.state, "sent");
      assert.equal(store.get("draft", draft.id), undefined);
      assert.throws(() => box.edit(entry.id), /cannot be undone/);
      await assert.rejects(box.submit(entry.id), /Only pending/);
      clean();
    });
    await t.test("concurrent dispatch and Send now admit one provider attempt", async () => {
      const { entry } = queue();
      let release!: () => void;
      deliver = () => new Promise(resolve => { release = () => resolve({ ok: true }); });
      const first = box.submit(entry.id);
      await assert.rejects(box.submit(entry.id), /Only pending/);
      await box.dispatchDue();
      assert.equal(calls, 1);
      release(); await first;
      assert.equal(store.get("outbox", entry.id)?.state, "sent");
      clean();
    });
    await t.test("pending and submitting recover in a fresh process without provider calls", async () => {
      const pending = queue(); const submitting = queue();
      store.put("outbox", submitting.entry.id, { ...store.get("outbox", submitting.entry.id)!, state: "submitting" });
      const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
        const { Outbox } = await import('./server/outbox.ts');
        const { all, closeStore } = await import('./server/store.ts');
        const box = new Outbox(() => {}, Date.now, async () => { throw Error('Must not send'); });
        box.recover(); await box.dispatchDue();
        console.log(JSON.stringify(all('outbox').map(e => ({id:e.id,state:e.state,review:e.review}))));
        closeStore();
      `], { encoding: "utf8", timeout: 15000 });
      assert.equal(result.status, 0, result.stderr);
      const entries = JSON.parse(result.stdout);
      assert.deepEqual(entries.find((e: { id: string }) => e.id === pending.entry.id), { id: pending.entry.id, state: "pending", review: true });
      assert.deepEqual(entries.find((e: { id: string }) => e.id === submitting.entry.id), { id: submitting.entry.id, state: "unknown", review: true });
      assert.equal(calls, 0);
      assert.equal(box.edit(submitting.entry.id).sendUnknown, true);
      clean();
    });
    await t.test("encrypted payload round-trip is opaque and absent from database and WAL bytes", () => {
      const { entry, request } = queue();
      assert.deepEqual(store.get("outbox", entry.id)!.payload, request.payload);
      for (const name of ["mail.sqlite", "mail.sqlite-wal"]) {
        assert.equal(readFileSync(path.join(directory, name)).includes(Buffer.from(content.subject)), false);
        assert.equal(readFileSync(path.join(directory, name)).includes(Buffer.from(content.bcc[0])), false);
      }
      clean();
    });
    await t.test("explicit rejection is failed, lost acceptance is unknown, Sent-copy warning is sent", async () => {
      for (const scenario of [
        { error: Object.assign(new Error("Rejected"), { responseCode: 550 }), state: "failed" },
        { error: Object.assign(new Error("Disconnected"), { code: "ECONNRESET" }), state: "unknown" },
        { error: undefined, state: "sent" },
      ]) {
        const { entry } = queue();
        deliver = async () => { if (scenario.error) throw scenario.error; return { ok: true, warning: "Sent copy failed. Do not resend." }; };
        await box.submit(entry.id); await box.dispatchDue();
        assert.equal(calls, 1); assert.equal(store.get("outbox", entry.id)?.state, scenario.state);
        if (scenario.state === "sent") assert.match(store.get("outbox", entry.id)!.warning!, /Do not resend/);
        if (scenario.state === "unknown") assert.equal(box.edit(entry.id).sendUnknown, true);
        if (scenario.state === "failed") assert.equal(box.edit(entry.id).sendUnknown, false);
        clean();
      }
      assert.equal(rejectedBeforeAcceptance({ response: { status: 503 } }), false);
      assert.equal(rejectedBeforeAcceptance({ response: { status: 403 } }), true);
      assert.equal(rejectedBeforeAcceptance({ status: 400 }), false, "HTTP wrapper failures are not provider rejections");
    });
    await t.test("drain holds pending and waits for the whole submitting receipt", async () => {
      const pending = queue(); const active = queue();
      let release!: () => void;
      deliver = () => new Promise(resolve => { release = () => resolve({ ok: true }); });
      const sending = box.submit(active.entry.id);
      assert.equal(store.get("outbox", active.entry.id)?.state, "submitting");
      assert.equal(box.hold(), 1);
      let drained = false;
      const draining = quiesceMailWork(1000).then(() => { drained = true; });
      await Promise.resolve(); assert.equal(drained, false);
      clock += 30000; await box.dispatchDue(); assert.equal(calls, 1);
      release(); await sending; await draining;
      assert.equal(store.get("outbox", active.entry.id)?.state, "sent");
      resumeMailWork(); await box.dispatchDue();
      assert.equal(calls, 1); assert.equal(store.get("outbox", pending.entry.id)?.review, true);
      deliver = async () => ({ ok: true });
      await box.submit(pending.entry.id); assert.equal(calls, 2);
      clean();
    });
    await t.test("a rejected confirmed resend does not erase earlier uncertainty", async () => {
      const { entry } = queue();
      store.put("outbox", entry.id, { ...store.get("outbox", entry.id)!, state: "unknown" });
      const uncertain = box.edit(entry.id);
      const retry = box.enqueue({ payload: { accountId: uncertain.accountId, ...content }, sourceDraftId: uncertain.id, sourceRevision: uncertain.revision });
      deliver = async () => { throw Object.assign(new Error("Rejected"), { responseCode: 550 }); };
      await box.submit(retry.id);
      assert.equal(box.edit(retry.id).sendUnknown, true, "The original attempt may still have been accepted");
      clean();
    });
    await t.test("Off, 5, 10 and 30 seconds retain the durable state machine", async () => {
      for (const delay of [0, 5, 10, 30] as const) {
        store.put("compose", "preferences", { templates: [], signatures: {}, undoSendSeconds: delay });
        const { entry } = queue(); assert.equal(entry.dueAt, clock + delay * 1000);
        clock += delay * 1000; await box.dispatchDue(); assert.equal(calls, 1);
        clean();
      }
    });
    await t.test("recovered pending Send now is explicit; Discard never submits", async () => {
      const first = queue(); const second = queue();
      box.recover(); clock += 60000; await box.dispatchDue(); assert.equal(calls, 0);
      box.discard(second.entry.id); assert.equal(store.get("draft", second.draft.id), undefined);
      await box.submit(first.entry.id); assert.equal(calls, 1);
      clean();
    });
  } finally { box.close(); store.closeStore(); rmSync(directory, { recursive: true, force: true }); }
});
