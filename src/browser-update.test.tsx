import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";
import { Window } from "happy-dom";
import { BrowserUpdateNotice } from "./shell/BrowserUpdateNotice";

test("browser update waits for idle, protects writes and honors Later", async () => {
  const dom = new Window({ url: "http://localhost/" });
  Object.defineProperty(dom.document, "visibilityState", { configurable: true, value: "visible" });
  let tick: (() => void) | undefined;
  let time = 1000;
  const globals = { window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true,
    setInterval: (callback: () => void) => { tick = callback; return 1; }, clearInterval: () => {} };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const originalNow = Date.now; Date.now = () => time;
  const { createRoot } = await import("react-dom/client");
  const container = dom.document.createElement("div"); dom.document.body.append(container);
  const root = createRoot(container as unknown as HTMLElement);
  const writes = { current: { pending: 0, uncertain: false } };
  let reloads = 0;
  const render = async (blocked = false) => act(async () => root.render(<BrowserUpdateNotice blocked={blocked} writes={writes} onReload={() => { reloads++; }} />));
  const detect = () => act(async () => dom.dispatchEvent(Object.assign(new dom.Event("emc2-update-ready"), { detail: "a".repeat(64) })));
  const click = async (label: string) => { const button = Array.from(container.querySelectorAll("button")).find(b => b.textContent === label); assert.ok(button); await act(async () => button.click()); };
  try {
    await render(true); await detect();
    assert.match(container.textContent || "", /Update ready/);
    time += 60_000; await act(async () => tick?.()); assert.equal(reloads, 0);
    await click("Update now"); assert.equal(reloads, 0, "manual update also protects unsaved work");
    await render(); writes.current.pending = 1;
    await act(async () => tick?.()); assert.equal(reloads, 0);
    writes.current.pending = 0; writes.current.uncertain = true;
    await act(async () => tick?.()); assert.equal(reloads, 0);
    writes.current.uncertain = false;
    dom.document.dispatchEvent(new dom.Event("keydown"));
    await act(async () => tick?.()); assert.equal(reloads, 0, "typing resets idle time");
    await click("Later"); time += 60_000;
    await detect(); await act(async () => tick?.()); assert.equal(reloads, 0, "same build cannot cancel Later");
    await click("Update now"); assert.equal(reloads, 1);
    await act(async () => root.render(<BrowserUpdateNotice key="automatic" blocked={false} writes={writes} onReload={() => { reloads++; }} />));
    await detect(); time += 31_000;
    const form = dom.document.createElement("form"); dom.document.body.append(form);
    await act(async () => tick?.()); assert.equal(reloads, 1, "forms prevent automatic refresh");
    form.remove();
    const download = dom.document.createElement("li"); download.setAttribute("aria-busy", "true"); dom.document.body.append(download);
    await click("Update now"); await act(async () => tick?.()); assert.equal(reloads, 1, "pending downloads block manual and automatic refresh");
    download.remove();
    const preview = dom.document.createElement("div"); preview.className = "attachment-preview"; dom.document.body.append(preview);
    await act(async () => tick?.()); assert.equal(reloads, 1, "attachment previews stay open"); preview.remove();
    Object.defineProperty(dom.document, "visibilityState", { configurable: true, value: "hidden" });
    await act(async () => tick?.()); assert.equal(reloads, 1, "hidden tabs cannot refresh");
    Object.defineProperty(dom.document, "visibilityState", { configurable: true, value: "visible" });
    await act(async () => tick?.()); assert.equal(reloads, 2, "safe idle view refreshes automatically exactly once");
    await act(async () => tick?.()); assert.equal(reloads, 2);
  } finally { await act(async () => root.unmount()); Date.now = originalNow; dom.happyDOM.abort();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});

test("browser update navigation is tab-local, validated and consumed only once", async () => {
  const dom = new Window({ url: "http://localhost/" });
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom });
  const { rememberBrowserUpdateLocation, takeBrowserUpdateLocation } = await import("./navigation");
  const location = { page: "mail", view: "inbox", tab: "social", settingsSection: "interaction", accountFilter: "synthetic", labelFilter: "all", query: "synthetic search", readFilter: "all", relevanceFilter: "all", sort: "newest", selectedId: "synthetic-mail", opened: true } as const;
  try {
    rememberBrowserUpdateLocation(location);
    const restored = takeBrowserUpdateLocation();
    assert.equal(restored.tab, "social"); assert.equal(restored.selectedId, location.selectedId); assert.equal(restored.opened, true); assert.equal(restored.query, location.query);
    assert.deepEqual(takeBrowserUpdateLocation(), {});
    dom.sessionStorage.setItem("emc2.browser-update-location", JSON.stringify({ at: Date.now() - 130_000, location }));
    assert.deepEqual(takeBrowserUpdateLocation(), {});
    dom.sessionStorage.setItem("emc2.browser-update-location", "invalid"); assert.deepEqual(takeBrowserUpdateLocation(), {});
    dom.sessionStorage.setItem("emc2.browser-update-location", JSON.stringify({ at: Date.now(), location: { ...location, view: "unknown" } }));
    assert.deepEqual(takeBrowserUpdateLocation(), {});
  } finally { dom.happyDOM.abort(); if (previous) Object.defineProperty(globalThis, "window", previous); else Reflect.deleteProperty(globalThis, "window"); }
});
