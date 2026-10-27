import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Mail } from "../shared/types.js";

test("summary copies isolate nested metadata and healthy compaction preserves every record", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "emc2-startup-storage-"));
  process.env.MAIL_DATA_DIR = directory;
  process.env.MAIL_DATA_KEY = "";
  const store = await import("./store.js");
  const raw = new DatabaseSync(path.join(directory, "mail.sqlite"));
  const mail: Mail = { id: "a:1", accountId: "a", remoteId: "1", sender: "Sender", address: "sender@example.test", to: "reader@example.test", subject: "Subject", preview: "Preview", body: "Body search marker", date: 1, unread: true, archived: false, category: "other", relevance: 1, reason: "", snoozedUntil: null,
    labelIds: ["inbox"], references: ["reference"], mailbox: { path: "INBOX", uidValidity: "1", uid: 1 }, attachments: [{ id: "file", filename: "file.txt", contentType: "text/plain", size: 9 }] };
  try {
    store.put("account", "a", { id: "a", provider: "imap", email: "reader@example.test", credentials: {} });
    store.put("mail", mail.id, mail);
    store.put("mail", "b:1", { ...mail, id: "b:1", accountId: "b", archived: true, direction: "sent" });
    store.put("attachment", "a:1:file", { accountId: "a", content: "c3ludGhldGlj" });
    store.put("draft", "draft", { id: "draft", accountId: "a", revision: 4, updatedAt: 1, to: ["recipient@example.test"], subject: "Draft", body: "Draft body", sendUnknown: true, attachments: [{ filename: "draft.txt", contentType: "text/plain", content: "c3ludGhldGlj" }] });
    const first = await store.mailSummaryChanges();
    const expected = structuredClone(first);
    first.messages[0].labelIds!.push("changed"); first.messages[0].references!.push("changed");
    first.messages[0].mailbox!.path = "changed"; first.messages[0].attachments![0].filename = "changed";
    assert.deepEqual(await store.mailSummaryChanges(), expected);
    assert.equal((await store.mailSummaryChanges(expected.mailCursor)).messages.length, 0);
    const pending = store.mailSummaryChanges();
    store.put("mail", mail.id, { ...mail, subject: "Changed" });
    const captured = await pending;
    const delta = await store.mailSummaryChanges(expected.mailCursor);
    assert.equal(delta.mailMode, "delta"); assert.equal(delta.messages.length, 1);
    assert.equal(delta.messages[0].accountId, "a");
    assert.ok(captured.messages.every(m => m.subject === "Subject" || m.subject === "Changed"));
    const search = await store.searchMail("body:marker", store.all("account"));
    assert.deepEqual(search.matches.map(m => m.id), ["a:1"]);
    store.remove("mail", "b:1");
    assert.deepEqual((await store.mailSummaryChanges(delta.mailCursor)).removedMailIds, ["b:1"]);
    store.compactStore({ cleanupOrphans: true, vacuum: true, isDrained: () => true });
    assert.equal(store.storageStats().freePages, 0);
    const before = raw.prepare("SELECT * FROM records ORDER BY kind,id").all();
    const key = readFileSync(path.join(directory, "key"));
    const result = store.compactStore({ cleanupOrphans: true, isDrained: () => true });
    assert.equal(result.vacuumed, false, "no free pages means no whole-database rewrite");
    assert.equal(result.removedAttachments, 0);
    assert.deepEqual(raw.prepare("SELECT * FROM records ORDER BY kind,id").all(), before);
    assert.deepEqual(readFileSync(path.join(directory, "key")), key);
    assert.equal(store.get("draft", "draft")?.sendUnknown, true);
    assert.equal(store.get("draft", "draft")?.revision, 4);
    assert.equal(raw.prepare("PRAGMA integrity_check").get()!.integrity_check, "ok");
  } finally { raw.close(); store.closeStore(); rmSync(directory, { recursive: true, force: true }); }
});
