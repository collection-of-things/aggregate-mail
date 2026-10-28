import assert from "node:assert/strict";
import { test } from "node:test";
import { act, type ReactNode } from "react";
import { JSDOM } from "jsdom";
import type { ContactList, SavedContact } from "../shared/contacts";
import type { Account } from "../shared/types";
import type { Api } from "./api";
import { ContactsPage } from "./contacts/ContactsPage";
import { PrivacyContext } from "./ui/Privacy";

const accounts: Account[] = [{ id: "work", email: "work@example.test", provider: "imap" }];

async function withDOM(run: (ui: { document: Document; render: (node: ReactNode) => Promise<void> }) => Promise<void>) {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
  const globals = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true, confirm: () => true };
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

// An in-memory stand-in for the contact routes.
function fakeApi() {
  const list: ContactList = {
    saved: [],
    recent: [{ kind: "recent", id: "r1", accountId: "work", email: "recent@example.test", lastSentAt: 1 }],
  };
  const calls: string[] = [];
  const api: Api = async <T,>(url: string, method = "GET", body?: unknown) => {
    calls.push(`${method} ${url}`);
    const input = body as { name: string; email: string } | undefined;
    if (method === "POST" && input) list.saved.push({ kind: "saved", id: "c1", accountId: "work", updatedAt: 1, ...input });
    if (method === "PUT" && input) list.saved = list.saved.map((contact): SavedContact => ({ ...contact, ...input }));
    if (method === "DELETE" && url.startsWith("/contacts/recent/")) list.recent = [];
    else if (method === "DELETE") list.saved = [];
    return structuredClone(list) as T;
  };
  return { api, calls };
}

async function fill(document: Document, label: string, value: string) {
  const field = [...document.querySelectorAll("label")].find((item) => item.querySelector("span")?.textContent === label)!.querySelector("input")!;
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    field.focus();
    setValue.call(field, value);
    field.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}
const button = (document: Document, name: string) =>
  [...document.querySelectorAll("button")].find((item) => item.textContent === name || item.getAttribute("aria-label") === name)!;
const click = (element: HTMLElement) => act(async () => { element.click(); });

test("Contacts page lists, adds, edits and deletes contacts and removes recent recipients", async () => {
  await withDOM(async ({ document, render }) => {
    const { api, calls } = fakeApi();
    await render(<ContactsPage api={api} accounts={accounts} />);
    assert.match(document.body.textContent!, /No saved contacts\./);
    await click(button(document, "Recent recipients"));
    assert.match(document.body.textContent!, /recent@example\.test/);
    await click(button(document, "Saved contacts"));

    await click(button(document, "Add contact"));
    await fill(document, "Name", "Ada Synthetic");
    await fill(document, "Email address", "ada@example.test");
    await act(async () => { document.querySelector("form")!.requestSubmit(); });
    assert.ok(calls.includes("POST /contacts"));
    assert.match(document.body.textContent!, /Ada Synthetic/);
    assert.equal(document.querySelector('[role="status"]')!.textContent, "Contact saved.");

    await click(button(document, "Edit contact 1"));
    await fill(document, "Name", "Ada King");
    await act(async () => { document.querySelector("form")!.requestSubmit(); });
    assert.ok(calls.includes("PUT /contacts/c1"));
    assert.match(document.body.textContent!, /Ada King/);

    await click(button(document, "Delete contact 1"));
    assert.ok(calls.includes("DELETE /contacts/c1"));
    await click(button(document, "Recent recipients"));
    await click(button(document, "Remove recent recipient 1"));
    assert.ok(calls.includes("DELETE /contacts/recent/r1"));
    assert.match(document.body.textContent!, /No recent recipients\./);
    await click(button(document, "Saved contacts"));
    assert.match(document.body.textContent!, /No saved contacts\./);
  });
});

test("privacy mode hides contact names and addresses on the Contacts page", async () => {
  await withDOM(async ({ document, render }) => {
    const { api } = fakeApi();
    const privacy = (node: ReactNode) => <PrivacyContext.Provider value={{ on: true, revealed: new Set(), toggle() {} }}>{node}</PrivacyContext.Provider>;
    await render(<ContactsPage api={api} accounts={accounts} />);
    await click(button(document, "Add contact"));
    await fill(document, "Name", "Ada Synthetic");
    await fill(document, "Email address", "ada@example.test");
    await act(async () => { document.querySelector("form")!.requestSubmit(); });
    await click(button(document, "Edit contact 1"));
    (document.activeElement as HTMLElement | null)?.blur();
    await render(privacy(<ContactsPage api={api} accounts={accounts} />));
    for (const text of ["Ada Synthetic", "ada@example.test", "recent@example.test", "work@example.test"])
      assert.equal(document.body.innerHTML.includes(text), false, `${text} is hidden`);
    assert.ok(document.querySelectorAll(".veiled").length >= 2);
  });
});

test("import requires a preview and confirmation, hides personal preview data, and recovers from failure", async () => {
  await withDOM(async ({ document, render }) => {
    const calls: string[] = [];
    let fail = true;
    const api: Api = async <T,>(url: string) => {
      calls.push(url);
      if (url === "/contacts") return { saved: [], recent: [] } as T;
      if (url === "/contacts/import" && fail) throw new Error("Synthetic failure");
      return { added: 1, skipped: 2, duplicates: 1, sample: [{ name: "Private Person", email: "private@example.test" }] } as T;
    };
    await render(<PrivacyContext.Provider value={{ on: true, revealed: new Set(), toggle() {} }}><ContactsPage api={api} accounts={accounts} /></PrivacyContext.Provider>);
    await click(button(document, "Import contacts"));
    const file = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const bytes = new TextEncoder().encode('Name,Email\nPrivate Person,private@example.test');
    Object.defineProperty(file, "files", { configurable: true, value: [{ name: "contacts.csv", size: bytes.length, arrayBuffer: async () => bytes.buffer }] });
    await act(async () => { file.dispatchEvent(new window.Event("change", { bubbles: true })); });
    assert.ok(calls.includes("/contacts/import/preview"));
    assert.equal(calls.includes("/contacts/import"), false);
    assert.doesNotMatch(document.body.innerHTML, /Private Person|private@example.test/);
    assert.match(document.body.textContent!, /1 ready to import/);
    await click(button(document, "Import 1 contacts"));
    assert.match(document.body.textContent!, /Import could not be confirmed/);
    fail = false;
    await click(button(document, "Import 1 contacts"));
    assert.match(document.body.textContent!, /Imported 1 contact/);
    assert.equal(document.querySelector('[aria-label="Import preview"]'), null);
  });
});

test("enabling privacy hides an unfocused contact search until focused", async () => {
  await withDOM(async ({ document, render }) => {
    const { api } = fakeApi();
    const page = (on: boolean) => <PrivacyContext.Provider value={{ on, revealed: new Set(), toggle() {} }}><ContactsPage api={api} accounts={accounts} /></PrivacyContext.Provider>;
    await render(page(false));
    await fill(document, "Find contacts", "person@example.test");
    await act(async () => { (document.activeElement as HTMLElement).blur(); });
    await render(page(true));
    const field = document.querySelector<HTMLInputElement>('input[type="search"]')!;
    assert.equal(field.value, "");
    assert.doesNotMatch(document.body.innerHTML, /person@example.test/);
    await act(async () => { field.focus(); });
    assert.equal(field.value, "person@example.test");
  });
});

test("account removal clears cached contacts, edits and import previews while Contacts remains mounted", async () => {
  await withDOM(async ({ document, render }) => {
    const home: Account = { id: "home", email: "home@example.test", provider: "imap" };
    const list: ContactList = { saved: [{ kind: "saved", id: "c1", accountId: "work", name: "Removed Person", email: "removed@example.test", updatedAt: 1 }], recent: [{ kind: "recent", id: "r1", accountId: "work", email: "removed-recent@example.test", lastSentAt: 1 }] };
    const api: Api = async <T,>(url: string) => (url === "/contacts" ? structuredClone(list) : { added: 1, skipped: 0, duplicates: 0, sample: [{ name: "Preview Person", email: "preview@example.test" }] }) as T;
    await render(<ContactsPage api={api} accounts={[...accounts, home]} />);
    await click(button(document, "Edit contact 1"));
    await render(<ContactsPage api={api} accounts={[home]} />);
    assert.doesNotMatch(document.body.textContent!, /Removed Person|removed@example.test/);
    assert.equal(document.querySelector(".contact-form"), null);
    await click(button(document, "Recent recipients"));
    assert.doesNotMatch(document.body.textContent!, /removed-recent@example.test/);
    await render(<ContactsPage api={api} accounts={[...accounts, home]} />);
    await click(button(document, "Import contacts"));
    const file = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const bytes = new TextEncoder().encode('Name,Email\nPreview Person,preview@example.test');
    Object.defineProperty(file, "files", { configurable: true, value: [{ name: "contacts.csv", size: bytes.length, arrayBuffer: async () => bytes.buffer }] });
    await act(async () => { file.dispatchEvent(new window.Event("change", { bubbles: true })); });
    assert.ok(document.querySelector('[aria-label="Import preview"]'));
    await render(<ContactsPage api={api} accounts={[home]} />);
    assert.equal(document.querySelector('[aria-label="Import preview"]'), null);
    assert.doesNotMatch(document.body.innerHTML, /preview@example.test/);
  });
});
