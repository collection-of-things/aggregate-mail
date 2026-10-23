import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { simpleParser } from "mailparser";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readResponseBytes, ByteCache, workLimit, trimImageCache } from "./resource-limits.js";
import { decodeGmailSource, checkMimeSource, rawMailLimit, canonicalBase64Size, mimeParserOptions } from "./mime-limits.js";

test("streamed responses cancel at the byte bound without trusting Content-Length", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array(9)); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(readResponseBytes(new Response(body, { headers: { "content-length": "1" } }), 8), /limit/);
  assert.equal(cancelled, true);
  assert.equal((await readResponseBytes(new Response("12345678"), 8)).toString(), "12345678");
});

test("declared excess cancels before consuming a response", async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "content-length": "100" } });
  await assert.rejects(readResponseBytes(response, 8), /limit/);
  assert.equal(cancelled, true);
});

test("cache evicts by bytes and entries, expires and isolates keys", () => {
  let now = 0;
  const cache = new ByteCache<Buffer>(2, 5, 10, (body) => body.length, () => now);
  cache.set("one", Buffer.alloc(3)); cache.set("two", Buffer.alloc(3));
  assert.equal(cache.get("one"), undefined);
  cache.set("three", Buffer.alloc(1)); cache.set("four", Buffer.alloc(1));
  assert.equal(cache.get("two"), undefined);
  now = 11;
  assert.equal(cache.get("four"), undefined);
});

test("raw mail and Gmail base64 are bounded before decoding or parsing", () => {
  assert.throws(() => checkMimeSource(Buffer.alloc(rawMailLimit + 1)), /limit/);
  assert.throws(() => decodeGmailSource("A".repeat(Math.ceil(rawMailLimit / 3) * 4 + 4)), /limit/);
  for (const value of [undefined, "a", "SGVsbG8+", "SG VsbG8", "SGVsbG9"]) assert.throws(() => decodeGmailSource(value));
  assert.equal(decodeGmailSource("SGVsbG8").toString(), "Hello");
  assert.equal(decodeGmailSource("SGVsbG8=").toString(), "Hello");
});

test("MIME metadata and part counts are bounded by the parser grammar", async () => {
  await assert.rejects(simpleParser(Buffer.from(`X-Header: ${"x".repeat(65536)}\r\n\r\nbody`), mimeParserOptions), /Max header/);
  const parts = Array.from({ length: 130 }, () => "--part\r\nContent-Type: text/plain\r\n\r\nx\r\n").join("");
  await assert.rejects(simpleParser(Buffer.from(`Content-Type: multipart/mixed; boundary=part\r\n\r\n${parts}--part--`), mimeParserOptions), /Max allowed child/);
});

test("canonical base64 sizes preserve padding validation without repeated decoding", () => {
  assert.equal(canonicalBase64Size(""), 0);
  assert.equal(canonicalBase64Size("YQ=="), 1);
  assert.equal(canonicalBase64Size("YWI="), 2);
  for (const value of ["YR==", "YWJ=", "YQ", " YQ==", "YQ==="]) assert.equal(canonicalBase64Size(value), null);
});

test("work admission bounds active work and pending closures", async () => {
  const limited = workLimit(1, 1);
  let release!: () => void;
  const first = limited(() => new Promise<void>((resolve) => { release = resolve; }));
  let started = false;
  const second = limited(async () => { started = true; });
  await assert.rejects(limited(async () => {}), /queue limit/);
  assert.equal(started, false);
  release(); await Promise.all([first, second]);
  assert.equal(started, true);
});

test("decorative disk cache budgets preserve unrelated files", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "emc2-cache-budget-"));
  try {
    writeFileSync(path.join(dir, "preserve.txt"), "untouched");
    for (let i = 0; i < 260; i++) writeFileSync(path.join(dir, `${i}.svg`), "icon");
    trimImageCache(dir);
    assert.equal(readdirSync(dir).filter((name) => name.endsWith(".svg")).length, 256);
    assert.ok(readdirSync(dir).includes("preserve.txt"));
    for (let i = 0; i < 20; i++) writeFileSync(path.join(dir, `large-${i}.json`), Buffer.alloc(1024 * 1024));
    trimImageCache(dir);
    const files = readdirSync(dir).filter((name) => name.startsWith("large-"));
    assert.ok(files.length <= 16);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("HTML-to-text conversion has a decoded input bound", async () => {
  const source = Buffer.from(`Content-Type: text/html; charset=utf-8\r\n\r\n<p>${"x".repeat(2 * 1024 * 1024)}</p>`);
  await assert.rejects(simpleParser(source, mimeParserOptions), /HTML too long/);
});
