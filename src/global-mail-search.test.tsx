import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import type { Account, Draft, DraftSummary, MailSearchResult } from "../shared/types";
import type { Api } from "./api";
import { useMailSearch } from "./use-mail-search";
import { DraftList } from "./compose/DraftList";
import { accountLabel } from "./mail-ui";

const accounts: Account[] = [{ id: "a", email: "one@example.test", provider: "imap" }, { id: "b", email: "two@example.test", provider: "imap" }];
const draft: Draft = { id: "same", accountId: "a", revision: 2, updatedAt: 1, to: "client@example.test", subject: "Proposal", body: "x".repeat(500) + " Needle", sendUnknown: true };
const summary: DraftSummary = { id: draft.id, accountId: draft.accountId, revision: draft.revision, updatedAt: 1, to: draft.to, subject: draft.subject, preview: "x".repeat(200), sendUnknown: true };
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
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 145)); });

test("draft-only search debounces once, aborts superseded work and reuses stable results until same-count save", async () => {
  const ui = await fixture();
  const requests: { url: string; signal?: AbortSignal; resolve: (value: MailSearchResult) => void }[] = [];
  const api: Api = (url, _method, _body, signal) => new Promise(resolve => requests.push({ url, signal, resolve: value => resolve(value as never) }));
  let latest!: ReturnType<typeof useMailSearch>;
  function Probe({ query, token, copies = false }: { query: string; token: string; copies?: boolean }) {
    latest = useMailSearch(query, copies ? accounts.map(a => ({ ...a })) : accounts, [], api, token);
    return <p>{latest.pending ? "Pending" : (latest.drafts?.length ?? 0)}</p>;
  }
  const render = (query: string, token = "d1", copies = false) => act(async () => ui.root.render(<Probe query={query} token={token} copies={copies} />));
  try {
    await render("n"); await render("ne"); await render("needle"); await settle();
    assert.equal(requests.length, 1, "one request for a burst, even with no cached mail");
    assert.ok(requests[0].url.includes("query=needle"));
    await act(async () => requests[0].resolve({ mailCursor: "m:0", draftToken: "d1", matches: [{ kind: "draft", ...summary }] }));
    const first = latest;
    await render("needle", "d1", true); await settle();
    assert.equal(requests.length, 1, "equivalent account/cache input does no work");
    assert.equal(latest.matches, first.matches, "unchanged state does not refilter mail");
    assert.equal(latest.drafts, first.drafts);
    assert.equal(latest, first);
    await render("needle", "d2"); await settle();
    assert.equal(requests.length, 2, "a saved body edit invalidates an unchanged query");
    assert.equal(requests[0].signal?.aborted, true);
    await render("replacement", "d2"); await settle();
    assert.equal(requests[1].signal?.aborted, true);
    await act(async () => requests[1].resolve({ mailCursor: "m:0", draftToken: "d2", matches: [{ kind: "draft", ...summary }] }));
    assert.equal(latest.pending, true, "a late prior query never publishes drafts");
    await act(async () => requests[2].resolve({ mailCursor: "m:0", draftToken: "d1", matches: [{ kind: "draft", ...summary }] }));
    assert.equal(latest.drafts.length, 0, "stale draft tokens never publish results");
    await render('body:"open', "d2"); await settle();
    assert.equal(requests.length, 3, "invalid queries make no request");
    assert.ok(latest.error);
    await render("replacement", "d3"); await settle();
    assert.equal(requests.length, 4);
    await ui.close();
    assert.equal(requests[3].signal?.aborted, true, "unmount cancels the last request");
  } finally { await ui.close(); }
});

test("draft opening rejects query/account/compose changes and stale revisions before replacing a compose session", async () => {
  const ui = await fixture();
  const opened: Draft[] = [];
  let resolve: ((value: Draft) => void) | undefined;
  const api: Api = url => url.endsWith("/drafts/same") ? new Promise(done => { resolve = value => done(value as never); }) : Promise.resolve((url.startsWith("/accounts/a/") ? [summary] : []) as never);
  const render = (filter = "all", active = true, refreshKey = "d1", list = accounts, query = "") => act(async () => ui.root.render(<DraftList accounts={list} api={api} accountFilter={filter} query={query} search={query ? { drafts: [summary], pending: false, error: undefined, matches: () => false, refresh() {} } : undefined} refreshKey={refreshKey} active={active} onOpen={value => opened.push(value)} />));
  const click = () => act(async () => ui.container.querySelector<HTMLButtonElement>(".draft-row")!.click());
  try {
    await render(); await click(); await render("all", true, "d1", accounts, "needle"); await act(async () => resolve?.(draft));
    assert.equal(opened.length, 0, "query changes invalidate an opening");
    await render(); await click(); await render("b"); await act(async () => resolve?.(draft));
    assert.equal(opened.length, 0, "account navigation invalidates an opening");
    await render(); await click(); await render("all", false); await act(async () => resolve?.(draft));
    assert.equal(opened.length, 0, "a composer/modal opening meanwhile owns the session");
    await render(); await click(); await render("all", true, "d1", accounts.filter(a => a.id !== "a")); await act(async () => resolve?.(draft));
    assert.equal(opened.length, 0, "removed account cannot open a draft");
    await render(); await click(); await act(async () => resolve?.({ ...draft, revision: 3 }));
    assert.equal(opened.length, 0, "a changed revision needs explicit refresh");
    assert.match(ui.container.textContent!, /changed|Refresh/);
    await render(); await click(); await act(async () => resolve?.(draft));
    assert.deepEqual(opened, [draft]);
    await click(); await ui.close(); await act(async () => resolve?.(draft));
    assert.equal(opened.length, 1, "unmount invalidates opening requests");
  } finally { await ui.close(); }
});

test("privacy-safe account labels distinguish address-only names and retain meaningful custom names", () => {
  const named = accounts.map(a => ({ ...a, name: a.email }));
  assert.equal(accountLabel(named[0], 0, true, named), "Account 1 · Custom IMAP");
  assert.equal(accountLabel(named[1], 1, true, named), "Account 2 · Custom IMAP");
  const duplicates = accounts.map(a => ({ ...a, name: "Account" }));
  assert.notEqual(accountLabel(duplicates[0], 0, true, duplicates), accountLabel(duplicates[1], 1, true, duplicates));
  assert.equal(accountLabel({ ...accounts[0], name: "Studio <one@example.test>" }, 0, true), "Studio <••••••••>");
  assert.equal(accountLabel({ ...accounts[0], name: "Studio" }, 0, true), "Studio");
});
