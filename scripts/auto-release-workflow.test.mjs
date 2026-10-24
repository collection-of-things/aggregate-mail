import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";

const workflow = readFileSync(new URL("../.github/workflows/auto-release.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("automatic release builds the triggering SHA and writes its tag only after builds pass", () => {
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}[\s\S]*release_version:/);
  assert.match(workflow, /needs: \[version, build\]/);
  assert.ok(workflow.indexOf("needs: [version, build]") < workflow.indexOf("name: Create the release tag"));
  assert.match(workflow, /git push origin "refs\/tags\/\$\{TAG\}"/);
  assert.doesNotMatch(workflow, /npm version|git commit|HEAD:main|git push origin[^\n]*main/);
});

test("publication preserves downloaded artifacts and grants write access only to publishing", () => {
  const publish = workflow.slice(workflow.indexOf("\n  publish:"));
  assert.ok(publish.indexOf("actions/checkout@") < publish.indexOf("actions/download-artifact@"));
  assert.match(workflow.slice(0, workflow.indexOf("\n  publish:")), /permissions:\n  contents: read/);
  assert.doesNotMatch(workflow.slice(0, workflow.indexOf("\n  publish:")), /contents: write/);
  assert.ok(publish.indexOf("node scripts/prepare-release-assets.mjs") < publish.indexOf("git tag"));
  assert.match(workflow, /!startsWith\(github.event.head_commit.message, 'Release '\)/);
});

test("the publishing tag command retries the same commit and rejects a different commit", { skip: process.platform === "win32" }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "emc2-release-tag-"));
  try {
    const source = path.join(dir, "source");
    const remote = path.join(dir, "remote.git");
    execFileSync("git", ["init", "--bare", "--quiet", remote]);
    execFileSync("git", ["init", "--quiet", source]);
    const env = { ...process.env, GIT_AUTHOR_NAME: "Example", GIT_AUTHOR_EMAIL: "example@example.test", GIT_COMMITTER_NAME: "Example", GIT_COMMITTER_EMAIL: "example@example.test" };
    const git = (...args) => execFileSync("git", args, { cwd: source, env, encoding: "utf8", stdio: "pipe" }).trim();
    git("remote", "add", "origin", remote);
    git("commit", "--quiet", "--allow-empty", "-m", "Synthetic release source");
    const sha = git("rev-parse", "HEAD");
    const command = workflow.match(/- name: Create the release tag[\s\S]*?run: \|\n([\s\S]*?)(?=      - name: Publish the release)/)[1].replace(/^ {10}/gm, "");
    const run = (commit) => execFileSync("bash", ["-e", "-c", command], { cwd: source, env: { ...env, RELEASE_VERSION: "0.1.11", GITHUB_SHA: commit }, stdio: "pipe" });
    run(sha);
    assert.equal(git("--git-dir", remote, "rev-parse", "refs/tags/v0.1.11^{commit}"), sha);
    run(sha);
    git("commit", "--quiet", "--allow-empty", "-m", "Another synthetic source");
    assert.throws(() => run(git("rev-parse", "HEAD")));
    assert.equal(git("--git-dir", remote, "rev-parse", "refs/tags/v0.1.11^{commit}"), sha);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});


test("release-only skip marker leaves ordinary CI active", () => {
  const predicate = workflow.match(/  version:\n(?:    #[^\n]*\n)*    if: "([^"\n]+)"/)[1];
  // Evaluate the actual workflow expression with GitHub's case-insensitive
  // string functions, rather than testing a duplicate release policy.
  const eligible = (message) => vm.runInNewContext(predicate, {
    github: { event: { head_commit: { message } } },
    startsWith: (a, b) => a.toLowerCase().startsWith(b.toLowerCase()),
    contains: (a, b) => a.toLowerCase().includes(b.toLowerCase()),
  }, { timeout: 1000 });
  for (const message of ["chore: upgrade CI [skip release]", "Merge PR #69\n\n[skip release]", "[SKIP RELEASE] CI", "Release 0.2.0"]) {
    assert.equal(eligible(message), false, message);
  }
  for (const message of ["fix: mail rendering", "chore: upgrade CI", "skip release", "Release-notes update"]) {
    assert.equal(eligible(message), true, message);
  }
  assert.match(workflow, /  build:\n    needs: version/);
  assert.match(workflow, /  publish:\n    needs: \[version, build\]/);
  assert.doesNotMatch(workflow, /always\(\)/);
  const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(ci, /on:\n  pull_request:\n  push:\n    branches: \[main\]/);
  assert.doesNotMatch(ci, /skip release|head_commit|paths-ignore/);
  assert.match(ci, /  test:\n    needs: \[plan, workflows\]/);
  assert.match(ci, /  package:\n    needs: \[plan, workflows\]/);
});

test("required platform checks pass only when validation, every shard and every needed installer did", () => {
  const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const result = ci.slice(ci.indexOf("\n  result:"));
  assert.match(result, /needs: \[plan, workflows, test, package\]/);
  assert.match(result, /name: Test and package \(\$\{\{ matrix\.platform \}\}\)/);
  assert.match(result, /platform: \[windows-x64, macos-arm64, macos-x64, linux-x64\]/);
  for (const line of ['test "$PLAN" = success', 'test "$WORKFLOWS" = success',
    'if [ "$REUSE" = true ]; then test "$TEST" = skipped; else test "$TEST" = success; fi',
    'if [ "$PACKAGE" = true ]; then test "$PACKAGED" = success; else test "$PACKAGED" = skipped; fi']) assert.ok(result.includes(line), line);
  for (const platform of ["windows-x64", "macos-arm64", "macos-x64", "linux-x64"])
    assert.match(ci.slice(ci.indexOf("\n  test:"), ci.indexOf("\n  package:")), new RegExp(`platform: ${platform},.*shard: 1,`));
});

test("tests are reused only for a pushed commit that passed all four platforms", { skip: process.platform === "win32" }, () => {
  const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const script = ci.match(/      - id: plan\n[\s\S]*?        run: \|\n([\s\S]*?)\n\n/)[1].replace(/^ {10}/gm, "");
  const dir = mkdtempSync(path.join(tmpdir(), "emc2-ci-plan-"));
  try {
    // A fake gh resolves the commit and lists the given successful check names.
    const gh = path.join(dir, "gh");
    execFileSync("bash", ["-c", `printf '%s\\n' '#!/usr/bin/env bash' 'case "$*" in *check-runs*) printf "%s\\n" "$FAKE_CHECKS";; *) echo 0123abcd;; esac' > "${gh}" && chmod +x "${gh}"`]);
    const all = ["windows-x64", "macos-arm64", "macos-x64", "linux-x64"].map((platform) => `Test and package (${platform})`);
    const plan = (event, checks, extra = {}) => {
      const output = path.join(dir, "output");
      execFileSync("bash", ["-e", "-c", `: > "${output}"\n${script}`], { env: { ...process.env, PATH: `${dir}:${process.env.PATH}`,
        GITHUB_OUTPUT: output, GITHUB_REPOSITORY: "example/repo", EVENT: event, REF: "0123abcd", GIT_REF: "refs/heads/main",
        RELEASE_VERSION: "", FAKE_CHECKS: checks.join("\n"), ...extra }, stdio: "pipe" });
      return Object.fromEntries(readFileSync(output, "utf8").trim().split("\n").map((line) => line.split("=")));
    };
    assert.deepEqual(plan("push", all), { reuse: "true", package: "false" });
    assert.deepEqual(plan("push", all, { RELEASE_VERSION: "1.2.3" }), { reuse: "true", package: "true" });
    assert.deepEqual(plan("push", all.slice(1)), { reuse: "false", package: "false" });
    assert.deepEqual(plan("push", ["build / Test and package (windows-x64)", ...all.slice(1)]), { reuse: "false", package: "false" });
    assert.deepEqual(plan("push", all, { GIT_REF: "refs/tags/v1.2.3" }), { reuse: "true", package: "true" });
    assert.deepEqual(plan("pull_request", all), { reuse: "false", package: "true" });
    assert.deepEqual(plan("workflow_dispatch", all), { reuse: "false", package: "true" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("both publication lanes validate the exact asset set before publishing", () => {
  for (const name of ["auto-release", "release"]) {
    const source = readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
    const publish = source.slice(source.indexOf("\n  publish:"));
    assert.ok(publish.indexOf("actions/checkout@") < publish.indexOf("actions/download-artifact@"));
    assert.match(publish, /digest-mismatch: error/);
    assert.ok(publish.indexOf("node scripts/prepare-release-assets.mjs") < publish.indexOf("gh release create"));
    assert.doesNotMatch(publish, /sha256sum/);
  }
  const manual = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(manual, /group: manual-release-\$\{\{ github.ref \}\}/);
  assert.match(manual, /cancel-in-progress: false/);
});
