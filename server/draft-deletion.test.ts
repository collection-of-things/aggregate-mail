import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

test("draft deletion avoids unrelated cache reads and leaves safe upload cleanup to maintenance", async t => {
  const directory = mkdtempSync(path.join(tmpdir(), "emc2-draft-deletion-"));
  process.env.MAIL_DATA_DIR = directory;
  process.env.MAIL_CONFIG_PATH = path.join(directory, "absent.env");
  const store = await import("./store.js");
  const drafts = await import("./drafts.js");
  const raw = new DatabaseSync(path.join(directory, "mail.sqlite"));
  const content = { to: [], subject: "Synthetic draft", body: "Unfinished" };
  try {
    store.put("account", "a", { id: "a", provider: "imap", email: "synthetic@example.test", credentials: {} });
    await t.test("deletion does not decrypt unrelated cached mail", () => {
      const draft = drafts.createDraft("a", content);
      raw.prepare("INSERT INTO records VALUES(?,?,?)").run("mail", "unrelated", "unreadable-synthetic-ciphertext");
      try {
        assert.doesNotThrow(() => drafts.deleteDraft("a", draft.id, { revision: draft.revision }));
        assert.equal(store.get("draft", draft.id), undefined);
      } finally { raw.prepare("DELETE FROM records WHERE kind='mail' AND id='unrelated'").run(); }
    });
    await t.test("maintenance reclaims discarded uploads and preserves shared references, holds and grace", () => {
      const upload = (filename: string, aged = true) => {
        const id = store.beginUpload("a", filename, "text/plain", 1);
        store.appendUpload(id, 0, Buffer.from("x"));
        store.finishUpload(id, 1);
        if (aged) store.put("upload", id, { ...store.get("upload", id)!, createdAt: Date.now() - 7200000 });
        return { id, filename, contentType: "text/plain", size: 1 };
      };
      const orphan = upload("discarded.txt"), shared = upload("shared.txt"), held = upload("held.txt"), fresh = upload("fresh.txt", false);
      const deleted = drafts.createDraft("a", { ...content, attachments: [orphan, shared, held, fresh] });
      const retained = drafts.createDraft("a", { ...content, attachments: [shared] });
      const hold = store.holdAttachments("a", [held]);
      drafts.deleteDraft("a", deleted.id, { revision: deleted.revision });
      assert.equal(store.get("draft", deleted.id), undefined);
      assert.ok(store.get("upload", orphan.id), "deletion commits without running upload inventory");
      store.compactStore({ cleanupOrphans: true, vacuum: false, isDrained: () => true });
      assert.equal(store.get("upload", orphan.id), undefined);
      assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM attachment_chunks WHERE id=?").get(orphan.id)!.n, 0);
      for (const file of [shared, held, fresh]) assert.ok(store.get("upload", file.id));
      drafts.deleteDraft("a", retained.id, { revision: retained.revision });
      store.releaseAttachmentHold(hold);
      store.compactStore({ cleanupOrphans: true, vacuum: false, isDrained: () => true });
      assert.equal(store.get("upload", shared.id), undefined);
      assert.equal(store.get("upload", held.id), undefined);
      assert.ok(store.get("upload", fresh.id));
    });
  } finally { raw.close(); store.closeStore(); rmSync(directory, { recursive: true, force: true }); }
});
