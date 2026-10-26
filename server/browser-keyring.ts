import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, realpathSync, statSync, readFileSync, openSync, writeFileSync, fsyncSync, closeSync, rmdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Entry = { getPassword: () => Promise<string | null>; setPassword: (value: string) => Promise<void> };
const validKey = (value: string) => /^[A-Za-z0-9+/]{43}=$/.test(value) && Buffer.from(value, "base64").length === 32;
export async function provisionBrowserKey(directory: string, entry: Entry) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const profile = realpathSync(directory);
  const stat = statSync(profile);
  if (process.platform !== "win32" && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.())) throw new Error("Use a private browser profile owned by this user, with mode 0700.");
  const lock = path.join(profile, ".browser-bootstrap.lock");
  try { mkdirSync(lock, { mode: 0o700 }); }
  catch { throw new Error("Browser key setup is locked. Stop other launches; retain any interrupted setup for inspection."); }
  try {
    const marker = path.join(profile, "browser-keyring.json");
    const identity = createHash("sha256").update(profile).digest("hex");
    if (existsSync(marker)) {
      const saved = JSON.parse(readFileSync(marker, "utf8")) as { version?: number; identity?: string };
      if (saved.version !== 1 || saved.identity !== identity) throw new Error("Browser key identity changed. Restore the original profile and key.");
    } else if (existsSync(path.join(profile, "mail.sqlite"))) throw new Error("Existing browser storage needs its original externally supplied key. Automatic migration is unavailable.");
    let key = await entry.getPassword();
    if (key === null) {
      if (existsSync(marker) || existsSync(path.join(profile, "mail.sqlite"))) throw new Error("The existing browser encryption key is missing. Restore the original OS credential; no replacement was created.");
      key = randomBytes(32).toString("base64");
      await entry.setPassword(key);
    }
    if (!validKey(key) || await entry.getPassword() !== key) throw new Error("The browser encryption key could not be verified. Unlock or restore the OS credential store.");
    if (!existsSync(marker)) {
      const fd = openSync(marker, "wx", 0o600);
      try { writeFileSync(fd, JSON.stringify({ version: 1, identity }) + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
    }
    return key;
  } finally { rmdirSync(lock); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const directory = process.argv[2];
    if (!directory || !path.isAbsolute(directory)) throw new Error("profile");
    // Always require a persistent Secret Service on Linux, never memory-only keyutils.
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const profile = realpathSync(directory);
    const identity = createHash("sha256").update(profile).digest("hex");
    const { AsyncEntry } = await import("@napi-rs/keyring");
    const entry = new AsyncEntry("Emc2 Browser", identity, { linux: { store: "secret-service" } });
    process.stdout.write(await provisionBrowserKey(profile, entry));
  } catch {
    process.stderr.write("Protected browser-key setup failed. Unlock a persistent OS credential store, or supply the original external key. No weaker fallback is used.\n");
    process.exitCode = 1;
  }
}
