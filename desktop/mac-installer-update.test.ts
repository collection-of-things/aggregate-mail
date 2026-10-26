import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, cp, mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { MacInstallerUpdate, macInstallerCandidate, verifyDmg, type MacInstallerCandidate, type MacInstallerInstallation } from "./mac-installer-update.js";
import { bundleDigest, type Run } from "./mac-source-update.js";

const bytes = Buffer.from("synthetic disk image, never mounted");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const root = "https://github.com/collection-of-things/aggregate-mail/releases/download/v0.2.8/";
const asset = (name: string, size = bytes.length) => ({ name, size, browser_download_url: root + name });
const name = "Emc2-0.2.8-mac-arm64.dmg";
const release = () => ({ draft: false, prerelease: false, tag_name: "v0.2.8", assets: [asset(name), asset("Emc2-0.2.8-mac-x64.dmg"), asset("SHA256SUMS.txt", 528)] });
const sums = `${sha256}  ${name}\n${"b".repeat(64)}  Emc2-0.2.8-mac-x64.dmg\n`;
const target = { version: "0.2.5", arch: "arm64" };
const candidate: MacInstallerCandidate = { version: "0.2.8", arch: "arm64", asset: asset(name), sha256 };

test("published DMG and SHA256SUMS selection follows the running process architecture including Rosetta", async () => {
  const urls: string[] = [];
  assert.deepEqual(await macInstallerCandidate(release(), target, async (url, limit) => {
    urls.push(url); assert.equal(limit, 65536); return sums;
  }), candidate);
  assert.deepEqual(urls, [root + "SHA256SUMS.txt"]);
  assert.equal((await macInstallerCandidate(release(), { ...target, arch: "x64" }, async () => sums))?.sha256, "b".repeat(64));
  assert.equal(await macInstallerCandidate(release(), { ...target, version: "0.2.8" }, async () => { throw Error("no read"); }), null);
  assert.equal(await macInstallerCandidate(release(), { ...target, version: "0.2.9" }, async () => sums), null);
});

test("candidate preflight rejects malformed, foreign, missing and ambiguous releases and checksums", async () => {
  for (const value of [null, { ...release(), draft: true }, { ...release(), prerelease: true },
    { ...release(), tag_name: "v00.2.8" }, { ...release(), tag_name: "v0.2.8-ci.1" },
    { ...release(), assets: [asset(name)] },
    { ...release(), assets: [...release().assets, asset(name)] },
    { ...release(), assets: [...release().assets, asset("Other-0.2.8-mac-arm64.dmg")] },
    { ...release(), assets: release().assets.map(item => ({ ...item, browser_download_url: item.browser_download_url.replace("collection-of-things", "screen-devs") })) },
    { ...release(), assets: [asset(name, 1024 ** 3 + 1), asset("SHA256SUMS.txt")] },
    { ...release(), assets: [asset(name), asset("SHA256SUMS.txt", 65537)] }]) {
    await assert.rejects(macInstallerCandidate(value, target, async () => sums));
  }
  for (const raw of ["", "not a checksum", `${sums}${sha256}  ${name}\n`, `${sha256}  ../${name}\n`, `${sha256}  other.dmg\n`])
    await assert.rejects(macInstallerCandidate(release(), target, async () => raw));
  for (const value of [{ ...target, arch: "ia32" }, { ...target, version: "broken" }])
    await assert.rejects(macInstallerCandidate(release(), value, async () => sums));
});

test("DMG byte verification rejects tampering, truncation, symlinks and cancellation", async () => {
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), "emc2-dmg-")));
  const file = path.join(dir, name);
  try {
    await writeFile(file, bytes); await verifyDmg(file, candidate);
    await assert.rejects(verifyDmg(file, candidate, AbortSignal.abort()));
    await writeFile(file, Buffer.alloc(bytes.length)); await assert.rejects(verifyDmg(file, candidate));
    await writeFile(file, "short"); await assert.rejects(verifyDmg(file, candidate));
    if (process.platform !== "win32") {
      await symlink(file, path.join(dir, "link.dmg"));
      await assert.rejects(verifyDmg(path.join(dir, "link.dmg"), candidate));
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

async function binaryFixture(mode = "success") {
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), "emc2-dmg-flow-")));
  const installed = path.join(dir, "Installed.app"), helper = path.join(dir, "helper.cjs");
  await mkdir(installed); await writeFile(path.join(installed, "old"), "previous app"); await writeFile(helper, "synthetic helper");
  const calls: { command: string; args: string[]; signal: AbortSignal }[] = [], quarantines = new Map<string, string>();
  let file = "", update: MacInstallerUpdate;
  const run: Run = async (command, args, _cwd, env, signal) => {
    signal.throwIfAborted(); calls.push({ command, args, signal });
    assert.deepEqual(Object.keys(env).sort(), ["HOME", "LANG", "PATH"]);
    assert.equal(env.PATH, "/usr/bin:/bin:/usr/sbin:/sbin");
    if (command.endsWith("curl")) {
      assert.equal(args[0], "--disable");
      if (args.includes("--version")) return mode === "old-curl" ? "curl 8.3.0" : "curl 8.7.1";
      assert.equal(args[args.indexOf("--max-filesize") + 1], String(bytes.length));
      assert.equal(args[args.indexOf("--proto-redir") + 1], "=https");
      file = args[args.indexOf("--output") + 1]; await writeFile(file, bytes);
      if (mode === "download-failure") throw Error("download failed");
    } else if (command.endsWith("xattr")) {
      if (args[0] === "-w") quarantines.set(args[3], args[2]);
      else return quarantines.get(args[2]) ?? "";
    } else if (command.endsWith("hdiutil")) {
      if (args[0] === "attach") {
        const bundle = path.join(args[args.indexOf("-mountpoint") + 1], "Emc².app");
        await mkdir(path.join(bundle, "Contents/MacOS"), { recursive: true });
        await writeFile(path.join(bundle, "Contents/Info.plist"), "synthetic");
        const header = Buffer.alloc(32); header.writeUInt32LE(0xfeedfacf, 0); header.writeUInt32LE(0x0100000c, 4);
        await writeFile(path.join(bundle, "Contents/MacOS/Emc²"), header, { mode: 0o755 });
        assert.ok(args.includes("-readonly") && args.includes("-nobrowse"));
      }
    } else if (command.endsWith("ditto")) await cp(args[2], args[3], { recursive: true, preserveTimestamps: true });
    else if (command.endsWith("codesign")) {
      if (mode === "signature") throw Error("bad signature");
      if (mode === "cancel-mounted") { update.stop(); signal.throwIfAborted(); }
    } else if (command.endsWith("plutil")) return ({ CFBundleIdentifier: "dev.screen.aggregate-mail", CFBundleShortVersionString: candidate.version, CFBundleExecutable: "Emc²" } as Record<string, string>)[args[1]];
    else if (!command.endsWith("open") && !command.endsWith("osascript")) assert.fail("Unexpected tool " + command);
    return "";
  };
  let quit = false;
  const installation: MacInstallerInstallation = { downloads: dir, home: dir, installed, helper, runtime: path.join(installed, "Contents/MacOS/Emc²"), version: "0.2.5", quit: () => { quit = true; } };
  update = new MacInstallerUpdate(candidate, installation, run, (command, args, options) => {
    assert.equal(command, installation.runtime); assert.equal(options.env?.ELECTRON_RUN_AS_NODE, "1");
    assert.equal(args[0], path.join(options.cwd!.toString(), "replace.cjs"));
    return spawn(process.execPath, ["-e", 'process.on("message",v=>{if(v==="commit")process.send("armed");else process.send("ready")});process.on("disconnect",()=>process.exit(0))'], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
  });
  return { dir, installed, helper, installation, update, calls, quarantines, get file() { return file; }, get quit() { return quit; },
    cleanup: async () => { await update.dispose(); await rm(dir, { recursive: true, force: true }); } };
}

test("download prepares a verified app for automatic replacement without opening Finder", async () => {
  const f = await binaryFixture();
  try {
    await f.update.download();
    assert.ok(f.calls.some(call => call.command === "/usr/bin/hdiutil" && call.args[0] === "attach"));
    assert.ok(f.calls.some(call => call.command === "/usr/bin/hdiutil" && call.args[0] === "detach"));
    assert.ok(!f.calls.some(call => call.command === "/usr/bin/open"));
    const stage = [...f.quarantines.keys()].find(file => file.endsWith("staged.app"))!;
    assert.equal(f.quarantines.get(stage), f.quarantines.get(f.file), "copy preserves explicit image quarantine");
    assert.ok((await readdir(stage)).includes("Contents"));
    await f.update.verify(); await f.update.install(); assert.equal(f.quit, true);
    await f.update.dispose();
    assert.equal(await readFile(path.join(f.installed, "old"), "utf8"), "previous app", "helper waits for parent exit before replacement");
    assert.ok((await readdir(f.dir)).some(name => name.startsWith(".Installed.app.update-")), "armed stage is retained for helper");
    assert.ok(!(await readdir(f.dir)).some(name => name.startsWith("Emc2-update-")), "download is cleaned after handoff");
  } finally { await f.cleanup(); }
});

test("download failures, signature rejection and cancellation detach and clean without quitting", async () => {
  for (const mode of ["download-failure", "old-curl", "signature", "cancel-mounted"]) {
    const f = await binaryFixture(mode);
    try {
      await assert.rejects(f.update.download()); assert.equal(f.quit, false);
      assert.equal(await readFile(path.join(f.installed, "old"), "utf8"), "previous app");
      if (mode === "signature" || mode === "cancel-mounted") {
        const detach = f.calls.find(call => call.command.endsWith("hdiutil") && call.args[0] === "detach");
        assert.ok(detach); assert.equal(detach.signal.aborted, false, "cleanup uses an independent signal");
      }
      assert.ok(!(await readdir(f.dir)).some(name => name.startsWith("Emc2-update-") || name.startsWith(".Installed.app.update-")));
    } finally { await f.cleanup(); }
  }
});

test("stage, image and quarantine tampering stop handoff before quit", async () => {
  for (const mode of ["image", "stage", "quarantine", "cancel"]) {
    const f = await binaryFixture();
    try {
      await f.update.download();
      const stage = [...f.quarantines.keys()].find(file => file.endsWith("staged.app"))!;
      if (mode === "image") await writeFile(f.file, Buffer.alloc(bytes.length));
      if (mode === "stage") await writeFile(path.join(stage, "Contents/Info.plist"), "tampered");
      if (mode === "quarantine") f.quarantines.delete(stage);
      if (mode === "cancel") f.update.stop();
      await assert.rejects(f.update.install()); assert.equal(f.quit, false);
    } finally { await f.cleanup(); }
  }
});

test("only a successfully started exact running app and profile can retire its prior backup", async () => {
  for (const mode of ["success", "uncertain", "wrong-digest", "wrong-profile"]) {
    const f = await binaryFixture();
    const workspace = await mkdtemp(path.join(f.dir, ".Installed.app.update-")); await chmod(workspace, 0o700);
    await mkdir(path.join(workspace, "previous.app")); await writeFile(path.join(workspace, "previous.app/keep"), "prior app");
    await writeFile(path.join(workspace, "result.json"), JSON.stringify({ kind: "mac-binary-update", format: 1,
      state: mode === "uncertain" ? "launch-uncertain-retained-backup" : "launch-dispatched", installed: f.installed,
      version: f.installation.version, arch: candidate.arch, digest: mode === "wrong-digest" ? "a".repeat(128) : await bundleDigest(f.installed),
      profile: mode === "wrong-profile" ? path.join(f.dir, "other-profile") : null }), { mode: 0o600 });
    try {
      if (mode === "success") {
        await f.update.download(); assert.ok(!(await readdir(f.dir)).includes(path.basename(workspace)));
      } else {
        await assert.rejects(f.update.download(), error => (error as { reason?: string }).reason === "installer-target");
        assert.equal(await readFile(path.join(workspace, "previous.app/keep"), "utf8"), "prior app");
        assert.ok(f.calls.some(call => call.command.endsWith("open") && call.args[0] === "-R"));
      }
    } finally { await f.cleanup(); }
  }
});

test("a quit exception waits for the armed helper to close before cleanup and restoration", async () => {
  const f = await binaryFixture();
  try {
    await f.update.download();
    f.installation.quit = () => { throw Error("synthetic quit exception"); };
    await assert.rejects(f.update.install());
    await f.update.dispose();
    assert.ok(!(await readdir(f.dir)).some(name => name.startsWith(".Installed.app.update-")));
    assert.equal(await readFile(path.join(f.installed, "old"), "utf8"), "previous app");
  } finally { await f.cleanup(); }
});
