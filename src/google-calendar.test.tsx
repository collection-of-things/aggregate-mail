import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { GoogleCalendar } from "./work/GoogleCalendar";
import type { State } from "../shared/types";
import type { CalendarEvents } from "./work/events";

test("connected event access retains per-account re-consent for missing free/busy permission", () => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { desktop: { oauthUrl: "/api/oauth/google" } } });
  try {
    const state = { accounts: [{ id: "a", email: "a@example.test", provider: "gmail" }, { id: "b", email: "b@example.test", provider: "gmail" }], googleConfigured: true } as State;
    const calendar: CalendarEvents = { events: [], error: "", loaded: true, pending: false,
      google: state.accounts.map(account => ({ accountId: account.id, status: "connected", calendars: [], syncedAt: 1, stale: false })),
      coverage: [{month:"2026-10", failed:false, google: state.accounts.map(account => ({ accountId: account.id, status: "connected", calendars: [], syncedAt: 1, stale: false }))}],
      refresh: async () => true, mutate: async (task) => ({ ok: true, value: await task() }) };
    const dom = new JSDOM(renderToStaticMarkup(<GoogleCalendar state={state} calendar={calendar} api={async () => { throw new Error("Rendering must not contact a provider"); }} months={["2026-10"]} accountFilter="all" />));
    try {
      const links = [...dom.window.document.querySelectorAll<HTMLAnchorElement>("a")];
      assert.deepEqual(links.map(link => [link.textContent, link.getAttribute("href")]), [
        ["Reconnect Google Calendar", "/api/oauth/google?calendar=1&accountId=a"],
        ["Reconnect Google Calendar", "/api/oauth/google?calendar=1&accountId=b"],
      ]);
      assert.equal(dom.window.document.querySelectorAll("button").length, 2, "Existing sync remains available");
    } finally { dom.window.close(); }
  } finally {
    if (prior) Object.defineProperty(globalThis, "window", prior); else Reflect.deleteProperty(globalThis, "window");
  }
});


test("cross-month Google coverage stays visible and each Sync uses its exact existing month", async () => {
  const { act } = await import("react"), { createRoot } = await import("react-dom/client");
  const { monthRange } = await import("./work/events");
  const dom = new JSDOM("<div id='root'></div>", {url:"http://localhost/"});
  const globals = {window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true};
  const before = new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for (const [key,value] of Object.entries(globals)) Object.defineProperty(globalThis,key,{configurable:true,value});
  const root = createRoot(document.getElementById("root")!);
  const state = {accounts:[{id:"a",provider:"gmail",email:"a@example.test"}],googleConfigured:true} as State;
  const status = {accountId:"a",status:"connected" as const,calendars:[],stale:false,syncedAt:1};
  const calendar:CalendarEvents = {events:[],google:[{...status,stale:true,syncedAt:0}],coverage:[{month:"2026-10",google:[status],failed:false},{month:"2026-11",google:[],failed:true}],error:"",loaded:true,pending:false,refresh:async()=>true,mutate:async task=>({ok:true,value:await task()})};
  const calls: {url:string;method:string;body:unknown}[] = [];
  const api: import("./api").Api = async <T,>(url:string,method="GET",body?:unknown)=>{calls.push({url,method,body});return {ok:true} as T;};
  try {
    await act(async()=>root.render(<GoogleCalendar state={state} calendar={calendar} api={api} months={["2026-10","2026-11"]} accountFilter="all"/>));
    assert.equal(calls.length,0);
    const warning = [...document.querySelectorAll('[role="status"]')].find(element=>element.textContent?.includes("coverage is incomplete"));
    assert.ok(warning);assert.equal(warning.closest("details"),null,"coverage warning remains outside the collapsed disclosure");
    assert.match(document.querySelector("summary")!.textContent!,/Coverage incomplete/);
    assert.match(document.querySelectorAll(".google-calendar-month")[1].textContent!,/Cache read failed/);
    for (const month of ["2026-11","2026-10"]) {
      const button=[...document.querySelectorAll("button")].find(button=>button.textContent===`Sync ${month}`)!;
      await act(async()=>button.click());
      assert.deepEqual(calls.at(-1),{url:"/calendar/google/a/sync",method:"POST",body:monthRange(month)});
    }
    assert.equal(calls.length,2);
    calendar.google=[]; calendar.coverage=[{month:"2026-10",google:[],failed:false},{month:"2026-11",google:[],failed:false}];
    await act(async()=>root.render(<GoogleCalendar state={state} calendar={calendar} api={api} months={["2026-10","2026-11"]} accountFilter="all"/>));
    assert.match(document.querySelector("summary")!.textContent!,/Coverage incomplete/);
    assert.equal(calls.length,2,"missing status never triggers a provider read");
  } finally {
    await act(async()=>root.unmount());dom.window.close();
    for(const[key,descriptor]of before){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}
  }
});
