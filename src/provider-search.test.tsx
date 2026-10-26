import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import type { Account, ProviderSearchResult } from "../shared/types";
import type { Api } from "./api";
import { providerSearchCoverage } from "./provider-search";
import { ProviderSearch } from "./mail/ProviderSearch";

const result = (over: Partial<ProviderSearchResult>): ProviderSearchResult =>
  ({ accountId: "a", source: "gmail", limit: 100, examined: 0, imported: 0, complete: true, narrowed: [], ...over });

test("provider search coverage names the source, scope and remaining matches", () => {
  assert.equal(providerSearchCoverage(result({})), "Gmail search: no matches.");
  assert.equal(providerSearchCoverage(result({ examined: 1, imported: 1 })), "Gmail search: all 1 match, 1 new.");
  assert.equal(providerSearchCoverage(result({ examined: 5, imported: 5 })), "Gmail search: all 5 matches, 5 new.");
  assert.equal(providerSearchCoverage(result({ examined: 100, imported: 12, complete: false })), "Gmail search, first 100 matches, 12 new. More remain on the server.");
  assert.equal(providerSearchCoverage(result({ source: "imap", examined: 3, imported: 3, mailboxes: ["archive", "sent"] })), "IMAP search of Archive and Sent: all 3 matches, 3 new.");
  assert.equal(providerSearchCoverage(result({ source: "imap", examined: 3, imported: 3, mailboxes: ["all"] })), "IMAP search of All Mail: all 3 matches, 3 new.");
  assert.equal(providerSearchCoverage(result({ examined: 5, imported: 5, narrowed: ["account:", "is:pinned"] })), "Gmail search: all 5 matches, 5 new. Applied after import: account:, is:pinned.");
});

async function fixture() {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
  const globals = { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  const container = document.getElementById("root")!;
  const root = createRoot(container);
  let closed = false;
  return { container, root, async close() { if (closed) return; closed = true; await act(async () => root.unmount()); dom.window.close(); for (const [key, value] of previous) if (value) Object.defineProperty(globalThis, key, value); else Reflect.deleteProperty(globalThis, key); } };
}

const account: Account = { id: "a", email: "one@example.test", provider: "imap", name: "Personal" };

test("older mail search asks the provider only on activation and reports coverage", async () => {
  const ui = await fixture();
  const requests: { url: string; method?: string; body: unknown; signal?: AbortSignal; resolve: (value: ProviderSearchResult) => void }[] = [];
  const api: Api = (url, method, body, signal) => new Promise(resolve => requests.push({ url, method, body, signal, resolve: value => resolve(value as never) }));
  let reloads = 0;
  const render = (selected: Account | undefined, query: string) => act(async () => ui.root.render(
    <ProviderSearch api={api} query={query} account={selected} accountName={selected ? "Personal" : ""} blocked={false} visible reload={() => { reloads++; return Promise.resolve(); }} />));
  try {
    await render(account, "needle");
    assert.equal(requests.length, 0, "nothing is requested before the button is clicked");
    const button = ui.container.querySelector("button")!;
    assert.match(button.textContent!, /Search older mail in Personal/);
    await act(async () => button.click());
    assert.equal(requests.length, 1, "one click sends one request");
    assert.equal(requests[0].url, "/accounts/a/search");
    assert.equal(requests[0].method, "POST");
    assert.deepEqual(requests[0].body, { query: "needle" });
    assert.match(ui.container.querySelector('[role="status"]')!.textContent!, /Searching Personal/);
    await act(async () => requests[0].resolve(result({ source: "imap", examined: 4, imported: 4, mailboxes: ["archive", "sent"] })));
    assert.equal(ui.container.querySelector('[role="status"]')!.textContent, "IMAP search of Archive and Sent: all 4 matches, 4 new.");
    assert.equal(reloads, 1, "imported mail reloads when no desktop mail-changed bridge exists");

    await act(async () => ui.root.render(
      <ProviderSearch api={api} query="again" account={account} accountName="Personal" blocked={false} visible reload={() => Promise.resolve()} />));
    await act(async () => ui.container.querySelector("button")!.click());
    assert.equal(requests.length, 2);
    const cancel = [...ui.container.querySelectorAll("button")].find((item) => item.textContent === "Cancel")!;
    await act(async () => cancel.click());
    assert.equal(requests[1].signal?.aborted, true, "Cancel aborts the request");
    await act(async () => requests[1].resolve(result({ examined: 4, imported: 4 })));
    assert.equal(ui.container.querySelector('[role="status"]'), null, "a cancelled run never shows coverage");
    assert.match(ui.container.querySelector("button")!.textContent!, /Search older mail in Personal/);

    await render(undefined, "again");
    assert.match(ui.container.textContent!, /Choose an account to search older mail\./);
    assert.equal(ui.container.querySelector("button"), null, "all accounts offers no request");
    assert.equal(requests.length, 2);
  } finally { await ui.close(); }
});

test("a query or account change cancels a running search", async () => {
  const ui = await fixture();
  const requests: { signal?: AbortSignal; resolve: (value: ProviderSearchResult) => void }[] = [];
  const api: Api = (_url, _method, _body, signal) => new Promise(resolve => requests.push({ signal, resolve: value => resolve(value as never) }));
  try {
    await act(async () => ui.root.render(
      <ProviderSearch api={api} query="needle" account={account} accountName="Personal" blocked={false} visible reload={() => Promise.resolve()} />));
    await act(async () => ui.container.querySelector("button")!.click());
    assert.equal(requests.length, 1);
    await act(async () => ui.root.render(
      <ProviderSearch api={api} query="changed" account={account} accountName="Personal" blocked={false} visible reload={() => Promise.resolve()} />));
    assert.equal(requests[0].signal?.aborted, true, "a changed query aborts the run");
    await act(async () => requests[0].resolve(result({ examined: 4, imported: 4 })));
    assert.equal(ui.container.querySelector('[role="status"]'), null, "stale results never render");
  } finally { await ui.close(); }
});
