import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { nextRegion, regionOf, regionOrder, type Region } from "./region-focus";

test("the cycle visits the documented order in both directions and wraps", () => {
  assert.deepEqual(regionOrder, ["sidebar", "search", "list", "reader"]);
  const steps: [Region, Region][] = [["sidebar", "search"], ["search", "list"], ["list", "reader"], ["reader", "sidebar"]];
  for (const [from, to] of steps) assert.equal(nextRegion(regionOrder, from, 1), to, `${from} forward`);
  for (const [to, from] of steps) assert.equal(nextRegion(regionOrder, from, -1), to, `${from} backward`);
});

test("hidden regions are skipped without leaving the cycle", () => {
  const visible: Region[] = ["sidebar", "list", "reader"];
  assert.equal(nextRegion(visible, "sidebar", 1), "list");
  assert.equal(nextRegion(visible, "reader", -1), "list");
  assert.equal(nextRegion(visible, "reader", 1), "sidebar");
  const noReader: Region[] = ["sidebar", "search", "list"];
  assert.equal(nextRegion(noReader, "list", 1), "sidebar");
  assert.equal(nextRegion(noReader, "sidebar", -1), "list");
  const chromeOnly: Region[] = ["sidebar", "search"];
  assert.equal(nextRegion(chromeOnly, "search", 1), "sidebar");
});

test("focus outside the cycle enters at the matching end", () => {
  assert.equal(nextRegion(regionOrder, null, 1), "sidebar");
  assert.equal(nextRegion(regionOrder, null, -1), "reader");
  assert.equal(nextRegion(["search", "list"], null, -1), "list");
  // A region that just became unavailable restarts the same way.
  assert.equal(nextRegion(["search", "list"], "reader", 1), "search");
  assert.equal(nextRegion(["sidebar", "search"], "list", -1), "search");
});

test("the cycle stops when no region is available", () => {
  assert.equal(nextRegion([], "sidebar", 1), null);
  assert.equal(nextRegion([], null, -1), null);
});

test("regionOf maps focused elements to their window region", () => {
  const dom = new JSDOM(`<div id="root">
    <aside id="sidebar"><button id="nav"></button></aside>
    <div class="app-main">
      <header class="app-toolbar"><input id="search" /><button id="filters"></button></header>
      <div class="search-help"><details><summary id="help">Search help</summary></details></div>
      <main class="workspace split">
        <section class="list-pane"><div class="list"><button class="row" id="mail-a"></button></div></section>
        <section class="reader-pane"><div class="reader-scroll"><article class="message" id="reader"></article></div></section>
      </main>
    </div>
    <button id="outside"></button></div>`);
  const doc = dom.window.document;
  const at = (id: string) => regionOf(doc.getElementById(id));
  assert.equal(at("nav"), "sidebar");
  assert.equal(at("search"), "search");
  assert.equal(at("filters"), "search");
  assert.equal(at("help"), "search");
  assert.equal(at("mail-a"), "list");
  assert.equal(at("reader"), "reader");
  assert.equal(at("outside"), null);
  assert.equal(regionOf(doc.body), null);
  assert.equal(regionOf(null), null);
  assert.equal(regionOf(undefined), null);
  dom.window.close();
});
