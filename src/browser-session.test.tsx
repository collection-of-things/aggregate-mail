import assert from "node:assert/strict";
import { test } from "node:test";
import { act, useEffect } from "react";
import { Window as DOMWindow } from "happy-dom";
import { BrowserSession } from "./BrowserSession";

test("browser lock removes retained mail and drafts; visibility and offline checks fail closed", async () => {
  const dom = new DOMWindow({ url: "http://127.0.0.1:3001" });
  let accepted = true;
  let failed = false;
  let interval: (() => void) | undefined;
  let channel: { onmessage?: (event: { data: string }) => void; close(): void } | undefined;
  let checks = 0;
  const globals = {
    window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async () => { checks++; if (failed) throw new Error("synthetic offline"); return Response.json({ authenticated: accepted }); },
    BroadcastChannel: class { onmessage?: (event: { data: string }) => void; constructor() { channel = this; } close() {} },
    setInterval: (callback: () => void) => { interval = callback; return 1; }, clearInterval: () => {},
  };
  const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import("react-dom/client");
  const container = dom.document.createElement("div");
  dom.document.body.append(container);
  const root = createRoot(container as unknown as HTMLElement);
  let unmounted = 0;
  function PrivateContent() {
    useEffect(() => () => { unmounted++; }, []);
    return <section>synthetic retained mail body<input defaultValue="synthetic unsaved draft" /></section>;
  }
  const render = async (key: string) => { await act(async () => root.render(<BrowserSession key={key}><PrivateContent /></BrowserSession>)); };
  try {
    await render("channel");
    assert.match(container.textContent || "", /retained mail/);
    await act(async () => channel?.onmessage?.({ data: "locked" }));
    assert.equal(container.querySelector("section"), null);
    assert.equal(container.querySelector("input"), null);
    assert.equal(unmounted, 1);
    await act(async () => interval?.());
    assert.equal(container.querySelector("section"), null, "revoked content cannot silently remount");
    await render("expiry");
    accepted = false;
    await act(async () => interval?.());
    assert.equal(container.querySelector("section"), null);
    accepted = true;
    await render("visibility");
    Object.defineProperty(dom.document, "visibilityState", { configurable: true, value: "hidden" });
    await act(async () => dom.document.dispatchEvent(new dom.Event("visibilitychange")));
    assert.equal(container.querySelector("section")?.parentElement?.getAttribute("style"), "display: none;");
    accepted = false;
    Object.defineProperty(dom.document, "visibilityState", { configurable: true, value: "visible" });
    await act(async () => dom.document.dispatchEvent(new dom.Event("visibilitychange")));
    assert.equal(container.querySelector("section"), null);
    accepted = true;
    await render("http401");
    await act(async () => dom.dispatchEvent(new dom.Event("emc2-browser-locked")));
    assert.equal(container.querySelector("section"), null);
    await render("offline");
    failed = true;
    await act(async () => interval?.());
    assert.equal(container.querySelector("section"), null);
    failed = false;
    const before = checks;
    Object.assign(dom, { desktop: {} });
    await render("desktop");
    assert.match(container.textContent || "", /retained mail/);
    assert.equal(container.querySelector("section")?.parentElement, container, "desktop keeps its existing layout");
    assert.equal(checks, before);
  } finally {
    await act(async () => root.unmount());
    dom.happyDOM.abort();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
