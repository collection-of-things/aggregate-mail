import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

test("incomplete uploads reserve admission capacity until completed or erased", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "emc2-attachment-quota-"));
  process.env.MAIL_DATA_DIR = directory;
  process.env.MAIL_CONFIG_PATH = path.join(directory, "absent.env");
  const store = await import("./store.js");
  const unit = 25 * 1024 * 1024;
  const ids: string[] = [];
  try {
    for (let i = 0; i < 10; i++) ids.push(store.beginUpload("synthetic", "reserved.bin", "application/octet-stream", unit));
    assert.throws(() => store.beginUpload("synthetic", "overflow.bin", "application/octet-stream", unit), /storage limit/);
    store.finishUpload(ids[0], 0);
    const replacement = store.beginUpload("synthetic", "replacement.bin", "application/octet-stream", unit);
    assert.throws(() => store.restoreBackupUpload("synthetic", { filename: "backup.bin", contentType: "application/octet-stream", content: Buffer.alloc(7 * 1024 * 1024).toString("base64") }), /storage limit/);
    store.eraseUpload(replacement);
    assert.ok(store.beginUpload("synthetic", "released.bin", "application/octet-stream", unit));
    // The global limit counts reservations across accounts as well.
    for (let i = 0; i < 30; i++) store.beginUpload(`other-${i}`, "reserved.bin", "application/octet-stream", unit);
    assert.throws(() => store.beginUpload("last", "overflow.bin", "application/octet-stream", unit), /storage limit/);
  } finally {
    store.closeStore();
    rmSync(directory, { recursive: true, force: true });
  }
});
