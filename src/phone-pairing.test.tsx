import assert from "node:assert/strict";
import { test } from "node:test";
import { act, type ReactNode } from "react";
import { JSDOM } from "jsdom";
import type { Api } from "./api";
import { PhonePairingSettings } from "./settings/PhonePairingSettings";
import { PrivacyContext } from "./ui/Privacy";
async function withDOM(run: (ui: { document: Document; render: (node: ReactNode) => Promise<void> }) => Promise<void>) {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
  dom.window.HTMLElement.prototype.scrollTo = function (options?: ScrollToOptions | number) {
    if (typeof options === "object") this.scrollTop = options.top ?? this.scrollTop;
  };
  const globals = { window: dom.window, document: dom.window.document, location: dom.window.location, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(dom.window.document.getElementById("root")!);
  try {
    await run({ document: dom.window.document, render: async (node) => { await act(async () => root.render(node)); } });
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
}


test("Settings shows QR only outside Privacy, approves the matching code and revokes phones", async () => {
  await withDOM(async ({ document, render }) => {
    let phase: "waiting" | "claimed" | "approved" | undefined;
    let devices = [{ id: "synthetic-public-credential", name: "Phone 1", createdAt: 1000 }];
    const calls: string[] = [];
    const api: Api = async <T,>(route: string) => {
      calls.push(route);
      if (route.endsWith("/connect")) phase = "waiting";
      if (route.endsWith("/approve")) phase = "approved";
      if (route.endsWith("/revoke")) devices = [];
      if (route.endsWith("/cancel")) phase = undefined;
      return { devices, ...(phase ? { pairing: { id: "synthetic-pairing", phase, expiresAt: Date.now() + 120000, code: phase === "waiting" ? undefined : "123456", ...(route.endsWith("/connect") ? { qr: "data:image/png;base64,c3ludGhldGlj" } : {}) } } : {}) } as T;
    };
    const previous = Object.getOwnPropertyDescriptor(globalThis, "confirm");
    Object.defineProperty(globalThis, "confirm", { configurable: true, value: () => true });
    const button = (label: string) => [...document.querySelectorAll("button")].find((node) => node.textContent === label)!;
    const ui = (privacy: boolean) => <PrivacyContext.Provider value={{ on: privacy, revealed: new Set(), toggle() {} }}><PhonePairingSettings api={api} canPair /></PrivacyContext.Provider>;
    try {
      await render(ui(false));
      await act(async () => button("Connect phone").click());
      assert.ok(document.querySelector('img[alt="Scan to connect this phone"]'));
      await render(ui(true));
      assert.equal(document.querySelector("img"), null);
      assert.ok(!document.body.innerHTML.includes("c3ludGhldGlj"));
      phase = "claimed";
      await act(async () => button("Refresh phones").click());
      assert.ok(!document.body.innerHTML.includes("123456"));
      assert.ok(!button("Approve matching phone"));
      await render(ui(false));
      assert.match(document.body.textContent!, /123456/);
      Object.defineProperty(globalThis, "confirm", { configurable: true, value: () => false });
      await act(async () => button("Approve matching phone").click());
      assert.ok(!calls.includes("/phone-devices/approve"));
      Object.defineProperty(globalThis, "confirm", { configurable: true, value: () => true });
      await act(async () => button("Approve matching phone").click());
      assert.ok(calls.includes("/phone-devices/approve"));
      assert.match(document.body.textContent!, /Save the passkey/);
      await act(async () => button("Cancel pairing").click());
      await act(async () => button("Remove Phone 1").click());
      assert.ok(calls.includes("/phone-devices/revoke"));
      assert.match(document.body.textContent!, /No phones paired/);
    } finally { if (previous) Object.defineProperty(globalThis, "confirm", previous); else Reflect.deleteProperty(globalThis, "confirm"); }
  });
});
test("stale polls cannot overwrite a newer pairing", async () => {
  await withDOM(async ({ document, render }) => {
    let pending: ((value: unknown) => void) | undefined;
    let getCount = 0, writes = 0;
    const api: Api = async <T,>(route: string, method?: string) => {
      if (method === "POST") { writes++; return { devices: [], pairing: { id: "new", phase: "waiting", expiresAt: Date.now()+120000, qr: "data:image/png;base64,bmV3" } } as T; }
      if (++getCount === 2) return await new Promise<T>((resolve) => { pending = resolve as (value: unknown) => void; });
      return { devices: [] } as T;
    };
    await render(<PhonePairingSettings api={api} canPair />);
    const button = (label: string) => [...document.querySelectorAll("button")].find((node) => node.textContent === label)!;
    await act(async () => { button("Refresh phones").click(); });
    await act(async () => { button("Connect phone").click(); });
    await act(async () => { pending!({ devices: [], pairing: { id: "old", phase: "claimed", code: "999999", expiresAt: Date.now()+120000 } }); });
    assert.equal(writes, 1); assert.ok(document.querySelector("img"));
    assert.ok(!document.body.textContent!.includes("999999"));
  });
});
