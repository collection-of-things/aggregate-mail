import assert from "node:assert/strict";
import { test } from "node:test";
import { act, type ReactNode } from "react";
import { JSDOM } from "jsdom";
import type { Api } from "./api";
import { PhoneAccessSettings } from "./settings/PhoneAccessSettings";
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

const url = "https://mail.synthetic-tailnet.ts.net:8444/auth";
test("Settings displays verified URL, hides it from private DOM and confirms route changes", async () => {
  await withDOM(async ({ document, render }) => {
    const calls: [string, string | undefined, unknown][] = [];
    let hasRoute = false;
    const api: Api = async <T,>(path: string, method?: string, body?: unknown) => {
      calls.push([path, method, body]);
      if (path.endsWith("/enable")) hasRoute = true;
      if (path.endsWith("/disable")) hasRoute = false;
      return { supported: true, state: hasRoute ? "ready" : "off", canManage: true, hasRoute, message: "Synthetic status", ...(hasRoute ? { url } : {}) } as T;
    };
    const previous = Object.getOwnPropertyDescriptor(globalThis, "confirm");
    Object.defineProperty(globalThis, "confirm", { configurable: true, value: () => false });
    const button = (label: string) => [...document.querySelectorAll("button")].find((node) => node.textContent === label)!;
    try {
      await render(<PhoneAccessSettings api={api} onCopied={() => {}} />);
      await act(async () => button("Enable phone access").click());
      assert.equal(calls.length, 1);
      Object.defineProperty(globalThis, "confirm", { configurable: true, value: () => true });
      await act(async () => button("Enable phone access").click());
      assert.deepEqual(calls.at(-1), ["/phone-access/enable", "POST", { confirm: true }]);
      assert.equal(document.querySelector("a")?.href, url);
      await render(<PrivacyContext.Provider value={{ on: true, revealed: new Set(), toggle() {} }}><PhoneAccessSettings api={api} onCopied={() => {}} /></PrivacyContext.Provider>);
      assert.ok(!document.body.innerHTML.includes("synthetic-tailnet"));
      assert.equal(document.querySelector("a"), null);
      assert.ok(!button("Copy URL"));
      await act(async () => button("Disable phone access").click());
      assert.deepEqual(calls.at(-1), ["/phone-access/disable", "POST", { confirm: true }]);
    } finally { if (previous) Object.defineProperty(globalThis, "confirm", previous); else Reflect.deleteProperty(globalThis, "confirm"); }
  });
});
test("Settings presents remote and unsupported states without management controls, and recovers from offline", async () => {
  for (const supported of [true, false]) await withDOM(async ({ document, render }) => {
    let offline = true;
    const api: Api = async <T,>() => {
      if (offline) throw new Error("synthetic network error");
      return { supported, state: "unavailable", canManage: false, message: "Synthetic unavailable" } as T;
    };
    await render(<PhoneAccessSettings api={api} onCopied={() => {}} />);
    assert.ok(document.querySelector('[role="alert"]'));
    offline = false;
    await act(async () => document.querySelector("button")!.click());
    assert.equal(document.querySelectorAll("button").length, 1);
    assert.match(document.body.textContent!, /Synthetic unavailable/);
  });
});
