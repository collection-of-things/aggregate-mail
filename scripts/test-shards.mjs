// Splits test files into shards of similar total duration. Each file goes,
// longest first, to the shard with the least work so far. Weights are measured
// seconds per file; a file without one counts as the median, so new files are
// still placed and stale weights only affect balance, never coverage.
export function shardFiles(files, total, weights = {}) {
  const known = Object.values(weights).filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  const fallback = known.length ? known[Math.floor(known.length / 2)] : 1;
  const weight = (file) => Number.isFinite(weights[file]) && weights[file] > 0 ? weights[file] : fallback;
  const loads = Array(total).fill(0);
  const shards = Array.from({ length: total }, () => []);
  // Ties fall back to the file name, so every runner computes the same split.
  for (const file of [...new Set(files)].sort((a, b) => weight(b) - weight(a) || a.localeCompare(b))) {
    const lightest = loads.indexOf(Math.min(...loads));
    loads[lightest] += weight(file);
    shards[lightest].push(file);
  }
  return shards.map((list) => list.sort());
}
