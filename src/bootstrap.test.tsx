import assert from "node:assert/strict";
import { test } from "node:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { App } from "./App";
import type { BootstrapResponse, StateResponse } from "../shared/types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const status: BootstrapResponse = { csrf: "synthetic-csrf", accounts: [{ id: "a", email: "reader@example.test", name: "Synthetic account", provider: "imap" }],
  labels: [], rules: [], draftCount: 1, googleConfigured: false, googleClientId: null, jevConfigured: false, jevProvider: "typesafe", aiConfigured: false, lastSync: null, syncing: false };
const full: StateResponse = { ...status, mailCursor: "synthetic:1", mailMode: "snapshot", removedMailIds: [], messages: [{ id: "a:1", accountId: "a", remoteId: "1", sender: "Sender", address: "sender@example.test", to: "reader@example.test", subject: "Cached subject", preview: "Preview", date: 1, unread: true, archived: false, category: "other", relevance: 1, reason: "", snoozedUntil: null, contentVersion: "synthetic-version", inboxTab: "primary" }] };
const json = (value: unknown, code = 200) => new Response(JSON.stringify(value), { status: code, headers: { "Content-Type": "application/json" } });

for (const scenario of ["status-first", "full-first", "bootstrap-failure", "retry", "auth-reset", "auth-after-status", "unmount", "retry-unmount", "browser-pending", "browser-failed"]) test(`startup bootstrap: ${scenario}`, async (context) => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost/?connected=1" });
  dom.window.HTMLElement.prototype.scrollTo = () => {}; dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  const globals = { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, location: dom.window.location, history: dom.window.history, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element,
    requestAnimationFrame: (callback: FrameRequestCallback) => { callback(0); return 0; }, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  let changed: (() => void) | undefined;
  window.desktop = { platform: "linux", materials: false, oauthUrl: "", windowCommand() {}, onWindowState: () => () => {}, onNavigation: () => () => {}, onAccountConnected: () => () => {}, onMailChanged: callback => { changed = callback; return () => { changed = undefined; }; } };
  const browser = scenario.startsWith("browser-");
  if (browser) { delete window.desktop; context.mock.timers.enable({ apis: ["setInterval"] }); }
  const bootstrap = deferred<Response>(), mail = deferred<Response>(), retry = deferred<Response>();
  const requests: { url: string; csrf: string | null; signal?: AbortSignal | null }[] = [];
  let reads = 0;
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    const url = String(input); requests.push({ url, csrf: new Headers(options?.headers).get("X-CSRF-Token"), signal: options?.signal });
    if (url === "/api/bootstrap") return bootstrap.promise;
    if (url.startsWith("/api/state")) { if (++reads === 1) return mail.promise; if (scenario === "retry-unmount") return retry.promise; return json(full); }
    if (url === "/api/workspace") return json({ commitments: [], projects: [], decisions: [], coverage: [], proposals: [] });
    if (url === "/api/sync") return json({ errors: [] });
    if (url.startsWith("/api/drafts")) return json({ drafts: [] });
    return json({});
  };
  const container = document.getElementById("root")!; const root = createRoot(container);
  let unmounted = false;
  const settle = async (task: () => void) => { await act(async () => { task(); await new Promise<void>(resolve => setImmediate(resolve)); }); };
  const button = (label: string) => { const value = [...container.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent?.trim() === label || item.querySelector(".sidebar-name")?.textContent === label); assert.ok(value, label); return value; };
  try {
    await act(async () => root.render(<App />));
    assert.equal(reads, 1); assert.ok(requests.some(item => item.url === "/api/bootstrap"));
    if (browser) {
      await settle(() => bootstrap.resolve(json(status)));
      if (scenario === "browser-failed") await settle(() => mail.resolve(json({ error: "Synthetic read failure" }, 500)));
      await settle(() => context.mock.timers.tick(300000));
      assert.equal(requests.filter(item => item.url === "/api/sync").length, 0, "automatic browser sync waits for the full mail snapshot");
      if (scenario === "browser-failed") await settle(() => button("Retry loading mail").click());
      else await settle(() => mail.resolve(json(full)));
      await settle(() => context.mock.timers.tick(300000));
      assert.equal(requests.filter(item => item.url === "/api/sync").length, 1, "automatic browser sync starts after a successful snapshot");
      return;
    }
    if (scenario === "unmount") {
      await act(async () => root.unmount()); unmounted = true;
      assert.ok(requests.filter(item => item.url === "/api/bootstrap" || item.url === "/api/state").every(item => item.signal?.aborted));
      await settle(() => { bootstrap.resolve(json(status)); mail.resolve(json(full)); });
      assert.equal(requests.some(item => item.url === "/api/workspace"), false); return;
    }
    if (scenario === "full-first") {
      await settle(() => mail.resolve(json(full)));
      await settle(() => bootstrap.resolve(json({ ...status, accounts: [] })));
      assert.match(container.textContent || "", /Synthetic account/);
    } else if (scenario === "bootstrap-failure") {
      await settle(() => bootstrap.resolve(json({ error: "Not supported" }, 404)));
      assert.equal(requests.some(item => item.url === "/api/workspace"), false);
      await settle(() => mail.resolve(json(full)));
      assert.match(container.textContent || "", /Synthetic account/);
    } else if (scenario === "auth-reset") {
      await settle(() => mail.resolve(json({ error: "Open the app session" }, 403)));
      await settle(() => bootstrap.resolve(json(status)));
      assert.doesNotMatch(container.textContent || "", /Synthetic account/);
      assert.equal(requests.some(item => item.url === "/api/workspace"), false);
      await settle(() => button("Retry loading mail").click());
      assert.match(container.textContent || "", /Synthetic account/);
    } else {
      await settle(() => bootstrap.resolve(json(status)));
      assert.match(container.textContent || "", /Synthetic account/);
      const workspace = requests.find(item => item.url === "/api/workspace"); assert.ok(workspace); assert.equal(workspace.csrf, status.csrf);
      const inbox = [...container.querySelectorAll<HTMLButtonElement>(".sidebar button")].find(item => item.textContent?.startsWith("Inbox")); assert.ok(inbox);
      assert.equal(inbox.querySelector(".sidebar-count"), null, "unknown mail count is not zero");
      assert.doesNotMatch(container.textContent || "", /Source unavailable|No tracked work|No cached mail/);
      await settle(() => button("All cached").click());
      assert.match(container.textContent || "", /Loading cached mail/); assert.doesNotMatch(container.textContent || "", /0 cached messages|No matching mail/);
      if (scenario === "retry-unmount") {
        await settle(() => mail.resolve(json({ error: "Synthetic read failure" }, 500)));
        await settle(() => button("Retry loading mail").click());
        await act(async () => root.unmount()); unmounted = true;
        assert.equal(requests.filter(item => item.url === "/api/state").at(-1)?.signal?.aborted, true);
        await settle(() => retry.resolve(json(full)));
        assert.equal(container.textContent, ""); return;
      } else if (scenario === "auth-after-status") {
        await settle(() => mail.resolve(json({ error: "Session expired" }, 403)));
        assert.doesNotMatch(container.textContent || "", /Synthetic account/);
        const today = [...container.querySelectorAll<HTMLButtonElement>(".sidebar button")].find(item => item.getAttribute("aria-label")?.startsWith("Today,"));
        assert.equal(today?.querySelector(".sidebar-count")?.textContent, "?");
        await settle(() => button("Retry loading mail").click());
      } else if (scenario === "retry") {
        await settle(() => mail.resolve(json({ error: "Synthetic read failure" }, 500)));
        await settle(() => button("Retry loading mail").click());
      } else await settle(() => mail.resolve(json(full)));
      assert.match(container.textContent || "", /1 cached message/);
    }
    assert.ok(changed); await settle(() => changed!());
    const refresh = requests.find(item => item.url === "/api/state?mailCursor=synthetic%3A1");
    assert.ok(refresh, "desktop events retain the cursor reload path");
    assert.equal(refresh.signal, undefined, "later refreshes do not inherit startup cancellation");
  } finally {
    if (!unmounted) await act(async () => root.unmount());
    assert.equal(changed, undefined); if (browser) context.mock.timers.reset(); dom.window.close(); globalThis.fetch = priorFetch;
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
