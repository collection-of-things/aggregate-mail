import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { bundleDigest, canonicalDirectory, runBounded, validateDestination, type Run } from "./mac-source-update.js";
import { versionParts } from "../shared/updates.js";

async function waitForParentExit(parent: number, signal: AbortSignal) {
  const deadline = Date.now() + 60000;
  while (true) {
    signal.throwIfAborted();
    try { process.kill(parent, 0); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return; throw error; }
    if (Date.now() >= deadline) throw invalid();
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

export type BinaryCandidate = { version: string; arch: "arm64" | "x64" };
export type BinaryReplacement = { parent: number; installed: string; home: string; workspace: string;
  candidate: BinaryCandidate; digest: string; quarantine: string; profile?: string };
const invalid = () => new Error("mac-binary-replacement");
export const binaryEnvironment = (home: string): NodeJS.ProcessEnv => ({ HOME: home, PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LANG: "en_US.UTF-8" });
export const binaryWorkspacePrefix = (installed: string) => `.${path.basename(installed)}.update-`;
export const validQuarantine = (value: string) => /^0083;[a-f0-9]+;Emc2;$/.test(value);

// Published installers contain one thin Mach-O architecture. Do not invoke lipo or require developer tools.
async function verifyArchitecture(executable: string, arch: BinaryCandidate["arch"]) {
  const before = await lstat(executable);
  if (!before.isFile() || before.isSymbolicLink()) throw invalid();
  const file = await open(executable, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat(), header = Buffer.alloc(32);
    if (stat.ino !== before.ino || stat.dev !== before.dev || !stat.isFile() ||
        (await file.read(header, 0, header.length, 0)).bytesRead !== header.length ||
        header.readUInt32LE(0) !== 0xfeedfacf || header.readUInt32LE(4) !== (arch === "arm64" ? 0x0100000c : 0x01000007)) throw invalid();
  } finally { await file.close(); }
}

export async function verifyBinaryBundle(bundle: string, candidate: BinaryCandidate, quarantine: string,
  cwd: string, env: NodeJS.ProcessEnv, signal: AbortSignal, run: Run = runBounded) {
  if (!versionParts(candidate.version, true) || !["arm64", "x64"].includes(candidate.arch) || !validQuarantine(quarantine)) throw invalid();
  await canonicalDirectory(bundle);
  if (await run("/usr/bin/xattr", ["-p", "com.apple.quarantine", bundle], cwd, env, signal) !== quarantine) throw invalid();
  await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", bundle], cwd, env, signal);
  const plist = path.join(bundle, "Contents/Info.plist");
  for (const [field, expected] of [["CFBundleIdentifier", "dev.screen.aggregate-mail"], ["CFBundleShortVersionString", candidate.version], ["CFBundleExecutable", "Emc²"]]) {
    if (await run("/usr/bin/plutil", ["-extract", field, "raw", "-o", "-", plist], cwd, env, signal) !== expected) throw invalid();
  }
  await verifyArchitecture(path.join(bundle, "Contents/MacOS/Emc²"), candidate.arch);
  return bundleDigest(bundle, signal);
}

export async function validateBinaryReplacement(value: unknown, parent: number): Promise<BinaryReplacement> {
  const request = value as BinaryReplacement;
  if (!request || Object.keys(request).some(key => !["parent", "installed", "home", "workspace", "candidate", "digest", "quarantine", "profile"].includes(key)) ||
      request.parent !== parent || !Number.isSafeInteger(parent) || parent < 2 || typeof request.installed !== "string" ||
      typeof request.workspace !== "string" || path.dirname(request.workspace) !== path.dirname(request.installed) ||
      !path.basename(request.workspace).startsWith(binaryWorkspacePrefix(request.installed)) ||
      typeof request.digest !== "string" || !/^[a-f0-9]{128}$/.test(request.digest) ||
      !request.candidate || Object.keys(request.candidate).sort().join(",") !== "arch,version" ||
      !versionParts(request.candidate.version, true) || !["arm64", "x64"].includes(request.candidate.arch) ||
      typeof request.quarantine !== "string" || !validQuarantine(request.quarantine) ||
      (request.profile !== undefined && (typeof request.profile !== "string" || !path.isAbsolute(request.profile) ||
        path.normalize(request.profile) !== request.profile || request.profile.includes("\0")))) throw invalid();
  await canonicalDirectory(request.home);
  await canonicalDirectory(request.workspace);
  const stat = await lstat(request.workspace);
  if (stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o700) throw invalid();
  await validateDestination(request.installed);
  return request;
}

export async function revealBinaryRecovery(request: Pick<BinaryReplacement, "workspace" | "home">, run: Run = runBounded, original?: string) {
  const env = binaryEnvironment(request.home), signal = new AbortController().signal;
  const backup = path.join(request.workspace, "previous.app");
  const target = original ?? await lstat(backup).then(() => backup, () => request.workspace);
  await run("/usr/bin/open", ["-R", target], request.workspace, env, signal).catch(() => {});
  const message = original
    ? 'display dialog "The update could not start. Your existing Emc² app is selected in Finder. Open it to continue. Your saved mail has not been removed." buttons {"OK"} default button "OK" with title "Emc² update" giving up after 60'
    : 'display dialog "Emc² could not confirm the updated app opened. Your update recovery files are selected in Finder. Keep both app copies and stop if macOS blocks the update. Your saved mail has not been removed." buttons {"OK"} default button "OK" with title "Emc² update" giving up after 60';
  await run("/usr/bin/osascript", ["-e", message],
    request.workspace, env, signal, 65000).catch(() => {});
}

export async function replaceBinaryAndLaunch(request: BinaryReplacement, run: Run = runBounded,
  signal = new AbortController().signal, launch: (command: string, args: string[], options: SpawnOptions) => ChildProcess = spawn) {
  const { workspace, installed, candidate, quarantine } = request;
  const stage = path.join(workspace, "staged.app"), backup = path.join(workspace, "previous.app"), env = binaryEnvironment(request.home);
  let backedUp = false, promoted = false, dispatched = false;
  const receipt = (state: string) => writeFile(path.join(workspace, "result.json"),
    JSON.stringify({ kind: "mac-binary-update", format: 1, state, installed, version: candidate.version, arch: candidate.arch, digest: request.digest, profile: request.profile ?? null }) + "\n", { mode: 0o600 });
  try {
    if (await verifyBinaryBundle(stage, candidate, quarantine, workspace, env, signal, run) !== request.digest) throw invalid();
    await validateDestination(installed);
    if (await lstat(backup).then(() => true, error => { if (error.code === "ENOENT") return false; throw error; })) throw invalid();
    await rename(installed, backup); backedUp = true;
    await rename(stage, installed); promoted = true;
    if (await verifyBinaryBundle(installed, candidate, quarantine, workspace, env, signal, run) !== request.digest) throw invalid();
    const args = request.profile ? ["--args", `--user-data-dir=${request.profile}`] : [];
    const child = launch("/usr/bin/open", ["-n", installed, ...args], { detached: true, cwd: path.dirname(installed), env, stdio: "ignore" });
    const exit = new Promise<number | null | undefined>(resolve => {
      const timer = setTimeout(() => resolve(undefined), 5000);
      child.once("exit", code => { clearTimeout(timer); resolve(code); });
      child.once("error", () => { clearTimeout(timer); resolve(null); });
    });
    await new Promise<void>((resolve, reject) => { child.once("error", reject); child.once("spawn", () => { dispatched = true; resolve(); }); });
    await receipt("launch-dispatching");
    const code = await exit;
    const state = code === 0 ? "launch-dispatched" : code === undefined ? "launch-uncertain-retained-backup" : "launch-dispatch-failed";
    await receipt(state); child.unref();
    if (code !== 0) await revealBinaryRecovery(request, run);
  } catch (error) {
    let restored = !backedUp;
    if (!dispatched && backedUp) {
      try {
        if (promoted) await rename(installed, stage);
        await rename(backup, installed);
        restored = true;
      } catch { restored = false; }
    }
    const state = dispatched ? "launch-uncertain-retained-backup" : !restored ? "rollback-failed-before-start" :
      backedUp ? "rolled-back-before-start" : "failed-before-start";
    // Recovery must remain visible even when restoring or writing its receipt fails.
    await receipt(state).catch(() => {});
    await revealBinaryRecovery(request, run, !dispatched && restored ? installed : undefined).catch(() => {});
    throw error;
  }
}

export async function runBinaryHelper() {
  if (process.platform !== "darwin" || !process.send || process.env.ELECTRON_RUN_AS_NODE !== "1" || !process.versions.electron) throw invalid();
  const abort = new AbortController();
  process.once("SIGTERM", () => abort.abort());
  const raw = await new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => reject(invalid()), 10000);
    process.once("message", value => { clearTimeout(timer); resolve(value); });
  });
  const request = await validateBinaryReplacement(raw, process.ppid);
  if (process.execPath !== path.join(request.installed, "Contents/MacOS/Emc²") ||
      await verifyBinaryBundle(path.join(request.workspace, "staged.app"), request.candidate, request.quarantine,
        request.workspace, binaryEnvironment(request.home), abort.signal) !== request.digest) throw invalid();
  process.send!("ready");
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(invalid()), 10000);
    process.once("message", value => { clearTimeout(timer); if (value === "commit") resolve(); else reject(invalid()); });
    process.once("disconnect", () => { clearTimeout(timer); reject(invalid()); });
    abort.signal.addEventListener("abort", () => { clearTimeout(timer); reject(invalid()); }, { once: true });
  });
  abort.signal.throwIfAborted(); process.send!("armed");
  await waitForParentExit(request.parent, abort.signal);
  await replaceBinaryAndLaunch(request, undefined, abort.signal);
}
