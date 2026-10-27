import assert from "node:assert/strict";
import http from "node:http";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import express from "express";
import { writeStateResponse } from "../server/state-response.js";

// Transport-only synthetic fixture. No store import, profile, provider or saved
// authentication. Run serially through Fleet's bounded verification runner.
const count = Number(process.env.EMC2_BENCHMARK_MESSAGES || 34000);
assert.ok(Number.isInteger(count) && count >= 4 && count <= 34000);
const messages = Array.from({ length: count }, (_, i) => ({
  id: `a${i % 4}:${String(i).padStart(6, "0")}`, remoteId: String(i), accountId: `a${i % 4}`,
  sender: `Sender ${i % 250}`, address: `sender${i % 250}@example.test`, to: `reader${i % 4}@example.test`,
  subject: `Synthetic message ${i}`, preview: "Synthetic cached message preview",
  date: 1700000000000 - i * 60000, unread: i % 3 === 0, archived: i % 3 === 1,
  direction: i % 3 === 2 ? "sent" : "received", category: "other", relevance: 1, reason: "Synthetic", snoozedUntil: null,
  attachments: i % 100 === 0 ? [{ id: "file", filename: "sample.txt", contentType: "text/plain", size: 9 }] : [],
  contentVersion: createHash("sha256").update(`synthetic-content-${i}`).digest("hex"), inboxTab: "primary",
}));
const envelope = { csrf: "synthetic-csrf", accounts: Array.from({ length: 4 }, (_, i) => ({ id: `a${i}`, email: `reader${i}@example.test`, provider: "imap" })),
  draftCount: 1, mailCursor: "synthetic:0", mailMode: "snapshot", removedMailIds: [], labels: [], rules: [], syncing: false };
const expected = JSON.stringify({ ...envelope, messages });
const app = express();
app.get("/state", async (req, res) => {
  const controller = new AbortController(); const cancel = () => controller.abort();
  res.once("close", cancel);
  try { await writeStateResponse(req, res, envelope, messages, controller.signal); }
  catch (error) { if (!controller.signal.aborted) res.destroy(error as Error); }
  finally { res.off("close", cancel); }
});
const server = app.listen(0, "127.0.0.1");
await new Promise<void>(resolve => server.once("listening", resolve));
const address = server.address(); assert.ok(address && typeof address === "object");
try {
  for (let pair = 0; pair < 3; pair++) for (const encoding of ["identity", "gzip"]) {
    const cpu = process.cpuUsage(), start = performance.now();
    const wire = await new Promise<Buffer>((resolve, reject) => {
      const request = http.get({ host: "127.0.0.1", port: address.port, path: "/state", headers: { "Accept-Encoding": encoding, Connection: "close" } }, response => {
        const chunks: Buffer[] = []; response.on("data", chunk => chunks.push(chunk));
        response.on("end", () => resolve(Buffer.concat(chunks))); response.on("error", reject);
      });
      request.on("error", reject);
    });
    const wireMs = performance.now() - start, decodeStart = performance.now();
    const decoded = encoding === "gzip" ? gunzipSync(wire) : wire;
    const parsed = JSON.parse(decoded.toString("utf8"));
    const decodeMs = performance.now() - decodeStart, usage = process.cpuUsage(cpu);
    assert.equal(decoded.toString("utf8"), expected); assert.equal(parsed.messages.length, count);
    console.log(JSON.stringify({ pair, encoding, messages: count, jsonBytes: Buffer.byteLength(expected), wireBytes: wire.length,
      wireMs, decodeMs, endToEndMs: wireMs + decodeMs, cpuMs: (usage.user + usage.system) / 1000 }));
  }
} finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
