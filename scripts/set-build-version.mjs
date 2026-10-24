import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { releaseTags, releaseVersion } from "./release-version.mjs";

export function ciVersion(version, env, tags = [], sourceTags = []) {
  assert.match(version, /^\d+\.\d+\.\d+$/, "Commit a release version before building");
  const ref = env.EMC2_BUILD_REF || env.GITHUB_REF;
  if (env.EMC2_RELEASE_VERSION) {
    assert.match(ref ?? "", /^[0-9a-f]{40}$/, "Automatic release requires a commit SHA");
    assert.match(env.EMC2_RELEASE_VERSION, /^\d+\.\d+\.\d+$/, "Invalid automatic release version");
    assert.equal(env.EMC2_RELEASE_VERSION, releaseVersion(version, tags, sourceTags), "Automatic release must reuse its source tag or use the next unused patch version");
    return env.EMC2_RELEASE_VERSION;
  }
  if (ref?.startsWith("refs/tags/") || /^v\d+\.\d+\.\d+$/.test(ref ?? "")) {
    assert.ok(ref === `v${version}` || ref === `refs/tags/v${version}`, "Release tag must match package.json");
    return version;
  }
  for (const key of ["GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"])
    assert.match(env[key] ?? "", /^[1-9]\d*$/, `${key} must be a positive integer`);
  return `${version}-ci.${env.GITHUB_RUN_ID}.${env.GITHUB_RUN_ATTEMPT}`;
}

if (import.meta.main) {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[""].version, pkg.version);
  if (process.env.EMC2_RELEASE_VERSION) {
    const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    assert.equal(process.env.EMC2_BUILD_REF || process.env.GITHUB_REF, head, "Automatic release source must match HEAD");
  }
  const { tags, sourceTags } = process.env.EMC2_RELEASE_VERSION ? releaseTags() : { tags: [], sourceTags: [] };
  const version = ciVersion(pkg.version, process.env, tags, sourceTags);
  for (const key of ["GITHUB_RUN_NUMBER", "GITHUB_RUN_ATTEMPT"])
    assert.match(process.env[key] ?? "", /^[1-9]\d*$/, `${key} must be a positive integer`);
  pkg.version = lock.version = lock.packages[""].version = version;
  pkg.build.buildNumber = process.env.GITHUB_RUN_NUMBER;
  pkg.build.buildVersion = `${process.env.GITHUB_RUN_NUMBER}.${process.env.GITHUB_RUN_ATTEMPT}`;
  writeFileSync("package.json", `${JSON.stringify(pkg, null, 2)}\n`);
  writeFileSync("package-lock.json", `${JSON.stringify(lock, null, 2)}\n`);
  console.log(`Build version: ${version} (${pkg.build.buildVersion})`);
}
