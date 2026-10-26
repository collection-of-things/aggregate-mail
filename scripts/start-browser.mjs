import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import path from "node:path";
import { browserConfiguration, browserProfileDirectory } from "../server/browser-access.ts";

try {
  const password = process.env.MAIL_WEB_PASSWORD;
  if (!password || password.length < 16 || password.length > 256) throw new Error("Set MAIL_WEB_PASSWORD to a host recovery passphrase of 16 to 256 characters through your password manager. Phones use passkeys.");
  const base = process.platform === "win32" ? process.env.LOCALAPPDATA : process.platform === "darwin" ? path.join(homedir(), "Library", "Application Support") : process.env.XDG_DATA_HOME || path.join(homedir(), ".local", "share");
  process.env.MAIL_DATA_DIR ||= path.join(base || homedir(), "emc2-browser");
  const directory = browserProfileDirectory(process.env);
  if (!process.env.MAIL_DATA_KEY) {
    const env = Object.fromEntries(["PATH", "HOME", "USERPROFILE", "SystemRoot", "SYSTEMROOT", "LOCALAPPDATA", "TEMP", "TMP", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS", "DISPLAY"].flatMap((name) => process.env[name] ? [[name, process.env[name]]] : []));
    try {
      const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", fileURLToPath(new URL("../server/browser-keyring.ts", import.meta.url)), directory], { env, timeout: 15_000, maxBuffer: 2048, windowsHide: true });
      process.env.MAIL_DATA_KEY = stdout;
    } catch { throw new Error("Protected browser-key setup failed. Unlock a persistent OS credential store or supply your original external key. Existing keys were not replaced."); }
  }
  browserConfiguration(process.env);
  process.env.MAIL_CONFIG_PATH ||= path.join(directory, "settings.env");
  await import("../server/index.ts");
} catch (error) {
  // Never expose child stdout, key values, native-store errors or process environment.
  console.error(error instanceof Error ? error.message : "Browser startup failed.");
  process.exitCode = 1;
}
