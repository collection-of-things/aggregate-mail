import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile, rename, symlink, readlink, rm, realpath, mkdtemp } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const repository = "https://github.com/collection-of-things/aggregate-mail.git";
const api = "https://api.github.com/repos/collection-of-things/aggregate-mail/releases/latest";
const sha = /^[a-f0-9]{40}$/;
const stable = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const json = async file => JSON.parse(await readFile(file, "utf8"));
async function optional(file) { try { return await json(file); } catch (error) { if (error.code === "ENOENT") return undefined; throw error; } }
async function atomic(file, value) {
  await writeFile(`${file}.new`, JSON.stringify(value) + "\n", { mode: 0o600 });
  await rename(`${file}.new`, file);
}
export function releaseTag(release) {
  if (!release || release.draft !== false || release.prerelease !== false || !Number.isFinite(Date.parse(release.published_at)) || !stable.test(release.tag_name))
    throw new Error("No valid published stable release.");
  return release.tag_name;
}
export function newer(tag, installed) {
  const a = stable.exec(tag), b = stable.exec(installed);
  if (!a || !b) throw new Error("Invalid stable version.");
  for (let i = 1; i <= 3; i++) { if (BigInt(a[i]) !== BigInt(b[i])) return BigInt(a[i]) > BigInt(b[i]); }
  return false;
}
export async function latestRelease() {
  const response = await fetch(api, { redirect: "error", signal: AbortSignal.timeout(15_000), headers: { Accept: "application/vnd.github+json" } });
  if (!response.ok) throw new Error("Published release lookup failed.");
  return releaseTag(await response.json());
}
export function buildEnvironment(home) {
  // The build has its own HOME and receives no inherited mail, npm or Git secrets.
  return { PATH: process.env.PATH, HOME: home, TMPDIR: home, CI: "true", NODE_OPTIONS: "--max-old-space-size=2048",
    ELECTRON_SKIP_BINARY_DOWNLOAD: "1", GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
}
async function run(command, args, cwd, env) {
  try { return (await promisify(execFile)(command, args, { cwd, env, timeout: 900_000, maxBuffer: 16 * 1024 * 1024 })).stdout.trim(); }
  catch { throw new Error(`${command} step failed; service unchanged unless switch recovery is pending.`); }
}
export async function probe(port, revision, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  do {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/auth`, { redirect: "error", signal: AbortSignal.timeout(1000) });
      await response.body?.cancel();
      if (response.status === 200 && response.headers.get("x-emc2-browser") === "1" && response.headers.get("x-emc2-revision") === revision) return;
    } catch { /* Allow a starting listener to become ready within this deadline. */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  throw new Error("Served revision check failed.");
}
export async function smokeRelease(directory, revision) {
  const scratch = await mkdtemp(path.join(tmpdir(), "emc2-web-smoke-"));
  const listener = createServer();
  await new Promise((resolve, reject) => { listener.once("error", reject); listener.listen(0, "127.0.0.1", resolve); });
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const child = spawn(process.execPath, ["--import", "tsx", "scripts/start-browser.mjs"], { cwd: directory, stdio: "ignore", env: {
    ...buildEnvironment(scratch), MAIL_WEB_MANAGED: "1", MAIL_WEB_PORT: String(port), MAIL_WEB_PASSWORD: randomBytes(24).toString("base64url"),
    MAIL_DATA_KEY: randomBytes(32).toString("base64"), MAIL_DATA_DIR: path.join(scratch, "profile"), MAIL_CONFIG_PATH: path.join(scratch, "settings.env"),
  } });
  const exited = new Promise(resolve => { child.once("exit", (code, signal) => resolve({ code, signal })); child.once("error", () => resolve({ code: 1 })); });
  let timer;
  try {
    await Promise.race([probe(port, revision), exited.then(() => { throw new Error("Synthetic browser startup failed."); })]);
    const denied = await fetch(`http://127.0.0.1:${port}/api/state`, { redirect: "error", signal: AbortSignal.timeout(1000) });
    await denied.body?.cancel();
    if (denied.status !== 401) throw new Error("Synthetic browser API gate failed.");
    child.kill("SIGUSR2");
    const result = await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Synthetic browser did not drain.")), 40_000); })]);
    if (result.code !== 0) throw new Error("Synthetic browser shutdown failed.");
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; } // Synthetic process only.
    await rm(scratch, { recursive: true, force: true });
  }
}
export async function deploymentPackage(directory, tag, revision) {
  const pkg = await json(path.join(directory, "package.json"));
  const lock = await json(path.join(directory, "package-lock.json"));
  if (!sha.test(revision) || !stable.test(tag) || !stable.test(`v${pkg.version}`) || newer(`v${pkg.version}`, tag) ||
      pkg.webDeployment?.protocol !== 1 || !Number.isSafeInteger(pkg.webDeployment?.profile) || pkg.webDeployment.profile < 1 ||
      lock.version !== pkg.version || lock.packages?.[""]?.version !== pkg.version)
    throw new Error("Release lacks compatible managed web deployment support.");
  if (`v${pkg.version}` !== tag) {
    // Automatic releases tag original source; reuse the installer version contract
    // while changing only the disposable package/lock roots, never source history.
    const { ciVersion } = await import(pathToFileURL(path.join(directory, "scripts/set-build-version.mjs")));
    const version = ciVersion(pkg.version, { EMC2_BUILD_REF: revision, EMC2_RELEASE_VERSION: tag.slice(1) }, [tag], [tag]);
    pkg.version = lock.version = lock.packages[""].version = version;
    await writeFile(path.join(directory, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
    await writeFile(path.join(directory, "package-lock.json"), JSON.stringify(lock, null, 2) + "\n");
  }
  return pkg;
}
export async function prepareRelease(root, tag) {
  const home = path.join(root, "build-home");
  await mkdir(home, { recursive: true, mode: 0o700 });
  const env = buildEnvironment(home), git = path.join(root, "source.git");
  await run("git", ["init", "--bare", git], root, env);
  await run("git", ["--git-dir", git, "fetch", "--depth=1", repository, `refs/tags/${tag}:refs/tags/${tag}`], root, env);
  const revision = await run("git", ["--git-dir", git, "rev-parse", `refs/tags/${tag}^{commit}`], root, env);
  if (!sha.test(revision)) throw new Error("Invalid release commit.");
  const directory = path.join(root, "releases", revision);
  return { revision, directory, async build() {
    const existing = await optional(path.join(directory, ".web-deployment.json"));
    if (existing) {
      if (existing.tag !== tag || existing.revision !== revision) throw new Error("Existing release identity changed.");
      await smokeRelease(directory, revision);
      return;
    }
    const stage = await mkdtemp(path.join(root, "build-"));
    try {
      const archive = path.join(stage, "source.tar");
      await run("git", ["--git-dir", git, "archive", "--format=tar", `--output=${archive}`, revision], root, env);
      await run("tar", ["-xf", archive, "-C", stage], root, env);
      await rm(archive);
      const pkg = await deploymentPackage(stage, tag, revision);
      await run("npm", ["ci", "--no-audit", "--no-fund"], stage, env);
      await run("npm", ["test"], stage, env);
      await run("npm", ["run", "build:web"], stage, env);
      const build = (await readFile(path.join(stage, "dist/index.html"), "utf8")).match(/name="emc2-build" content="([a-f0-9]{64})"/)?.[1];
      if (!build) throw new Error("Release has no browser build identity.");
      await atomic(path.join(stage, ".web-deployment.json"), { revision, tag, profile: pkg.webDeployment.profile, build });
      await smokeRelease(stage, revision);
      await rename(stage, directory);
    } finally { await rm(stage, { recursive: true, force: true }); }
  } };
}
async function pointer(root, name) {
  let target;
  try { target = await readlink(path.join(root, name)); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
  if (!/^releases\/[a-f0-9]{40}$/.test(target)) throw new Error("Unsafe deployment pointer.");
  return target;
}
async function point(root, name, target) {
  if (target === null) return rm(path.join(root, name), { force: true });
  if (!/^releases\/[a-f0-9]{40}$/.test(target)) throw new Error("Unsafe deployment target.");
  await rm(path.join(root, `${name}.new`), { force: true });
  await symlink(target, path.join(root, `${name}.new`));
  await rename(path.join(root, `${name}.new`), path.join(root, name));
}
async function receipt(root, target) {
  if (!target || !/^releases\/[a-f0-9]{40}$/.test(target)) throw new Error("No valid deployment target.");
  const directory = path.join(root, target);
  if (await realpath(directory) !== directory) throw new Error("Release directories must not be symlinks.");
  const value = await json(path.join(directory, ".web-deployment.json"));
  if (!sha.test(value.revision) || target !== `releases/${value.revision}` || !stable.test(value.tag) || !Number.isSafeInteger(value.profile) || value.profile < 1)
    throw new Error("Invalid deployment receipt.");
  return value;
}
export function systemdService() {
  const env = Object.fromEntries(["PATH", "HOME", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"].flatMap(key => process.env[key] ? [[key, process.env[key]]] : []));
  return {
    async stop() {
      await run("systemctl", ["--user", "stop", "emc2-web.service"], undefined, env);
      const pid = await run("systemctl", ["--user", "show", "--property=MainPID", "--value", "emc2-web.service"], undefined, env);
      if (pid !== "0") throw new Error("Previous browser process is still running.");
    },
    async start() { await run("systemctl", ["--user", "start", "emc2-web.service"], undefined, env); },
  };
}
export async function deploy({ root, command = "update", retry = false, port = 3001, latest = latestRelease, prepare = prepareRelease, service = systemdService(), health = probe }) {
  if (!path.isAbsolute(root)) throw new Error("Deployment root must be absolute.");
  await mkdir(root, { recursive: true, mode: 0o700 });
  root = await realpath(root);
  const lock = path.join(root, "update.lock");
  try { await mkdir(lock, { mode: 0o700 }); } catch (error) { if (error.code === "EEXIST") throw new Error("Update lock exists; check for an active updater before recovery."); throw error; }
  let target;
  try {
    await mkdir(path.join(root, "releases"), { recursive: true, mode: 0o700 });
    const current = await pointer(root, "current"), previous = await pointer(root, "previous");
    const pending = await optional(path.join(root, "pending.json"));
    const failed = await optional(path.join(root, "failed.json"));
    if (command === "status") return { current: current && await receipt(root, current), previous: previous && await receipt(root, previous), pending: !!pending, failed };
    if (pending) throw new Error("Interrupted switch. Run recover before another deployment.");
    const installed = current && await receipt(root, current);
    let candidate;
    if (command === "rollback") {
      target = previous;
      candidate = await receipt(root, target);
    } else if (command === "update") {
      const tag = await latest();
      if (!stable.test(tag)) throw new Error("Invalid stable release tag.");
      if (installed && tag !== installed.tag && !newer(tag, installed.tag)) return { status: "up to date", revision: installed.revision };
      if (failed?.tag === tag && !retry) throw new Error("This release previously failed or was rolled back. An explicit retry is required.");
      const prepared = await prepare(root, tag);
      if (!sha.test(prepared.revision) || path.resolve(prepared.directory) !== path.join(root, "releases", prepared.revision)) throw new Error("Invalid prepared release.");
      if (installed?.tag === tag) {
        if (installed.revision !== prepared.revision) throw new Error("Published tag moved from its installed commit.");
        return { status: "up to date", revision: installed.revision };
      }
      target = `releases/${prepared.revision}`;
      try {
        await prepared.build();
        candidate = await receipt(root, target);
      } catch (error) {
        await atomic(path.join(root, "failed.json"), { tag, revision: prepared.revision });
        throw error;
      }
    } else throw new Error("Unknown deployment command.");
    if (installed && installed.profile !== candidate.profile) {
      await atomic(path.join(root, "failed.json"), { tag: candidate.tag, revision: candidate.revision });
      throw new Error("Profile format changed. Automatic deployment and rollback are blocked.");
    }
    await atomic(path.join(root, "pending.json"), { from: current, to: target, previous });
    let stopped = false;
    try {
      await service.stop();
      stopped = true;
      await point(root, "current", target);
      await service.start();
      await health(port, candidate.revision);
      await point(root, "previous", current);
      if (command === "rollback" && installed) await atomic(path.join(root, "failed.json"), { tag: installed.tag, revision: installed.revision });
      await rm(path.join(root, "pending.json"));
      return { status: command === "rollback" ? "rolled back" : "updated", revision: candidate.revision };
    } catch {
      await atomic(path.join(root, "failed.json"), { tag: candidate.tag, revision: candidate.revision });
      if (stopped) {
        try {
          await service.stop();
          await point(root, "current", current);
          if (installed) { await service.start(); await health(port, installed.revision); }
          await point(root, "previous", previous);
        } catch { throw new Error("Switch and recovery failed. Pending record retained; operator recovery required."); }
      }
      await rm(path.join(root, "pending.json"));
      throw new Error(stopped ? "Replacement failed; previous deployment restored." : "Service did not stop safely; current deployment unchanged.");
    }
  } finally { await rm(lock, { recursive: true, force: true }); }
}

// Recovery is explicit because an interrupted process may have left an uncertain write.
export async function recover({ root, service = systemdService(), health = probe, port = 3001 }) {
  if (!path.isAbsolute(root)) throw new Error("Deployment root must be absolute.");
  root = await realpath(root);
  const lock = path.join(root, "update.lock");
  await mkdir(lock, { mode: 0o700 });
  try {
    const pending = await optional(path.join(root, "pending.json"));
    if (!pending) return { status: "no recovery needed" };
    for (const key of ["from", "previous"]) if (pending[key] !== null && !/^releases\/[a-f0-9]{40}$/.test(pending[key] || "")) throw new Error("Invalid recovery pointer.");
    if (pending.previous) await receipt(root, pending.previous);
    const old = pending.from && await receipt(root, pending.from);
    const next = await receipt(root, pending.to);
    if (old && old.profile !== next.profile) throw new Error("Recovery profile formats differ.");
    await service.stop();
    await point(root, "current", pending.from);
    if (old) { await service.start(); await health(port, old.revision); }
    await point(root, "previous", pending.previous);
    await atomic(path.join(root, "failed.json"), { tag: next.tag, revision: next.revision });
    await rm(path.join(root, "pending.json"));
    return { status: "recovered", revision: old?.revision ?? null };
  } finally { await rm(lock, { recursive: true, force: true }); }
}
export async function assertBoundedUpdate() {
  const group = (await readFile("/proc/self/cgroup", "utf8")).trim().match(/^0::([^\n]+)$/)?.[1];
  if (!group?.endsWith("/emc2-web-update.service")) throw new Error("Run updates through emc2-web-update.service for containment.");
  const base = path.join("/sys/fs/cgroup", group);
  const memory = (await readFile(path.join(base, "memory.max"), "utf8")).trim();
  const swap = (await readFile(path.join(base, "memory.swap.max"), "utf8")).trim();
  if (!/^\d+$/.test(memory) || BigInt(memory) > 3n * 1024n ** 3n || swap !== "0") throw new Error("Updater memory/swap containment is unavailable.");
  const timeout = await run("systemctl", ["--user", "show", "--property=TimeoutStartUSec", "--value", "emc2-web-update.service"], undefined, Object.fromEntries(["PATH", "HOME", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"].flatMap(key => process.env[key] ? [[key, process.env[key]]] : [])));
  if (timeout !== "20min") throw new Error("Updater must have the reviewed 20 minute service deadline.");
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [major, minor, patch] = process.versions.node.split(".").map(Number);
    if (major !== 24 || minor < 22 || (minor === 22 && patch < 1)) throw new Error("Use Node 24.22.1 or newer 24.x.");
    if (process.platform !== "linux") throw new Error("Managed web deployment requires Linux systemd.");
    const [command, ...flags] = process.argv.slice(2);
    if (!["update", "rollback", "recover", "status"].includes(command) || flags.some(flag => flag !== "--retry")) throw new Error("Usage: node web-deploy.mjs update|rollback|recover|status [--retry]");
    const options = { command, root: path.join(homedir(), ".local/share/emc2-web"), retry: flags.includes("--retry"), port: Number(process.env.MAIL_WEB_PORT || 3001) };
    if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) throw new Error("Invalid web port.");
    if (command === "update") await assertBoundedUpdate();
    console.log(JSON.stringify(await (command === "recover" ? recover(options) : deploy(options))));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
