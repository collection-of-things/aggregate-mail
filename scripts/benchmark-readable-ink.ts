// Synthetic allocation/CPU probe; not native layout or installed-app proof.
import { JSDOM } from "jsdom";
import assert from "node:assert/strict";
import { parseMailContent } from "../shared/mail-content.js";
const { applyReadableInk } = await import(process.argv[2] || "../src/mail/readable-ink.js");

const depth = 80, branches = 20;
const html = (`${'<div>text'.repeat(depth)}${'</div>'.repeat(depth)}`).repeat(branches);
assert.ok(parseMailContent(html, true), "fixture must fit the real mail parser's node and depth limits");
const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
const style = { color: "rgb(255, 255, 255)", backgroundColor: "rgba(255, 255, 255, 0.01)" };
// Isolate the traversal/compositing cost from the DOM engine's CSS implementation.
Object.defineProperty(dom.window, "getComputedStyle", { value: () => style });
const times: number[] = [], heaps: number[] = [];
try {
  for (let i = 0; i < 7; i++) {
    global.gc?.();
    const heap = process.memoryUsage().heapUsed;
    const start = performance.now();
    applyReadableInk(dom.window.document.body, [255, 255, 255, 1]);
    times.push(performance.now() - start);
    heaps.push(process.memoryUsage().heapUsed - heap);
  }
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  console.log(JSON.stringify({ depth, branches, passes: times.length, medianMs: median(times), medianHeapGrowthBytes: median(heaps) }));
} finally { dom.window.close(); }
