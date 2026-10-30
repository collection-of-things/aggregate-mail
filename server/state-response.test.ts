import assert from "node:assert/strict";
import { test } from "node:test";
import http from "node:http";
import { gunzipSync, inflateRawSync } from "node:zlib";
import express from "express";
import { writeStateResponse } from "./state-response.js";

test("state transport negotiates gzip, preserves JSON and cancels disconnected readers", async () => {
  const app = express();
  const messages = Array.from({ length: 1025 }, (_, id) => ({ id: `a:${id}`, accountId: "a", subject: "Synthetic message", contentVersion: String(id), preview: "Synthetic preview. ".repeat(20) }));
  const envelope = { csrf: "synthetic-csrf", accounts: [{ id: "a" }], mailCursor: "synthetic:1", mailMode: "snapshot", removedMailIds: [] };
  let written = 0, stopped = false;
  let finish!: () => void;
  let finished = new Promise<void>(resolve => { finish = resolve; });
  app.use((req, res, next) => { if (req.get("X-Test-Session") !== "synthetic") { res.status(403).end(); return; } next(); });
  app.get("/state", async (req, res) => {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    res.once("close", cancel);
    try {
      let selected: readonly unknown[] = req.query.tiny ? [] : messages;
      if (req.query.disconnect || req.query.fail) selected = Array.from({ length: 34000 }, (_, id) => ({ toJSON() {
        written++;
        if (req.query.fail && written > 128) throw Error("synthetic-serialization-failure");
        return { id, body: "synthetic".repeat(100) };
      } }));
      // Over 64 KiB of status spans several stored DEFLATE blocks.
      const status = req.query.largeStatus ? { ...envelope, accounts: Array.from({ length: 2000 }, (_, id) => ({ id: `synthetic-account-${id}`, label: "Synthetic account label" })) } : envelope;
      await writeStateResponse(req, res, status, selected, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) stopped = true;
      else if (!res.destroyed) res.destroy(error as Error);
    } finally { res.off("close", cancel); if (req.query.disconnect || req.query.fail) finish(); }
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address(); assert.ok(address && typeof address === "object");
  const get = (encoding?: string, suffix = "", authorized = true) => new Promise<{ headers: http.IncomingHttpHeaders; status: number; bytes: Buffer }>((resolve, reject) => {
    const request = http.get({ host: "127.0.0.1", port: address.port, path: `/state${suffix}`, headers: { ...(encoding === undefined ? {} : { "Accept-Encoding": encoding }), ...(authorized ? { "X-Test-Session": "synthetic" } : {}), Connection: "close" } }, response => {
      const chunks: Buffer[] = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => resolve({ headers: response.headers, status: response.statusCode!, bytes: Buffer.concat(chunks) }));
      response.on("error", reject);
    });
    request.on("error", reject);
  });
  try {
    const denied = await get("gzip", "", false); assert.equal(denied.status, 403); assert.equal(denied.headers["content-encoding"], undefined);
    const plain = await get();
    const expected = Buffer.from(JSON.stringify({ ...envelope, messages }));
    assert.deepEqual(plain.bytes, expected);
    for (const encoding of ["gzip", "br, gzip;q=0.5", "*;q=0.7", "identity;q=1, gzip;q=0.1"]) {
      const response = await get(encoding);
      assert.equal(response.headers["content-encoding"], "gzip");
      assert.equal(response.headers["cache-control"], "no-store");
      assert.match(String(response.headers.vary), /Accept-Encoding/i);
      assert.deepEqual(gunzipSync(response.bytes), expected);
      // HTTP decoders can stop at the first gzip member. Its DEFLATE payload
      // must contain the complete JSON, rather than only the status prefix.
      const firstMember = inflateRawSync(response.bytes.subarray(10), { info: true }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
      assert.deepEqual(JSON.parse(firstMember.buffer.toString()), { ...envelope, messages });
      assert.equal(firstMember.engine.bytesWritten + 18, response.bytes.length, "one gzip header, payload and trailer");
      assert.ok(response.bytes.includes(Buffer.from(envelope.csrf)), "CSRF stays literal in the stored status member");
      assert.ok(response.bytes.length < expected.length / 4);
    }
    const largeStatus = await get("gzip", "?largeStatus=1");
    const largeExpected = { ...envelope, accounts: Array.from({ length: 2000 }, (_, id) => ({ id: `synthetic-account-${id}`, label: "Synthetic account label" })), messages };
    assert.ok(JSON.stringify(largeExpected.accounts).length > 0xffff);
    const largeMember = inflateRawSync(largeStatus.bytes.subarray(10), { info: true }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
    assert.deepEqual(JSON.parse(largeMember.buffer.toString()), largeExpected);
    assert.equal(largeMember.engine.bytesWritten + 18, largeStatus.bytes.length);
    assert.deepEqual(JSON.parse(gunzipSync(largeStatus.bytes).toString()), largeExpected);
    for (const encoding of ["identity", "gzip;q=0", "gzip;q=0, *;q=1", "*;q=0", "br"]) {
      const response = await get(encoding); assert.equal(response.headers["content-encoding"], undefined); assert.deepEqual(response.bytes, expected);
    }
    const tiny = await get("gzip", "?tiny=1");
    assert.equal(tiny.headers["content-encoding"], undefined);
    assert.deepEqual(tiny.bytes, Buffer.from(JSON.stringify({ ...envelope, messages: [] })));
    finished = new Promise<void>(resolve => { finish = resolve; });
    await new Promise<void>((resolve, reject) => {
      const request = http.get({ host: "127.0.0.1", port: address.port, path: "/state?disconnect=1", headers: { "Accept-Encoding": "gzip", "X-Test-Session": "synthetic" } }, response => {
        response.once("data", () => { response.destroy(); request.destroy(); resolve(); });
        response.on("error", () => {});
      });
      request.on("error", reject);
    });
    await finished;
    assert.equal(stopped, true); assert.ok(written < 34000);
    const atClose = written;
    await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(written, atClose);
    written = 0; finished = new Promise<void>(resolve => { finish = resolve; });
    await assert.rejects(get("gzip", "?fail=1")); await finished; assert.equal(written, 129, "serialization failure stops production at the failing record");
    assert.deepEqual((await get("gzip", "?tiny=1")).bytes, tiny.bytes, "later requests survive stream errors");
    const decoded = await fetch(`http://127.0.0.1:${address.port}/state`, { headers: { "X-Test-Session": "synthetic", "Accept-Encoding": "gzip" } });
    assert.deepEqual(await decoded.json(), { ...envelope, messages });
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
