import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { build } from "esbuild";
import { createRequire } from "node:module";

// Bundle with mocked Electron. Never load a saved profile or native dialog.
test("backup file bridge bounds reads, saves private files, and rejects foreign senders", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "emc2-backup-bridge-"));
  const outfile = path.join(directory, "bridge.cjs");
  const require = createRequire(import.meta.url);
  await build({ entryPoints: ["desktop/workspace-backup.ts"], outfile, bundle: true, platform: "node", format: "cjs", plugins: [{ name: "synthetic-electron", setup(build) {
    build.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "synthetic" }));
    build.onLoad({ filter: /.*/, namespace: "synthetic" }, () => ({ contents: 'export const dialog = { showOpenDialog: async () => { throw Error("foreign sender reached dialog"); }, showSaveDialog: async () => { throw Error("foreign sender reached dialog"); } };' }));
  } }] });
  const bridge = require(outfile) as typeof import("./workspace-backup.js");
  try {
    const file = path.join(directory, "synthetic.emc2-backup");
    await bridge.writeBackupFile(file, "synthetic ciphertext");
    assert.equal(await bridge.readBackupFile(file), "synthetic ciphertext");
    if (process.platform !== "win32") assert.equal((await stat(file)).mode & 0o777, 0o600);
    await bridge.writeBackupFile(file, "replacement ciphertext");
    assert.equal(await readFile(file, "utf8"), "replacement ciphertext");
    const oversized = path.join(directory, "too-large");
    await writeFile(oversized, Buffer.alloc(32 * 1024 * 1024 + 1));
    await assert.rejects(bridge.readBackupFile(oversized), /Invalid backup size/);
    await assert.rejects(bridge.readBackupFile(directory));
    const handlers = new Map<string, (...args: any[]) => Promise<unknown>>();
    const frame = {};
    const contents = { mainFrame: frame, getURL: () => "http://127.0.0.1:5173/" };
    const window = { webContents: contents, isDestroyed: () => false };
    bridge.registerWorkspaceBackupIpc({ handle: (name: string, handler: any) => handlers.set(name, handler) } as never, () => window as never, "http://127.0.0.1:5173");
    for (const handler of handlers.values()) {
      await assert.rejects(handler({ sender: {}, senderFrame: frame }), /Backup unavailable/);
      await assert.rejects(handler({ sender: contents, senderFrame: {} }), /Backup unavailable/);
    }
    await assert.rejects(handlers.get("workspace-backup-save")!({ sender: contents, senderFrame: frame }, "plaintext"), /could not be opened or saved/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
