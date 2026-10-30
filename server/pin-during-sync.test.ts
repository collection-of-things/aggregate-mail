import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Mail } from "../shared/types.js";

test("pin and unpin finish while a long sync holds the mail queue, and still respect update drains", async t => {
  const directory = mkdtempSync(path.join(tmpdir(), "emc2-pin-sync-"));
  process.env.MAIL_DATA_DIR = directory;
  process.env.MAIL_DATA_KEY = Buffer.alloc(32, 7).toString("base64");
  const { put, get, closeStore } = await import("./store.js");
  const { updateMessage, runMailWork, quiesceMailWork, resumeMailWork, mailWorkActivity } = await import("./mail-actions.js");
  t.after(() => { resumeMailWork(); closeStore(); rmSync(directory, { recursive: true, force: true }); });
  put("account", "a", { id: "a", email: "reader@example.test", provider: "imap", credentials: {} });
  const mail: Mail = { id: "one", accountId: "a", remoteId: "one", sender: "Synthetic", address: "sender@example.test",
    to: "reader@example.test", subject: "Synthetic", body: "", preview: "", date: 1, unread: true, archived: false,
    category: "important", relevance: 2, reason: "", snoozedUntil: null };
  put("mail", mail.id, mail);
  // Stand in for a long sync: it holds the serialized mail queue until released.
  let release = () => {};
  const sync = runMailWork(() => new Promise<void>(resolve => { release = resolve; }));
  await Promise.resolve();
  const within = <T,>(work: Promise<T>) => Promise.race([work, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Pin waited for the sync to finish.")), 500))]);
  try {
    assert.equal((await within(updateMessage("one", { action: "pin" }))).pinned, true);
    assert.equal(get("mail", "one")?.pinned, true);
    assert.equal((await within(updateMessage("one", { action: "unpin" }))).pinned, undefined);
    assert.equal(get("mail", "one")?.pinned, undefined);
    // Provider actions still wait for the sync so stale metadata cannot undo them.
    let read = false;
    const queued = updateMessage("one", { action: "read" }).then(() => { read = true; }, () => { read = true; });
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(read, false);
    release(); await sync; await queued;
  } finally { release(); await sync; }
  assert.equal(mailWorkActivity().active, 0);
  await quiesceMailWork(1000);
  await assert.rejects(updateMessage("one", { action: "pin" }), /paused for an application update/);
  assert.equal(get("mail", "one")?.pinned, undefined);
  resumeMailWork();
});
