import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { stampBrowserBuild } from "./build-browser.mjs";

test("browser build identity is stable, embedded and changes with its asset references", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "emc2-build-"));
  try {
    const file = path.join(directory, "index.html");
    await writeFile(file, '<html><head><script type="module" src="/assets/one.js"></script></head></html>');
    const first = await stampBrowserBuild(directory);
    assert.match(first, /^[a-f0-9]{64}$/);
    assert.match(await readFile(file, "utf8"), new RegExp(`name="emc2-build" content="${first}"`));
    assert.equal(await stampBrowserBuild(directory), first);
    await writeFile(file, (await readFile(file, "utf8")).replace("one.js", "two.js"));
    assert.notEqual(await stampBrowserBuild(directory), first);
    await writeFile(file, "invalid HTML");
    await assert.rejects(stampBrowserBuild(directory), /no head/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
