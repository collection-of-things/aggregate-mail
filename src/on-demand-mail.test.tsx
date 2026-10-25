import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import type { Mail, MailBodyResponse, MailSearchResult, MailSummary } from "../shared/types";
import type { Api } from "./api";
import { replySource, useMailBody } from "./mail-body";
import { Reader } from "./mail/Reader";
import { useMailSearch } from "./use-mail-search";

const full: Mail = { id: "same-id", accountId: "a", remoteId: "1", messageId: "<source@example.test>", sender: "Sender", address: "sender@example.test", to: "reader@example.test", subject: "Synthetic",
  preview: "Summary only", body: "Locally cached private body", html: '<p>Locally cached private body</p><img src="https://images.example.test/a.png" alt="Image">', images: [{ src: "https://images.example.test/a.png", alt: "Image" }], attachments: [], date: 1, unread: false, archived: false, category: "other", relevance: 1, reason: "", snoozedUntil: null };
const summary = (accountId = "a", contentVersion = "v1"): MailSummary => {
  const { body: _body, html: _html, images: _images, invitation: _invitation, ...metadata } = full;
  return { ...metadata, accountId, contentVersion, inboxTab: "primary" };
};

test("recovered replies resolve exactly one source in the sending account", () => {
  const draft = { accountId: "a", inReplyTo: full.messageId };
  assert.equal(replySource([summary("b"), summary()], draft)?.accountId, "a");
  assert.equal(replySource([summary("b")], draft), undefined);
  assert.equal(replySource([summary(), { ...summary(), id: "duplicate" }], draft), undefined);
  assert.equal(replySource([summary()], { accountId: "a", inReplyTo: "missing" }), undefined);
});

test("summary hydration preserves legacy content recovery and retry without image activation", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>");
  const globals = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const { html: _html, attachments: _attachments, images: _images, ...legacy } = full;
  const requests: string[] = [];
  let contentAttempts = 0;
  const api: Api = async (url, method) => {
    requests.push(url);
    if (url.includes("/body?")) return { mail: legacy, contentVersion: "v1" } as never;
    assert.equal(url, `/messages/${full.id}/content`);
    assert.equal(method, "POST");
    if (++contentAttempts === 1) throw new Error("Synthetic content recovery failure");
    return { html: full.html, images: full.images, attachments: [{ id: "file", filename: "synthetic.txt", size: 12, contentType: "text/plain" }] } as never;
  };
  const button = (label: string) => {
    const found = [...container.querySelectorAll("button")].find(candidate => candidate.textContent === label);
    assert.ok(found, `${label} control is available`);
    return found;
  };
  try {
    await act(async () => root.render(<Reader mail={summary()} labels={[]} busy={false} api={api} onLabels={() => {}} onMenu={() => {}} onMenuKey={() => {}} />));
    assert.equal(contentAttempts, 1, "missing legacy metadata must request content recovery after body hydration");
    assert.match(container.textContent || "", /Formatted email is unavailable/);
    assert.match(container.textContent || "", /Locally cached private body/);
    assert.match(container.textContent || "", /Attachment metadata is not yet available/);
    assert.equal(container.querySelectorAll(".avatar-logo").length, 1, "the local sender avatar is separate from message image consent");
    assert.equal(container.querySelectorAll('[aria-label="Email content"] img').length, 0);
    await act(async () => button("Try again").click());
    assert.equal(contentAttempts, 2);
    assert.doesNotMatch(container.textContent || "", /Formatted email is unavailable/);
    assert.match(container.textContent || "", /synthetic.txt/);
    assert.ok(container.querySelector('button[aria-label="Download attachment 1"]'));
    assert.equal(container.querySelectorAll('[aria-label="Email content"] img').length, 0, "recovery must not activate remote images");
    await act(async () => button("Show images").click());
    assert.equal(container.querySelectorAll('[aria-label="Email content"] img').length, 1);
    await act(async () => button("Hide images").click());
    assert.equal(container.querySelectorAll('[aria-label="Email content"] img').length, 0);
    assert.equal(requests.length, 3, "only local body and content recovery requests are made");
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});

test("body hydration rejects late, cross-account and changed-version completions; reader resets image consent", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>");
  const globals = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const pending: { url: string; resolve: (value: MailBodyResponse) => void; signal?: AbortSignal }[] = [];
  const api: Api = (url, _method, _body, signal) => new Promise(resolve => pending.push({ url, signal, resolve: value => resolve(value as never) }));
  function Probe({ mail }: { mail?: MailSummary }) {
    const result = useMailBody(mail, api);
    return <p>{result.mail?.body || result.error || "Loading"}</p>;
  }
  try {
    await act(async () => root.render(<Probe mail={summary()} />));
    const a = pending[0];
    assert.ok(a.url.includes("accountId=a"));
    await act(async () => root.render(<Probe mail={summary("b")} />));
    assert.equal(a.signal?.aborted, true);
    await act(async () => a.resolve({ mail: full, contentVersion: "v1" }));
    assert.doesNotMatch(container.textContent || "", /private body/);
    await act(async () => pending[1].resolve({ mail: full, contentVersion: "v1" }));
    assert.doesNotMatch(container.textContent || "", /private body/);
    await act(async () => root.render(<Probe mail={summary("a", "v2")} />));
    await act(async () => pending[2].resolve({ mail: full, contentVersion: "v1" }));
    assert.doesNotMatch(container.textContent || "", /private body/);
    await act(async () => root.render(<Probe mail={undefined} />));
    assert.doesNotMatch(container.textContent || "", /private body/);
    const reader = (mail: MailSummary) => <Reader mail={mail} labels={[]} busy={false} api={api} onLabels={() => {}} onMenu={() => {}} onMenuKey={() => {}} />;
    await act(async () => root.render(reader(summary())));
    assert.doesNotMatch(container.textContent || "", /private body/);
    await act(async () => pending.at(-1)!.resolve({ mail: full, contentVersion: "v1" }));
    assert.match(container.textContent || "", /Locally cached private body/);
    assert.equal(container.querySelectorAll('[aria-label="Email content"] img').length, 0);
    const show = [...container.querySelectorAll("button")].find(button => button.textContent === "Show images")!;
    await act(async () => show.click()); assert.equal(container.querySelectorAll('[aria-label="Email content"] img').length, 1);
    await act(async () => root.render(reader(summary("a", "v3"))));
    assert.equal(container.querySelectorAll('[aria-label="Email content"] img').length, 0);
    await act(async () => pending.at(-1)!.resolve({ mail: full, contentVersion: "v3" }));
    assert.equal(container.querySelectorAll('[aria-label="Email content"] img').length, 0, "a changed source cannot reuse image consent");
    const searches: { resolve: (value: MailSearchResult) => void; signal?: AbortSignal }[] = [];
    const searchApi: Api = (_url, _method, _body, signal) => new Promise(resolve => searches.push({ signal, resolve: value => resolve(value as never) }));
    function SearchProbe({ query, mail }: { query: string; mail: MailSummary }) {
      const result = useMailSearch(query, [], [mail], searchApi);
      return <p>{result.matches(mail) ? "Matched" : result.pending ? "Pending" : "No match"}</p>;
    }
    const renderSearch = async (query: string, mail = summary()) => {
      await act(async () => root.render(<SearchProbe query={query} mail={mail} />));
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 150)); });
    };
    await renderSearch("body:local"); const oldSearch = searches[0];
    await renderSearch("body:other");
    assert.equal(oldSearch.signal?.aborted, true);
    await act(async () => oldSearch.resolve({ mailCursor: "old:1", matches: [summary()] }));
    assert.equal(container.textContent, "Pending");
    await act(async () => searches[1].resolve({ mailCursor: "new:1", matches: [summary("a", "stale-version")] }));
    assert.equal(container.textContent, "No match", "search hits must identify the exact summary version");
    await renderSearch("body:local", summary("b"));
    await act(async () => searches[2].resolve({ mailCursor: "new:2", matches: [summary()] }));
    assert.equal(container.textContent, "No match", "cross-account results cannot match a same-id summary");
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});

test("pending body searches retain confirmed header matches through result and version refresh", async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const globals = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  const root = createRoot(document.getElementById('root')!);
  let resolve: ((value: unknown) => void) | undefined;
  let calls = 0;
  const api: Api = () => { calls++; return new Promise(done => { resolve = done; }) as never; };
  const hit = { ...summary(), subject: 'Design review' };
  const other = { ...summary(), id: 'other', subject: 'Different subject' };
  function Probe({ version = 'v1', query = 'desgin' }) {
    const rows = [{ ...hit, contentVersion: version }, other];
    const search = useMailSearch(query, [], rows, api);
    return <div>{rows.filter(search.matches).map(m => <span key={m.id}>{m.id}</span>)}<p>{search.pending ? 'Searching' : 'Ready'}</p></div>;
  }
  try {
    await act(async () => root.render(<Probe />));
    assert.match(document.body.textContent!, /same-id/);
    assert.match(document.body.textContent!, /Searching/);
    await act(async () => { await new Promise(r => setTimeout(r, 150)); });
    await act(async () => resolve!({ mailCursor: 'one:1', matches: [hit] }));
    assert.match(document.body.textContent!, /Ready/);
    await act(async () => root.render(<Probe version="v2" />));
    assert.match(document.body.textContent!, /same-id/);
    assert.match(document.body.textContent!, /Searching/);
    const before = calls;
    await act(async () => root.render(<Probe query="subject:Design" />));
    await act(async () => { await new Promise(r => setTimeout(r, 150)); });
    assert.match(document.body.textContent!, /same-id/);
    assert.match(document.body.textContent!, /Ready/);
    assert.equal(calls, before, 'header-only searches never wait on the body API');
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of previous) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
});
