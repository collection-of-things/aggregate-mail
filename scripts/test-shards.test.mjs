import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { shardFiles } from "./test-shards.mjs";

const files = ["server/*.test.ts", "desktop/*.test.ts", "src/*.test.tsx", "scripts/*.test.mjs"]
  .flatMap((pattern) => globSync(pattern)).map((file) => file.replaceAll("\\", "/"));
const weights = JSON.parse(readFileSync(new URL("./test-weights.json", import.meta.url), "utf8"));

test("every test file runs in exactly one shard, the same way on every runner", () => {
  for (let total = 1; total <= 6; total++) {
    const shards = shardFiles(files, total, weights);
    assert.equal(shards.length, total);
    assert.deepEqual(shards.flat().sort(), [...files].sort(), `${total} shards`);
    assert.deepEqual(shardFiles([...files].reverse(), total, weights), shards, `${total} shards, other input order`);
  }
});

test("heavy files are spread out and unknown files still get placed", () => {
  // The unweighted file counts as the median weight (90 here).
  const shards = shardFiles(["a", "b", "c", "d", "new"], 2, { a: 100, b: 90, c: 5, d: 5 });
  assert.deepEqual(shards, [["a", "c", "d"], ["b", "new"]]);
  assert.deepEqual(shardFiles(["x", "y"], 3, {}), [["x"], ["y"], []]);
});

test("weights name only test files that exist", () => {
  for (const file of Object.keys(weights)) assert.ok(files.includes(file), file);
});
