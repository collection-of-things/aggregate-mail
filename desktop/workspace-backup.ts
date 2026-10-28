import type { BrowserWindow, IpcMain } from "electron";
import { dialog } from "electron";
import { open, rename, unlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { trustedWindowSender } from "./navigation.js";
import { BACKUP_MAX_BYTES } from "../shared/workspace-backup.js";

export async function readBackupFile(file: string): Promise<string> {
  const handle = await open(file, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > BACKUP_MAX_BYTES) throw Error("Invalid backup size.");
    const bytes = Buffer.alloc(Math.min(stat.size + 1, BACKUP_MAX_BYTES + 1));
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length !== stat.size) throw Error("Backup changed while reading.");
    return bytes.subarray(0, length).toString("utf8");
  } finally { await handle.close(); }
}
export async function writeBackupFile(file: string, encrypted: string): Promise<void> {
  const temporary = `${file}.${randomBytes(12).toString("hex")}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(encrypted, "utf8");
    await handle.sync();
    await handle.close();
    await rename(temporary, file);
  } finally {
    await handle.close();
    await unlink(temporary).catch(() => {});
  }
}
export function registerWorkspaceBackupIpc(ipc: IpcMain, current: () => BrowserWindow | null, origin: string) {
  for (const action of ["save", "open"] as const) ipc.handle(`workspace-backup-${action}`, async (event, encrypted: unknown) => {
    const window = current();
    const trusted = () => !!window && current() === window && !window.isDestroyed() && trustedWindowSender(event, window.webContents, origin);
    if (!window || !trusted()) throw Error("Backup unavailable.");
    try {
      if (action === "open") {
        const result = await dialog.showOpenDialog(window, { properties: ["openFile"], filters: [{ name: "Encrypted Emc² backup", extensions: ["emc2-backup"] }] });
        if (result.canceled) return null;
        if (!trusted()) throw Error();
        return await readBackupFile(result.filePaths[0]);
      }
      if (typeof encrypted !== "string" || Buffer.byteLength(encrypted) > BACKUP_MAX_BYTES) throw Error();
      const envelope = JSON.parse(encrypted);
      if (envelope?.format !== "emc2-workspace-backup" || envelope.version !== 1 || typeof envelope.data !== "string") throw Error();
      const result = await dialog.showSaveDialog(window, { defaultPath: "workspace.emc2-backup", filters: [{ name: "Encrypted Emc² backup", extensions: ["emc2-backup"] }] });
      if (result.canceled || !result.filePath) return false;
      if (!trusted()) throw Error();
      await writeBackupFile(result.filePath, encrypted);
      return true;
    } catch { throw Error("The backup file could not be opened or saved. Check file access and the 128 MiB limit."); }
  });
}
