import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";
import { JSDOM } from "jsdom";
import type { Api } from "./api";
import type { AgentGrant } from "../shared/workspace";
import type { AgentAutomationSettings, AgentProviderSettings } from "../shared/agent-provider";

// Synthetic grant, provider and settings only. No network or saved accounts.
async function mount(options: { key: boolean; automation: AgentAutomationSettings | null; tools?: AgentGrant["tools"] }) {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost/" });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true };
  const old = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  const grant: AgentGrant = { id: "synthetic-agent", token: "synthetic-grant", name: "Synthetic agent", accountIds: ["a"], tools: options.tools ?? ["read_email", "propose_draft"], createdAt: 1 };
  const provider: AgentProviderSettings | null = options.key ? { provider: "openai", baseURL: "https://api.openai.com/v1", model: "gpt-4.1-mini", hasKey: true, revision: "e5fd4f14-c3b5-4cb6-9f1e-116833392d8e" } : null;
  let automation = options.automation;
  const calls: { url: string; method: string; body: any }[] = [];
  const api: Api = async <T,>(url: string, method = "GET", body?: unknown): Promise<T> => {
    calls.push({ url, method, body });
    if (url.endsWith("/provider")) return structuredClone(provider) as T;
    assert.ok(url.endsWith("/automation"));
    if (method === "PUT") automation = { ...automation, ...(body as any), agentId: grant.id, revision: crypto.randomUUID() };
    return structuredClone(automation) as T;
  };
  const { createRoot } = await import("react-dom/client");
  const { AgentAutomation } = await import("./work/AgentAutomation");
  const container = document.getElementById("root")!; const root = createRoot(container);
  const render = async (reload = 0, disabled = false) => act(async () => root.render(<AgentAutomation grant={grant} api={api} disabled={disabled} reload={reload} mcpEnabled />));
  await render();
  const toggle = () => container.querySelector<HTMLInputElement>('input[role="switch"]');
  return { container, calls, toggle, render, click: async (item: HTMLElement) => act(async () => item.click()),
    async close() { await act(async () => root.unmount()); dom.window.close(); for (const [key, descriptor] of old) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } } };
}
const settings = (enabled: boolean): AgentAutomationSettings => ({ agentId: "synthetic-agent", enabled, scope: "important", instruction: "", dailyLimit: 20, revision: "3c3e0f3e-6d0b-4b8c-9a55-8f1b0f0e1d10", day: new Date().toLocaleDateString("en-CA"), count: 3, lastRunAt: 1, lastResult: "Prepared 3 replies for review." });

test("the user switches automatic replies on and off per assistant", async () => {
  const ui = await mount({ key: true, automation: settings(true) });
  try {
    assert.equal(ui.toggle()!.checked, true);
    assert.match(ui.container.textContent!, /On\. For each new email.*3 of 20 today/);
    assert.match(ui.container.textContent!, /Prepared 3 replies for review/);
    await ui.click(ui.toggle()!);
    const off = ui.calls.at(-1)!;
    assert.equal(off.method, "PUT"); assert.equal(off.body.enabled, false); assert.equal(off.body.revision, settings(true).revision);
    assert.equal(ui.toggle()!.checked, false);
    assert.match(ui.container.textContent!, /Off\. This assistant prepares replies only when you click Prepare draft/);
    await ui.click(ui.toggle()!);
    assert.equal(ui.calls.at(-1)!.body.enabled, true); assert.equal(ui.toggle()!.checked, true);
    const limit = [...ui.container.querySelectorAll("label")].find((label) => label.childNodes[0]?.textContent === "Daily limit")!.querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(limit, "");
      limit.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    assert.equal(limit.value, "", "clearing the field keeps it empty while typing");
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(limit, "50");
      limit.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    await ui.click(ui.toggle()!);
    assert.equal(ui.calls.at(-1)!.body.dailyLimit, 20, "the switch keeps saved options and ignores unsaved edits");
    assert.equal(limit.value, "50");
    const saveOptions = [...ui.container.querySelectorAll("button")].find((button) => button.textContent === "Save options")!;
    await ui.click(saveOptions);
    assert.equal(ui.calls.at(-1)!.body.dailyLimit, 50); assert.equal(ui.calls.at(-1)!.body.enabled, false);
  } finally { await ui.close(); }
});

test("without a key the switch stays off and points to Bring your own key", async () => {
  const ui = await mount({ key: false, automation: null });
  try {
    assert.equal(ui.toggle()!.checked, false); assert.equal(ui.toggle()!.disabled, true);
    assert.match(ui.container.textContent!, /Add a provider key under Bring your own key/);
    assert.equal(ui.calls.some((call) => call.method !== "GET"), false);
  } finally { await ui.close(); }
});

test("assistants without reply permission show no switch", async () => {
  const ui = await mount({ key: true, automation: null, tools: ["read_email"] });
  try {
    assert.equal(ui.toggle(), null); assert.equal(ui.calls.length, 0);
  } finally { await ui.close(); }
});

test("a reload or busy workspace keeps unsaved option edits", async () => {
  const ui = await mount({ key: true, automation: settings(true) });
  try {
    const limit = [...ui.container.querySelectorAll("label")].find((label) => label.childNodes[0]?.textContent === "Daily limit")!.querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(limit, "75");
      limit.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    await ui.render(0, true); await ui.render(0, false); await ui.render(1, false);
    assert.equal(ui.calls.filter((call) => call.method === "GET" && call.url.endsWith("/automation")).length, 3, "the card reloaded");
    assert.equal(limit.value, "75", "unsaved edits survive reloads");
    assert.equal(ui.toggle()!.checked, true);
  } finally { await ui.close(); }
});
