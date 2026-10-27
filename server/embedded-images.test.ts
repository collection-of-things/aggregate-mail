import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse } from "./providers.js";

const directory = mkdtempSync(path.join(tmpdir(), "emc2-inline-"));
process.env.MAIL_DATA_DIR = directory;
process.env.MAIL_CONFIG_PATH = path.join(directory, "absent.env");
process.env.MAIL_DATA_KEY = Buffer.alloc(32, 86).toString("base64");

test("CID mail retains short HTML and encrypted message-bound image metadata", async () => {
  const { put, get } = await import("./store.js");
  const account = { id: "synthetic", email: "reader@example.com", provider: "gmail" as const, credentials: {} };
  put("account", account.id, account);
  const bytes = Buffer.alloc(220_000, 1);
  const html = '<h2>Expected today</h2><img src="cid:mailpiece" alt="Mailpiece"><p>Delivery details</p>';
  const source = Buffer.from([
    "From: sender@example.com", "To: reader@example.com", "MIME-Version: 1.0",
    "Content-Type: multipart/related; boundary=part", "", "--part",
    "Content-Type: text/html; charset=utf-8", "", html, "--part",
    "Content-Type: image/png", "Content-ID: <mailpiece>", "Content-Disposition: inline; filename=mailpiece.png",
    "Content-Transfer-Encoding: base64", "", bytes.toString("base64"), "--part--", "",
  ].join("\r\n"));
  const mail = await parse(account, "one", source, true);
  assert.equal(mail.html, html);
  assert.equal(mail.attachments?.[0].contentId, "mailpiece");
  assert.equal(mail.attachments?.[0].unavailable, undefined);
  assert.equal(get("attachment", `synthetic:one:${mail.attachments![0].id}`)?.content, bytes.toString("base64"));
  assert.deepEqual(mail.images, [], "embedded images must not become remote image URLs");
});
