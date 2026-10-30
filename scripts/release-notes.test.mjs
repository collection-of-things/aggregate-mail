import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { releaseNotes } from "./release-notes.mjs";

const changelog = `# Changelog

## Unreleased

### Fixed

- Unreleased fix.

## 0.1.12 - 2026-01-02

### Fixed

- Twelve.

## 0.1.1 - 2026-01-01

### Added

- One.
`;

test("release notes use the exact CHANGELOG version section", () => {
  assert.equal(releaseNotes(changelog, "0.1.12"), "### Fixed\n\n- Twelve.\n");
  assert.equal(releaseNotes(changelog, "0.1.1"), "### Added\n\n- One.\n");
  assert.equal(releaseNotes(changelog.replace(/\n/g, "\r\n"), "0.1.1"), "### Added\n\n- One.\n");
});

test("manual releases require their section; push releases may use Unreleased", () => {
  assert.throws(() => releaseNotes(changelog, "0.1.13"), /no release notes for 0\.1\.13/);
  assert.equal(releaseNotes(changelog, "0.1.13", { allowUnreleased: true }), "### Fixed\n\n- Unreleased fix.\n");
  assert.equal(releaseNotes(changelog, "0.1.12", { allowUnreleased: true }), "### Fixed\n\n- Twelve.\n");
  const empty = changelog.replace("### Fixed\n\n- Unreleased fix.\n\n", "");
  assert.throws(() => releaseNotes(empty, "0.1.13", { allowUnreleased: true }), /no release notes/);
  assert.throws(() => releaseNotes(changelog.replace("- Twelve.", ""), "0.1.12"), /no release notes/);
  assert.equal(releaseNotes(changelog.replace("- Twelve.", ""), "0.1.12", { allowUnreleased: true }), "### Fixed\n\n- Unreleased fix.\n");
  for (const version of ["", "v0.1.12", "0.1", "01.1.12", "0.1.12-beta.1"]) assert.throws(() => releaseNotes(changelog, version), /Invalid stable version/);
});

test("every dated CHANGELOG section produces release notes", () => {
  const source = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
  const versions = [...source.matchAll(/^## (\d+\.\d+\.\d+) - \d{4}-\d{2}-\d{2}$/gm)].map((match) => match[1]);
  assert.ok(versions.length > 0);
  for (const version of versions) assert.match(releaseNotes(source, version), /^### /);
  const cli = execFileSync(process.execPath, ["scripts/release-notes.mjs", versions[0]], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
  assert.equal(cli, releaseNotes(source, versions[0]));
});
