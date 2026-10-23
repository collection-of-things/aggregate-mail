import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { companyLogo } from "./avatars.js";

async function isolated(work: (dir: string) => Promise<void>) {
  const dir = mkdtempSync(path.join(tmpdir(), "emc2-avatar-"));
  const previous = process.env.MAIL_DATA_DIR;
  process.env.MAIL_DATA_DIR = dir;
  try { await work(dir); }
  finally {
    if (previous === undefined) delete process.env.MAIL_DATA_DIR; else process.env.MAIL_DATA_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
}

test("favicon requests coalesce and isolate memory by data directory", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return new Response("icon", { headers: { "content-type": "image/x-icon" } });
  });
  await isolated(async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => companyLogo("brand.example")));
    assert.ok(results.every((image) => image?.body.toString() === "icon"));
    assert.equal(calls, 1);
    assert.equal((await companyLogo("brand.example"))?.body.toString(), "icon");
    assert.equal(calls, 1);
  });
  await isolated(async () => { await companyLogo("brand.example"); assert.equal(calls, 2); });
});

test("oversized streamed favicons cancel and preserve the previous expired disk cache", async (t) => {
  let cancelled = false;
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array(256 * 1024)); },
    cancel() { cancelled = true; },
  }), { headers: { "content-type": "image/x-icon" } }));
  await isolated(async (dir) => {
    mkdirSync(path.join(dir, "logos"));
    const file = path.join(dir, "logos", "brand.example.json");
    const saved = JSON.stringify({ body: Buffer.from("previous").toString("base64"), type: "image/x-icon" });
    writeFileSync(file, saved); utimesSync(file, new Date(0), new Date(0));
    assert.equal((await companyLogo("brand.example"))?.body.toString(), "previous");
    assert.equal(cancelled, true);
    assert.equal(readFileSync(file, "utf8"), saved);
  });
});

test("invalid cached image metadata is unavailable and never trusted", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("missing", { status: 404 }));
  await isolated(async (dir) => {
    mkdirSync(path.join(dir, "logos"));
    writeFileSync(path.join(dir, "logos", "brand.example.json"), JSON.stringify({ body: "AAAA", type: "text/html" }));
    assert.equal(await companyLogo("brand.example"), null);
  });
});
