import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

test("scheduled sends retain frozen snapshots, review missed deadlines and never retry", async t => {
  const directory = mkdtempSync(path.join(tmpdir(), "emc2-scheduled-"));
  process.env.MAIL_DATA_DIR = directory;
  process.env.MAIL_CONFIG_PATH = path.join(directory, "absent.env");
  process.env.MAIL_DESKTOP_TOKEN = "synthetic-scheduled-desktop";
  process.env.MAIL_DATA_KEY = Buffer.alloc(32, 31).toString("base64");
  const store = await import("./store.js");
  const { Outbox } = await import("./outbox.js");
  const { createDraft } = await import("./drafts.js");
  store.put("account", "a", { id: "a", email: "sender@example.test", provider: "imap", credentials: {} });
  let clock = 100000, online = true, calls = 0;
  let deliver = async () => ({ ok: true, warning: "Some recipients were rejected. Do not resend." });
  const box = new Outbox(() => {}, () => clock, async () => { calls++; return deliver(); }, () => online);
  const content = { to: ["one@example.test", "two@example.test"], bcc: ["hidden@example.test"], subject: "Synthetic schedule", body: "Frozen synthetic body" };
  const queue = (scheduleAt = clock + 60000) => {
    const draft = createDraft("a", content);
    const request = { payload: { accountId: "a", ...content }, sourceDraftId: draft.id, sourceRevision: draft.revision, scheduleAt };
    return { draft, request, entry: box.enqueue(request) };
  };
  const clean = () => { for (const entry of store.all("outbox")) store.remove("outbox", entry.id); for (const draft of store.all("draft")) store.remove("draft", draft.id); calls = 0; online = true; };
  try {
    await t.test("authenticated schedule and reschedule routes preserve the exact snapshot", async () => {
      const backend = await import("./index.js");
      const { quietImapWatch, quietGmailRevision } = await import("./imap-watch-fixture.js");
      const server = await backend.startServer(0, undefined, undefined, undefined, quietImapWatch, quietGmailRevision);
      const address = server.address(); assert.ok(address && typeof address === "object");
      const origin = `http://127.0.0.1:${address.port}`;
      const headers = { "X-Desktop-Token": "synthetic-scheduled-desktop", "Content-Type": "application/json", "X-CSRF-Token": "" };
      const request = (route: string, method = "GET", body?: unknown) => fetch(`${origin}/api${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      try {
        headers["X-CSRF-Token"] = ((await (await request("/state")).json()) as { csrf: string }).csrf;
        const draft = createDraft("a", content), scheduleAt = Date.now() + 60000;
        const queued = await request("/send", "POST", { payload: { accountId: "a", ...content }, sourceDraftId: draft.id, sourceRevision: draft.revision, scheduleAt });
        assert.equal(queued.status, 202);
        const { entry } = await queued.json() as { entry: import("../shared/types.js").OutboxStatus };
        const before = store.get("outbox", entry.id)!;
        assert.equal((await fetch(`${origin}/api/outbox/${entry.id}/reschedule`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 403);
        assert.equal((await request(`/outbox/${entry.id}/reschedule`, "POST", { at: Date.now() - 1 })).status, 400);
        assert.equal((await request(`/outbox/${entry.id}/reschedule`, "POST", { at: scheduleAt + 60000 })).status, 200);
        assert.deepEqual(store.get("outbox", entry.id)!.payload, before.payload);
        assert.equal(store.get("outbox", entry.id)!.sourceRevision, draft.revision);
        assert.doesNotMatch(await (await request("/outbox")).text(), /Frozen synthetic body|hidden@example.test/);
        assert.equal((await request(`/outbox/${entry.id}/edit`, "POST", {})).status, 200);
        assert.equal(store.get("draft", draft.id)!.revision, 2); assert.equal(calls, 0);
      } finally { await new Promise<void>(resolve => server.close(() => resolve())); clean(); }
    });
    await t.test("future admission is idempotent and due dispatch submits once with sent warning", async () => {
      const { request, entry } = queue();
      assert.equal(entry.scheduledFor, request.scheduleAt);
      assert.equal(entry.dueAt, request.scheduleAt);
      assert.equal(box.enqueue(request).id, entry.id);
      await box.dispatchDue(); assert.equal(calls, 0);
      clock = request.scheduleAt;
      await Promise.all([box.dispatchDue(), box.dispatchDue()]);
      assert.equal(calls, 1); assert.equal(store.get("outbox", entry.id)?.state, "sent");
      assert.match(store.get("outbox", entry.id)!.warning!, /Do not resend/);
      assert.equal(box.enqueue(request).id, entry.id, "Lost acknowledgement after the deadline still reconciles");
      clean();
    });
    await t.test("invalid dates do not admit a schedule", () => {
      const { draft } = queue(); clean();
      const saved = createDraft("a", content);
      const request = { payload: { accountId: "a", ...content }, sourceDraftId: saved.id, sourceRevision: saved.revision };
      for (const scheduleAt of [clock, clock - 1, clock + 367 * 86400000, 1.5])
        assert.throws(() => box.enqueue({ ...request, scheduleAt }));
      assert.equal(store.all("outbox").length, 0); assert.equal(calls, 0);
      assert.notEqual(saved.id, draft.id);
      clean();
    });
    await t.test("reschedule retains attempt and snapshot; Cancel restores exact draft", () => {
      const { entry, draft } = queue();
      const before = store.get("outbox", entry.id)!;
      const at = clock + 120000;
      box.reschedule(entry.id, at);
      const after = store.get("outbox", entry.id)!;
      assert.equal(after.id, before.id); assert.equal(after.dueAt, at); assert.equal(after.scheduledFor, at);
      assert.deepEqual(after.payload, before.payload); assert.deepEqual(after.draft, before.draft);
      assert.equal(after.review, false);
      assert.deepEqual(box.edit(entry.id), { ...draft, revision: 2, updatedAt: clock });
      assert.equal(calls, 0); clean();
    });
    await t.test("offline due mail is held; reconnect never sends until explicit reschedule", async () => {
      const { entry } = queue(); online = false; clock = entry.dueAt;
      await box.dispatchDue(); assert.equal(calls, 0); assert.equal(store.get("outbox", entry.id)?.review, true);
      online = true; await box.dispatchDue(); assert.equal(calls, 0);
      box.reschedule(entry.id, clock + 1000); clock += 1000;
      await box.dispatchDue(); assert.equal(calls, 1); clean();
    });
    await t.test("sleep gap and restart hold schedules for review without sending", async () => {
      const { entry } = queue(); clock = entry.dueAt + 1;
      await box.tick(); assert.equal(calls, 0); assert.equal(store.get("outbox", entry.id)?.review, true);
      clean(); const next = queue(); box.recover(); clock = next.entry.dueAt + 1;
      await box.dispatchDue(); assert.equal(calls, 0); assert.equal(store.get("outbox", next.entry.id)?.review, true);
      clean();
    });
    await t.test("active and uncertain submissions cannot be rescheduled or retried", async () => {
      const { entry } = queue();
      let release!: () => void;
      deliver = () => new Promise(resolve => { release = () => resolve({ ok: true, warning: "Accepted" }); });
      const active = box.submit(entry.id);
      assert.throws(() => box.reschedule(entry.id, clock + 1000), /pending/);
      assert.throws(() => box.edit(entry.id), /cannot be undone/);
      await assert.rejects(box.submit(entry.id), /Only pending/);
      release(); await active; clean();
      const uncertain = queue(); deliver = async () => { throw Object.assign(new Error("Synthetic disconnect"), { code: "ECONNRESET" }); };
      await box.submit(uncertain.entry.id); await box.dispatchDue();
      assert.equal(calls, 1); assert.equal(store.get("outbox", uncertain.entry.id)?.state, "unknown");
      assert.throws(() => box.reschedule(uncertain.entry.id, clock + 1000), /pending/);
      assert.equal(box.edit(uncertain.entry.id).sendUnknown, true);
      clean();
    });
  } finally { box.close(); store.closeStore(); rmSync(directory, { recursive: true, force: true }); }
});
