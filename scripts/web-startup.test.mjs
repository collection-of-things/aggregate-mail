import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, cp, symlink, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { smokeRelease } from "./web-deploy.mjs";

const source = fileURLToPath(new URL("../", import.meta.url));
test("real managed browser starts with a synthetic encrypted profile, rejects unauthenticated API reads and drains", { timeout: 60_000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "emc2-managed-test-"));
  const revision = "d".repeat(40), build = "e".repeat(64);
  const directory = path.join(root, "releases", revision);
  try {
    await mkdir(path.join(directory, "scripts"), { recursive: true });
    await mkdir(path.join(directory, "dist"));
    for (const name of ["server", "shared"]) await cp(path.join(source, name), path.join(directory, name), { recursive: true });
    for (const name of ["start-browser.mjs", "browser-shutdown.mjs"]) await cp(path.join(source, "scripts", name), path.join(directory, "scripts", name));
    await symlink(path.join(source, "node_modules"), path.join(directory, "node_modules"), "dir");
    const pkg = JSON.parse(await readFile(path.join(source, "package.json"), "utf8"));
    await writeFile(path.join(directory, "package.json"), JSON.stringify(pkg));
    await writeFile(path.join(directory, "dist/index.html"), `<html><head><meta name="emc2-build" content="${build}"></head><body>synthetic</body></html>`);
    await writeFile(path.join(directory, ".web-deployment.json"), JSON.stringify({ revision, tag: `v${pkg.version}`, profile: 1, build }));
    await smokeRelease(directory, revision);
    assert.equal((await readFile(path.join(directory, ".web-deployment.json"), "utf8")).includes(revision), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
