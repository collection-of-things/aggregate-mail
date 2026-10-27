import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";
import { JSDOM } from "jsdom";
import type { Draft, Mail } from "../shared/types";
import type { Api } from "./api";
import { Reader } from "./mail/Reader";
import { PrivacyContext } from "./ui/Privacy";

const base: Mail = { id: "a:1", accountId: "a", remoteId: "1", sender: "Newsletter", address: "sender@example.com", to: "reader@example.com",
  subject: "Synthetic newsletter", body: "Cached body", html: null, images: [], attachments: [], preview: "", date: 1, unread: false, archived: false, snoozedUntil: null, category: "other", relevance: 1, reason: "Newsletter" };

async function mount(action: Mail["unsubscribe"], result: unknown) {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost" });
  const globals = { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root")!);
  const calls: { url: string; method?: string; body: unknown }[] = [], drafts: Draft[] = [];
  let resolveRequest: (() => void) | undefined;
  let wait: Promise<void> | undefined;
  const api: Api = async <T,>(url: string, method?: string, body?: unknown) => {
    calls.push({ url, method, body }); await wait;
    // The fixture represents the local service response, with its shape tested below.
    return result as T;
  };
  const render = async (privacy = false) => act(async () => root.render(
    <PrivacyContext.Provider value={{ on: privacy, revealed: new Set(), toggle() {} }}>
      <Reader mail={{ ...base, unsubscribe: action }} labels={[]} api={api} busy={false} onLabels={() => {}} onMenu={() => {}} onMenuKey={() => {}} onOpenDraft={draft => drafts.push(draft)} />
    </PrivacyContext.Provider>));
  await render();
  const button = (text: string) => {
    const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === text);
    assert.ok(button, text); return button;
  };
  const click = async (text: string) => act(async () => button(text).click());
  return { calls, drafts, render, button, click,
    hold: () => { wait = new Promise<void>(resolve => { resolveRequest = resolve; }); },
    release: async () => act(async () => { resolveRequest?.(); await wait; }),
    close: async () => { await act(async () => root.unmount()); dom.window.close();
      for (const [key, value] of previous) if (value) Object.defineProperty(globalThis, key, value); else Reflect.deleteProperty(globalThis, key); },
  };
}

test("reader unsubscribe sends no request on render, review or cancel and submits once only after confirmation", async () => {
  const action = { kind: "post", url: "https://lists.example.com/remove?token=synthetic" } as const;
  const app = await mount(action, { kind: "sent" });
  try {
    assert.equal(app.calls.length, 0);
    await app.click("Unsubscribe");
    assert.ok(document.body.textContent?.includes("lists.example.com"));
    assert.equal(document.querySelector("a[href]"), null, "review exposes no active unsubscribe destination");
    assert.equal(app.calls.length, 0);
    await app.click("Cancel"); assert.equal(app.calls.length, 0);
    await app.click("Unsubscribe"); app.hold();
    await app.click("Send unsubscribe request");
    assert.equal(app.calls.length, 1);
    assert.deepEqual(app.calls[0], { url: "/messages/a%3A1/unsubscribe", method: "POST", body: { confirmed: true, expected: action } });
    await app.release();
    assert.ok(document.body.textContent?.includes("The sender controls when mail stops"));
    assert.equal(app.button("Unsubscribe request accepted").disabled, true);
  } finally { await app.close(); }
});

test("mailto unsubscribe opens the returned receiving-account draft for ordinary review", async () => {
  const draft: Draft = { id: "draft", accountId: "a", revision: 1, updatedAt: 1, to: ["leave@example.com"], subject: "Remove", body: "Please unsubscribe", sendUnknown: false };
  const app = await mount({ kind: "mailto", address: "leave@example.com", subject: "Remove", body: "Please unsubscribe" }, { kind: "draft", draft });
  try {
    await app.click("Unsubscribe"); assert.equal(app.calls.length, 0);
    await app.click("Create draft");
    assert.deepEqual(app.drafts, [draft]);
    assert.equal(app.calls.length, 1); assert.equal(app.calls.some(call => call.url.includes("/send")), false);
  } finally { await app.close(); }
});

test("HTTPS unsubscribe reveals no private destination until review and uses the existing external-link path", async () => {
  const url = "https://lists.example.com/remove?token=private-synthetic";
  const app = await mount({ kind: "link", url }, { kind: "link", url });
  try {
    await app.render(true); await app.click("Unsubscribe");
    assert.equal(document.body.innerHTML.includes("lists.example.com"), false);
    assert.equal(app.button("Check destination").disabled, true);
    assert.equal(app.calls.length, 0);
    await app.click("Reveal unsubscribe destination");
    assert.ok(document.body.textContent?.includes("lists.example.com"));
    await app.click("Check destination");
    const link = document.querySelector<HTMLAnchorElement>('a[href]')!;
    assert.equal(link.href, url); assert.equal(link.target, "_blank"); assert.equal(link.rel, "noopener noreferrer");
    await app.render(false); await app.render(true);
    assert.equal(document.querySelector("a[href]"), null, "enabling privacy clears the revealed destination");
    assert.equal(app.calls.length, 1);
  } finally { await app.close(); }
});

test("unsupported or absent unsubscribe headers expose no reader action", async () => {
  for (const action of [undefined, { kind: "blocked", reason: "destination" } as const]) {
    const app = await mount(action, {});
    try {
      assert.equal([...document.querySelectorAll("button")].some(button => button.textContent === "Unsubscribe"), false);
      if (action) assert.match(document.body.textContent || "", /public HTTPS/);
      assert.equal(app.calls.length, 0);
    } finally { await app.close(); }
  }
});
