// Runs the serial test suite. CI sets TEST_SHARD=<index>/<total> to split the
// files across runners by measured duration (scripts/test-weights.json); every
// shard still runs its files one at a time.
import { spawnSync } from "node:child_process";
import { globSync, readFileSync } from "node:fs";
import { shardFiles } from "./test-shards.mjs";

const patterns = ["server/*.test.ts", "desktop/*.test.ts", "src/*.test.tsx", "scripts/*.test.mjs"];
const shard = process.env.TEST_SHARD || "";
const match = /^([1-9]\d*)\/([1-9]\d*)$/.exec(shard);
if (shard && (!match || Number(match[1]) > Number(match[2]))) {
  console.error(`TEST_SHARD must look like 1/3, not ${JSON.stringify(shard)}`);
  process.exit(2);
}
let files = patterns;
if (match) {
  const weights = JSON.parse(readFileSync(new URL("./test-weights.json", import.meta.url), "utf8"));
  const all = patterns.flatMap((pattern) => globSync(pattern)).map((file) => file.replaceAll("\\", "/"));
  files = shardFiles(all, Number(match[2]), weights)[Number(match[1]) - 1];
  console.log(`Shard ${shard}: ${files.length} of ${all.length} test files`);
  if (!files.length) process.exit(0);
}
const args = ["--import", "tsx", "--test", "--test-concurrency=1", "--test-timeout=120000", ...files, ...process.argv.slice(2)];
const result = spawnSync(process.execPath, args, { stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
