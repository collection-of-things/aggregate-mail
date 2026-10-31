import assert from "node:assert/strict";
import { test } from "node:test";
import { installerFor, parseRelease } from "../website/src/lib/release.ts";

const asset = (name, extra = {}) => ({
  name,
  browser_download_url: `https://github.com/collection-of-things/aggregate-mail/releases/download/v0.2.17/${name}`,
  size: 100,
  digest: `sha256:${"a".repeat(64)}`,
  ...extra,
});

test("parseRelease maps the four installers and validates assets", () => {
  const body = {
    tag_name: "v0.2.17",
    published_at: "2026-10-27T18:34:55Z",
    assets: [
      asset("Emc2-0.2.17-win-x64.exe", { size: 146847971 }),
      asset("Emc2-0.2.17-mac-arm64.dmg", { size: 168499148, digest: `sha256:${"B".repeat(64)}` }),
      asset("Emc2-0.2.17-mac-x64.dmg", { size: 175482862, digest: "sha256:not-a-hash" }),
      asset("Emc2-0.2.17-linux-x86_64.AppImage", { size: 167108536 }),
      asset("latest.yml"),
      asset("SHA256SUMS.txt"),
      asset("Emc2-0.2.17-win-x64.exe", {
        browser_download_url: "https://evil.example.com/Emc2-0.2.17-win-x64.exe",
      }),
    ],
  };
  const release = parseRelease(body);
  assert.ok(release);
  assert.equal(release.version, "0.2.17", "the leading v is stripped");
  assert.equal(release.publishedAt, "2026-10-27T18:34:55Z");

  const win = release.assets.windows;
  assert.ok(win);
  assert.equal(win.size, 146847971);
  assert.equal(win.sha256, "a".repeat(64));
  assert.match(win.url, /^https:\/\/github\.com\//);
  // The non-GitHub mirror of the same name was skipped, not kept.
  assert.equal(win.url, "https://github.com/collection-of-things/aggregate-mail/releases/download/v0.2.17/Emc2-0.2.17-win-x64.exe");

  const arm = release.assets["mac-arm64"];
  assert.ok(arm);
  assert.equal(arm.sha256, "b".repeat(64), "digest hex is lowercased");

  const x64 = release.assets["mac-x64"];
  assert.ok(x64);
  assert.equal(x64.sha256, null, "a malformed digest becomes null, not the raw value");

  assert.ok(release.assets.linux);
  assert.equal(Object.keys(release.assets).length, 4, "metadata files are ignored");

  const missingDigest = parseRelease({
    tag_name: "v1",
    published_at: "x",
    assets: [asset("Emc2-1-win-x64.exe", { digest: undefined })],
  });
  assert.equal(missingDigest?.assets.windows?.sha256, null, "a missing digest becomes null");

  for (const invalid of [null, {}, "v0.2.17", { tag_name: 4 }, { tag_name: "v1" }, { tag_name: "v1", assets: [] }]) {
    assert.equal(parseRelease(invalid), null, `${JSON.stringify(invalid)} is not a release`);
  }
});

test("installerFor picks the right installer for each platform", () => {
  assert.deepEqual(installerFor("windows", {}), { installer: "windows", archKnown: true });
  assert.deepEqual(installerFor("linux", {}), { installer: "linux", archKnown: true });
  assert.deepEqual(installerFor("mac", { arch: "arm" }), { installer: "mac-arm64", archKnown: true });
  assert.deepEqual(installerFor("mac", { arch: "x86" }), { installer: "mac-x64", archKnown: true });
  assert.deepEqual(installerFor("mac", { gpu: "Intel(R) Iris(TM) Plus Graphics" }), {
    installer: "mac-x64",
    archKnown: true,
  });
  assert.deepEqual(installerFor("mac", { gpu: "Apple M3" }), { installer: "mac-arm64", archKnown: true });
  assert.deepEqual(installerFor("mac", { gpu: "Apple GPU" }), {
    installer: "mac-arm64",
    archKnown: false,
  });
});
