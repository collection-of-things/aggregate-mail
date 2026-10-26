import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";
import { JSDOM } from "jsdom";
import type { Api } from "./api";

test("Settings backup requires passphrase confirmation and explicit preview confirmation", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://127.0.0.1/" });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import("react-dom/client");
  const { WorkspaceBackup } = await import("./settings/WorkspaceBackup");
  let saved = "", opened = 0, missingAccounts = 0;
  Object.assign(dom.window, { desktop: { workspaceBackup: { save: async (file: string) => { saved = file; return true; }, open: async () => { opened++; return "synthetic encrypted file"; } } } });
  const calls: { url: string; body: any }[] = [];
  const api: Api = async <T,>(url: string, _method?: string, body?: unknown) => {
    calls.push({ url, body });
    return (url.endsWith("/export") ? { file: "synthetic exported ciphertext" } : { manifest: { formatVersion: 1, appVersion: "test", createdAt: "2026-10-25T00:00:00.000Z", counts: { commitment: 3 } }, added: { commitment: 2 }, skipped: { commitment: 1 }, missingAccounts, previewToken: "synthetic-preview-receipt" }) as T;
  };
  const container = dom.window.document.createElement("div"); dom.window.document.body.append(container);
  const root = createRoot(container);
  const errors: unknown[] = [];
  const button = (label: string) => [...container.querySelectorAll("button")].find(button => button.textContent === label)!;
  const set = async (index: number, value: string) => {
    const field = container.querySelectorAll("input")[index];
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(field, value);
      field.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
  };
  try {
    await act(async () => root.render(<WorkspaceBackup busy={false} api={api} perform={async task => { try { await task(); } catch (error) { errors.push(error); } }} />));
    assert.ok(button("Export encrypted backup").disabled);
    await set(0, "synthetic passphrase");
    assert.ok(button("Export encrypted backup").disabled);
    await set(1, "synthetic passphrase");
    await act(async () => button("Export encrypted backup").click());
    assert.equal(saved, "synthetic exported ciphertext");
    assert.equal(container.querySelector("input")!.value, "");
    await set(0, "synthetic passphrase");
    await act(async () => button("Open backup and preview").click());
    assert.equal(opened, 1);
    assert.equal(calls.filter(call => call.url.endsWith("/import")).length, 0);
    assert.match(container.textContent!, /Skip existing/);
    assert.match(container.textContent!, /Existing IDs/);
    await act(async () => button("Merge into current profile").click());
    const imported = calls.find(call => call.url.endsWith("/import"))!;
    assert.equal(imported.body.previewToken, "synthetic-preview-receipt");
    assert.equal(imported.body.file, "synthetic encrypted file");
    assert.equal(container.querySelector("input")!.value, "");
    missingAccounts = 1;
    await set(0, "synthetic passphrase");
    await act(async () => button("Open backup and preview").click());
    assert.ok(button("Merge into current profile").disabled);
    await act(async () => button("Cancel import").click());
    assert.equal(container.querySelector("input")!.value, "");
    assert.deepEqual(errors, []);
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
