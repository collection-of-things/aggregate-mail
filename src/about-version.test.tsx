import assert from "node:assert/strict";
import { test } from "node:test";
import { act, StrictMode } from "react";
import { Window } from "happy-dom";
import { version } from "../package.json";
import { AboutVersion } from "./settings/AboutVersion";
import type { UpdateBridge, UpdateState } from "../shared/updates";

test("About identifies browser version and host freshness without reloading", async () => {
  const dom = new Window({ url: "http://localhost/" });
  const meta = dom.document.createElement("meta"); meta.name = "emc2-build"; meta.content = "a".repeat(64); dom.document.head.append(meta);
  let latest: string | null = meta.content;
  let authenticated = true;
  let failed = false;
  let requests = 0;
  let updateEvents = 0;
  dom.addEventListener("emc2-update-ready", () => updateEvents++);
  const globals = { window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url: string, options: RequestInit) => {
      requests++; assert.equal(url, "/auth/session"); assert.equal(options.cache, "no-store"); assert.ok(options.signal);
      if (failed) throw new Error("offline");
      return { ok: true, json: async () => ({ authenticated }), headers: new Headers(latest ? { "X-Emc2-Build": latest } : {}) };
    } };
  const prior = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import("react-dom/client");
  const container = dom.document.createElement("div"); dom.document.body.append(container);
  const root = createRoot(container as unknown as HTMLElement);
  const text = () => container.textContent || "";
  const check = () => act(async () => container.querySelector("button")!.click());
  try {
    await act(async () => root.render(<StrictMode><dl><AboutVersion /></dl></StrictMode>));
    assert.match(text(), new RegExp(`Emc² ${version.replaceAll(".", "\\.")}`));
    assert.match(text(), /Build aaaaaaaa/); assert.match(text(), /Latest version on this host/);
    latest = "b".repeat(64); await check();
    assert.match(text(), /newer build is ready/); assert.equal(updateEvents, 1);
    authenticated = false; await check(); assert.match(text(), /Could not confirm/); assert.equal(updateEvents, 1);
    authenticated = true; latest = null; await check(); assert.match(text(), /Could not confirm/);
    latest = "invalid"; await check(); assert.match(text(), /Could not confirm/);
    failed = true; await check(); assert.match(text(), /Could not confirm/);
    failed = false; latest = meta.content; await check(); assert.match(text(), /Latest version on this host/);
    await act(async () => root.render(<dl><AboutVersion key="missing-build" /></dl>));
    // A development page cannot prove freshness without a stamped build.
    meta.remove();
    const before = requests;
    await act(async () => root.render(<dl><AboutVersion key="development" /></dl>));
    assert.match(text(), /Could not confirm/); assert.equal(requests, before);
    assert.equal(container.querySelector("button")!.disabled, true);
  } finally {
    await act(async () => root.unmount()); await dom.happyDOM.close();
    for (const [key, descriptor] of prior) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});

test("About uses desktop update state, preserves newer events and checks without installing", async () => {
  const dom = new Window({ url: "http://localhost/" });
  let listener: ((state: UpdateState) => void) | undefined;
  let resolveInitial!: (state: UpdateState) => void;
  let finish!: (state: UpdateState) => void;
  const commands: string[] = [];
  const bridge: UpdateBridge = {
    state: () => new Promise(resolve => { resolveInitial = resolve; }),
    command: command => { commands.push(command); return new Promise(resolve => { finish = resolve; }); },
    onState: callback => { listener = callback; return () => { listener = undefined; }; }, onDrain: () => () => {},
  };
  Object.assign(dom, { desktop: { updates: bridge } });
  const globals = { window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true };
  const prior = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import("react-dom/client");
  const container = dom.document.createElement("div"); dom.document.body.append(container);
  const root = createRoot(container as unknown as HTMLElement);
  const button = () => container.querySelector("button")!;
  const text = () => container.textContent || "";
  try {
    await act(async () => root.render(<StrictMode><dl><AboutVersion /></dl></StrictMode>));
    assert.deepEqual(commands, []);
    await act(async () => { listener!({ phase: "available", version: "9.0.0" }); resolveInitial({ phase: "current" }); });
    assert.match(text(), /Update 9.0.0 available/); assert.doesNotMatch(text(), /Build/);
    await act(async () => button().click()); assert.equal(button().disabled, true); assert.match(text(), /Checking/);
    await act(async () => button().click()); assert.deepEqual(commands, ["check"]);
    await act(async () => { listener!({ phase: "available", version: "9.1.0" }); finish({ phase: "current" }); });
    assert.match(text(), /Update 9.1.0 available/);
    await act(async () => listener!({ phase: "current" })); assert.match(text(), /latest stable version/);
    await act(async () => listener!({ phase: "error", reason: "network" })); assert.match(text(), /Could not confirm/);
    await act(async () => listener!({ phase: "unsupported", reason: "development" }));
    assert.match(text(), /unavailable for this build/); assert.equal(button().disabled, true);
  } finally {
    await act(async () => root.unmount()); assert.equal(listener, undefined); await dom.happyDOM.close();
    for (const [key, descriptor] of prior) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
