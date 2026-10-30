import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Headings and HTML comments alone are not notes; require a list entry.
const hasEntry = (notes) => /^[-*] \S/m.test(notes.replace(/<!--[\s\S]*?-->/g, ""));

function section(changelog, heading) {
  const lines = changelog.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => heading.test(line));
  if (start < 0) return "";
  const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim();
}

// Release bodies come from the CHANGELOG.md version section. Push releases
// choose their version while running, so they may use Unreleased instead.
export function releaseNotes(changelog, version, { allowUnreleased = false } = {}) {
  assert.match(version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, `Invalid stable version: ${version}`);
  let notes = section(changelog, new RegExp(`^## ${version.replace(/\./g, "\\.")}(?:\\s|$)`));
  if (!hasEntry(notes) && allowUnreleased) notes = section(changelog, /^## Unreleased\s*$/);
  assert.ok(hasEntry(notes), `CHANGELOG.md has no release notes for ${version}`);
  return `${notes}\n`;
}

if (import.meta.main) {
  const [version, ...flags] = process.argv.slice(2);
  process.stdout.write(releaseNotes(readFileSync("CHANGELOG.md", "utf8"), version ?? "", { allowUnreleased: flags.includes("--allow-unreleased") }));
}
