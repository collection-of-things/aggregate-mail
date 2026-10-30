import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Account, Mail } from "../shared/types.js";

test("bounded sequential batches preserve per-item success, failure and uncertainty without retry", async t => {
  const directory = mkdtempSync(path.join(tmpdir(), "emc2-bulk-"));
  process.env.MAIL_DATA_DIR = directory;
  process.env.MAIL_DATA_KEY = Buffer.alloc(32, 9).toString("base64");
  const { put, get, remove, closeStore } = await import("./store.js");
  const { providers } = await import("./providers.js");
  const { updateMessages, mailBatchSchema, quiesceMailWork, resumeMailWork, mailWorkActivity, runMailWork } = await import("./mail-actions.js");
  t.after(() => { resumeMailWork(); closeStore(); rmSync(directory, { recursive: true, force: true }); });
  for (const id of ["a", "b"]) put("account", id, { id, email: `${id}@example.test`, provider: "imap", credentials: {} });
  const mail = (id: string, accountId = "a"): Mail => ({ id, accountId, remoteId: id,
    sender: "Synthetic", address: "sender@example.test", to: "reader@example.test", subject: id,
    body: "", preview: "", date: 1, unread: true, archived: false,
    category: "important", relevance: 2, reason: "", snoozedUntil: null });
  for (const item of [mail("one"), mail("uncertain", "b"), mail("last", "b")]) put("mail", item.id, item);
  let active = 0, peak = 0;
  const calls: string[] = [];
  t.mock.method(providers.imap, "update", async (account: Account, item: Mail, action: string) => {
    active++; peak = Math.max(peak, active); calls.push(`${account.id}:${item.id}:${action}`);
    await Promise.resolve(); active--;
    if (item.id === "uncertain") throw new Error("Synthetic lost response after mutation");
  });
  const result = await updateMessages({ items: [
    { id: "one", accountId: "a" }, { id: "missing", accountId: "a" },
    { id: "uncertain", accountId: "b" }, { id: "last", accountId: "b" },
  ], operation: { action: "archive" } });
  assert.deepEqual(result.results.map(item => item.status), ["done", "failed", "unknown", "done"]);
  assert.equal(get("mail", "one")?.archived, true);
  assert.equal(get("mail", "last")?.archived, true);
  assert.equal(get("mail", "uncertain")?.archived, false);
  assert.equal(peak, 1);
  assert.deepEqual(calls, ["a:one:archive", "b:uncertain:archive", "b:last:archive"]);
  assert.deepEqual((await updateMessages({ items: [{ id: "one", accountId: "b" }], operation: { action: "trash" } })).results[0].status, "failed");
  assert.equal(calls.length, 3, "changed account is rejected before provider access");
  assert.throws(() => mailBatchSchema.parse({ items: Array.from({ length: 201 }, (_, id) => ({ id: String(id), accountId: "a" })), operation: { action: "pin" } }));
  assert.throws(() => mailBatchSchema.parse({ items: [{ id: "one", accountId: "a" }, { id: "one", accountId: "a" }], operation: { action: "trash" } }));
  assert.throws(() => mailBatchSchema.parse({ items: [{ id: "one", accountId: "a" }], operation: { action: "labels", labelIds: [] } }));
  assert.equal((await updateMessages({ items: [{ id: "one", accountId: "a" }], operation: { action: "snooze", until: Date.now() + 60_000 } })).results[0].status, "failed", "archived mail keeps the single-message UI snooze boundary");
  for (const action of ["pin", "unpin", "inbox", "snooze", "read", "unread", "trash"] as const) {
    const result = await updateMessages({ items: [{ id: "one", accountId: "a" }], operation: { action, ...(action === "snooze" ? { until: Date.now() + 60_000 } : {}) } });
    assert.equal(result.results[0].status, "done", action);
  }
  assert.equal(get("mail", "one"), undefined, "trash removes only confirmed mail");
  const rejected = await updateMessages({ items: [{ id: "last", accountId: "b" }], operation: { action: "unpin" } }, () => { throw new Error("Wait for sync"); });
  assert.equal(rejected.results[0].status, "failed");
  assert.equal(mailWorkActivity().active, 0);
  // Queue a mutation, replace its account while queued, then release serialization.
  let release = () => {};
  const gate = runMailWork(() => new Promise<void>(resolve => { release = resolve; }));
  await Promise.resolve();
  const queued = updateMessages({ items: [{ id: "last", accountId: "b" }], operation: { action: "read" } });
  put("mail", "last", mail("last", "a")); release(); await gate;
  assert.equal((await queued).results[0].status, "failed");
  // Start with no accounts so the HTTP checks cannot open provider watchers.
  process.env.MAIL_CONFIG_PATH = path.join(directory, "synthetic-settings.env");
  process.env.MAIL_DESKTOP_TOKEN = "synthetic-bulk-session";
  remove("account", "a"); remove("account", "b");
  const { startServer } = await import("./index.js");
  const server = await startServer(0);
  try {
    const address = server.address(); assert.ok(address && typeof address === "object");
    const origin = `http://127.0.0.1:${address.port}`;
    const desktop = { "Content-Type": "application/json", "X-Desktop-Token": "synthetic-bulk-session" };
    const state = await (await fetch(`${origin}/api/state`, { headers: desktop })).json() as { csrf: string };
    const batch = JSON.stringify({ items: [{ id: "last", accountId: "a" }], operation: { action: "pin" } });
    const request = (headers: Record<string, string>, body = batch) => fetch(`${origin}/api/messages/batch`, { method: "POST", headers, body });
    assert.equal((await request({ "Content-Type": "application/json" })).status, 403);
    assert.equal((await request(desktop)).status, 403);
    const authorized = { ...desktop, "X-CSRF-Token": state.csrf };
    assert.equal((await request({ ...authorized, Origin: "https://untrusted.example.test" })).status, 403);
    const response = await request(authorized); assert.equal(response.status, 200);
    assert.equal((await response.json() as { results: { status: string }[] }).results[0].status, "done");
    assert.equal((await request(authorized, JSON.stringify({ items: [], operation: { action: "pin" } }))).status, 400);
    await quiesceMailWork(1000);
    assert.equal((await request(authorized)).status, 503);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  await quiesceMailWork(1000);
  await assert.rejects(updateMessages({ items: [{ id: "last", accountId: "a" }], operation: { action: "pin" } }), /paused/);
});
