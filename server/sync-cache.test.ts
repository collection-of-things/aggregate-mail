import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Mail } from "../shared/types.js";

test("sync caches only account summaries and reads current bodies on demand", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "emc2-sync-cache-"));
  process.env.MAIL_DATA_DIR = directory;
  const store = await import("./store.js");
  const mail: Mail = { id: "a:1", accountId: "a", remoteId: "1", sender: "Synthetic", address: "sender@example.test", to: "reader@example.test", subject: "Cached", preview: "Summary", body: "Body loaded only on demand", date: 1, unread: false, archived: false, snoozedUntil: null, category: "important", relevance: 2, reason: "", html: null };
  try {
    store.putBatch("mail", [[mail.id, mail], ["b:1", { ...mail, id: "b:1", accountId: "b" }], ["a:sent", { ...mail, id: "a:sent", direction: "sent" }]]);
    const cache = await store.syncMailCache("a");
    assert.equal(cache.size, 1);
    assert.equal(cache.has("b:1"), false);
    assert.equal(cache.get("b:1"), undefined);
    assert.equal("body" in cache.summaries.get(mail.id)!, false);
    assert.equal(cache.get(mail.id)?.body, mail.body);
    store.put("mail", mail.id, { ...mail, pinned: true, body: "Updated body" });
    assert.equal(cache.get(mail.id)?.pinned, true, "sync preserves concurrent local metadata");
    assert.equal(cache.get(mail.id)?.body, "Updated body");
    store.put("mail", mail.id, { ...mail, remoteId: "replacement" });
    assert.equal(cache.get(mail.id), undefined, "a replacement identity is not the cached message");
  } finally { store.closeStore(); rmSync(directory, { recursive: true, force: true }); }
});
