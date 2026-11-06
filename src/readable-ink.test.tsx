import { test } from "node:test";
import assert from "node:assert/strict";
import { applyReadableInk, composite, contrastRatio, parseColor, readableInk, type Rgba } from "./mail/readable-ink";
import { JSDOM } from "jsdom";

const WHITE: Rgba = [255, 255, 255, 1];

test("parseColor reads the rgb()/rgba() forms getComputedStyle returns", () => {
  assert.deepEqual(parseColor("rgb(1, 2, 3)"), [1, 2, 3, 1]);
  assert.deepEqual(parseColor("rgba(1, 2, 3, 0.5)"), [1, 2, 3, 0.5]);
  assert.deepEqual(parseColor("rgba(1, 2, 3, 0)"), [1, 2, 3, 0]);
  assert.deepEqual(parseColor("rgb(10 20 30)"), [10, 20, 30, 1]);
  assert.deepEqual(parseColor("rgb(10 20 30 / 0.25)"), [10, 20, 30, 0.25]);
  assert.deepEqual(parseColor(" rgb( 255,255,255 ) "), [255, 255, 255, 1]);
  for (const value of ["", "red", "transparent", "#fff", "hsl(0 0% 0%)", "rgb(1, 2)", "rgb(1, 2, 3, 4, 5)",
    "rgb(a, b, c)", "rgb(1 2 3 4)", "url(https://example.com/x)", "rgb(1, 2, 3", "var(--x)"])
    assert.equal(parseColor(value), null, value);
});

test("composite layers a translucent top over the color behind it", () => {
  assert.deepEqual(composite([0, 0, 0, 0.5], WHITE), [127.5, 127.5, 127.5, 1]);
  assert.deepEqual(composite([255, 255, 255, 1], [0, 0, 0, 1]), [255, 255, 255, 1]);
  assert.deepEqual(composite([10, 20, 30, 0], [40, 50, 60, 1]), [40, 50, 60, 1]);
  assert.deepEqual(composite([0, 0, 0, 0], [0, 0, 0, 0]), [0, 0, 0, 0]);
});

test("contrastRatio matches WCAG known values", () => {
  assert.equal(contrastRatio([0, 0, 0, 1], WHITE), 21);
  assert.equal(contrastRatio(WHITE, [0, 0, 0, 1]), 21);
  assert.ok(Math.abs(contrastRatio([0x77, 0x77, 0x77, 1], WHITE) - 4.48) < 0.01);
  assert.ok(Math.abs(contrastRatio([0x76, 0x76, 0x76, 1], WHITE) - 4.54) < 0.01);
});

test("readableInk marks only text below 3:1 and picks the stronger fixed ink", () => {
  // Preheader ink on the background's own white.
  assert.equal(readableInk([0xfe, 0xfe, 0xfe, 1], [], WHITE), "dark");
  // Sender gray on an unstyled element over a dark reader surface.
  assert.equal(readableInk([0x33, 0x33, 0x33, 1], [], [0x15, 0x05, 0x10, 1]), "light");
  // Below 3:1 on white still gets dark ink, the stronger side.
  assert.equal(readableInk([0x99, 0x99, 0x99, 1], [], WHITE), "dark");
  // 4.54:1 clears the bar and keeps the sender color.
  assert.equal(readableInk([0x76, 0x76, 0x76, 1], [], WHITE), null);
  // Fully transparent text has no readable form, so ink is always chosen.
  assert.equal(readableInk([0, 0, 0, 0], [], WHITE), "dark");
  assert.equal(readableInk([0, 0, 0, 0], [], [0x15, 0x05, 0x10, 1]), "light");
  // A semi-transparent sender background composites over the surface first.
  assert.equal(readableInk([255, 255, 255, 1], [[255, 0, 0, 0.5]], WHITE), "dark");
  assert.equal(readableInk([0, 0, 0, 1], [[0, 0, 0, 0.9]], WHITE), "light");
});

test("applyReadableInk marks low-contrast elements and skips protected classes", () => {
  const dom = new JSDOM(`<!doctype html><body>
    <div id="hidden">preheader</div>
    <p id="clear" style="color:#222222">body</p>
    <span id="padding">\u200B\u200C\u00A0\u200B\u200C\u00A0\u200B\u200C\u00A0</span>
    <span class="address" id="protected" style="color:#fefefe">reader@example.com</span>
    <span class="formatted-mail-image-placeholder" id="placeholder">x</span>
  </body>`);
  try {
    const { document, getComputedStyle } = dom.window;
    const real = getComputedStyle.bind(dom.window);
    dom.window.getComputedStyle = ((element: Element) =>
      element.id === "hidden" || element.id === "padding" || element.id === "protected" || element.id === "placeholder" ?
        { color: "rgb(254, 254, 254)", backgroundColor: "rgba(0, 0, 0, 0)" } as CSSStyleDeclaration :
        real(element)) as typeof getComputedStyle;
    applyReadableInk(document.body, WHITE);
    assert.equal(document.getElementById("hidden")!.getAttribute("data-ink"), "dark");
    assert.equal(document.getElementById("padding")!.getAttribute("data-ink"), null, "padding-only text is not a candidate");
    assert.equal(document.getElementById("clear")!.getAttribute("data-ink"), null);
    assert.equal(document.getElementById("protected")!.getAttribute("data-ink"), null);
    assert.equal(document.getElementById("placeholder")!.getAttribute("data-ink"), null);
    // A second pass clears a mark that became stale.
    document.getElementById("hidden")!.setAttribute("data-ink", "light");
    dom.window.getComputedStyle = ((element: Element) =>
      element.id === "hidden" ?
        { color: "rgb(34, 34, 34)", backgroundColor: "rgba(0, 0, 0, 0)" } as CSSStyleDeclaration :
        real(element)) as typeof getComputedStyle;
    applyReadableInk(document.body, WHITE);
    assert.equal(document.getElementById("hidden")!.getAttribute("data-ink"), null);
  } finally { dom.window.close(); }
});

test("deep nesting reads each element's background at most once per pass", () => {
  const depth = 50;
  const dom = new JSDOM(`<!doctype html><body>${"<div>".repeat(depth)}leaf text${"</div>".repeat(depth)}</body>`);
  try {
    const { document } = dom.window;
    const real = dom.window.getComputedStyle.bind(dom.window);
    const reads = new Map<Element, number>();
    dom.window.getComputedStyle = ((element: Element) =>
      new Proxy(real(element), {
        get(target, property) {
          if (property === "backgroundColor") reads.set(element, (reads.get(element) ?? 0) + 1);
          return (target as unknown as Record<PropertyKey, unknown>)[property];
        },
      })) as typeof dom.window.getComputedStyle;
    applyReadableInk(document.body, WHITE);
    // The layer list is memoized, so no element's background is sampled twice.
    const over = [...reads.entries()].filter(([, count]) => count > 1);
    assert.deepEqual(over.map(([element]) => element.tagName), [], "elements sampled more than once");
  } finally { dom.window.close(); }
});
