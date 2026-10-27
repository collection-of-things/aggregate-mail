import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import crypto from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { Mail } from "../shared/types.js";

// Run only through the bounded verification runner. Every profile is synthetic,
// owned by this process and removed after its children exit. Never accepts a path.
const phase = process.env.EMC2_STARTUP_PHASE;
const count = Number(process.env.EMC2_BENCHMARK_MESSAGES || 34000);
assert.ok(Number.isInteger(count) && count >= 4 && count <= 34000);
if (!phase) {
  const directory = mkdtempSync(path.join(tmpdir(), "emc2-startup-"));
  try {
    for (const childPhase of ["seed", "measure", "measure"]) {
      const child = spawnSync(process.execPath, ["--import", "tsx", fileURLToPath(import.meta.url)], {
        env: { ...process.env, EMC2_STARTUP_PHASE: childPhase, MAIL_DATA_DIR: directory,
          MAIL_DATA_KEY: "", MAIL_CONFIG_PATH: path.join(directory, "absent.env"), MAIL_DESKTOP_TOKEN: "synthetic-startup" },
        encoding: "utf8", timeout: 180000,
      });
      assert.equal(child.status, 0, child.stderr);
      process.stdout.write(child.stdout);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
} else {
  assert.ok(phase === "seed" || phase === "measure");
  const start = performance.now();
  const store = await import("../server/store.js");
  if (phase === "seed") {
    for (let a = 0; a < 4; a++) store.put("account", `a${a}`, { id: `a${a}`, email: `reader${a}@example.test`, provider: "imap", credentials: {} });
    for (let offset = 0; offset < count; offset += 128) store.transaction(() => {
      for (let i = offset; i < Math.min(offset + 128, count); i++) {
        const id = `a${i % 4}:${String(i).padStart(6, "0")}`;
        const mail: Mail = { id, remoteId: String(i), accountId: `a${i % 4}`,
          sender: `Sender ${i % 250}`, address: `sender${i % 250}@example.test`, to: `reader${i % 4}@example.test`,
          subject: `Synthetic message ${i}`, preview: "Synthetic cached message preview",
          body: `Unique body marker ${i}. ` + "Synthetic message content. ".repeat(100),
          html: "<p>" + "Synthetic formatted content. ".repeat(50) + "</p>",
          attachments: i % 100 === 0 ? [{ id: "file", filename: "sample.txt", contentType: "text/plain", size: 9 }] : [],
          date: 1700000000000 - i * 60000, unread: i % 3 === 0, archived: i % 3 === 1,
          direction: i % 3 === 2 ? "sent" : "received", category: "other", relevance: 1, reason: "Synthetic", snoozedUntil: null };
        store.put("mail", id, mail);
        if (i % 100 === 0) store.put("attachment", `${id}:file`, { accountId: mail.accountId, content: "c3ludGhldGlj" });
      }
    });
    store.put("draft", "draft", { id: "draft", accountId: "a0", revision: 3, updatedAt: 1, to: "recipient@example.test", subject: "Draft", body: "Saved draft", sendUnknown: true, attachments: [{ filename: "draft.txt", contentType: "text/plain", content: "c3ludGhldGlj" }] });
    store.closeStore();
    console.log(JSON.stringify({ phase, messages: count, accounts: 4, ms: performance.now() - start, databaseBytes: statSync(path.join(process.env.MAIL_DATA_DIR!, "mail.sqlite")).size }));
  } else {
    let decryptMs = 0, decryptCount = 0, parseMs = 0, digestMs = 0;
    const decipher = crypto.createDecipheriv, hash = crypto.createHash, parse = JSON.parse;
    crypto.createDecipheriv = ((...args: Parameters<typeof decipher>) => {
      const t = performance.now(); const result = Reflect.apply(decipher, crypto, args); decryptMs += performance.now() - t; decryptCount++;
      for (const method of ["update", "final"] as const) {
        const original = result[method];
        (result as any)[method] = (...values: unknown[]) => { const t = performance.now(); try { return Reflect.apply(original, result, values); } finally { decryptMs += performance.now() - t; } };
      }
      return result;
    }) as typeof decipher;
    crypto.createHash = ((...args: Parameters<typeof hash>) => {
      const result = Reflect.apply(hash, crypto, args), update = result.update;
      result.update = ((...values: Parameters<typeof update>) => { const t = performance.now(); try { return Reflect.apply(update, result, values); } finally { digestMs += performance.now() - t; } }) as typeof update;
      return result;
    }) as typeof hash;
    JSON.parse = ((...args: Parameters<typeof parse>) => { const t = performance.now(); try { return Reflect.apply(parse, JSON, args); } finally { parseMs += performance.now() - t; } }) as typeof parse;
    syncBuiltinESMExports();
    const coldStart = performance.now();
    const cold = await store.mailSummaryChanges();
    const coldMs = performance.now() - coldStart;
    const coldCosts = { decryptMs, decryptCount, parseMs, digestMs };
    const warmStart = performance.now();
    const warm = await store.mailSummaryChanges();
    const warmMs = performance.now() - warmStart;
    const serializeStart = performance.now(); const json = JSON.stringify(cold);
    const serializeMs = performance.now() - serializeStart;
    const deltaStart = performance.now(); const delta = await store.mailSummaryChanges(cold.mailCursor);
    assert.equal(delta.messages.length, 0); assert.equal(delta.mailMode, "delta");
    const deltaMs = performance.now() - deltaStart;
    assert.equal(cold.messages.length, count); assert.deepEqual(cold.messages, warm.messages);
    crypto.createDecipheriv = decipher; crypto.createHash = hash; JSON.parse = parse; syncBuiltinESMExports();
    const { startServer } = await import("../server/index.js");
    const { quietImapWatch, quietGmailRevision } = await import("../server/imap-watch-fixture.js");
    const server = await startServer(0, undefined, undefined, undefined, quietImapWatch, quietGmailRevision);
    const address = server.address(); assert.ok(address && typeof address === "object");
    let apiMs = 0, apiBytes = 0;
    try {
      const t = performance.now();
      const response = await fetch(`http://127.0.0.1:${address.port}/api/state`, { headers: { "X-Desktop-Token": "synthetic-startup", Connection: "close" } });
      assert.equal(response.status, 200); const text = await response.text(); apiMs = performance.now() - t; apiBytes = Buffer.byteLength(text);
      assert.equal(JSON.parse(text).messages.length, count);
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
    const raw = new DatabaseSync(path.join(process.env.MAIL_DATA_DIR!, "mail.sqlite"));
    const before = raw.prepare("SELECT kind,id,value FROM records ORDER BY kind,id").all();
    const compactStart = performance.now(); const compact = store.compactStore({ cleanupOrphans: true, isDrained: () => true });
    const compactMs = performance.now() - compactStart;
    assert.deepEqual(raw.prepare("SELECT kind,id,value FROM records ORDER BY kind,id").all(), before);
    assert.equal(raw.prepare("PRAGMA integrity_check").get()!.integrity_check, "ok");
    assert.equal(store.get("draft", "draft")?.revision, 3); assert.equal(store.get("draft", "draft")?.sendUnknown, true);
    raw.close(); store.closeStore();
    console.log(JSON.stringify({ phase, messages: count, coldMs, warmMs, ...coldCosts, serializeMs, jsonBytes: Buffer.byteLength(json), deltaMs, deltaBytes: Buffer.byteLength(JSON.stringify(delta)), apiMs, apiBytes, compactMs, compact, rssMiB: process.memoryUsage().rss / 1048576 }));
  }
}
