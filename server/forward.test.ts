import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Mail } from "../shared/types.js";

test("forward uses cached plain text, local bounded attachments and explicit omissions without threading", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "emc2-forward-"));
  process.env.MAIL_DATA_DIR = directory;
  process.env.MAIL_DATA_KEY = Buffer.alloc(32, 12).toString("base64");
  const store = await import("./store.js");
  const { forwardContent } = await import("./forward.js");
  const { createDraft, readDraft } = await import("./drafts.js");
  const mail = { id: "source", accountId: "synthetic", sender: "Sender", address: "sender@example.test", to: "reader@example.test", date: 0,
    subject: "Synthetic", body: "Cached text <script>text only</script>", html: '<img src="https://example.test/private">', preview: "Preview",
    messageId: "<original@example.test>", threadId: "original-thread", references: ["<ancestor@example.test>"],
    attachments: [{ id: "local", filename: "local.txt", contentType: "text/plain", size: 5 },
      { id: "missing", filename: "missing.txt", contentType: "text/plain", size: 5 },
      { id: "large", filename: "large.txt", contentType: "text/plain", size: 600000, unavailable: true }],
  } as Mail;
  try {
    store.put("account", "synthetic", { id: "synthetic", email: "reader@example.test", provider: "imap", credentials: {} });
    store.put("attachment", "source:local", { accountId: "synthetic", content: Buffer.from("hello").toString("base64") });
    const result = forwardContent(mail);
    assert.deepEqual(result.to, []);
    assert.equal(result.subject, "Fwd: Synthetic");
    assert.match(result.body, /From: Sender <sender@example.test>\nDate: 1970-01-01T00:00:00.000Z\nSubject: Synthetic\nTo: reader@example.test/);
    assert.match(result.body, /Cached text <script>text only<\/script>/);
    assert.match(result.body, /Attachments not included:\n- missing.txt\n- large.txt/);
    assert.doesNotMatch(result.body, /https:\/\/example.test\/private/);
    for (const key of ["html", "inReplyTo", "threadId", "references"]) assert.equal(key in result, false);
    assert.deepEqual(result.attachments?.map(file => file.filename), ["local.txt"]);
    const draft = createDraft("synthetic", { ...result, to: ["one@example.test", "two@example.test"], cc: ["copy@example.test"], bcc: ["hidden@example.test"] });
    assert.deepEqual(readDraft("synthetic", draft.id), draft);
    const restart = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `import { readDraft } from './server/drafts.ts'; import { closeStore } from './server/store.ts'; console.log(JSON.stringify(readDraft('synthetic', '${draft.id}'))); closeStore();`], { encoding: "utf8", timeout: 15000 });
    assert.equal(restart.status, 0, restart.stderr);
    assert.deepEqual(JSON.parse(restart.stdout), draft);
    assert.deepEqual(forwardContent({ ...mail, subject: "Fwd: Already", body: "", attachments: [] }).body.endsWith("Preview"), true);
    assert.equal(forwardContent({ ...mail, subject: "Fwd: Already" }).subject, "Fwd: Already");
  } finally { store.closeStore(); rmSync(directory, { recursive: true, force: true }); }
});
