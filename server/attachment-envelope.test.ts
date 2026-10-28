import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { createServer } from "node:net";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import type { Mail, DraftAttachment } from "../shared/types.js";
import { ATTACHMENT_BYTES } from "../shared/attachments.js";
import { quietImapWatch } from "./imap-watch-fixture.js";

test("practical encrypted attachment envelope", { timeout: 110000 }, async t => {
  const directory = mkdtempSync(path.join(tmpdir(), "emc2-envelope-"));
  process.env.MAIL_DATA_DIR = directory;
  process.env.MAIL_CONFIG_PATH = path.join(directory, "absent.env");
  process.env.MAIL_DATA_KEY = Buffer.alloc(32, 92).toString("base64");
  process.env.MAIL_DESKTOP_TOKEN = "synthetic-attachment-session";
  const store = await import("./store.js");
  const bytes = await import("./attachment-bytes.js");
  const providers = await import("./providers.js");
  const drafts = await import("./drafts.js");
  const actions = await import("./mail-actions.js");
  const download = await import("./attachment-download.js");
  const { google } = await import("./google-api.js");
  const a = { id: "synthetic", email: "sender@example.test", provider: "imap" as const, credentials: { imapHost: "imap.example.test", smtpHost: "smtp.example.test" } };
  store.put("account", a.id, a);
  store.put("account", "other", { ...a, id: "other" });
  const content = { to: ["recipient@example.test"], subject: "Synthetic", body: "Synthetic attachment envelope" };
  const upload = async (size: number, filename = "synthetic.bin") => bytes.storeAttachmentBytes(a.id, filename, "application/octet-stream", (async function* () {
    for (let left = size; left; left -= Math.min(left, 65536)) yield Buffer.alloc(Math.min(left, 65536), 42);
  })(), new AbortController().signal);
  const mail = (file: Mail["attachments"] extends (infer F)[] | undefined ? F : never, provider = "imap"): Mail => ({
    id: `${a.id}:123:7`, accountId: a.id, remoteId: provider === "gmail" ? "remote" : "123:7", sender: "Synthetic", address: "sender@example.test", to: a.email,
    subject: "Synthetic attachment", body: "Synthetic text", preview: "Synthetic text", date: 1700000000000, unread: true,
    category: "important", relevance: 1, reason: "Synthetic", archived: false, snoozedUntil: null, messageId: "<synthetic@example.test>", attachments: [file],
  });
  try {
    const files: DraftAttachment[] = [];
    await t.test("20 files near 25 MiB, mixed sizes, and oversize validation", async t => {
      const size = Math.floor(ATTACHMENT_BYTES / 20);
      for (let i = 0; i < 20; i++) files.push(await upload(size, `synthetic-${i}.bin`));
      assert.ok(providers.sendSchema.safeParse({ accountId: a.id, ...content, attachments: files }).success);
      assert.equal(providers.attachmentsSchema.safeParse([...files, files[0]]).success, false);
      assert.equal(providers.attachmentsSchema.safeParse([{ ...files[0], size: ATTACHMENT_BYTES + 1 }, files[1]]).success, false);
      assert.equal(providers.attachmentsSchema.safeParse([{ ...files[0], size: ATTACHMENT_BYTES }, files[1]]).success, false);
      assert.equal(providers.attachmentsSchema.safeParse([files[0], { filename: "small.txt", contentType: "text/plain", content: "eA==" }]).success, true);
      assert.equal(JSON.stringify({ ...content, attachments: files }).length < 10000, true, "snapshots contain IDs, not file data");
      const gmailAccount = { ...a, provider: "gmail" as const };
      store.put("account", a.id, gmailAccount);
      let transmitted = 0, requests = 0;
      t.mock.method(google.auth.OAuth2.prototype, "request", async (options: { data?: unknown; retry?: boolean }) => {
        assert.equal(options.retry, false); requests++;
        for await (const chunk of options.data as Readable) { transmitted += Buffer.byteLength(chunk); assert.ok(Buffer.byteLength(chunk) < 200000); }
        return { data: { id: "synthetic-accepted" } };
      });
      try { await providers.providers.gmail.send(gmailAccount, { accountId: a.id, ...content, attachments: files }); }
      finally { store.put("account", a.id, a); }
      assert.equal(requests, 1); assert.ok(transmitted > 35 * 1024 * 1024);

    });
    await t.test("encrypted draft round-trip, cross-account refusal and opaque outbox retention", async () => {
      const draft = drafts.createDraft(a.id, { ...content, attachments: files });
      assert.deepEqual(drafts.readDraft(a.id, draft.id).attachments, files);
      assert.throws(() => drafts.createDraft("other", { ...content, attachments: files }), /another account/);
      const held = await upload(77, "held.bin");
      const hold = store.holdAttachments(a.id, [held]);
      const pending = await upload(88, "outbox.bin");
      const orphan = await upload(99, "orphan.bin");
      const db = new DatabaseSync(path.join(directory, "mail.sqlite"));
      db.prepare("INSERT INTO records VALUES(?,?,?)").run("opaque-outbox-test", "entry", store.encrypt({ state: "unknown", payload: { attachments: [pending] } }));
      store.cleanupUploads(Date.now() + 3600001);
      assert.ok(store.get("upload", pending.id)); assert.ok(store.get("upload", held.id));
      assert.ok(store.get("upload", files[0].id!)); assert.equal(store.get("upload", orphan.id), undefined);
      drafts.deleteDraft(a.id, draft.id, { revision: draft.revision });
      store.cleanupUploads(Date.now() + 3600001);
      assert.equal(store.get("upload", files[0].id!), undefined);
      assert.ok(store.get("upload", held.id));
      store.releaseAttachmentHold(hold);
      db.prepare("DELETE FROM records WHERE kind=?").run("opaque-outbox-test"); db.close();
      store.cleanupUploads(Date.now() + 3600001);
      assert.equal(store.get("upload", held.id), undefined); assert.equal(store.get("upload", pending.id), undefined);
      const streaming = await upload(90000, "concurrent.bin");
      const readerOne = store.uploadBytes(streaming.id), readerTwo = store.uploadBytes(streaming.id);
      await readerOne.next(); await readerTwo.next(); await readerOne.return(undefined);
      store.cleanupUploads(Date.now() + 3600001);
      assert.ok(store.get("upload", streaming.id), "a second active reader still owns the bytes");
      await readerTwo.return(undefined); store.cleanupUploads(Date.now() + 3600001);
      assert.equal(store.get("upload", streaming.id), undefined);

      const marker = "PRIVATE-SYNTHETIC-ATTACHMENT-BYTES";
      await bytes.storeAttachmentBytes(a.id, "secret-name-SYNTHETIC.txt", "text/plain", Readable.from([Buffer.from(marker)]), new AbortController().signal);
      for (const suffix of ["", "-wal"]) {
        const file = path.join(directory, `mail.sqlite${suffix}`);
        if (existsSync(file)) { const data = readFileSync(file); assert.equal(data.includes(Buffer.from(marker)), false); assert.equal(data.includes(Buffer.from("secret-name-SYNTHETIC.txt")), false); }
      }
    });
    await t.test("interrupted, cancelled and oversized streams remove partial encrypted chunks", async () => {
      const before = store.all("upload").length;
      await assert.rejects(bytes.storeAttachmentBytes(a.id, "broken.bin", "application/octet-stream", (async function* () { yield Buffer.alloc(65536); throw Error("interrupted"); })(), new AbortController().signal), /interrupted/);
      const controller = new AbortController();
      await assert.rejects(bytes.storeAttachmentBytes(a.id, "cancel.bin", "application/octet-stream", (async function* () { yield Buffer.alloc(65536); controller.abort(); yield Buffer.alloc(10); })(), controller.signal));
      await assert.rejects(bytes.storeAttachmentBytes(a.id, "oversize.bin", "application/octet-stream", Readable.from([Buffer.alloc(100)]), new AbortController().signal, 99), /byte limit/);
      assert.equal(store.all("upload").length, before);
      const db = new DatabaseSync(path.join(directory, "mail.sqlite"));
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM attachment_chunks c LEFT JOIN records r ON r.kind='upload' AND r.id=c.id WHERE r.id IS NULL").get()!.n, 0); db.close();
    });
    await t.test("SMTP SIZE is rejected on submission connection before MAIL or DATA", async t => {
      const commands: string[] = [];
      const smtp = createServer(socket => {
        socket.write("220 synthetic ESMTP\r\n");
        let pending = "";
        socket.on("data", chunk => {
          pending += chunk.toString();
          while (pending.includes("\r\n")) {
            const index = pending.indexOf("\r\n"), command = pending.slice(0, index); pending = pending.slice(index + 2); commands.push(command);
            if (/^EHLO/i.test(command)) socket.write("250-synthetic\r\n250 SIZE 10\r\n");
            else if (/^QUIT/i.test(command)) socket.end("221 bye\r\n");
            else socket.write("550 unexpected\r\n");
          }
        });
      });
      smtp.listen(0, "127.0.0.1"); await once(smtp, "listening");
      const port = (smtp.address() as { port: number }).port;
      const original = nodemailer.createTransport.bind(nodemailer);
      t.mock.method(nodemailer, "createTransport", () => original({ host: "127.0.0.1", port, secure: false, ignoreTLS: true, connectionTimeout: 2000, socketTimeout: 2000, logger: false }));
      const file = await upload(1000);
      try {
        await assert.rejects(actions.sendMail({ accountId: a.id, ...content, attachments: [file] }), /size larger than allowed/i);
        assert.ok(commands.some(c => /^EHLO/.test(c)));
        assert.equal(commands.some(c => /^(MAIL|DATA)/i.test(c)), false);
        assert.ok(store.get("upload", file.id));
        assert.equal(store.all("attachmentHold").length, 0, "preflight does not create an unknown send");
      } finally { await new Promise<void>(resolve => smtp.close(() => resolve())); }
    });
    await t.test("legacy inline draft still sends; referenced SMTP send streams and preserves accepted outcome", async t => {
      let sends = 0;
      t.mock.method(nodemailer, "createTransport", () => ({
        close() {}, async sendMail(value: { raw: Buffer | Readable; envelope: { size?: number } }) {
          sends++; let count = 0;
          if (Buffer.isBuffer(value.raw)) count = value.raw.length;
          else for await (const chunk of value.raw) count += chunk.length;
          if (value.envelope.size) assert.equal(count, value.envelope.size);
          return { accepted: [content.to[0]] };
        },
      }));
      t.mock.method(ImapFlow.prototype, "connect", async () => { throw Error("Synthetic copy failure"); });
      const legacy = { ...content, attachments: [{ filename: "legacy.txt", contentType: "text/plain", content: "eA==" }] };
      const draft = drafts.createDraft(a.id, legacy);
      assert.deepEqual(drafts.readDraft(a.id, draft.id).attachments, legacy.attachments);
      assert.equal((await actions.sendMail({ accountId: a.id, ...legacy })).ok, true);
      const file = await upload(1048576);
      const result = await actions.sendMail({ accountId: a.id, ...content, attachments: [file] });
      assert.equal(result.ok, true); assert.match(result.warning!, /Do not resend/); assert.equal(sends, 2);
      const uncertain = await upload(100, "unknown.bin");
      t.mock.method(nodemailer, "createTransport", () => ({ close() {}, async sendMail() { throw Error("Synthetic lost acceptance"); } }));
      await assert.rejects(actions.sendMail({ accountId: a.id, ...content, attachments: [uncertain] }), /lost acceptance/);
      store.cleanupUploads(Date.now() + 3600001);
      assert.ok(store.get("upload", uncertain.id), "unknown send retains its durable hold");
    });
    await t.test("referenced IMAP-account send saves the exact streamed message to Sent", async t => {
      let sent: Buffer | undefined;
      t.mock.method(nodemailer, "createTransport", () => ({
        close() {}, async sendMail(value: { raw: Readable }) {
          const chunks: Buffer[] = []; for await (const chunk of value.raw) chunks.push(Buffer.from(chunk));
          sent = Buffer.concat(chunks); return { accepted: [content.to[0]] };
        },
      }));
      const appended: { folder: string; raw: Buffer }[] = [];
      t.mock.method(ImapFlow.prototype, "connect", async () => {});
      t.mock.method(ImapFlow.prototype, "list", async () => [{ path: "Sent", specialUse: "\\Sent", flags: new Set(["\\Sent"]) }]);
      t.mock.method(ImapFlow.prototype, "append", async (folder: string, raw: Buffer) => { appended.push({ folder, raw }); return { destination: folder }; });
      t.mock.method(ImapFlow.prototype, "logout", async () => {});
      const file = await upload(1048576, "copy.bin");
      const result = await actions.sendMail({ accountId: a.id, ...content, bcc: ["hidden@example.test"], attachments: [file] });
      assert.equal(result.ok, true); assert.equal(result.warning, undefined, "a saved Sent copy produces no warning");
      assert.equal(appended.length, 1); assert.equal(appended[0].folder, "Sent");
      assert.ok(sent && appended[0].raw.equals(sent), "Sent copy is the exact submitted message");
      assert.ok(!appended[0].raw.toString("latin1").includes("hidden@example.test"), "Sent copy carries no Bcc header");
    });
    await t.test("streamed SMTP preserves partial recipient warnings and rejects zero acceptance", async t => {
      const file = await upload(128, "recipients.bin");
      const gmailImap = { ...a, provider: "gmail-imap" as const };
      store.put("account", a.id, gmailImap);
      let rejectAll = false;
      t.mock.method(nodemailer, "createTransport", () => ({ close() {}, async sendMail(value: { raw: Readable }) {
        for await (const _chunk of value.raw) { /* drain the measured synthetic stream */ }
        return { accepted: rejectAll ? [] : [content.to[0]], rejected: ["rejected@example.test"] };
      } }));
      const result = await actions.sendMail({ accountId: a.id, ...content, attachments: [file] });
      assert.equal(result.ok, true); assert.match(result.warning!, /some recipients were rejected/);
      rejectAll = true;
      await assert.rejects(actions.sendMail({ accountId: a.id, ...content, attachments: [file] }), error =>
        (error as { code?: string }).code === "EENVELOPE");
      store.put("account", a.id, a);
    });
    await t.test("Gmail streams base64url JSON without collecting the message", async () => {
      const payload: Buffer[] = [];
      for await (const chunk of bytes.gmailJson(Readable.from([Buffer.from("a"), Buffer.from("bcde"), Buffer.from("fg")]), "thread")) payload.push(Buffer.from(chunk));
      assert.deepEqual(JSON.parse(Buffer.concat(payload).toString()), { raw: Buffer.from("abcdefg").toString("base64url"), threadId: "thread" });
      const decoded: Buffer[] = [];
      for await (const chunk of download.gmailAttachmentBytes(Readable.from([Buffer.from('{"size":5,"da'), Buffer.from('ta":"aGV'), Buffer.from('sbG8"}')]), new AbortController().signal)) decoded.push(chunk);
      assert.equal(Buffer.concat(decoded).toString(), "hello");
      await assert.rejects(async () => { for await (const _ of download.gmailAttachmentBytes(Readable.from([Buffer.from('{"size":5,"data":"aGVs')]), new AbortController().signal)) {} }, /interrupted/);
    });
    await t.test("large Gmail metadata and explicit single-part encrypted download", async t => {
      const gmailAccount = { ...a, provider: "gmail" as const }; store.put("account", a.id, gmailAccount);
      const part = { filename: "large.bin", mimeType: "application/octet-stream", body: { attachmentId: "part-id", size: 600000 } };
      let attachmentCalls = 0;
      const api = { users: { messages: {
        list: async () => ({ data: { messages: [{ id: "remote" }] } }),
        get: async (input: { format?: string }) => {
          if (input.format === "raw") throw Error("maxContentLength exceeded");
          return { data: { id: "remote", labelIds: ["UNREAD"], payload: { headers: [{ name: "Message-ID", value: "<synthetic@example.test>" }], parts: [part] } } }; },
        attachments: { get: async () => { attachmentCalls++; return { data: Readable.from([Buffer.from(JSON.stringify({ size: 600000, data: Buffer.alloc(600000, 42).toString("base64url") }))]) }; } },
      } } };
      t.mock.method(google, "gmail", () => api);
      const recovered = (await providers.providers.gmail.list(gmailAccount, new Map()))[0];
      assert.equal(recovered.bodyUnavailable, true); assert.equal(recovered.attachments![0].unavailable, true);
      const message = { ...mail(recovered.attachments![0], "gmail"), ...recovered } as Mail;
      store.put("mail", message.id, message);
      const file = await download.downloadProviderAttachment(gmailAccount, message, message.attachments![0], new AbortController().signal);
      assert.equal(file.size, 600000); assert.equal(attachmentCalls, 1);
      assert.equal(store.get("mail", message.id)!.unread, true, "download never changes Seen");
      store.eraseUpload(file.id);
      store.put("account", a.id, a);
    });
    await t.test("IMAP checks UIDVALIDITY, fetches only requested part and cancels transport", async t => {
      const file = { id: "synthetic-file", filename: "large.bin", contentType: "application/octet-stream", size: 600000, unavailable: true, remotePart: "2" };
      const message = mail(file); store.put("mail", message.id, message);
      let validity = "999", calls = 0, closed = 0, cancelDownload = true;
      t.mock.method(ImapFlow.prototype, "connect", async function(this: ImapFlow) { this.usable = true; });
      t.mock.method(ImapFlow.prototype, "mailboxOpen", async function(this: ImapFlow, folder: string, options?: { readOnly?: boolean }) {
        assert.equal(folder, "INBOX"); assert.equal(options?.readOnly, true);
        Object.assign(this, { mailbox: { uidValidity: BigInt(validity) } }); return {};
      });
      t.mock.method(ImapFlow.prototype, "fetchOne", async (_uid: string, query: { source?: unknown }, options?: { uid?: boolean }) => {
        assert.equal(query.source, undefined); assert.deepEqual(options, { uid: true });
        return { uid: 7, envelope: { messageId: message.messageId }, bodyStructure: { type: "application/octet-stream", part: "2", dispositionParameters: { filename: file.filename } } };
      });
      t.mock.method(ImapFlow.prototype, "close", () => { closed++; });
      const controller = new AbortController();
      t.mock.method(ImapFlow.prototype, "download", async (uid: string, part?: string, options?: { uid?: boolean; maxBytes?: number }) => {
        calls++; assert.equal(uid, "7"); assert.equal(part, "2"); assert.equal(options?.uid, true); assert.equal(options?.maxBytes, ATTACHMENT_BYTES + 1);
        return { meta: {}, content: Readable.from((async function* () {
          if (cancelDownload) { yield Buffer.alloc(65536); controller.abort(); yield Buffer.alloc(65536); }
          else for (let left = file.size; left; left -= Math.min(left, 65536)) yield Buffer.alloc(Math.min(left, 65536));
        })()) };
      });
      await assert.rejects(download.downloadProviderAttachment(a, message, file, new AbortController().signal), /identifiers changed/);
      assert.equal(calls, 0); validity = "123";
      const before = store.all("upload").length;
      await assert.rejects(download.downloadProviderAttachment(a, message, file, controller.signal));
      assert.equal(calls, 1); assert.ok(closed >= 2); assert.equal(store.all("upload").length, before);
      cancelDownload = false;
      const saved = await download.downloadProviderAttachment(a, message, file, new AbortController().signal);
      assert.equal(saved.size, file.size); store.eraseUpload(saved.id);
      assert.equal(store.get("mail", message.id)!.unread, true);
    });
    await t.test("large IMAP messages import only envelope and part metadata", async t => {
      let rawFetches = 0;
      t.mock.method(ImapFlow.prototype, "connect", async function(this: ImapFlow) { this.usable = true; });
      t.mock.method(ImapFlow.prototype, "getMailboxLock", async function(this: ImapFlow) {
        Object.assign(this, { mailbox: { exists: 1, uidValidity: 123n, uidNext: 8 } });
        return { release() {} };
      });
      t.mock.method(ImapFlow.prototype, "fetch", async function* (_range: unknown, query: { source?: unknown }) {
        if (query.source) rawFetches++;
        yield { uid: 7, flags: new Set(), size: 20 * 1024 * 1024 };
      });
      t.mock.method(ImapFlow.prototype, "fetchOne", async (_uid: unknown, query: { source?: unknown }) => {
        assert.equal(query.source, undefined);
        return { uid: 7, flags: new Set(), envelope: { messageId: "<synthetic@example.test>", from: [{ address: "sender@example.test" }] },
          bodyStructure: { type: "application/octet-stream", part: "2", size: 19 * 1024 * 1024, encoding: "base64", dispositionParameters: { filename: "large.bin" } } };
      });
      t.mock.method(ImapFlow.prototype, "logout", async () => {});
      t.mock.method(ImapFlow.prototype, "close", () => {});
      const messages = await providers.providers.imap.list(a, new Map());
      assert.equal(messages.length, 1); assert.equal(rawFetches, 0);
      assert.equal(messages[0].bodyUnavailable, true); assert.equal(messages[0].attachments![0].remotePart, "2");
      assert.equal(messages[0].attachments![0].unavailable, true); assert.equal(messages[0].attachments![0].sizeIsEstimate, true);
    });
    await t.test("raw upload endpoint inherits desktop, origin and CSRF checks; other JSON stays tight", async t => {
      const { startServer } = await import("./index.js");
      const server = await startServer(0, undefined, undefined, undefined, quietImapWatch);
      const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      const session = { "X-Desktop-Token": process.env.MAIL_DESKTOP_TOKEN! };
      const state = await (await fetch(`${origin}/api/state`, { headers: session })).json() as { csrf: string };
      const url = `${origin}/api/accounts/${a.id}/attachments?filename=upload.bin&contentType=application%2Foctet-stream`;
      const headers = { ...session, "X-CSRF-Token": state.csrf, "Content-Type": "application/octet-stream" };
      try {
        assert.equal((await fetch(url, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: "abc" })).status, 403);
        assert.equal((await fetch(url, { method: "POST", headers: { ...headers, "X-CSRF-Token": "invalid" }, body: "abc" })).status, 403);
        assert.equal((await fetch(url, { method: "POST", headers: { ...headers, Origin: "https://untrusted.example.test" }, body: "abc" })).status, 403);
        const response = await fetch(url, { method: "POST", headers, body: Buffer.alloc(3 * 1024 * 1024, 42) });
        assert.equal(response.status, 201); const file = await response.json() as DraftAttachment;
        assert.equal(file.size, 3 * 1024 * 1024);
        const draft = drafts.createDraft(a.id, { ...content, attachments: [file] });
        assert.deepEqual(drafts.readDraft(a.id, draft.id).attachments, [file]);
        const incoming = { ...mail({ id: "http-part", filename: "large.txt", contentType: "text/plain", size: 5, unavailable: true }, "gmail"), id: `${a.id}:remote` };
        store.put("account", a.id, { ...a, provider: "gmail" }); store.put("mail", incoming.id, incoming);
        let partRequests = 0;
        t.mock.method(google, "gmail", () => ({ users: { messages: {
          get: async () => ({ data: { id: "remote", payload: { headers: [{ name: "Message-ID", value: incoming.messageId }], parts: [{ filename: "large.txt", mimeType: "text/plain", body: { attachmentId: "http-attachment", size: 5 } }] } } }),
          attachments: { get: async () => { partRequests++; return { data: Readable.from([Buffer.from('{"size":5,"data":"aGVsbG8"}')]) }; } },
        } } }));
        const route = `${origin}/api/messages/${encodeURIComponent(incoming.id)}/attachments/http-part`;
        const fetchPart = () => fetch(`${route}/download`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: "{}" });
        assert.equal((await fetchPart()).status, 200); assert.equal((await fetchPart()).status, 200);
        assert.equal(partRequests, 1, "cached downloads never refetch the provider");
        const cached = store.get("mail", incoming.id)!;
        assert.ok(cached.attachments![0].uploadId); assert.equal(cached.unread, true);
        const savedResponse = await fetch(route, { headers: session });
        assert.equal(savedResponse.status, 200); assert.equal(savedResponse.headers.get("content-length"), "5");
        assert.equal(await savedResponse.text(), "hello");
        store.put("account", a.id, a);

        const rejected = await fetch(`${origin}/api/send`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ body: "x".repeat(2 * 1024 * 1024) }) });
        assert.equal(rejected.status, 400);
      } finally { await new Promise<void>(resolve => server.close(() => resolve())); server.closeAllConnections(); }
    });
  } finally { store.closeStore(); rmSync(directory, { recursive: true, force: true }); }
});
