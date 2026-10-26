import { createHash } from "node:crypto";
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { constants } from "node:fs";
import { chmod, copyFile, lstat, mkdir, mkdtemp, open, readFile, readdir, rm, statfs } from "node:fs/promises";
import path from "node:path";
import { isHigherStableVersion, versionParts } from "../shared/updates.js";
import { bundleDigest, canonicalDirectory, runBounded, validateDestination, type Run } from "./mac-source-update.js";

import { binaryEnvironment, binaryWorkspacePrefix, revealBinaryRecovery, verifyBinaryBundle, type BinaryReplacement } from "./mac-binary-replacement.js";

const repository = "collection-of-things/aggregate-mail";
export const macReleaseApi = `https://api.github.com/repos/${repository}/releases/latest`;
type Asset = { name: string; size: number; browser_download_url: string };
export type MacInstallerCandidate = { version: string; arch: "x64" | "arm64"; asset: Asset; sha256: string };
export type MacInstallerInstallation = { downloads: string; home: string; installed: string; runtime: string;
  helper: string; version: string; profile?: string; quit: () => void };
export class MacInstallerFailure extends Error {
  constructor(readonly reason?: "installer-target") { super("mac-installer-update"); }
}
const invalid = () => new MacInstallerFailure();

export async function macInstallerCandidate(value: unknown, target: { version: string; arch: string },
  read: (url: string, limit: number) => Promise<string>): Promise<MacInstallerCandidate | null> {
  const release = value as { draft?: unknown; prerelease?: unknown; tag_name?: unknown; assets?: Asset[] } | null;
  if (!release || release.draft !== false || release.prerelease !== false || typeof release.tag_name !== "string" ||
      !release.tag_name.startsWith("v") || !versionParts(release.tag_name.slice(1), true) ||
      !versionParts(target.version, false) || !["arm64", "x64"].includes(target.arch) ||
      !Array.isArray(release.assets) || release.assets.length > 100) throw invalid();
  const version = release.tag_name.slice(1);
  if (!isHigherStableVersion(version, target.version)) return null;
  const root = `https://github.com/${repository}/releases/download/${release.tag_name}/`;
  const names = new Set<string>();
  for (const asset of release.assets) {
    if (!asset || typeof asset.name !== "string" || asset.name.length > 200 || names.has(asset.name) ||
        !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.browser_download_url !== root + encodeURIComponent(asset.name)) throw invalid();
    names.add(asset.name);
  }
  const name = `Emc2-${version}-mac-${target.arch}.dmg`;
  const matches = release.assets.filter(asset => asset.name.endsWith(`-mac-${target.arch}.dmg`));
  const sums = release.assets.find(asset => asset.name === "SHA256SUMS.txt");
  if (matches.length !== 1 || matches[0].name !== name || matches[0].size > 1024 ** 3 || !sums || sums.size > 65536) throw invalid();
  const raw = await read(sums.browser_download_url, 65536);
  const entries = new Map<string, string>();
  for (const line of raw.trimEnd().split("\n")) {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9._-]+)\r?$/.exec(line);
    if (!match || entries.has(match[2])) throw invalid();
    entries.set(match[2], match[1]);
  }
  const sha256 = entries.get(name);
  if (!sha256) throw invalid();
  return { version, arch: target.arch as MacInstallerCandidate["arch"], asset: { ...matches[0] }, sha256 };
}

export async function verifyDmg(file: string, candidate: MacInstallerCandidate, signal?: AbortSignal) {
  if (!path.isAbsolute(file)) throw invalid();
  const before = await lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.size !== candidate.asset.size) throw invalid();
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  const abort = new AbortController();
  const cancel = () => abort.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  const timer = setTimeout(cancel, 30000);
  try {
    abort.signal.throwIfAborted();
    const stat = await handle.stat();
    if (!stat.isFile() || stat.ino !== before.ino || stat.dev !== before.dev || stat.size !== before.size) throw invalid();
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false, start: 0, end: candidate.asset.size - 1, signal: abort.signal })) {
      bytes += chunk.length; hash.update(chunk);
    }
    const after = await lstat(file);
    abort.signal.throwIfAborted();
    if (bytes !== candidate.asset.size || hash.digest("hex") !== candidate.sha256 || !after.isFile() ||
        after.ino !== stat.ino || after.dev !== stat.dev || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw invalid();
  } finally {
    clearTimeout(timer); signal?.removeEventListener("abort", cancel);
    if (handle.fd !== -1) await handle.close();
  }
}

export class MacInstallerUpdate {
  private abort = new AbortController();
  private workspace?: string;
  private quarantine?: string;
  private stageWorkspace?: string;
  private digest?: string;
  private mount?: string;
  private attached = false;
  private handedOff = false;
  private pending = new Set<Promise<void>>();
  constructor(readonly candidate: MacInstallerCandidate, private installation: MacInstallerInstallation, private run: Run = runBounded,
    private launch: (command: string, args: string[], options: SpawnOptions) => ChildProcess = spawn) {}
  private get env(): NodeJS.ProcessEnv {
    return binaryEnvironment(this.installation.home);
  }
  private track(operation: Promise<void>) {
    this.pending.add(operation);
    return operation.finally(() => { this.pending.delete(operation); });
  }
  stop() { if (!this.handedOff) this.abort.abort(); }
  async dispose() {
    this.stop();
    await Promise.allSettled(this.pending);
    await this.cleanup();
  }
  download() { return this.track(this.downloadInstaller()); }
  private async downloadInstaller() {
    try {
      const { downloads, installed } = this.installation;
      try {
        await validateDestination(installed);
        if (this.installation.runtime !== path.join(installed, "Contents/MacOS/Emc²")) throw invalid();
        await this.cleanupPrevious();
      } catch { throw new MacInstallerFailure("installer-target"); }
      await canonicalDirectory(downloads);
      const disk = await statfs(downloads);
      if (disk.bavail * disk.bsize < this.candidate.asset.size * 2) throw invalid();
      this.workspace = await mkdtemp(path.join(downloads, "Emc2-update-"));
      await chmod(this.workspace, 0o700);
      const file = path.join(this.workspace, this.candidate.asset.name);
      // curl 8.4 added streaming --max-filesize enforcement without Content-Length.
      const curlVersion = /^curl (\d+)\.(\d+)\./.exec(await this.run("/usr/bin/curl", ["--disable", "--version"], this.workspace, this.env, this.abort.signal));
      if (!curlVersion || Number(curlVersion[1]) < 8 || (Number(curlVersion[1]) === 8 && Number(curlVersion[2]) < 4)) throw invalid();
      await this.run("/usr/bin/curl", ["--disable", "--fail", "--silent", "--show-error", "--location", "--proto", "=https", "--proto-redir", "=https",
        "--connect-timeout", "30", "--max-time", "600", "--max-filesize", String(this.candidate.asset.size),
        "--output", file, this.candidate.asset.browser_download_url], this.workspace, this.env, this.abort.signal, 610000);
      await chmod(file, 0o600);
      await verifyDmg(file, this.candidate, this.abort.signal);
      // Programmatic downloads need quarantine metadata too. Never remove it or bypass macOS trust checks.
      this.quarantine = `0083;${Math.floor(Date.now() / 1000).toString(16)};Emc2;`;
      await this.run("/usr/bin/xattr", ["-w", "com.apple.quarantine", this.quarantine, file], this.workspace, this.env, this.abort.signal);
      await this.prepareBundle();
    } catch (error) {
      await this.cleanup();
      throw error;
    }
  }
  private async unmount() {
    if (!this.mount || !this.workspace) return;
    // A failed attach may still have mounted. Never recursively remove a mounted image.
    if (this.attached || (await lstat(this.mount)).dev !== (await lstat(this.workspace)).dev)
      await this.run("/usr/bin/hdiutil", ["detach", this.mount], this.workspace, this.env, new AbortController().signal, 45000);
    if ((await lstat(this.mount)).dev !== (await lstat(this.workspace)).dev) throw invalid();
    this.mount = undefined; this.attached = false;
  }
  private async cleanup() {
    if (this.stageWorkspace && !this.handedOff) {
      await rm(this.stageWorkspace, { recursive: true, force: true }); this.stageWorkspace = undefined;
    }
    await this.unmount();
    if (this.workspace) { await rm(this.workspace, { recursive: true, force: true }); this.workspace = undefined; }
  }
  private async cleanupPrevious() {
    const { installed, version, profile } = this.installation;
    const parent = path.dirname(installed), prefix = binaryWorkspacePrefix(installed);
    let currentDigest: string | undefined;
    for (const name of await readdir(parent)) {
      if (!name.startsWith(prefix)) continue;
      const workspace = path.join(parent, name);
      try {
        await canonicalDirectory(workspace);
        const owner = await lstat(workspace), file = path.join(workspace, "result.json"), stat = await lstat(file);
        if (owner.uid !== process.getuid?.() || (owner.mode & 0o777) !== 0o700 || !stat.isFile() || stat.isSymbolicLink() ||
            stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o600 || stat.size > 4096) throw invalid();
        const result = JSON.parse(await readFile(file, "utf8"));
        currentDigest ??= await bundleDigest(installed, this.abort.signal);
        // This updater is constructed only after healthy backend startup. Match that exact running app and profile.
        if (result.kind !== "mac-binary-update" || result.format !== 1 || result.state !== "launch-dispatched" ||
            result.installed !== installed || result.version !== version || result.arch !== this.candidate.arch ||
            result.profile !== (profile ?? null) || result.digest !== currentDigest) throw invalid();
        await rm(workspace, { recursive: true, force: true });
      } catch {
        await revealBinaryRecovery({ workspace, home: this.installation.home }, this.run);
        throw invalid();
      }
    }
  }
  private async prepareBundle() {
    const signal = this.abort.signal, file = path.join(this.workspace!, this.candidate.asset.name);
    await verifyDmg(file, this.candidate, signal);
    this.stageWorkspace = await mkdtemp(path.join(path.dirname(this.installation.installed), binaryWorkspacePrefix(this.installation.installed)));
    await chmod(this.stageWorkspace, 0o700);
    this.mount = path.join(this.workspace!, "mount"); await mkdir(this.mount, { mode: 0o700 });
    try {
      await this.run("/usr/bin/hdiutil", ["attach", "-readonly", "-nobrowse", "-mountpoint", this.mount, file], this.workspace!, this.env, signal, 90000);
      this.attached = true;
      const apps = (await readdir(this.mount)).filter(name => name.endsWith(".app"));
      if (apps.length !== 1 || apps[0] !== "Emc².app") throw invalid();
      const source = path.join(this.mount, apps[0]), stage = path.join(this.stageWorkspace, "staged.app");
      const digest = await bundleDigest(source, signal);
      await this.run("/usr/bin/ditto", ["--rsrc", "--extattr", source, stage], this.stageWorkspace, this.env, signal, 120000);
      // Finder propagates image quarantine; programmatic copying must do so explicitly.
      await this.run("/usr/bin/xattr", ["-w", "com.apple.quarantine", this.quarantine!, stage], this.stageWorkspace, this.env, signal);
      this.digest = await verifyBinaryBundle(stage, this.candidate, this.quarantine!, this.stageWorkspace, this.env, signal, this.run);
      if (this.digest !== digest) throw invalid();
    } finally { await this.unmount(); }
  }
  verify() { return this.track(this.verifyInstaller()); }
  private async verifyInstaller() {
    if (!this.workspace || !this.quarantine || !this.stageWorkspace || !this.digest) throw invalid();
    await canonicalDirectory(this.workspace);
    const file = path.join(this.workspace, this.candidate.asset.name);
    await verifyDmg(file, this.candidate, this.abort.signal);
    if (await this.run("/usr/bin/xattr", ["-p", "com.apple.quarantine", file], this.workspace, this.env, this.abort.signal) !== this.quarantine) throw invalid();
    await validateDestination(this.installation.installed);
    if (await verifyBinaryBundle(path.join(this.stageWorkspace, "staged.app"), this.candidate, this.quarantine,
      this.stageWorkspace, this.env, this.abort.signal, this.run) !== this.digest) throw invalid();
  }
  install() { return this.track(this.installBinary()); }
  private async installBinary() {
    await this.verify();
    const workspace = this.stageWorkspace!, helper = path.join(workspace, "replace.cjs");
    await copyFile(this.installation.helper, helper, constants.COPYFILE_EXCL); await chmod(helper, 0o600);
    const child = this.launch(this.installation.runtime, [helper], { cwd: workspace, env: { ...this.env, ELECTRON_RUN_AS_NODE: "1" },
      detached: true, stdio: ["ignore", "ignore", "ignore", "ipc"] });
    const childExited = new Promise<void>(resolve => child.once("exit", () => resolve()));
    await new Promise<void>((resolve, reject) => {
      let settled = false, ready = false;
      const fail = () => {
        if (settled) return;
        settled = true; clearTimeout(timer); this.abort.signal.removeEventListener("abort", fail);
        const force = setTimeout(() => child.kill("SIGKILL"), 2000);
        child.once("close", () => { clearTimeout(force); reject(invalid()); }); child.kill("SIGTERM");
      };
      const timer = setTimeout(fail, 30000);
      this.abort.signal.addEventListener("abort", fail, { once: true });
      child.once("error", fail); child.once("exit", fail);
      child.on("message", (message: unknown) => {
        if (settled) return;
        if (this.abort.signal.aborted) { fail(); return; }
        if (!ready && message === "ready") { ready = true; child.send("commit", error => { if (error) fail(); }); return; }
        if (!ready || message !== "armed") { fail(); return; }
        settled = true; clearTimeout(timer); this.abort.signal.removeEventListener("abort", fail);
        child.removeListener("error", fail); child.removeListener("exit", fail);
        this.handedOff = true; child.disconnect(); child.unref(); resolve();
      });
      const request: BinaryReplacement = { parent: process.pid, installed: this.installation.installed, home: this.installation.home,
        workspace, candidate: { version: this.candidate.version, arch: this.candidate.arch }, digest: this.digest!,
        quarantine: this.quarantine!, profile: this.installation.profile };
      child.send(request, error => { if (error) fail(); });
      if (this.abort.signal.aborted) fail();
    });
    try { this.installation.quit(); }
    catch (error) {
      // IPC is already disconnected and stdio is ignored. Observe process exit; Node may omit close after disconnect + kill.
      child.ref(); child.kill("SIGKILL"); await childExited; this.handedOff = false; throw error;
    }
  }
}
