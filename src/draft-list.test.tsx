import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";
import { JSDOM } from "jsdom";
import { DraftList } from "./compose/DraftList";
import { PrivacyContext } from "./ui/Privacy";
import type { Api } from "./api";
import type { Account, Draft } from "../shared/types";

test("Drafts lists account, envelope, snippet and saved time; scopes search, opens once and hides private details", async () => {
  const dom = new JSDOM('<div id="root"></div>', {url:"http://localhost"});
  const globals = {window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const previous = new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for (const [key,value] of Object.entries(globals)) Object.defineProperty(globalThis,key,{configurable:true,value});
  const accounts: Account[] = [{id:"a",email:"sender@example.test",name:"Studio",provider:"imap"},{id:"b",email:"other@example.test",provider:"gmail"}];
  const draft: Draft = {id:"one",accountId:"a",to:"client@example.test",cc:["copy@example.test"],subject:"Project plan",body:"A saved proposal",attachments:[],revision:2,updatedAt:1,sendUnknown:true};
  const requests: string[] = [], opened: Draft[] = [];
  const filters: string[] = [];
  let fail = false, release: (()=>void) | undefined;
  const api: Api = async <T,>(url: string, method = "GET") => {
    assert.equal(method,"GET"); requests.push(url);
    if(fail) throw Error("synthetic");
    if (url.startsWith("/messages/search?")) return { mailCursor: "m:0", draftToken: "d1", matches: [{kind: "draft", id: draft.id, accountId: draft.accountId, revision: draft.revision, updatedAt: draft.updatedAt, to: draft.to, cc: draft.cc, subject: draft.subject, preview: "A saved proposal", sendUnknown: true, attachmentCount: 1}] } as T;
    if(url.endsWith("/drafts/one")){await new Promise<void>(resolve=>{release=resolve;});return draft as T;}
    return (url.startsWith("/accounts/a/") ? [{...draft,preview:"A saved proposal",attachmentCount:1}] : [{...draft,id:"two",accountId:"b",subject:"Unrelated"}]) as T;
  };
  const {createRoot}=await import("react-dom/client");const root=createRoot(document.getElementById("root")!);
  const render=(filter="all",query="",privateText=false,key="cached")=>act(async()=>root.render(<PrivacyContext.Provider value={{on:privateText,names:["Studio"],revealed:new Set(),toggle(){}}}><DraftList key={key} accounts={accounts} api={api} accountFilter={filter} query={query} active onOpen={value=>opened.push(value)} onAccount={id=>filters.push(id)}/></PrivacyContext.Provider>));
  try {
    await render(); assert.equal(document.querySelector('[role="dialog"]'),null);assert.equal(document.querySelectorAll('.draft-row').length,2);
    assert.ok(document.querySelector('.draft-list-heading')!.classList.contains('visually-hidden'), 'healthy count banner does not consume a row');
    assert.ok(document.querySelector('.draft-refresh')!.closest('.draft-tab-bar'), 'Refresh shares the account row');
    assert.equal(document.querySelectorAll('.draft-row-identity').length, 2);
    const tabs = () => [...document.querySelectorAll<HTMLButtonElement>('.draft-account-tabs button')];
    assert.equal(tabs()[0].getAttribute('aria-pressed'), 'true');
    assert.equal(tabs()[0].querySelector('.tab-count')?.textContent, '2');
    await act(async () => tabs()[1].click());
    assert.deepEqual(filters, ['a']);
    const text=document.body.textContent!;
    for(const value of ["Studio","sender@example.test","client@example.test","copy@example.test","Project plan","A saved proposal","1 attachment","Send status unknown"]) assert.ok(text.includes(value),value);
    assert.equal(document.querySelector('time')?.getAttribute('dateTime'),new Date(1).toISOString());
    await render("a","proposal"); await act(async () => { await new Promise(resolve => setTimeout(resolve, 145)); }); assert.equal(document.querySelectorAll('.draft-row').length,1);
    await render("a","",true);
    assert.ok(document.querySelector('.draft-account-tabs')!.textContent!.includes('Studio'), 'custom labels stay visible under ADR 0034');
    for(const value of [draft.subject,draft.to,accounts[0].email,draft.body,"copy@example.test"]) assert.ok(!document.body.innerHTML.includes(value),value);
    const row=document.querySelector<HTMLButtonElement>('.draft-row')!;
    await act(async()=>{row.click();row.click();});assert.equal(requests.filter(url=>url.endsWith('/drafts/one')).length,1);assert.equal(opened.length,0);
    await act(async()=>release?.());assert.deepEqual(opened,[draft]);
    fail=true;await act(async()=>document.querySelector<HTMLButtonElement>('.draft-refresh')!.click());assert.match(document.querySelector('[role="alert"]')!.textContent!,/could not be loaded/);
    assert.equal(document.querySelectorAll('.draft-account-tabs .tab-count').length, 0);
    assert.match(document.querySelector('.draft-list-heading')!.textContent!,/1 cached draft · Count unavailable/);
    await render("all","",false,"fresh-failure");
    assert.match(document.querySelector('.draft-list-heading')!.textContent!,/Draft count unavailable/);
    assert.ok(!document.querySelector('.draft-list-heading')!.textContent!.includes('0 drafts'));
    fail=false;await act(async()=>document.querySelector<HTMLButtonElement>('.draft-refresh')!.click());
    assert.match(document.querySelector('.draft-list-heading')!.textContent!,/2 drafts · Saved on this device/);
  } finally { await act(async()=>root.unmount());dom.window.close();for(const[key,value]of previous)if(value)Object.defineProperty(globalThis,key,value);else Reflect.deleteProperty(globalThis,key); }
});

test("draft quick delete confirms uncertainty, locks requests and preserves account identity and failed rows", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
  let accepted = false;
  const prompts: string[] = [];
  const globals = { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true,
    confirm: (text: string) => { prompts.push(text); return accepted; } };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  const accounts: Account[] = [{ id: "a", email: "a@example.test", provider: "imap" }, { id: "b", email: "b@example.test", provider: "imap" }];
  const requests: { url: string; body: unknown }[] = [];
  let release: (() => void) | undefined, fail = false, changes = 0, opens = 0;
  const api: Api = async <T,>(url: string, method = "GET", body?: unknown) => {
    if (method === "DELETE") {
      requests.push({ url, body });
      await new Promise<void>(resolve => { release = resolve; });
      if (fail) throw Error("synthetic conflict or response loss");
      return { ok: true } as T;
    }
    const accountId = url.startsWith("/accounts/a/") ? "a" : "b";
    return [{ id: "shared", accountId, revision: 3, updatedAt: 1, to: "recipient@example.test", subject: "Same subject", sendUnknown: accountId === "a" }] as T;
  };
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root")!);
  try {
    await act(async () => root.render(<DraftList accounts={accounts} api={api} accountFilter="all" query="" active onOpen={() => opens++} onDeleted={() => changes++} />));
    const remove = () => document.querySelector<HTMLButtonElement>(".draft-row-delete")!;
    await act(async () => remove().click());
    assert.equal(requests.length, 0);
    assert.match(prompts[0], /may already have been sent/);
    accepted = true;
    await act(async () => { remove().click(); remove().click(); });
    assert.deepEqual(requests, [{ url: "/accounts/a/drafts/shared", body: { revision: 3, confirmUnknown: true } }]);
    assert.equal(opens, 0);
    await act(async () => release?.());
    assert.equal(document.querySelectorAll(".draft-row").length, 1);
    assert.equal(changes, 1);
    assert.equal(document.activeElement, document.querySelector(".draft-row"));
    fail = true;
    await act(async () => remove().click());
    assert.deepEqual(requests[1], { url: "/accounts/b/drafts/shared", body: { revision: 3 } });
    await act(async () => release?.());
    assert.equal(document.querySelectorAll(".draft-row").length, 1);
    assert.match(document.querySelector('[role="alert"]')!.textContent!, /could not be confirmed/);
    assert.equal(changes, 1);
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, value] of previous) if (value) Object.defineProperty(globalThis, key, value); else Reflect.deleteProperty(globalThis, key);
  }
});

test("draft deletion invalidates a delayed refresh so deleted rows stay removed", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
  const globals = { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true, confirm: () => true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  let reads = 0, writes = 0, release: (() => void) | undefined;
  const api: Api = async <T,>(_url: string, method = "GET") => {
    if (method === "DELETE") { writes++; return { ok: true } as T; }
    if (reads++ > 0) await new Promise<void>(resolve => { release = resolve; });
    return [{ id: "one", accountId: "a", revision: 1, updatedAt: 1, to: "recipient@example.test", subject: "Saved" }] as T;
  };
  const { createRoot } = await import("react-dom/client"); const root = createRoot(document.getElementById("root")!);
  try {
    await act(async () => root.render(<DraftList accounts={[{ id: "a", email: "a@example.test", provider: "imap" }]} api={api} accountFilter="all" query="" active onOpen={() => {}} />));
    await act(async () => document.querySelector<HTMLButtonElement>(".draft-refresh")!.click());
    await act(async () => document.querySelector<HTMLButtonElement>(".draft-row-delete")!.click());
    assert.equal(writes, 1);
    assert.equal(document.querySelectorAll(".draft-row").length, 0);
    await act(async () => release?.());
    assert.equal(document.querySelectorAll(".draft-row").length, 0);
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, value] of previous) if (value) Object.defineProperty(globalThis, key, value); else Reflect.deleteProperty(globalThis, key);
  }
});
