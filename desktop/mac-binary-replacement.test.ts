import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { build } from "esbuild";
import { bundleDigest, type Run } from "./mac-source-update.js";
import { binaryWorkspacePrefix, replaceBinaryAndLaunch, validateBinaryReplacement, verifyBinaryBundle, type BinaryReplacement } from "./mac-binary-replacement.js";

const candidate = { version: "0.2.11", arch: "arm64" as const }, quarantine = "0083;123abc;Emc2;";
type Launch = NonNullable<Parameters<typeof replaceBinaryAndLaunch>[3]>;
async function fixture() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "emc2-binary-helper-")));
  const installed = path.join(root, "Installed.app"), profile = path.join(root, "profile");
  await mkdir(installed); await writeFile(path.join(installed, "old"), "original app");
  await mkdir(profile); await writeFile(path.join(profile, "key.protected"), "unchanged synthetic protected bytes");
  const workspace = await mkdtemp(path.join(root, binaryWorkspacePrefix(installed))); await chmod(workspace, 0o700);
  const stage = path.join(workspace, "staged.app"); await mkdir(path.join(stage, "Contents/MacOS"), { recursive: true });
  await writeFile(path.join(stage, "Contents/Info.plist"), "synthetic");
  const header = Buffer.alloc(32); header.writeUInt32LE(0xfeedfacf, 0); header.writeUInt32LE(0x0100000c, 4);
  await writeFile(path.join(stage, "Contents/MacOS/Emc²"), header, { mode: 0o755 });
  const calls: { command: string; args: string[] }[] = [];
  const run: Run = async (command, args) => {
    calls.push({ command, args });
    if (command.endsWith("xattr")) return quarantine;
    if (command.endsWith("codesign") || command.endsWith("open") || command.endsWith("osascript")) return "";
    if (command.endsWith("plutil")) return ({ CFBundleIdentifier: "dev.screen.aggregate-mail", CFBundleShortVersionString: candidate.version, CFBundleExecutable: "Emc²" } as Record<string, string>)[args[1]];
    throw Error("Unexpected native command");
  };
  const request: BinaryReplacement = { parent: process.pid, installed, home: root, workspace, candidate, quarantine, profile, digest: await bundleDigest(stage) };
  return { root, installed, profile, workspace, stage, request, run, calls, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("binary helper validates private sibling workspace, exact candidate, quarantine and parent", async () => {
  const f = await fixture();
  try {
    if (process.platform !== "win32") assert.deepEqual(await validateBinaryReplacement(f.request, process.pid), f.request);
    for (const changes of [{ parent: process.pid + 1 }, { workspace: f.root }, { digest: "bad" }, { quarantine: "" },
      { candidate: { ...candidate, arch: "ia32" } }, { candidate: { ...candidate, url: "foreign" } }, { profile: "relative" }, { extra: true }])
      await assert.rejects(validateBinaryReplacement({ ...f.request, ...changes }, process.pid));
    if (process.platform !== "win32") {
      await chmod(f.workspace, 0o755); await assert.rejects(validateBinaryReplacement(f.request, process.pid));
    }
  } finally { await f.cleanup(); }
});

test("binary validation rejects unsupported Mach-O, wrong architecture, signature and quarantine without developer tools", async () => {
  const f = await fixture();
  const verify = (run = f.run) => verifyBinaryBundle(f.stage, candidate, quarantine, f.workspace, {}, new AbortController().signal, run);
  try {
    assert.equal(await verify(), f.request.digest);
    assert.ok(f.calls.every(call => !/lipo|xcrun|git|node|npm/.test(call.command)));
    await assert.rejects(verify(async (command, ...args) => command.endsWith("xattr") ? "missing" : f.run(command, ...args)));
    await assert.rejects(verify(async (command, ...args) => { if (command.endsWith("codesign")) throw Error("bad signature"); return f.run(command, ...args); }));
    const executable = path.join(f.stage, "Contents/MacOS/Emc²"), original = await readFile(executable);
    for (const header of [Buffer.alloc(32), (() => { const h = Buffer.from(original); h.writeUInt32LE(0x01000007, 4); return h; })()]) {
      await writeFile(executable, header); await assert.rejects(verify());
    }
  } finally { await f.cleanup(); }
});

test("binary replacement retains backup and profile, rechecks promoted quarantine and uses normal LaunchServices", async () => {
  const f = await fixture();
  try {
    const launch: Launch = (command, args, options) => {
      assert.equal(command, "/usr/bin/open");
      assert.deepEqual(args, ["-n", f.installed, "--args", `--user-data-dir=${f.profile}`]);
      assert.deepEqual(Object.keys(options.env ?? {}).sort(), ["HOME", "LANG", "PATH"]);
      return spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
    };
    await replaceBinaryAndLaunch(f.request, f.run, undefined, launch);
    assert.equal(await readFile(path.join(f.workspace, "previous.app/old"), "utf8"), "original app");
    assert.equal(await readFile(path.join(f.profile, "key.protected"), "utf8"), "unchanged synthetic protected bytes");
    assert.ok(f.calls.some(call => call.command.endsWith("xattr") && call.args.at(-1) === f.installed));
    assert.ok(!f.calls.some(call => call.command.endsWith("open")), "success does not reveal Finder recovery");
    const result = JSON.parse(await readFile(path.join(f.workspace, "result.json"), "utf8"));
    assert.equal(result.state, "launch-dispatched"); assert.equal(result.profile, f.profile); assert.equal(result.digest, f.request.digest);
    assert.equal(result.kind, "mac-binary-update"); assert.equal(result.format, 1);
  } finally { await f.cleanup(); }
});

test("known pre-dispatch failure rolls back, while dispatched failure keeps both apps and reveals recovery", async () => {
  for (const mode of ["spawn", "dispatch"]) {
    const f = await fixture();
    try {
      const launch: Launch = () => mode === "spawn" ? spawn(path.join(f.root, "missing"), [], { stdio: "ignore" }) :
        spawn(process.execPath, ["-e", "process.exit(12)"], { stdio: "ignore" });
      if (mode === "spawn") {
        await assert.rejects(replaceBinaryAndLaunch(f.request, f.run, undefined, launch));
        assert.equal(await readFile(path.join(f.installed, "old"), "utf8"), "original app");
        assert.ok(f.calls.some(call => call.command.endsWith("open") && call.args.join("|") === ["-R", f.installed].join("|")));
      } else {
        await replaceBinaryAndLaunch(f.request, f.run, undefined, launch);
        assert.ok((await readdir(f.installed)).includes("Contents"));
        assert.equal(await readFile(path.join(f.workspace, "previous.app/old"), "utf8"), "original app");
        assert.ok(f.calls.some(call => call.command.endsWith("open") && call.args[0] === "-R"));
        assert.ok(f.calls.some(call => call.command.endsWith("osascript")));
      }
      assert.equal(JSON.parse(await readFile(path.join(f.workspace, "result.json"), "utf8")).state,
        mode === "spawn" ? "rolled-back-before-start" : "launch-dispatch-failed");
    } finally { await f.cleanup(); }
  }
});

test("stage tamper, backup collision and symlink destinations never replace the installed app", async () => {
  for (const mode of ["tamper", "backup", "symlink"]) {
    const f = await fixture();
    try {
      if (mode === "tamper") await writeFile(path.join(f.stage, "Contents/Info.plist"), "changed");
      if (mode === "backup") await mkdir(path.join(f.workspace, "previous.app"));
      if (mode === "symlink") {
        if (process.platform === "win32") continue;
        const actual = path.join(f.root, "actual.app"); await mkdir(actual); await rm(f.installed, { recursive: true }); await symlink(actual, f.installed);
      }
      await assert.rejects(replaceBinaryAndLaunch(f.request, f.run));
      assert.equal(await readFile(path.join(f.profile, "key.protected"), "utf8"), "unchanged synthetic protected bytes");
    } finally { await f.cleanup(); }
  }
});

test("bundling the ordinary updater does not execute the replacement helper bootstrap", async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "emc2-binary-entry-")));
  try {
    const outfile = path.join(root, "normal.cjs");
    await build({ stdin: { contents: 'import {MacInstallerUpdate} from "./desktop/mac-installer-update"; console.log(typeof MacInstallerUpdate, "ordinary-import");',
      resolveDir: process.cwd(), loader: "ts" }, outfile, bundle: true, platform: "node", format: "cjs", packages: "external" });
    const child = spawnSync(process.execPath, [outfile], { encoding: "utf8", timeout: 10000 });
    assert.equal(child.status, 0, child.stderr); assert.match(child.stdout, /function ordinary-import/);
  } finally { await rm(root, { recursive: true, force: true }); }
});


test("rollback failure still reveals the retained original app", async () => {
  const f = await fixture();
  try {
    const run: Run = async (command, ...args) => {
      if (command.endsWith("xattr") && args[0].at(-1) === f.installed) {
        await mkdir(f.stage);
        await writeFile(path.join(f.stage, "blocks-rollback"), "synthetic collision");
        throw Error("synthetic promoted verification failure");
      }
      return f.run(command, ...args);
    };
    await assert.rejects(replaceBinaryAndLaunch(f.request, run));
    assert.equal(await readFile(path.join(f.workspace, "previous.app/old"), "utf8"), "original app");
    assert.ok(f.calls.some(call => call.command.endsWith("open") &&
      call.args.join("|") === ["-R", path.join(f.workspace, "previous.app")].join("|")), "retained original is revealed even when rollback fails");
    assert.ok(f.calls.some(call => call.command.endsWith("osascript")));
  } finally { await f.cleanup(); }
});

test("receipt write failures cannot suppress recovery before or after dispatch", async (t) => {
  for (const mode of ["before", "after"]) await t.test(mode, async () => {
    const f = await fixture();
    let exited = Promise.resolve();
    try {
      await mkdir(path.join(f.workspace, "result.json"));
      const launch: Launch = () => {
        const child = mode === "before" ? spawn(path.join(f.root, "missing"), [], { stdio: "ignore" }) :
          spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
        exited = new Promise(resolve => { child.once("exit", () => resolve()); child.once("close", () => resolve()); });
        return child;
      };
      await assert.rejects(replaceBinaryAndLaunch(f.request, f.run, undefined, launch));
      const target = mode === "before" ? f.installed : path.join(f.workspace, "previous.app");
      assert.equal(await readFile(path.join(target, "old"), "utf8"), "original app");
      assert.ok(f.calls.some(call => call.command.endsWith("open") && call.args.join("|") === ["-R", target].join("|")), "recovery does not depend on its receipt being writable");
      assert.ok(f.calls.some(call => call.command.endsWith("osascript")));
    } finally { await exited; await f.cleanup(); }
  });
});
