import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { google } from "./google-api.js";
import { composeMarkup } from "../shared/compose-content.js";

test("both provider paths send text first and safe HTML; SMTP Sent uses identical bytes", async t => {
  const directory = mkdtempSync(path.join(tmpdir(), "emc2-rich-send-"));
  process.env.MAIL_DATA_DIR = directory; process.env.MAIL_DATA_KEY = Buffer.alloc(32, 9).toString("base64");
  const { put, closeStore } = await import("./store.js");
  const { sendMail } = await import("./mail-actions.js");
  const { sendSchema } = await import("./providers.js");
  const input = { accountId: "synthetic", to: "recipient@example.test", subject: "Formatted test", ...composeMarkup('<strong>Hello</strong><br><a href="https://example.com/">Plan</a>') };
  let sent: Buffer | undefined, appended: Buffer | undefined, appends = 0, failCopy = false;
  t.mock.method(nodemailer, "createTransport", () => ({ sendMail: async (message: { raw: Buffer }) => { sent = message.raw; return { accepted: [input.to] }; } }));
  t.mock.method(ImapFlow.prototype, "connect", async function(this: ImapFlow) { this.usable = true; });
  t.mock.method(ImapFlow.prototype, "list", async () => [{ path: "Sent", specialUse: "\\Sent" }] as never);
  t.mock.method(ImapFlow.prototype, "append", async (_folder: string, raw: Buffer) => { appends++; appended = raw; if (failCopy) throw new Error("Synthetic copy failure"); return { uid: 1 }; });
  t.mock.method(ImapFlow.prototype, "logout", async () => true);
  t.mock.method(google, "gmail", () => ({ users: { messages: { send: async (value: { requestBody: { raw: string } }) => { sent = Buffer.from(value.requestBody.raw, "base64url"); return { data: {} }; } } } }) as never);
  try {
    for (const provider of ["imap", "gmail", "gmail-imap"] as const) {
      put("account", "synthetic", { id: "synthetic", email: "sender@example.test", provider, credentials: { imapHost: "imap.example.test", smtpHost: "smtp.example.test" } });
      const before = appends;
      const result = await sendMail(input);
      assert.equal(result.ok, true); assert.ok(sent);
      const source = sent.toString();
      assert.match(source, /multipart\/alternative/);
      assert.ok(source.indexOf('Content-Type: text/plain') < source.indexOf('Content-Type: text/html'));
      const parsed = await simpleParser(sent);
      assert.equal(parsed.text?.trim(), input.body);
      assert.equal(String(parsed.html).trim(), input.html);
      assert.equal(appends - before, provider === "imap" ? 1 : 0);
      if (provider === "imap") assert.deepEqual(appended, sent);
    }
    put("account", "synthetic", { id: "synthetic", email: "sender@example.test", provider: "imap", credentials: { imapHost: "imap.example.test", smtpHost: "smtp.example.test" } });
    failCopy = true;
    assert.match((await sendMail(input)).warning!, /Do not resend/);
    failCopy = false;
    const { html: _html, ...plain } = input;
    await sendMail(plain);
    assert.doesNotMatch(sent!.toString(), /text\/html|multipart\/alternative/);
    assert.equal(sendSchema.safeParse({ ...input, body: "Mismatch" }).success, false);
    assert.equal(sendSchema.safeParse({ ...input, html: '<img src="https://example.com/">' }).success, false);
  } finally { closeStore(); rmSync(directory, { recursive: true, force: true }); }
});
