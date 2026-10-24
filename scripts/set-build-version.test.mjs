import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { ciVersion } from "./set-build-version.mjs";
import { nextReleaseVersion, releaseVersion } from "./release-version.mjs";

const env = { GITHUB_REF: "refs/heads/main", GITHUB_RUN_ID: "100", GITHUB_RUN_NUMBER: "7", GITHUB_RUN_ATTEMPT: "1" };

function releaseFixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "emc2-release-retry-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const gitEnv = { ...process.env, GIT_AUTHOR_NAME: "Example", GIT_AUTHOR_EMAIL: "example@example.test", GIT_COMMITTER_NAME: "Example", GIT_COMMITTER_EMAIL: "example@example.test" };
  const git = (...args) => execFileSync("git", args, { cwd: dir, env: gitEnv, encoding: "utf8", stdio: "pipe" }).trim();
  const dependencies = { example: "1.0.0" };
  const pkg = JSON.stringify({ version: "0.1.10", build: {}, dependencies });
  const lock = JSON.stringify({ version: "0.1.10", packages: { "": { version: "0.1.10", dependencies } } });
  const restore = () => {
    writeFileSync(path.join(dir, "package.json"), pkg);
    writeFileSync(path.join(dir, "package-lock.json"), lock);
  };
  restore();
  git("init", "--quiet");
  git("add", "package.json", "package-lock.json");
  git("commit", "--quiet", "-m", "Synthetic previous source");
  const previous = git("rev-parse", "HEAD");
  git("tag", "v0.1.12");
  git("commit", "--quiet", "--allow-empty", "-m", "Synthetic release source");
  const source = git("rev-parse", "HEAD");
  const run = (script, input = {}) => execFileSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url))], { cwd: dir, env: { ...process.env, ...env, EMC2_BUILD_REF: source, EMC2_RELEASE_VERSION: "", ...input }, encoding: "utf8", stdio: "pipe" }).trim();
  const select = () => run("./release-version.mjs");
  const stamp = (version, input = {}) => run("./set-build-version.mjs", { EMC2_RELEASE_VERSION: version, ...input });
  const assertUnchanged = () => {
    assert.equal(readFileSync(path.join(dir, "package.json"), "utf8"), pkg);
    assert.equal(readFileSync(path.join(dir, "package-lock.json"), "utf8"), lock);
  };
  const assertStamped = (version, attempt) => {
    const stamped = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
    const stampedLock = JSON.parse(readFileSync(path.join(dir, "package-lock.json"), "utf8"));
    assert.equal(stamped.version, version);
    assert.equal(stampedLock.version, version);
    assert.equal(stampedLock.packages[""].version, version);
    assert.deepEqual(stamped.dependencies, dependencies);
    assert.deepEqual(stampedLock.packages[""].dependencies, dependencies);
    assert.equal(stamped.build.buildNumber, "7");
    assert.equal(stamped.build.buildVersion, `7.${attempt}`);
    assert.equal(git("rev-parse", "HEAD"), source);
  };
  return { git, previous, source, restore, select, stamp, assertUnchanged, assertStamped };
}

for (const retry of ["full-run", "build-job"]) {
  for (const annotated of [false, true]) {
    test(`automatic ${retry} retry reuses its ${annotated ? "annotated" : "lightweight"} tag at the source commit`, (t) => {
      const fixture = releaseFixture(t);
      const selected = fixture.select();
      assert.equal(selected, "0.1.13");
      fixture.stamp(selected);
      fixture.assertStamped("0.1.13", "1");
      // Publication creates the tag, then fails. A retry checks out fresh source.
      fixture.git("tag", ...(annotated ? ["-a", "-m", "Synthetic automatic release"] : []), `v${selected}`);
      for (const laterRelease of [false, true]) {
        fixture.restore();
        if (laterRelease) fixture.git("tag", "v0.1.20", fixture.previous);
        const retried = retry === "full-run" ? fixture.select() : selected;
        assert.equal(retried, "0.1.13");
        fixture.assertUnchanged();
        fixture.stamp(retried, { GITHUB_RUN_ATTEMPT: "2" });
        fixture.assertStamped("0.1.13", "2");
      }
      assert.equal(fixture.git("rev-parse", `refs/tags/v${selected}^{commit}`), fixture.source);
    });
  }
}

test("automatic stamping rejects a different source commit before writing", (t) => {
  const fixture = releaseFixture(t);
  assert.throws(() => fixture.stamp("0.1.13", { EMC2_BUILD_REF: fixture.previous }));
  fixture.assertUnchanged();
});

test("tags on another commit advance selection and cannot authorize an older build version", (t) => {
  const fixture = releaseFixture(t);
  fixture.git("tag", "v0.1.13", fixture.previous);
  assert.equal(fixture.select(), "0.1.14");
  assert.throws(() => fixture.stamp("0.1.13"));
  fixture.assertUnchanged();
  fixture.stamp("0.1.14");
  fixture.assertStamped("0.1.14", "1");
});

test("manual builds still reject automatic tags whose version differs from source", (t) => {
  const fixture = releaseFixture(t);
  fixture.git("tag", "v0.1.13");
  assert.throws(() => fixture.stamp("", { EMC2_BUILD_REF: "refs/tags/v0.1.13" }));
  fixture.assertUnchanged();
});

test("CI versions change with each run and rerun; releases match their tag", () => {
  assert.equal(ciVersion("0.1.3", env), "0.1.3-ci.100.1");
  assert.equal(ciVersion("0.1.3", { ...env, GITHUB_RUN_ID: "101" }), "0.1.3-ci.101.1");
  assert.equal(ciVersion("0.1.3", { ...env, GITHUB_RUN_ATTEMPT: "2" }), "0.1.3-ci.100.2");
  assert.equal(ciVersion("0.1.3", { ...env, GITHUB_REF: "refs/tags/v0.1.3" }), "0.1.3");
  assert.throws(() => ciVersion("0.1.3", { ...env, GITHUB_REF: "refs/tags/v0.1.2" }));
  assert.throws(() => ciVersion("0.1.3", { ...env, GITHUB_RUN_ATTEMPT: "0" }));
});

test("reusable release builds use the checked-out tag instead of the caller's branch", () => {
  for (const EMC2_BUILD_REF of ["v0.1.3", "refs/tags/v0.1.3"])
    assert.equal(ciVersion("0.1.3", { ...env, EMC2_BUILD_REF }), "0.1.3");
  for (const EMC2_BUILD_REF of ["v0.1.2", "refs/tags/v0.1.2"])
    assert.throws(() => ciVersion("0.1.3", { ...env, EMC2_BUILD_REF }), /Release tag must match/);
  for (const EMC2_BUILD_REF of ["refs/heads/main", "1234567890abcdef"])
    assert.equal(ciVersion("0.1.3", { ...env, GITHUB_REF: "refs/tags/v0.1.2", EMC2_BUILD_REF }), "0.1.3-ci.100.1");
});

test("automatic releases select the next patch above both source version and stable tags", () => {
  assert.equal(nextReleaseVersion("0.1.10", ["v0.1.9", "v0.1.12", "v0.1.12-rc.1", "junk"]), "0.1.13");
  assert.equal(nextReleaseVersion("0.1.12", ["v0.1.9"]), "0.1.13");
  const automatic = { EMC2_BUILD_REF: "a".repeat(40), EMC2_RELEASE_VERSION: "0.1.13" };
  assert.equal(ciVersion("0.1.10", automatic, ["v0.1.12"]), "0.1.13");
  for (const EMC2_RELEASE_VERSION of ["9.9.9", "0.1.12"])
    assert.throws(() => ciVersion("0.1.10", { ...automatic, EMC2_RELEASE_VERSION }, ["v0.1.12"]), /next unused patch/);
  for (const EMC2_BUILD_REF of [undefined, "refs/heads/main", "v0.1.9", "refs/tags/v0.1.10"])
    assert.throws(() => ciVersion("0.1.10", { ...automatic, EMC2_BUILD_REF }, ["v0.1.12"]), /commit SHA/);
});

test("automatic retries reuse only newer stable source tags, choosing the highest numerically", () => {
  const tags = ["v0.1.12", "v0.2.0"];
  assert.equal(releaseVersion("0.1.10", tags, ["v0.1.10", "v0.1.9", "v0.1.13-rc.1", "v01.1.13", "v9007199254740992.0.0"]), "0.2.1");
  assert.equal(releaseVersion("0.1.10", tags, ["v0.1.13", "v0.1.20"]), "0.1.20");
});

test("automatic CLI stamps the selected version and rejects invalid input before writes", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "emc2-release-version-"));
  try {
    const dependencies = { example: "1.0.0" };
    const pkg = JSON.stringify({ version: "0.1.10", build: {}, dependencies });
    const lock = JSON.stringify({ version: "0.1.10", packages: { "": { version: "0.1.10", dependencies } } });
    writeFileSync(path.join(dir, "package.json"), pkg);
    writeFileSync(path.join(dir, "package-lock.json"), lock);
    const gitEnv = { ...process.env, GIT_AUTHOR_NAME: "Example", GIT_AUTHOR_EMAIL: "example@example.test", GIT_COMMITTER_NAME: "Example", GIT_COMMITTER_EMAIL: "example@example.test" };
    const git = (...args) => execFileSync("git", args, { cwd: dir, env: gitEnv, encoding: "utf8" });
    git("init", "--quiet");
    git("commit", "--quiet", "--allow-empty", "-m", "Synthetic release source");
    git("tag", "v0.1.12");
    git("commit", "--quiet", "--allow-empty", "-m", "Next synthetic release source");
    const automatic = { ...process.env, ...env, EMC2_BUILD_REF: git("rev-parse", "HEAD").trim(), EMC2_RELEASE_VERSION: "0.1.13" };
    const script = fileURLToPath(new URL("./set-build-version.mjs", import.meta.url));
    for (const input of [{ ...automatic, EMC2_RELEASE_VERSION: "0.1.12" }, { ...automatic, EMC2_BUILD_REF: "refs/tags/v0.1.10" }]) {
      assert.throws(() => execFileSync(process.execPath, [script], { cwd: dir, env: input, stdio: "pipe" }));
      assert.equal(readFileSync(path.join(dir, "package.json"), "utf8"), pkg);
      assert.equal(readFileSync(path.join(dir, "package-lock.json"), "utf8"), lock);
    }
    assert.equal(execFileSync(process.execPath, [fileURLToPath(new URL("./release-version.mjs", import.meta.url))], { cwd: dir, encoding: "utf8" }).trim(), "0.1.13");
    execFileSync(process.execPath, [script], { cwd: dir, env: automatic, stdio: "pipe" });
    const stamped = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
    const stampedLock = JSON.parse(readFileSync(path.join(dir, "package-lock.json"), "utf8"));
    assert.equal(stamped.version, "0.1.13");
    assert.equal(stampedLock.version, stamped.version);
    assert.equal(stampedLock.packages[""].version, stamped.version);
    assert.deepEqual(stamped.dependencies, dependencies);
    assert.deepEqual(stampedLock.packages[""].dependencies, dependencies);
    assert.equal(stamped.build.buildVersion, "7.1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI updates both lockfile versions and native build metadata without changing dependencies", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "emc2-version-"));
  try {
    for (const [EMC2_BUILD_REF, expected] of [["", "0.1.3-ci.100.1"], ["v0.1.3", "0.1.3"], ["refs/tags/v0.1.3", "0.1.3"]]) {
      const dependencies = { example: "1.0.0" };
      writeFileSync(path.join(dir, "package.json"), JSON.stringify({ version: "0.1.3", build: {}, dependencies }));
      writeFileSync(path.join(dir, "package-lock.json"), JSON.stringify({ version: "0.1.3", packages: { "": { version: "0.1.3", dependencies } } }));
      execFileSync(process.execPath, [fileURLToPath(new URL("./set-build-version.mjs", import.meta.url))], { cwd: dir, env: { ...process.env, ...env, EMC2_BUILD_REF } });
      const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
      const lock = JSON.parse(readFileSync(path.join(dir, "package-lock.json"), "utf8"));
      assert.equal(pkg.version, expected);
      assert.equal(lock.version, pkg.version);
      assert.equal(lock.packages[""].version, pkg.version);
      assert.deepEqual(pkg.dependencies, dependencies);
      assert.deepEqual(lock.packages[""].dependencies, dependencies);
      assert.equal(pkg.build.buildNumber, "7");
      assert.equal(pkg.build.buildVersion, "7.1");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
