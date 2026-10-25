import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdtemp, open, rm, statfs } from "node:fs/promises";
import path from "node:path";
import { isHigherStableVersion, versionParts } from "../shared/updates.js";
import { canonicalDirectory, runBounded, type Run } from "./mac-source-update.js";

const repository = "collection-of-things/aggregate-mail";
export const macReleaseApi = `https://api.github.com/repos/${repository}/releases/latest`;
type Asset = { name: string; size: number; browser_download_url: string };
export type MacInstallerCandidate = { version: string; arch: "x64" | "arm64"; asset: Asset; sha256: string };
export type MacInstallerInstallation = { downloads: string; home: string; quit: () => void };
export class MacInstallerFailure extends Error {
  constructor() { super("mac-installer-update"); }
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
  private handedOff = false;
  private pending = new Set<Promise<void>>();
  constructor(readonly candidate: MacInstallerCandidate, private installation: MacInstallerInstallation, private run: Run = runBounded) {}
  private get env(): NodeJS.ProcessEnv {
    return { HOME: this.installation.home, PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LANG: "en_US.UTF-8" };
  }
  private track(operation: Promise<void>) {
    this.pending.add(operation);
    return operation.finally(() => { this.pending.delete(operation); });
  }
  stop() { if (!this.handedOff) this.abort.abort(); }
  async dispose() {
    this.stop();
    await Promise.allSettled(this.pending);
    if (this.workspace && !this.handedOff) await rm(this.workspace, { recursive: true, force: true });
  }
  download() { return this.track(this.downloadInstaller()); }
  private async downloadInstaller() {
    try {
      const { downloads } = this.installation;
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
    } catch (error) {
      if (this.workspace) await rm(this.workspace, { recursive: true, force: true });
      this.workspace = undefined;
      throw error;
    }
  }
  verify() { return this.track(this.verifyInstaller()); }
  private async verifyInstaller() {
    if (!this.workspace || !this.quarantine) throw invalid();
    await canonicalDirectory(this.workspace);
    const file = path.join(this.workspace, this.candidate.asset.name);
    await verifyDmg(file, this.candidate, this.abort.signal);
    if (await this.run("/usr/bin/xattr", ["-p", "com.apple.quarantine", file], this.workspace, this.env, this.abort.signal) !== this.quarantine) throw invalid();
  }
  install() { return this.track(this.openInstaller()); }
  private async openInstaller() {
    await this.verify();
    const file = path.join(this.workspace!, this.candidate.asset.name);
    // Deliberately open only the disk image. Finder and macOS own replacement and app trust acceptance.
    await this.run("/usr/bin/open", [file], this.workspace!, this.env, this.abort.signal);
    this.handedOff = true;
    this.installation.quit();
  }
}
