import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

test("real outbox transitions retain uploaded bytes and distinguish preflight rejection from uncertainty", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "emc2-attachment-outbox-"));
  process.env.MAIL_DATA_DIR = directory;
  process.env.MAIL_CONFIG_PATH = path.join(directory, "absent.env");
  const store = await import("./store.js");
  const { storeAttachmentBytes, AttachmentPreflightError } = await import("./attachment-bytes.js");
  const { createDraft } = await import("./drafts.js");
  const { Outbox } = await import("./outbox.js");
  try {
    store.put("account", "a", { id: "a", provider: "imap", email: "synthetic@example.test", credentials: {} });
    const bytes = Buffer.from("synthetic outbox attachment");
    const file = await storeAttachmentBytes("a", "synthetic.txt", "text/plain", (async function* () { yield bytes; })(), new AbortController().signal);
    let failure: Error | undefined;
    let calls = 0;
    const box = new Outbox(() => {}, Date.now, async () => { calls++; if (failure) throw failure; return { ok: true }; });
    const content = { to: ["recipient@example.test"], subject: "Synthetic", body: "Local body", attachments: [file] };
    const queue = () => {
      const draft = createDraft("a", content);
      return box.enqueue({ sourceDraftId: draft.id, sourceRevision: draft.revision, payload: { ...content, accountId: "a" } });
    };
    const pending = queue();
    box.recover();
    await box.dispatchDue();
    assert.equal(calls, 0, "recovered pending mail needs explicit review");
    store.cleanupUploads(Date.now() + 7200000);
    assert.ok(store.get("upload", file.id));
    const recovered = box.edit(pending.id);
    assert.deepEqual(recovered.attachments, [file]);
    store.cleanupUploads(Date.now() + 7200000);
    assert.ok(store.get("upload", file.id), "Undo preserves the source draft reference");
    failure = new AttachmentPreflightError("Synthetic SIZE rejection");
    const rejected = queue(); await box.submit(rejected.id);
    assert.equal(store.get("outbox", rejected.id)!.state, "failed");
    failure = new Error("Synthetic lost acceptance");
    const uncertain = queue(); await box.submit(uncertain.id);
    assert.equal(store.get("outbox", uncertain.id)!.state, "unknown");
    box.recover(); await box.dispatchDue();
    assert.equal(calls, 2, "unknown and failed sends do not retry on recovery");
    store.cleanupUploads(Date.now() + 7200000);
    assert.ok(store.get("upload", file.id));
    const read: Buffer[] = []; for await (const chunk of store.uploadBytes(file.id)) read.push(chunk);
    assert.deepEqual(Buffer.concat(read), bytes);
    store.holdAttachments("a", [file]);
    store.put("account", "b", { id: "b", provider: "imap", email: "other@example.test", credentials: {} });
    const other = await storeAttachmentBytes("b", "other.txt", "text/plain", (async function* () { yield bytes; })(), new AbortController().signal);
    store.removeAccountAttachments("a");
    assert.equal(store.get("upload", file.id), undefined, "explicit account removal purges its referenced uploads");
    assert.ok(store.get("upload", other.id), "other accounts keep their bytes");
    assert.equal(store.all("attachmentHold").filter(value => value.accountId === "a").length, 0);
  } finally { store.closeStore(); rmSync(directory, { recursive: true, force: true }); }
});
