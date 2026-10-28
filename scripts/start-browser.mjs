import { readFile, realpath } from "node:fs/promises";
import { browserShutdown } from "./browser-shutdown.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import path from "node:path";
import { browserConfiguration, browserProfileDirectory } from "../server/browser-access.ts";

try {
  let managed;
  if (process.env.MAIL_WEB_MANAGED === "1") {
    if (process.env.MAIL_DESKTOP_TOKEN) throw new Error("Managed browser startup cannot use a desktop session.");
    const root = process.cwd();
    const receipt = JSON.parse(await readFile(path.join(root, ".web-deployment.json"), "utf8"));
    const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    const html = await readFile(path.join(root, "dist/index.html"), "utf8");
    if (!/^[a-f0-9]{40}$/.test(receipt.revision) || !/^[a-f0-9]{64}$/.test(receipt.build) ||
        pkg.webDeployment?.protocol !== 1 || pkg.webDeployment.profile !== receipt.profile ||
        `v${pkg.version}` !== receipt.tag || !html.includes(`<meta name="emc2-build" content="${receipt.build}">`))
      throw new Error("Invalid managed browser deployment.");
    process.env.MAIL_WEB_REVISION = receipt.revision;
    process.env.MAIL_STATIC_DIR = path.join(root, "dist");
    managed = path.basename(path.dirname(root)) === "releases" ? path.dirname(path.dirname(root)) : path.dirname(root);
  }
  const password = process.env.MAIL_WEB_PASSWORD;
  if (!password || password.length < 16 || password.length > 256) throw new Error("Set MAIL_WEB_PASSWORD to a host recovery passphrase of 16 to 256 characters through your password manager. Phones use passkeys.");
  const base = process.platform === "win32" ? process.env.LOCALAPPDATA : process.platform === "darwin" ? path.join(homedir(), "Library", "Application Support") : process.env.XDG_DATA_HOME || path.join(homedir(), ".local", "share");
  process.env.MAIL_DATA_DIR ||= path.join(base || homedir(), "emc2-browser");
  const directory = browserProfileDirectory(process.env);
  if (managed) {
    const canonical = async value => {
      try { return await realpath(value); }
      catch (error) { if (error.code !== "ENOENT") throw error; return path.join(await canonical(path.dirname(value)), path.basename(value)); }
    };
    const inside = value => { const relative = path.relative(managed, path.resolve(value)); return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative)); };
    if (inside(directory) || inside(await canonical(path.resolve(process.env.MAIL_CONFIG_PATH || path.join(directory, "settings.env")))))
      throw new Error("Managed browser profile and configuration must be outside the deployment root.");
  }
  if (!process.env.MAIL_DATA_KEY) {
    const env = Object.fromEntries(["PATH", "HOME", "USERPROFILE", "SystemRoot", "SYSTEMROOT", "LOCALAPPDATA", "TEMP", "TMP", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS", "DISPLAY"].flatMap((name) => process.env[name] ? [[name, process.env[name]]] : []));
    try {
      const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", fileURLToPath(new URL("../server/browser-keyring.ts", import.meta.url)), directory], { env, timeout: 15_000, maxBuffer: 2048, windowsHide: true });
      process.env.MAIL_DATA_KEY = stdout;
    } catch { throw new Error("Protected browser-key setup failed. Unlock a persistent OS credential store or supply your original external key. Existing keys were not replaced."); }
  }
  browserConfiguration(process.env);
  process.env.MAIL_CONFIG_PATH ||= path.join(directory, "settings.env");
  if (managed) {
    const ready = import("../server/index.ts").then(async runtime => ({ ...runtime, server: await runtime.startServer(Number(process.env.MAIL_WEB_PORT || 3001)) }));
    const stop = browserShutdown({ ready, exit: code => process.exit(code), warn: message => console.error(message) });
    process.on("SIGUSR2", stop);
    await ready;
    console.log(`Managed browser ready, revision ${process.env.MAIL_WEB_REVISION}`);
  } else await import("../server/index.ts");
} catch (error) {
  // Never expose child stdout, key values, native-store errors or process environment.
  console.error(error instanceof Error ? error.message : "Browser startup failed.");
  process.exitCode = 1;
}
