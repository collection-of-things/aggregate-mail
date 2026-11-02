import assert from "node:assert/strict";
import { test } from "node:test";
import { act, type ReactNode } from "react";
import { JSDOM } from "jsdom";
import type { RendererState as State } from "../shared/types";
import type { Api, Perform } from "./api";
import { PrivacySettings } from "./settings/PrivacySettings";
import { settingsGroup, settingsSections } from "./settings/sections";
import { PrivacyContext } from "./ui/Privacy";

const state = {
  accounts: [{ id: "a", email: "owner@example.test", provider: "imap" }],
  messages: [{ id: "a:1", accountId: "a", sender: "Shop", address: "info@shop.example", to: "Sam Example <owner@example.test>" }],
  labels: [], rules: [], googleConfigured: false, googleClientId: null, jevConfigured: false, jevProvider: "typesafe",
  aiConfigured: false, lastSync: null, syncing: false,
  privacyWords: { hidden: ["Private Nickname"], visible: ["Sample Brand"] },
} as unknown as State;

async function withDOM(run: (ui: { document: Document; render: (node: ReactNode) => Promise<void> }) => Promise<void>) {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
  const globals = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true };
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

test("Privacy settings list hidden, visible and learned names and save edits", async () => {
  assert.ok(settingsSections.some((section) => section.id === "privacy"));
  assert.equal(settingsGroup("privacy"), "Preferences");
  await withDOM(async ({ document, render }) => {
    const calls: { url: string; body: unknown }[] = [];
    const api = (async (url: string, _method?: string, body?: unknown) => { calls.push({ url, body }); return body; }) as Api;
    const perform: Perform = async (task) => { await task(); };
    const view = (on: boolean) => <PrivacyContext.Provider value={{ on, revealed: new Set(), toggle() {} }}>
      <PrivacySettings state={state} api={api} perform={perform} busy={false} />
    </PrivacyContext.Provider>;

    await render(view(true));
    const text = document.body.textContent || "";
    // Hidden and learned names stay masked while information is hidden.
    for (const value of ["Private Nickname", "Sam Example"]) assert.ok(!text.includes(value), value);
    assert.ok(text.includes("Sample Brand"));

    await render(view(false));
    assert.ok(document.body.textContent!.includes("Sam Example"));
    const field = document.querySelector<HTMLInputElement>(".privacy-word-form input")!;
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setValue.call(field, "  New   Name ");
      field.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    await act(async () => { field.form!.requestSubmit(); });
    assert.deepEqual(calls.at(-1), { url: "/privacy-words", body: { hidden: ["Private Nickname", "New Name"], visible: ["Sample Brand"] } });

    const keep = [...document.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === "Keep Sam Example visible")!;
    await act(async () => { keep.click(); });
    assert.deepEqual(calls.at(-1)!.body, { hidden: ["Private Nickname"], visible: ["Sample Brand", "Sam Example"] });
  });
});
