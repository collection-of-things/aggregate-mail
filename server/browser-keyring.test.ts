import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { provisionBrowserKey } from "./browser-keyring.js";

test("automatic key bootstrap persists once, reads back and reuses exactly the same OS credential", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "emc2-key-bootstrap-"));
  let saved: string | null = null, writes = 0;
  const entry = { getPassword: async () => saved, setPassword: async (value: string) => { saved = value; writes++; } };
  try {
    const key = await provisionBrowserKey(directory, entry);
    assert.equal(Buffer.from(key, "base64").length, 32);
    assert.equal(writes, 1);
    assert.equal(await provisionBrowserKey(directory, entry), key);
    assert.equal(writes, 1);
    assert.ok(!readFileSync(path.join(directory, "browser-keyring.json"), "utf8").includes(key));
    saved = null;
    await assert.rejects(provisionBrowserKey(directory, entry), /missing/);
    assert.equal(writes, 1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test("unavailable, malformed, or lost keys never fall back or replace storage keys", async () => {
  for (const mode of ["unavailable", "malformed", "database", "readback"] as const) {
    const directory = mkdtempSync(path.join(tmpdir(), "emc2-key-denied-"));
    let writes = 0;
    if (mode === "database") writeFileSync(path.join(directory, "mail.sqlite"), "synthetic encrypted database");
    const before = existsSync(path.join(directory, "mail.sqlite")) ? readFileSync(path.join(directory, "mail.sqlite")) : undefined;
    try {
      await assert.rejects(provisionBrowserKey(directory, { getPassword: async () => {
        if (mode === "unavailable") throw new Error("synthetic native denial");
        return mode === "malformed" ? "bad-key" : null;
      }, setPassword: async () => { writes++; } }));
      assert.equal(writes, mode === "readback" ? 1 : 0);
      assert.equal(existsSync(path.join(directory, "browser-keyring.json")), false);
      if (before) assert.deepEqual(readFileSync(path.join(directory, "mail.sqlite")), before);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }
});
test("concurrent bootstrap cannot overwrite the first key and interrupted creation recovers without replacement", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "emc2-key-concurrent-"));
  let release!: () => void, entered!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  const entryStarted = new Promise<void>((resolve) => { entered = resolve; });
  let key: string | null = null, writes = 0;
  const entry = { getPassword: async () => { if (!key) { entered(); await hold; } return key; }, setPassword: async (value: string) => { key = value; writes++; } };
  try {
    const first = provisionBrowserKey(directory, entry); await entryStarted;
    await assert.rejects(provisionBrowserKey(directory, entry), /locked/);
    release(); const original = await first;
    // A previously persisted key with no DB or marker is a recoverable interrupted bootstrap.
    rmSync(path.join(directory, "browser-keyring.json"));
    assert.equal(await provisionBrowserKey(directory, entry), original); assert.equal(writes, 1);
    mkdirSync(path.join(directory, ".browser-bootstrap.lock"));
    await assert.rejects(provisionBrowserKey(directory, entry), /locked/);
    assert.equal(writes, 1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
