import assert from "node:assert/strict";
import { test } from "node:test";
import { act, useState, type ReactNode } from "react";
import { JSDOM } from "jsdom";
import type { ContactSuggestion } from "../shared/contacts";
import type { Account } from "../shared/types";
import type { Api } from "./api";
import { RecipientInput } from "./compose/RecipientInput";
import { activeRecipient, replaceActiveRecipient } from "./compose/recipients";
import { PrivacyContext } from "./ui/Privacy";

const accounts: Account[] = [
  { id: "work", email: "work@example.test", provider: "imap" },
  { id: "home", email: "home@example.test", provider: "imap", name: "Home" },
];
const suggestions: ContactSuggestion[] = [
  { kind: "saved", id: "s1", accountId: "work", name: "Gregory Synthetic", email: "gregory@example.test", updatedAt: 1 },
  { kind: "recent", id: "r1", accountId: "home", email: "grace@example.test", lastSentAt: 2 },
];

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

function Field({ api, initial, changes }: { api: Api; initial: string; changes: string[] }) {
  const [value, setValue] = useState(initial);
  return <RecipientInput label="Cc" multiple value={value} accountId="work" accounts={accounts} api={api}
    onChange={(next) => { changes.push(next); setValue(next); }} />;
}

async function type(document: Document, text: string) {
  const input = document.querySelector<HTMLInputElement>('[role="combobox"]')!;
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    input.focus();
    setValue.call(input, text);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
  // Lookups wait for a short typing pause.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 160)); });
  return input;
}
const key = (input: HTMLInputElement, name: string) => act(async () => {
  input.dispatchEvent(new window.KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
});

test("token helpers complete only the address after the last comma", () => {
  assert.equal(activeRecipient("ada@example.test, gr"), "gr");
  assert.equal(activeRecipient("gr"), "gr");
  assert.equal(replaceActiveRecipient("ada@example.test,gr", "grace@example.test"), "ada@example.test, grace@example.test");
  assert.equal(replaceActiveRecipient("gr", "grace@example.test"), "grace@example.test");
});

test("the picker filters the current token and inserts only a picked suggestion", async () => {
  await withDOM(async ({ document, render }) => {
    const requests: string[] = [];
    const api: Api = async <T,>(url: string) => { requests.push(url); return suggestions as T; };
    const changes: string[] = [];
    await render(<Field api={api} initial="" changes={changes} />);
    const input = await type(document, "listed@example.test, gr");
    assert.deepEqual(requests, ["/contacts/suggestions?query=gr&accountId=work"]);
    assert.equal(input.getAttribute("aria-expanded"), "true");
    const options = [...document.querySelectorAll('[role="option"]')];
    assert.deepEqual(options.map((option) => option.getAttribute("aria-label")),
      ["Gregory Synthetic gregory@example.test, work@example.test", "grace@example.test, Home"]);
    assert.match(document.querySelector('[role="status"]')!.textContent!, /2 suggestions/);
    assert.ok(document.querySelector("[data-escape-owner]"), "Escape belongs to the open list, not the composer");

    await key(input, "Enter");
    assert.deepEqual(changes, ["listed@example.test,gr"], "Enter without a chosen option inserts nothing");
    await key(input, "ArrowDown");
    await key(input, "ArrowDown");
    assert.equal(input.getAttribute("aria-activedescendant"), options[1].id);
    assert.equal(options[1].getAttribute("aria-selected"), "true");
    await key(input, "Enter");
    assert.equal(changes.at(-1), "listed@example.test, grace@example.test");
    assert.equal(input.getAttribute("aria-expanded"), "false");
    assert.equal(document.querySelector('[role="listbox"]'), null);
  });
});

test("Escape dismisses suggestions and a click picks one", async () => {
  await withDOM(async ({ document, render }) => {
    const api: Api = async <T,>() => suggestions as T;
    const changes: string[] = [];
    await render(<Field api={api} initial="" changes={changes} />);
    const input = await type(document, "gr");
    await key(input, "Escape");
    assert.equal(input.getAttribute("aria-expanded"), "false");
    assert.equal(document.querySelector("[data-escape-owner]"), null);
    await key(input, "ArrowDown");
    assert.equal(input.getAttribute("aria-expanded"), "true");
    await act(async () => { document.querySelectorAll<HTMLElement>('[role="option"]')[0].click(); });
    assert.equal(changes.at(-1), "gregory@example.test");
  });
});

test("privacy mode hides suggested names and addresses until revealed", async () => {
  await withDOM(async ({ document, render }) => {
    const api: Api = async <T,>() => suggestions as T;
    const revealed = new Set<string>();
    const changes: string[] = [];
    const tree = () => <PrivacyContext.Provider value={{ on: true, revealed, toggle: (value) => { revealed.add(value); void render(tree()); } }}>
      <Field api={api} initial="" changes={changes} />
    </PrivacyContext.Provider>;
    await render(tree());
    await type(document, "gr");
    const list = document.querySelector('[role="listbox"]')!;
    for (const text of ["Gregory", "gregory@example.test", "grace@example.test", "work@example.test"])
      assert.equal(list.outerHTML.includes(text), false, `${text} is hidden`);
    assert.deepEqual([...list.querySelectorAll('[role="option"]')].map((option) => option.getAttribute("aria-label")),
      ["Hidden contact, Account 1 · Custom IMAP", "Hidden recipient, Home"]);
    await act(async () => { list.querySelectorAll<HTMLElement>(".veiled")[1].click(); });
    assert.equal(changes.length, 1, "revealing does not pick");
    assert.ok(document.querySelector('[role="listbox"]')!.textContent!.includes("gregory@example.test"));
  });
});
