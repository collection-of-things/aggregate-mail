import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { gunzipSync } from "node:zlib";
import { quietImapWatch, quietGmailRevision } from "./imap-watch-fixture.js";

test("cached reader and startup HTTP avoid whole-mailbox body and transport work", async t => {
  const directory = mkdtempSync(path.join(tmpdir(), "emc2-loading-"));
  Object.assign(process.env, { MAIL_DATA_DIR: directory, MAIL_DATA_KEY: "", MAIL_CONFIG_PATH: path.join(directory, "absent.env"), MAIL_DESKTOP_TOKEN: "synthetic-loading" });
  const store = await import("./store.js");
  const { startServer } = await import("./index.js");
  store.put("account", "a", { id: "a", email: "reader@example.test", provider: "imap", credentials: {} });
  store.transaction(() => {
    for (let i = 0; i < 256; i++) store.put("mail", `a:${i}`, {
      id: `a:${i}`, accountId: "a", remoteId: String(i), messageId: `<${i}@example.test>`,
      ...(i === 1 ? { inReplyTo: "<0@example.test>" } : {}),
      sender: "Synthetic", address: "sender@example.test", to: "reader@example.test", subject: `Synthetic ${i}`,
      preview: "Synthetic preview", body: "Synthetic body. ".repeat(200), date: i,
      unread: false, archived: false, category: "important", relevance: 2, reason: "Synthetic", snoozedUntil: null,
    });
  });
  const server = await startServer(0, undefined, undefined, undefined, quietImapWatch, quietGmailRevision);
  const address = server.address(); assert.ok(address && typeof address === "object");
  const read = (route: string, encoding = "identity", authorized = true) => new Promise<{ status: number; encoding?: string; bytes: Buffer }>((resolve, reject) => {
    const request = http.get({ host: "127.0.0.1", port: address.port, path: `/api/${route}`,
      headers: { ...(authorized ? { "X-Desktop-Token": "synthetic-loading" } : {}), "Accept-Encoding": encoding, Connection: "close" } }, response => {
      const chunks: Buffer[] = []; response.on("data", chunk => chunks.push(chunk)); response.on("error", reject);
      response.on("end", () => resolve({ status: response.statusCode!, encoding: response.headers["content-encoding"], bytes: Buffer.concat(chunks) }));
    }); request.on("error", reject);
  });
  try {
    const plain = await read("state"); assert.equal(plain.status, 200);
    const initial = JSON.parse(plain.bytes.toString()); assert.equal(initial.messages.length, 256);
    await t.test("real state route negotiates the existing bounded compressed writer", async () => {
      const packed = await read("state", "gzip"); assert.equal(packed.status, 200);
      assert.equal(packed.encoding, "gzip"); assert.deepEqual(gunzipSync(packed.bytes), plain.bytes);
      assert.ok(packed.bytes.length < plain.bytes.length / 2);
      const denied = await read("state", "gzip", false); assert.equal(denied.status, 403); assert.equal(denied.encoding, undefined);
      const delta = await read(`state?mailCursor=${encodeURIComponent(initial.mailCursor)}`, "gzip");
      assert.equal(delta.encoding, undefined); assert.deepEqual(JSON.parse(delta.bytes.toString()).messages, []);
    });
    await t.test("real conversation route hydrates related bodies only", async () => {
      let bodies = 0;
      const parse = JSON.parse;
      const spy = t.mock.method(JSON, "parse", (value: string, ...rest: unknown[]) => {
        if (value.includes('"body"') && value.includes('"remoteId"')) bodies++;
        return Reflect.apply(parse, JSON, [value, ...rest]);
      });
      let response: Awaited<ReturnType<typeof read>>;
      try { response = await read("messages/a%3A0/conversation"); }
      finally { spy.mock.restore(); }
      assert.equal(response.status, 200); assert.equal(bodies, 2, "unrelated cached bodies must not be decrypted on opening");
      const result = JSON.parse(response.bytes.toString()); assert.deepEqual(result.messages.map((item: { id: string }) => item.id), ["a:0", "a:1"]);
      assert.ok(result.gaps.length); assert.equal(store.get("mail", "a:0")?.unread, false);
    });
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    store.closeStore(); rmSync(directory, { recursive: true, force: true });
  }
});
