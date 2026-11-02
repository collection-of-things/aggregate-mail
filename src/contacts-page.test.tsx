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
    const bodies: unknown[] = [];
    let fail = true;
    const api: Api = async <T,>(url: string, method = "GET", body?: unknown) => {
      calls.push(url);
      if (method === "POST") bodies.push(body);
      if (url === "/contacts") return { saved: [], recent: [] } as T;
      if (url === "/contacts/import" && fail) throw new Error("Synthetic failure");
      return {
        added: 2, changed: 1, updated: 0, unchanged: 1, missing: 1, skipped: 1,
        sample: [{ name: "Private Person", email: "private@example.test" }, { name: "Second Person", email: "second@example.test" }],
        changes: [{ email: "renamed@example.test", name: "Renamed After", previousName: "Renamed Before" }],
        revision: "f".repeat(64),
      } as T;
    };
    await render(<PrivacyContext.Provider value={{ on: true, revealed: new Set(), toggle() {} }}><ContactsPage api={api} accounts={accounts} /></PrivacyContext.Provider>);
    await click(button(document, "Import contacts"));
    const file = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const bytes = new TextEncoder().encode('Name,Email\nPrivate Person,private@example.test');
    Object.defineProperty(file, "files", { configurable: true, value: [{ name: "contacts.csv", size: bytes.length, arrayBuffer: async () => bytes.buffer }] });
    await act(async () => { file.dispatchEvent(new window.Event("change", { bubbles: true })); });
    assert.ok(calls.includes("/contacts/import/preview"));
    assert.equal(calls.includes("/contacts/import"), false);
    assert.doesNotMatch(document.body.innerHTML, /Private Person|private@example.test|Second Person|second@example.test|Renamed Before|Renamed After|renamed@example.test/, "both lists hide names and addresses in text and attributes");
    assert.match(document.body.textContent!, /2 new, 1 with a changed name, 1 unchanged, 1 not in this file\. 1 invalid or repeated addresses skipped\./);
    assert.ok(document.querySelector('[aria-label="Import preview"]'));
    assert.ok(document.querySelector('[aria-label="Changed names"]'));
    const update = document.querySelector<HTMLInputElement>('.contact-import-preview input[type="checkbox"]')!;
    assert.equal(update.checked, false);
    assert.match(document.body.textContent!, /Update 1 existing name from this file/);
    assert.match(document.body.textContent!, /Saved contacts that are missing from the file stay saved\./);
    assert.equal(update.closest("label")!.querySelector("p"), null, "the update label holds only the checkbox and its text");
    await click(button(document, "Import 2 contacts"));
    assert.match(document.body.textContent!, /Import could not be confirmed/);
    const confirmed = bodies.at(-1) as { updateNames?: boolean; revision?: string };
    assert.equal(confirmed.updateNames, undefined, "updateNames is sent only when chosen");
    assert.equal(confirmed.revision, "f".repeat(64), "the confirm carries the preview's revision");
    fail = false;
    await act(async () => { update.click(); });
    assert.ok(button(document, "Import 2 and update 1"));
    await click(button(document, "Import 2 and update 1"));
    const updated = bodies.at(-1) as { updateNames?: boolean; revision?: string };
    assert.equal(updated.updateNames, true);
    assert.equal(updated.revision, "f".repeat(64), "the update confirm carries the preview's revision too");
    assert.match(document.body.textContent!, /Added 2, updated 0, skipped 2 already saved and 1 invalid or repeated\. None removed\./);
    assert.equal(document.querySelector('[aria-label="Import preview"]'), null);
  });
});

test("an import with only changed names stays disabled until the update choice", async () => {
  await withDOM(async ({ document, render }) => {
    const bodies: unknown[] = [];
    const api: Api = async <T,>(url: string, method = "GET", body?: unknown) => {
      if (method === "POST") bodies.push(body);
      if (url === "/contacts") return { saved: [], recent: [] } as T;
      return {
        added: 0, changed: 1, updated: 1, unchanged: 2, missing: 0, skipped: 0,
        sample: [],
        changes: [{ email: "renamed@example.test", name: "Renamed After", previousName: "Renamed Before" }],
        revision: "e".repeat(64),
      } as T;
    };
    await render(<ContactsPage api={api} accounts={accounts} />);
    await click(button(document, "Import contacts"));
    const file = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const bytes = new TextEncoder().encode('Name,Email\nRenamed After,renamed@example.test');
    Object.defineProperty(file, "files", { configurable: true, value: [{ name: "contacts.csv", size: bytes.length, arrayBuffer: async () => bytes.buffer }] });
    await act(async () => { file.dispatchEvent(new window.Event("change", { bubbles: true })); });
    assert.ok(document.querySelector('[aria-label="Changed names"]'));
    assert.match(document.querySelector('[aria-label="Changed names"]')!.textContent!, /Renamed Before → Renamed After · renamed@example.test/);
    const update = document.querySelector<HTMLInputElement>('.contact-import-preview input[type="checkbox"]')!;
    const action = () => document.querySelector<HTMLButtonElement>(".contacts-actions .button")!;
    assert.equal(action().disabled, true, "nothing to write without an update choice");
    assert.doesNotMatch(document.body.textContent!, /missing from the file stay saved/, "no missing-contacts note when none are missing");
    await act(async () => { update.click(); });
    assert.ok(button(document, "Update 1 name"));
    await click(button(document, "Update 1 name"));
    const sent = bodies.at(-1) as { updateNames?: boolean; revision?: string };
    assert.equal(sent.updateNames, true);
    assert.equal(sent.revision, "e".repeat(64), "the confirm carries the preview's revision");
    assert.match(document.body.textContent!, /Added 0, updated 1, skipped 2 already saved and 0 invalid or repeated\. None removed\./);
  });
});

test("changed names beyond five hide behind a disclosure and a rejected confirm shows an error", async () => {
  await withDOM(async ({ document, render }) => {
    const bodies: unknown[] = [];
    let fail = false;
    const changes = Array.from({ length: 6 }, (_, index) => ({ email: `old-${index}@example.test`, name: `New ${index}`, previousName: `Old ${index}` }));
    const api: Api = async <T,>(url: string, method = "GET", body?: unknown) => {
      if (method === "POST") bodies.push(body);
      if (url === "/contacts") return { saved: [], recent: [] } as T;
      if (url === "/contacts/import" && fail) throw new Error("Synthetic failure");
      return { added: 0, changed: 6, updated: 0, unchanged: 0, missing: 0, skipped: 0, sample: [], changes, revision: "e".repeat(64) } as T;
    };
    await render(<PrivacyContext.Provider value={{ on: true, revealed: new Set(), toggle() {} }}><ContactsPage api={api} accounts={accounts} /></PrivacyContext.Provider>);
    await click(button(document, "Import contacts"));
    const file = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const bytes = new TextEncoder().encode('Name,Email\nNew 0,old-0@example.test');
    Object.defineProperty(file, "files", { configurable: true, value: [{ name: "contacts.csv", size: bytes.length, arrayBuffer: async () => bytes.buffer }] });
    await act(async () => { file.dispatchEvent(new window.Event("change", { bubbles: true })); });
    assert.match(document.body.textContent!, /0 new, 6 with a changed name, 0 unchanged, 0 not in this file\./);
    assert.equal(document.querySelectorAll('[aria-label="Changed names"] li').length, 5, "the first five renames are listed directly");
    const disclosure = document.querySelector<HTMLDetailsElement>("details.contact-import-changes")!;
    assert.ok(disclosure, "the rest hide behind a disclosure");
    assert.equal(disclosure.querySelector("summary")!.textContent, "Show all 6 changed names");
    const rest = disclosure.querySelectorAll('[aria-label="Changed names (all)"] li');
    assert.equal(rest.length, 1, "the disclosure holds the sixth rename");
    for (const text of ["Old 0", "Old 5", "New 0", "New 5", "old-0@example.test", "old-5@example.test"])
      assert.equal(document.body.innerHTML.includes(text), false, `${text} is hidden in text and attributes`);
    await act(async () => { (document.querySelector('.contact-import-preview input[type="checkbox"]') as HTMLInputElement).click(); });
    fail = true;
    await click(button(document, "Update 6 names"));
    assert.match(document.body.textContent!, /Import could not be confirmed/);
    const sent = bodies.at(-1) as { updateNames?: boolean; revision?: string };
    assert.equal(sent.updateNames, true);
    assert.equal(sent.revision, "e".repeat(64), "the confirm carries the preview's revision");
  });
});

// A file-input fixture for the import flows.
const pickFile = async (document: Document) => {
  const file = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  const bytes = new TextEncoder().encode('Name,Email\nSomeone,someone@example.test');
  Object.defineProperty(file, "files", { configurable: true, value: [{ name: "contacts.csv", size: bytes.length, arrayBuffer: async () => bytes.buffer }] });
  await act(async () => { file.dispatchEvent(new window.Event("change", { bubbles: true })); });
  return bytes;
};

test("a stale confirm refreshes the preview and the next confirm sends its revision", async () => {
  await withDOM(async ({ document, render }) => {
    const { ApiError } = await import("./api");
    const bodies: unknown[] = [];
    const previews: unknown[] = [];
    const first = {
      added: 2, changed: 1, updated: 0, unchanged: 1, missing: 0, skipped: 0,
      sample: [{ name: "New One", email: "new.one@example.test" }],
      changes: [{ email: "old@example.test", name: "New Name", previousName: "Old Name" }],
      revision: "a".repeat(64),
    };
    const second = {
      added: 1, changed: 1, updated: 0, unchanged: 1, missing: 0, skipped: 0,
      sample: [{ name: "New Two", email: "new.two@example.test" }],
      changes: [{ email: "other@example.test", name: "Now This", previousName: "Was That" }],
      revision: "b".repeat(64),
    };
    let imports = 0;
    const api: Api = async <T,>(url: string, method = "GET", body?: unknown) => {
      if (method === "POST") bodies.push(body);
      if (url === "/contacts") return { saved: [], recent: [] } as T;
      if (url === "/contacts/import/preview") { previews.push(body); return (previews.length === 1 ? first : second) as T; }
      if (url === "/contacts/import") {
        if (++imports === 1) throw new ApiError(409, "Contacts changed since this preview. Preview the file again.");
        return { ...second, updated: 1, revision: "c".repeat(64) } as T;
      }
      return {} as T;
    };
    await render(<ContactsPage api={api} accounts={accounts} />);
    await click(button(document, "Import contacts"));
    const bytes = await pickFile(document);
    assert.equal(previews.length, 1);
    await act(async () => { document.querySelector<HTMLInputElement>('.contact-import-preview input[type="checkbox"]')!.click(); });
    await click(button(document, "Import 2 and update 1"));
    // The stale confirm is rejected; the same file is previewed again without
    // revision or updateNames, and the shown counts are the fresh ones.
    assert.equal(previews.length, 2, "the stale preview is refreshed");
    assert.deepEqual(previews[1], { accountId: "work", format: "csv", content: new TextDecoder().decode(bytes) }, "the refresh resends the file, not the stale revision");
    assert.match(document.body.textContent!, /Contacts changed since your preview\. Review the updated preview before importing\./);
    assert.match(document.body.textContent!, /1 new, 1 with a changed name, 1 unchanged, 0 not in this file\./);
    const update = document.querySelector<HTMLInputElement>('.contact-import-preview input[type="checkbox"]')!;
    assert.equal(update.checked, false, "the update choice resets with the fresh preview");
    // The next confirm sends the new preview's revision.
    await act(async () => { update.click(); });
    await click(button(document, "Import 1 and update 1"));
    const sent = bodies.at(-1) as { updateNames?: boolean; revision?: string };
    assert.equal(sent.updateNames, true);
    assert.equal(sent.revision, "b".repeat(64), "the retry carries the refreshed revision");
    assert.match(document.body.textContent!, /Added 1, updated 1, skipped 1 already saved and 0 invalid or repeated\. None removed\./);
  });
});

test("a stale confirm whose refresh also fails leaves no actionable preview", async () => {
  await withDOM(async ({ document, render }) => {
    const { ApiError } = await import("./api");
    let previews = 0;
    let imports = 0;
    const api: Api = async <T,>(url: string, method = "GET") => {
      if (url === "/contacts") return { saved: [], recent: [] } as T;
      if (url === "/contacts/import/preview") {
        if (++previews === 1) return {
          added: 1, changed: 0, updated: 0, unchanged: 0, missing: 0, skipped: 0,
          sample: [{ name: "New One", email: "new.one@example.test" }], changes: [], revision: "a".repeat(64),
        } as T;
        throw new ApiError(500, "Synthetic refresh failure");
      }
      if (url === "/contacts/import" && ++imports === 1) throw new ApiError(409, "Contacts changed since this preview. Preview the file again.");
      return {} as T;
    };
    await render(<ContactsPage api={api} accounts={accounts} />);
    await click(button(document, "Import contacts"));
    await pickFile(document);
    await click(button(document, "Import 1 contact"));
    assert.equal(previews, 2, "a stale confirm tries to refresh the preview");
    assert.match(document.body.textContent!, /Import could not be confirmed/);
    assert.equal(document.querySelector('[aria-label="Import preview"]'), null, "no stale preview stays actionable");
    const action = document.querySelector<HTMLButtonElement>(".contacts-actions .button");
    assert.equal(action, null, "the confirm button is gone with the preview");
  });
});

test("contacts missing from the file get the stay-saved note without a name change", async () => {
  await withDOM(async ({ document, render }) => {
    const api: Api = async <T,>(url: string) => (url === "/contacts" ? { saved: [], recent: [] }
      : { added: 1, changed: 0, updated: 0, unchanged: 1, missing: 2, skipped: 0, sample: [{ name: "New Person", email: "new@example.test" }], changes: [], revision: "d".repeat(64) }) as T;
    await render(<ContactsPage api={api} accounts={accounts} />);
    await click(button(document, "Import contacts"));
    const file = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const bytes = new TextEncoder().encode('Name,Email\nNew Person,new@example.test');
    Object.defineProperty(file, "files", { configurable: true, value: [{ name: "contacts.csv", size: bytes.length, arrayBuffer: async () => bytes.buffer }] });
    await act(async () => { file.dispatchEvent(new window.Event("change", { bubbles: true })); });
    assert.match(document.body.textContent!, /1 new, 0 with a changed name, 1 unchanged, 2 not in this file\./);
    assert.equal(document.querySelector('.contact-import-preview input[type="checkbox"]'), null, "no update choice without changed names");
    assert.match(document.body.textContent!, /Saved contacts that are missing from the file stay saved\./);
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
    const api: Api = async <T,>(url: string) => (url === "/contacts" ? structuredClone(list) : { added: 1, changed: 0, updated: 0, unchanged: 0, missing: 0, skipped: 0, sample: [{ name: "Preview Person", email: "preview@example.test" }], changes: [], revision: "c".repeat(64) }) as T;
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
    assert.equal(document.querySelector('[aria-label="Changed names"]'), null);
    assert.equal(document.querySelector('.contact-import-preview input[type="checkbox"]'), null, "no update choice without changed names");
    await render(<ContactsPage api={api} accounts={[home]} />);
    assert.equal(document.querySelector('[aria-label="Import preview"]'), null);
    assert.doesNotMatch(document.body.innerHTML, /preview@example.test/);
  });
});
