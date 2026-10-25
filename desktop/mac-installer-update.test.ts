import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { MacInstallerUpdate, macInstallerCandidate, verifyDmg, type MacInstallerCandidate } from "./mac-installer-update.js";
import type { Run } from "./mac-source-update.js";

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

test("binary adapter uses only built-in tools, quarantines and rechecks before opening only the DMG", async () => {
  for (const mode of ["success", "tamper", "quarantine-lost", "download-failure", "open-failure", "old-curl", "stop"] as const) {
    const dir = await realpath(await mkdtemp(path.join(tmpdir(), "emc2-dmg-flow-")));
    const calls: string[] = [];
    let file = "", quarantine = "", quit = false;
    const run: Run = async (command, args, cwd, env, signal) => {
      signal.throwIfAborted(); calls.push(command);
      assert.deepEqual(Object.keys(env).sort(), ["HOME", "LANG", "PATH"]);
      assert.equal(env.PATH, "/usr/bin:/bin:/usr/sbin:/sbin");
      assert.equal(path.dirname(cwd), dir);
      if (command === "/usr/bin/curl") {
        assert.equal(args[0], "--disable", "ignore user curl configuration");
        if (args.includes("--version")) return mode === "old-curl" ? "curl 8.3.0" : "curl 8.7.1";
        assert.equal(args[args.indexOf("--max-filesize") + 1], String(bytes.length));
        assert.equal(args[args.indexOf("--proto-redir") + 1], "=https");
        file = args[args.indexOf("--output") + 1];
        await writeFile(file, bytes);
        if (mode === "download-failure") throw Error("network failure");
      } else if (command === "/usr/bin/xattr") {
        if (args[0] === "-w") quarantine = args[2];
        else return mode === "quarantine-lost" ? "" : quarantine;
      } else if (command === "/usr/bin/open") {
        assert.deepEqual(args, [file]);
        if (mode === "open-failure") throw Error("open failure");
      } else assert.fail("Unexpected tool");
      return "";
    };
    const update = new MacInstallerUpdate(candidate, { downloads: dir, home: dir, quit: () => { quit = true; } }, run);
    try {
      if (mode === "download-failure" || mode === "old-curl") {
        await assert.rejects(update.download()); assert.deepEqual(await readdir(dir), []); continue;
      }
      await update.download();
      assert.match(quarantine, /^0083;[a-f0-9]+;Emc2;$/);
      assert.equal(quit, false);
      if (mode === "tamper") await writeFile(file, Buffer.alloc(bytes.length));
      if (mode === "stop") update.stop();
      if (mode === "success") {
        await update.verify(); await update.install();
        assert.equal(quit, true); await update.dispose();
        assert.deepEqual(await readFile(file), bytes, "successful handoff retains installer");
      } else {
        await assert.rejects(update.install()); assert.equal(quit, false);
        if (mode !== "open-failure") assert.ok(!calls.includes("/usr/bin/open"));
        await update.dispose(); assert.deepEqual(await readdir(dir), []);
      }
    } finally { await update.dispose(); await rm(dir, { recursive: true, force: true }); }
  }
});
