import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Draft, Mail, MailSearchResult } from "../shared/types.js";

// A private disposable profile, never the installed application's accounts.
const directory = mkdtempSync(path.join(tmpdir(), "emc2-search-store-"));
process.env.MAIL_DATA_DIR = directory;
process.env.MAIL_CONFIG_PATH = path.join(directory, "absent.env");
process.env.MAIL_DATA_KEY = Buffer.alloc(32, 73).toString("base64");
const store = await import("./store.js");
const accounts = ["a", "b"].map(id => ({ id, name: `Studio ${id}`, email: `${id}@example.test`, provider: "imap" as const, credentials: {} }));
const draft: Draft = { id: "same", accountId: "b", revision: 1, updatedAt: Date.UTC(2026, 9, 24), to: "client@example.test", cc: ["copy@example.test"], subject: "Saved proposal", body: "x".repeat(500) + " Réunion needle", sendUnknown: true, attachments: [{ filename: "private.txt", contentType: "text/plain", content: "ATTACHMENT-BYTES" }] };
const mail: Mail = { id: "same", accountId: "a", remoteId: "1", sender: "Sender", address: "sender@example.test", to: "a@example.test", subject: "Needle", body: "Needle", preview: "Needle", date: 1, unread: true, archived: false, snoozedUntil: null, category: "other", relevance: 1, reason: "" };

test("global service searches saved drafts, invalidates saves, yields and cancels", async t => {
  try {
    for (const account of accounts) store.put("account", account.id, account);
    store.put("draft", draft.id, draft);
    await t.test("draft-only profile searches the full body and returns a typed summary", async () => {
      const result = await store.searchMail('body:"reunion needle"', accounts);
      assert.equal(result.matches.length, 1);
      assert.equal(result.matches[0].kind, "draft");
      assert.equal(result.matches[0].id, draft.id);
      assert.equal("body" in result.matches[0], false);
      assert.equal("attachments" in result.matches[0], false);
      assert.equal(JSON.stringify(result).includes("ATTACHMENT-BYTES"), false);
    });
    await t.test("draft field/date/account semantics reuse the compiler and reject all read/pin predicates", async () => {
      for (const query of ['from:"studio b" to:copy@example.test subject:proposal body:needle account:b after:2026-10-24 before:2026-10-25', "nedle -body:missing"]) {
        assert.equal((await store.searchMail(query, accounts)).matches.length, 1, query);
      }
      for (const query of ["account:a", "before:2026-10-24", "is:read", "is:unread", "is:pinned", "-is:read", "-is:unread", "-is:pinned", 'body:"nedle"', "body:ก่า"]) {
        assert.equal((await store.searchMail(query, accounts)).matches.length, 0, query);
      }
      assert.ok((await store.searchMail('body:"open', accounts)).error);
    });
    await t.test("same IDs remain distinct and unchanged inputs reuse scans, not draft bodies", async () => {
      store.put("mail", mail.id, mail);
      const first = await store.searchMail("needle", accounts);
      assert.deepEqual(first.matches.map(value => [value.kind, value.accountId, value.id]).sort(), [["draft", "b", "same"], ["mail", "a", "same"]]);
      const parse = JSON.parse;
      let decryptedDrafts = 0;
      JSON.parse = ((text: string, ...args: unknown[]) => { if (text.includes('"body":') && text.includes('"revision":')) decryptedDrafts++; return Reflect.apply(parse, JSON, [text, ...args]); }) as typeof JSON.parse;
      try { assert.equal(await store.searchMail("needle", accounts), first); assert.equal(decryptedDrafts, 0); }
      finally { JSON.parse = parse; }
      const changed = { ...draft, revision: 2, body: "Replacement only" };
      store.put("draft", draft.id, changed);
      const next = await store.searchMail("needle", accounts);
      assert.notEqual(next.draftToken, first.draftToken, "same-count saves invalidate search");
      assert.equal(next.matches.filter(value => value.kind === "draft").length, 0);
      const token = next.draftToken;
      assert.throws(() => store.transaction(() => { store.put("draft", draft.id, draft); throw Error("rollback"); }));
      assert.equal((await store.searchMail("needle", accounts)).draftToken, token, "rolled-back writes publish no token");
      store.remove("account", "b");
      const removed = await store.searchMail("replacement", accounts.filter(value => value.id !== "b"));
      assert.notEqual(removed.draftToken, token);
      assert.equal(removed.matches.length, 0, "orphan drafts never escape account scope");
      store.put("account", "b", accounts[1]);
    });
    await t.test("mail metadata remains in its captured snapshot across updates and deletion", async () => {
      const ids = Array.from({ length: 64 }, (_, i) => `snapshot-${String(i).padStart(3, "0")}`);
      store.transaction(() => { for (const id of ids) store.put("mail", id, { ...mail, id, subject: "Stable snapshot" }); });
      await store.mailSummaryChanges();
      const pending = store.searchMail("subject:stable", accounts);
      await new Promise<void>(resolve => setImmediate(() => {
        store.put("mail", ids[62], { ...mail, id: ids[62], subject: "Changed metadata" });
        store.remove("mail", ids[63]);
        resolve();
      }));
      const captured = await pending;
      assert.deepEqual(captured.matches.filter(value => value.kind === "mail").map(value => value.id), ids,
        "search retains old metadata and versions from the same encrypted snapshot");
      const refreshed = await store.searchMail("subject:stable", accounts);
      assert.equal(refreshed.matches.filter(value => value.kind === "mail").length, 62);
      store.transaction(() => { for (const id of ids) store.remove("mail", id); });
    });
    await t.test("more than 256 draft records yield, hold a snapshot and cancel before decoding the rest", async () => {
      store.transaction(() => { for (let i = 0; i < 300; i++) store.put("draft", `batch-${String(i).padStart(3, "0")}`, { ...draft, id: `batch-${String(i).padStart(3, "0")}` }); });
      const parse = JSON.parse;
      let decoded = 0;
      JSON.parse = ((text: string, ...args: unknown[]) => { if (text.includes('"body":') && text.includes('"revision":')) decoded++; return Reflect.apply(parse, JSON, [text, ...args]); }) as typeof JSON.parse;
      try {
        const controller = new AbortController();
        const pending = store.searchMail("body:needle", accounts, controller.signal);
        setImmediate(() => controller.abort());
        await assert.rejects(pending, { name: "AbortError" });
        assert.ok(decoded < 300, `cancelled after ${decoded} decrypted drafts`);
        decoded = 0;
        const snapshot = store.searchMail("body:needle", accounts);
        setImmediate(() => store.put("draft", "batch-299", { ...draft, id: "batch-299", revision: 2, body: "Changed during scan" }));
        const result: MailSearchResult = await snapshot;
        assert.equal(result.matches.filter(value => value.kind === "draft").length, 300);
        assert.equal(decoded, 301, "decrypt each draft exactly once, including the nonmatching saved draft");
        assert.equal((await store.searchMail("body:needle", accounts)).matches.filter(value => value.kind === "draft").length, 299);
      } finally { JSON.parse = parse; }
    });
  } finally { store.closeStore(); rmSync(directory, { recursive: true, force: true }); }
});
