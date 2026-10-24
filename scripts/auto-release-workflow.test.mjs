import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";

const workflow = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const job = (name) => workflow.slice(workflow.indexOf(`\n  ${name}:\n`) + 1).split(/\n  (?=[a-z0-9-]+:\n)/)[0];

test("only the budgeted CI and release workflows remain", () => {
  assert.deepEqual(readdirSync(new URL("../.github/workflows/", import.meta.url)).sort(), ["ci.yml", "release.yml"]);
  const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.deepEqual(ci.match(/runs-on: \S+/g), ["runs-on: ubuntu-latest", "runs-on: ubuntu-latest", "runs-on: blacksmith-2vcpu-ubuntu-2404"]);
  assert.match(ci, /types: \[labeled, synchronize, reopened\]/);
  assert.match(ci, /contains\(github\.event\.pull_request\.labels\.\*\.name, 'ci'\)/);
  assert.match(ci, /MAX_RUNS: 150/);
  assert.match(ci, /actions\/workflows\/ci\.yml\/disable/);
  assert.match(ci, /cancel-in-progress: true/);
  assert.doesNotMatch(ci, /\n  (push|schedule|merge_group|workflow_call):/);
  assert.equal(existsSync(new URL("../.github/dependabot.yml", import.meta.url)), false);
  const triggers = workflow.split("\non:\n")[1].split("\npermissions:")[0];
  assert.match(triggers, /^  push:\n    branches: \[main\]\n    paths-ignore:\n/);
  assert.match(triggers, /\n  workflow_dispatch:\n/);
  assert.doesNotMatch(workflow, /workflow_call|inputs\.|pull_request|merge_group|schedule:/);
  assert.doesNotMatch(workflow, /npm version|git tag|git commit|git push/);
  assert.match(job("checks"), /!contains\(github\.event\.head_commit\.message, '\[skip release\]'\)/);
  assert.match(job("checks"), /run: echo "version=\$\(node scripts\/release-version\.mjs\)" >> "\$GITHUB_OUTPUT"/);
});

test("manual release requires an existing stable tag at the immutable build commit", { skip: process.platform === "win32" }, () => {
  const checks = job("checks");
  assert.match(checks, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(checks, /fetch-depth: 0/);
  assert.ok(checks.indexOf("name: Require an existing stable version tag") < checks.indexOf("name: Run actionlint"));
  const command = checks.match(/- name: Require an existing stable version tag\n        if: github.event_name == 'workflow_dispatch'\n        shell: bash\n        run: \|\n([\s\S]*?)(?=      - )/)[1].replace(/^ {10}/gm, "");
  const dir = mkdtempSync(path.join(tmpdir(), "emc2-release-tag-"));
  try {
    const env = { ...process.env, GIT_AUTHOR_NAME: "Example", GIT_AUTHOR_EMAIL: "example@example.test", GIT_COMMITTER_NAME: "Example", GIT_COMMITTER_EMAIL: "example@example.test" };
    const git = (...args) => execFileSync("git", args, { cwd: dir, env, encoding: "utf8", stdio: "pipe" }).trim();
    git("init", "--quiet");
    git("commit", "--quiet", "--allow-empty", "-m", "Synthetic release source");
    const sha = git("rev-parse", "HEAD");
    for (const tag of ["v0.1.11", "v01.1.11", "v0.1.11-beta.1"]) git("tag", tag);
    const run = (ref, commit = sha) => execFileSync("bash", ["-e", "-o", "pipefail", "-c", command], { cwd: dir, env: { ...env, GITHUB_REF: ref, GITHUB_SHA: commit }, stdio: "pipe" });
    run("refs/tags/v0.1.11");
    git("tag", "-a", "v0.1.12", "-m", "Synthetic annotated tag");
    run("refs/tags/v0.1.12");
    for (const ref of ["refs/heads/main", "refs/tags/v01.1.11", "refs/tags/v0.1.11-beta.1", "refs/tags/v0.1.99"]) {
      assert.throws(() => run(ref), undefined, ref);
    }
    git("commit", "--quiet", "--allow-empty", "-m", "Another synthetic source");
    assert.throws(() => run("refs/tags/v0.1.11", git("rev-parse", "HEAD")));
    assert.equal(git("rev-parse", "refs/tags/v0.1.11^{commit}"), sha);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("every platform tests and packages with its existing architecture and runner", () => {
  const platforms = [
    ["linux", "linux-x64", "ubuntu-latest", "--linux AppImage --x64"],
    ["windows", "windows-x64", "blacksmith-4vcpu-windows-2025", "--win nsis --x64"],
    ["macos-arm64", "macos-arm64", "blacksmith-6vcpu-macos-15", "--mac dmg --arm64"],
    ["macos-x64", "macos-x64", "blacksmith-6vcpu-macos-15", "--mac dmg --x64"],
  ];
  for (const [key, platform, runner, args] of platforms) {
    const body = job(key);
    assert.match(body, /needs: checks\n/);
    assert.ok(body.includes(`name: Test and package (${platform})`), key);
    assert.ok(body.includes(`PLATFORM: ${platform}\n`), key);
    assert.ok(body.includes(`runs-on: ${runner}\n`), key);
    assert.ok(body.includes(`BUILDER_ARGS: ${args}\n`), key);
    assert.match(body, /timeout-minutes: 30/);
    assert.match(body, /CSC_IDENTITY_AUTO_DISCOVERY: "false"/);
    assert.match(body, key === "linux" ? /steps: &platform-steps/ : /steps: \*platform-steps/, key);
    if (key.startsWith("macos")) assert.match(body, /shell: bash --noprofile --norc -eo pipefail \{0\}/);
    if (key !== "linux") assert.doesNotMatch(body, /\n    if:/);
  }
  const steps = job("linux");
  assert.match(steps, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(steps, /EMC2_BUILD_REF: \$\{\{ github\.event_name == 'push' && github\.sha \|\| github\.ref \}\}/);
  assert.match(steps, /EMC2_RELEASE_VERSION: \$\{\{ needs\.checks\.outputs\.version \}\}/);
  assert.match(steps, /run: node scripts\/set-build-version\.mjs/);
  assert.match(steps, /- run: npm ci --no-audit --no-fund\n      - if: runner.os == 'Linux'\n        run: npm test\n      - run: npm run build/);
  assert.match(steps, /name: Check desktop startup\n        if: runner.os != 'Linux'/);
  assert.match(steps, /--user-data-dir="\$\{\{ runner.temp \}\}\/emc2-check"/);
  assert.match(steps, /name: Install Rosetta for x64 builds\n        if: env.NODE_ARCH == 'x64' && runner.os == 'macOS'/);
  assert.match(steps, /architecture: \$\{\{ env\.NODE_ARCH \}\}/);
  assert.match(steps, /process\.arch !== 'x64'/);
  assert.match(job("macos-x64"), /NODE_ARCH: x64/);
});

test("failed workflow or tag checks fail the required Linux job before checkout", () => {
  const linux = job("linux");
  assert.match(linux, /needs: checks\n    if: always\(\) && needs\.checks\.result != 'skipped'/);
  const guard = linux.match(/- name: Require successful checks\n        if: ([^\n]+)\n        run: ([^\n]+)/);
  assert.ok(guard, "shared steps must reject an unsuccessful Checks job");
  assert.ok(linux.indexOf(guard[0]) < linux.indexOf("uses: actions/checkout@"));
  assert.equal(guard[2], "exit 1");
  for (const result of ["success", "failure", "cancelled", "skipped"]) {
    assert.equal(vm.runInNewContext(guard[1], { needs: { checks: { result } } }), result !== "success");
  }
});

test("release checks retain pinned actions, Node and checksum-verified actionlint", () => {
  const pins = {
    "actions/checkout": "3d3c42e5aac5ba805825da76410c181273ba90b1",
    "actions/setup-node": "949feb2413d6458794dcd2491c4babbbce0c15c1",
    "actions/cache": "55cc8345863c7cc4c66a329aec7e433d2d1c52a9",
    "actions/upload-artifact": "cf430e030ddbb5b0abf93d22962f4752f3646cd9",
    "actions/download-artifact": "9000827ccba6bdab643e8b6fd33ac0654aef8333",
  };
  const actions = [...workflow.matchAll(/uses: ([\w/-]+)@(\S+)/g)];
  assert.deepEqual([...new Set(actions.map(([, name]) => name))].sort(), Object.keys(pins).sort());
  for (const [, name, sha] of actions) assert.equal(sha, pins[name], name);
  assert.match(workflow, /node-version-file: \.nvmrc/);
  assert.equal(readFileSync(new URL("../.nvmrc", import.meta.url), "utf8").trim(), "24.22.1");
  const checks = job("checks");
  assert.match(checks, /releases\/download\/v1\.7\.12\/actionlint_1\.7\.12_linux_amd64\.tar\.gz/);
  assert.match(checks, /8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8[^\n]+sha256sum --check --strict/);
});

test("installer steps preserve unpublished builds and updater integrity before upload", () => {
  const steps = job("linux");
  assert.equal((steps.match(/electron-builder \$\{\{ env.BUILDER_ARGS \}\} --publish never/g) ?? []).length, 2);
  assert.match(steps, /name: Create installer\n        if: runner.os != 'macOS'/);
  assert.match(steps, /name: Create installer \(macOS, with hdiutil retry\)\n        if: runner.os == 'macOS'/);
  assert.match(steps, /name: Verify updater metadata and installer integrity\n        if: runner.os != 'macOS'/);
  assert.ok(steps.indexOf("scripts/check-release-assets.ts") < steps.indexOf("name: Upload installer"));
  assert.match(steps, /if-no-files-found: error\n          retention-days: 1\n          compression-level: 0\n          overwrite: true/);
  assert.match(steps, /release\/\*\.AppImage\n        release\/latest-linux.yml/);
  assert.match(job("windows"), /release\/\*\.exe\n        release\/latest.yml/);
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(pkg.scripts.test, /^tsx --test --test-concurrency=1 --test-timeout=120000 /);
  assert.equal(pkg.build.afterPack, "scripts/sign-mac.cjs");
  assert.equal(pkg.build.mac.identity, null);
  assert.equal(pkg.build.mac.notarize, false);
  assert.equal(pkg.build.dmg.sign, false);
  assert.doesNotMatch(workflow, /TEST_SHARD|check-runs|id: plan/);
  assert.match(steps, /key: electron-\$\{\{ runner\.os \}\}-\$\{\{ env\.NODE_ARCH \|\| runner\.arch \}\}/);
});

test("publication needs all four successful builds and validates artifacts before publishing", () => {
  const publish = job("publish");
  const builds = workflow.slice(0, workflow.indexOf("\n  publish:"));
  assert.match(builds, /permissions:\n  contents: read/);
  assert.doesNotMatch(builds, /contents: write/);
  assert.match(publish, /needs: \[checks, linux, windows, macos-arm64, macos-x64\]/);
  assert.match(publish, /if: github.event_name == 'push' \|\| startsWith\(github.ref, 'refs\/tags\/v'\)/);
  assert.doesNotMatch(publish, /always\(|continue-on-error/);
  assert.match(publish, /permissions:\n      contents: write/);
  assert.ok(publish.indexOf("actions/checkout@") < publish.indexOf("actions/download-artifact@"));
  assert.match(publish, /digest-mismatch: error/);
  assert.ok(publish.indexOf("node scripts/prepare-release-assets.mjs") < publish.indexOf("gh release create"));
  assert.match(publish, /prepare-release-assets.mjs release "\$\{RELEASE_VERSION:-\$\{GITHUB_REF_NAME#v\}\}"/);
  assert.ok(publish.indexOf("name: Create the release tag") < publish.indexOf("gh release create"));
  assert.match(publish, /test "\$sha" = "\$GITHUB_SHA"/);
  assert.match(publish, /gh release create "\$\{TAG\}"/);
  assert.match(publish, /\.\/\*\.exe \.\/\*\.dmg \.\/\*\.AppImage latest.yml latest-linux.yml SHA256SUMS.txt/);
  assert.match(publish, /--verify-tag/);
  assert.doesNotMatch(publish, /sha256sum/);
  assert.match(workflow, /group: release\n/);
  assert.match(workflow, /cancel-in-progress: false/);
});
