// Runs the serial test suite. CI sets TEST_SHARD=<index>/<total> to split the
// files across runners; every shard still runs its files one at a time.
import { spawnSync } from "node:child_process";

const files = ["server/*.test.ts", "desktop/*.test.ts", "src/*.test.tsx", "scripts/*.test.mjs"];
const shard = process.env.TEST_SHARD || "";
const match = /^([1-9]\d*)\/([1-9]\d*)$/.exec(shard);
if (shard && (!match || Number(match[1]) > Number(match[2]))) {
  console.error(`TEST_SHARD must look like 1/3, not ${JSON.stringify(shard)}`);
  process.exit(2);
}
// Node reads --test-shard only before the file patterns, so it goes first.
const args = ["--import", "tsx", "--test", "--test-concurrency=1", "--test-timeout=120000", ...(shard ? [`--test-shard=${shard}`] : []),
  ...files, ...process.argv.slice(2)];
const result = spawnSync(process.execPath, args, { stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
