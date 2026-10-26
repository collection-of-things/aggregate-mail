import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import MailComposer from "nodemailer/lib/mail-composer/index.js";

test("oversized parts do not consume the byte or file budget for later valid imports", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "emc2-attachment-import-"));
  process.env.MAIL_DATA_DIR = directory;
  process.env.MAIL_DATA_KEY = Buffer.alloc(32, 31).toString("base64");
  const store = await import("./store.js");
  const { parse } = await import("./providers.js");
  const account = { id: "synthetic", email: "reader@example.test", provider: "imap" as const, credentials: {} };
  store.put("account", account.id, account);
  const part = (filename: string, size: number) => ({ filename, contentType: "application/octet-stream", content: Buffer.alloc(size, 42) });
  try {
    for (const [scenario, parts, available] of [
      ["mixed", [part("large.bin", 600000), part("one.bin", 524288), part("two.bin", 524288)], ["one.bin", "two.bin"]],
      ["middle", [part("one.bin", 524288), part("large.bin", 600000), part("two.bin", 524288)], ["one.bin", "two.bin"]],
      ["many", [part("large.bin", 600000), ...Array.from({ length: 11 }, (_, index) => part(`${index}.bin`, 1))], Array.from({ length: 10 }, (_, index) => `${index}.bin`)],
    ] as const) {
      const source = await new MailComposer({ from: "sender@example.test", to: account.email, text: "Synthetic body", attachments: [...parts] }).compile().build();
      const mail = await parse(account, scenario, source, false);
      assert.equal(mail.body.trim(), "Synthetic body", "a skipped attachment does not become a message parse failure");
      assert.deepEqual(mail.attachments?.filter(file => !file.unavailable).map(file => file.filename), available, scenario);
      for (const file of mail.attachments || []) {
        const cached = store.get("attachment", `${mail.id}:${file.id}`);
        assert.equal(Boolean(cached), !file.unavailable);
        if (cached) assert.equal(Buffer.from(cached.content, "base64").length, file.size);
      }
    }
  } finally { store.closeStore(); rmSync(directory, { recursive: true, force: true }); }
});
