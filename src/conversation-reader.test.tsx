import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { ConversationReader } from "./mail/ConversationReader";
import { ReaderContent } from "./mail/MessageContent";
import { PrivacyContext } from "./ui/Privacy";
import type { Mail } from "../shared/types";
import type { Api } from "./api";
import { Reader } from "./mail/Reader";
import { conversationMembers } from "../server/conversation-members";

for (const gmail of [true, false]) test(`${gmail ? "Gmail" : "IMAP"} inline stack ordering, keyboard, consent, privacy and coverage`, async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const originals = ["window", "document", "IS_REACT_ACT_ENVIRONMENT"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  const base: Mail = { id: "a:2", accountId: "a", remoteId: "2", threadId: gmail ? "thread" : undefined, messageId: "two@example.test", references: ["one@example.test"], sender: "Synthetic Sender", address: "sender@example.test", to: "reader@example.test", subject: "Synthetic thread", preview: "Contact sender@example.test", body: "Contact sender@example.test", html: '<p>Contact sender@example.test</p><img src="https://images.example.com/a.png" alt="sender@example.test">', images: [], attachments: [], date: 2000, unread: false, archived: false, snoozedUntil: null, relevance: 2, category: "important", reason: "" };
  const older = { ...base, id: "a:1", remoteId: "1", date: 1000 };
  const latest = { ...base, id: "a:3", remoteId: "3", date: 3000, unread: true };
  const calls: string[] = []; let menuTarget = ""; let selected = ""; let changed = 0;
  const api: Api = async <T,>(path: string) => { calls.push(path); return { accountId: "a", messages: [latest, older, base], gaps: ["Sent coverage is bounded."] } as T; };
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const render = async (privacy = false) => act(async () => root.render(<PrivacyContext.Provider value={{ on: privacy, revealed: new Set(), toggle() {} }}>
    <ConversationReader mail={base} gmail={gmail} api={api} busy={false} onMenuKey={(event, mail) => { if (event.key === "F10" && event.shiftKey) { event.preventDefault(); menuTarget = mail.id; } }} onChanged={async () => { changed++; }} onSelect={mail => { selected = mail.id; }} renderMessage={mail => <ReaderContent mail={mail} loadImages={async () => ({ images: [] })} />} />
  </PrivacyContext.Provider>));
  const click = async (node: Element) => act(async () => (node as HTMLButtonElement).click());
  const toggles = () => [...container.querySelectorAll<HTMLButtonElement>('.conversation-toggle')];
  const cards = () => [...container.querySelectorAll<HTMLElement>('.conversation-message')];
  try {
    await render();
    const details = container.querySelector<HTMLDetailsElement>(".conversation-details");
    assert.ok(details, "history diagnostics belong in a disclosure");
    assert.equal(details.open, false, "diagnostics start collapsed");
    assert.ok(details.querySelector(".conversation-coverage"));
    assert.ok(details.textContent!.includes("Sent coverage is bounded"));
    assert.deepEqual(cards().map(node => node.dataset.messageId), [older.id, base.id, latest.id]);
    assert.deepEqual(toggles().map(node => node.getAttribute('aria-expanded')), ["false", "true", "false"]);
    assert.match(container.textContent!, /Older or Sent messages may be missing/);
    assert.match(container.textContent!, /Sent coverage is bounded/);
    if (!gmail) assert.match(container.textContent!, /cached Message-ID references only/);
    assert.equal(container.querySelectorAll('img').length, 0);
    await click(toggles()[0]);
    await click([...cards()[0].querySelectorAll('button')].find(node => node.textContent === 'Show images')!);
    assert.equal(cards()[0].querySelectorAll('img').length, 1);
    assert.equal(cards()[1].querySelectorAll('img').length, 0);
    await click(toggles()[0]); await click(toggles()[0]);
    assert.equal(cards()[0].querySelectorAll('img').length, 0);
    await act(async () => toggles()[0].dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
    assert.equal(dom.window.document.activeElement, toggles()[1]);
    await act(async () => toggles()[1].dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
    assert.equal(toggles()[1].getAttribute('aria-expanded'), 'false');
    await click([...cards()[0].querySelectorAll('button')].find(node => node.textContent === 'Select for actions')!);
    assert.equal(selected, older.id);
    await act(async () => toggles()[0].dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true })));
    assert.equal(menuTarget, older.id);
    await render(true);
    assert.doesNotMatch(container.innerHTML, /sender@example.test|reader@example.test/);
    assert.equal(container.querySelectorAll('img').length, 0);
    if (gmail) {
      await click([...container.querySelectorAll('button')].find(node => node.textContent?.startsWith('Fetch bounded'))!);
      assert.ok(calls.includes('/messages/a%3A2/conversation/expand')); assert.equal(changed, 1);
    }
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});

const message = (id = "a:2", extra: Partial<Mail> = {}): Mail => ({
  id, accountId: "a", remoteId: id, threadId: "thread", messageId: `${id}@example.test`,
  sender: "Synthetic Sender", address: "sender@example.test", to: "reader@example.test",
  subject: "Same subject", preview: "Synthetic preview", body: "Synthetic body", html: null,
  images: [], attachments: [], date: 2000, unread: false, archived: false, snoozedUntil: null,
  relevance: 2, category: "important", reason: "", ...extra,
});
const conversation = (messages: Mail[]) => ({ accountId: "a", messages, gaps: ["Referenced message unavailable: missing@example.test"] });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function fixture(api: Api) {
  const dom = new JSDOM('<div id="root"></div>');
  const globals = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const selected: string[] = [], menus: string[] = [];
  let changed = 0;
  const render = async (mail = message(), busy = false) => act(async () => root.render(
    <ConversationReader key={JSON.stringify([mail.accountId, mail.id])} mail={mail} gmail={!!mail.threadId} api={api}
      busy={busy} onChanged={async () => { changed++; }} onSelect={item => selected.push(item.id)}
      onMenu={(_, item) => menus.push(item.id)} onMenuKey={(event, item) => {
        if (event.key === "ContextMenu" || event.key === "F10" && event.shiftKey) {
          event.preventDefault(); event.stopPropagation(); menus.push(item.id);
        }
      }} renderMessage={item => <ReaderContent mail={item} loadImages={async () => ({ images: [] })} />} />));
  const buttons = () => [...container.querySelectorAll<HTMLButtonElement>("button")];
  const button = (text: string) => buttons().find(node => node.textContent?.includes(text))!;
  const click = async (node: Element) => act(async () => (node as HTMLButtonElement).click());
  const key = async (node: Element, value: string, extra: KeyboardEventInit = {}) => act(async () => {
    node.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...extra }));
  });
  const close = async () => {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  };
  return { container, root, render, button, click, key, selected, menus, changed: () => changed, close };
}

for (const bad of [undefined, {}, { messages: [], gaps: [] },
  { accountId: "a", messages: [null], gaps: [] },
  { accountId: "a", messages: [message("bad", { date: NaN })], gaps: [] },
  { accountId: "a", messages: [message("bad", { sender: null as unknown as string })], gaps: [] },
  { accountId: "a", messages: [message("bad", { images: [null] as never })], gaps: [] },
  { accountId: "a", messages: [message()], gaps: [null] },
  { accountId: "a", messages: [message("bad", { invitation: { status: "ok" } as never })], gaps: [] },
  { accountId: "b", messages: [message("foreign", { accountId: "b" })], gaps: ["Foreign secret"] },
  { accountId: "a", messages: [message("foreign", { accountId: "b" })], gaps: [] },
  conversation([message(), message()]),
]) test(`malformed or foreign conversation retains opened mail: ${JSON.stringify(bad)}`, async () => {
  const ui = await fixture(async <T,>() => bad as T);
  try {
    await ui.render();
    assert.equal(ui.container.querySelectorAll(".conversation-message").length, 1);
    assert.match(ui.container.textContent!, /Cached conversation could not be loaded/);
    assert.match(ui.container.textContent!, /Synthetic body/);
    assert.doesNotMatch(ui.container.textContent!, /Foreign secret/);
  } finally { await ui.close(); }
});

test("bounded expansion rejects malformed data and failures, preserves cache, and guards pending and busy", async () => {
  const gate = deferred<unknown>(); let posts = 0;
  const older = message("a:1", { date: 1000 });
  const api: Api = async <T,>(_path: string, method?: string) => {
    if (method === "POST") { posts++; return await gate.promise as T; }
    return conversation([older, message()]) as T;
  };
  const ui = await fixture(api);
  try {
    await ui.render(message(), true);
    assert.equal(ui.button("Fetch bounded").disabled, true);
    await ui.click(ui.button("Fetch bounded")); assert.equal(posts, 0);
    await ui.render();
    await ui.click(ui.button("Fetch bounded"));
    assert.equal(ui.button("Fetching conversation").disabled, true);
    await ui.click(ui.button("Fetching conversation")); assert.equal(posts, 1);
    await act(async () => gate.resolve({ accountId: "a", messages: [null], gaps: [] }));
    assert.match(ui.container.textContent!, /refresh could not be completed/);
    assert.equal(ui.container.querySelectorAll(".conversation-message").length, 2);
    assert.equal(ui.changed(), 0);
  } finally { await ui.close(); }
});

test("failed GET and failed Gmail expansion keep the opened mail without retrying", async () => {
  let calls = 0;
  const ui = await fixture(async () => { calls++; throw Error("Synthetic offline"); });
  try {
    await ui.render(); assert.equal(calls, 1);
    await ui.click(ui.button("Fetch bounded")); assert.equal(calls, 2);
    assert.match(ui.container.textContent!, /Synthetic body/);
    assert.match(ui.container.textContent!, /refresh could not be completed/);
  } finally { await ui.close(); }
});

for (const expand of [false, true]) test(`late ${expand ? "POST" : "GET"} cannot replace another opening or refresh it`, async () => {
  const gate = deferred<unknown>();
  const ui = await fixture(async <T,>(path: string, method?: string) => {
    if (path.includes("a%3A2") && (!expand || method === "POST")) return await gate.promise as T;
    return conversation([message("a:9")]) as T;
  });
  try {
    await ui.render(); if (expand) await ui.click(ui.button("Fetch bounded"));
    await ui.render(message("a:9"));
    await act(async () => gate.resolve(conversation([message("late")])));
    assert.deepEqual([...ui.container.querySelectorAll<HTMLElement>(".conversation-message")].map(node => node.dataset.messageId), ["a:9"]);
    assert.equal(ui.changed(), 0);
  } finally { await ui.close(); }
});

test("keyboard boundaries, modified arrows, explicit selection and focused context menu stay per message", async () => {
  const older = message("a:1", { date: 1000 });
  const ui = await fixture(async <T,>() => conversation([message(), older]) as T);
  try {
    await ui.render();
    const toggles = [...ui.container.querySelectorAll<HTMLButtonElement>(".conversation-toggle")];
    await ui.key(toggles[1], "Home"); assert.equal(document.activeElement, toggles[0]);
    await ui.key(toggles[0], "ArrowUp"); assert.equal(document.activeElement, toggles[0]);
    await ui.key(toggles[0], "End"); assert.equal(document.activeElement, toggles[1]);
    await ui.key(toggles[1], "ArrowDown"); assert.equal(document.activeElement, toggles[1]);
    await ui.key(toggles[1], "ArrowUp"); assert.equal(document.activeElement, toggles[0]);
    await ui.key(toggles[0], "ArrowRight", { shiftKey: true }); assert.equal(toggles[0].getAttribute("aria-expanded"), "false");
    await ui.key(toggles[0], "ArrowRight"); assert.equal(toggles[0].getAttribute("aria-expanded"), "true");
    await ui.key(toggles[0], "Enter"); assert.equal(toggles[0].getAttribute("aria-expanded"), "false");
    await ui.key(toggles[0], "Enter"); assert.equal(toggles[0].getAttribute("aria-expanded"), "true");
    assert.deepEqual(ui.selected, [], "expanding and moving never marks another message read");
    await ui.key(toggles[0], "F10", { shiftKey: true }); assert.deepEqual(ui.menus, [older.id]);
    await ui.click(ui.button("Select for actions")); assert.deepEqual(ui.selected, [older.id]);
    assert.equal(ui.container.querySelectorAll("strong").length, 1);
  } finally { await ui.close(); }
});

for (const gmail of [false, true]) test(`actual ${gmail ? "Gmail thread" : "IMAP References"} membership feeds ordered stack without subject or account grouping`, async () => {
  const base = message("a:2", { threadId: gmail ? "thread" : undefined, messageId: "second", references: ["first"] });
  const older = message("a:1", { threadId: gmail ? "thread" : undefined, messageId: "first", date: 1000 });
  const unrelated = message("unrelated", { threadId: "other", messageId: "unrelated" });
  const foreign = message("foreign", { accountId: "b", messageId: "first" });
  const ui = await fixture(async <T,>() => conversation(conversationMembers([base], [base, unrelated, foreign, older])) as T);
  try {
    await ui.render(base);
    assert.deepEqual([...ui.container.querySelectorAll<HTMLElement>(".conversation-message")].map(node => node.dataset.messageId), [older.id, base.id]);
    assert.match(ui.container.textContent!, /Referenced message unavailable/);
    assert.match(ui.container.textContent!, /do not prove completeness/);
    if (!gmail) assert.equal(ui.container.textContent!.includes("Fetch bounded"), false);
  } finally { await ui.close(); }
});

test("equal dates sort by id and an empty valid cache still retains the opened message", async () => {
  let empty = false;
  const ui = await fixture(async <T,>() => conversation(empty ? [] : [message("a:3"), message("a:1")]) as T);
  try {
    await ui.render();
    assert.deepEqual([...ui.container.querySelectorAll<HTMLElement>(".conversation-message")].map(node => node.dataset.messageId), ["a:1", "a:2", "a:3"]);
    empty = true; await ui.render(message("a:9"));
    assert.equal(ui.container.querySelectorAll(".conversation-message").length, 1);
    assert.match(ui.container.textContent!, /Selected for actions/);
  } finally { await ui.close(); }
});

test("Reader preserves selected snooze/reply/label callbacks and never applies them to another expanded message", async () => {
  const until = Date.now() + 86400000;
  const base = message("a:2", { snoozedUntil: until });
  const older = message("a:1", { date: 1000, snoozedUntil: until });
  const api: Api = async <T,>(path: string) => (path.endsWith("/conversation") ? conversation([older, base]) : {}) as T;
  const ui = await fixture(api);
  const actions: string[] = [];
  try {
    await act(async () => ui.root.render(<Reader mail={base} provider="gmail" labels={[]} api={api} busy={false}
      onLabels={() => actions.push("labels:a:2")} onReplyAll={() => actions.push("reply:a:2")}
      onForward={() => actions.push("forward:a:2")}
      onUnsnooze={() => actions.push("inbox:a:2")} onChangeTime={() => actions.push("snooze:a:2")}
      onOpen={item => actions.push(`open:${item.id}`)} onChanged={async () => {}}
      onMenu={(_, item) => actions.push(`menu:${item.id}`)} onMenuKey={() => {}} />));
    await ui.click(ui.container.querySelector('.conversation-toggle')!);
    const oldCard = ui.container.querySelector('[data-message-id="a:1"]')!;
    assert.doesNotMatch(oldCard.textContent!, /Return to inbox|Change time|Reply all|Forward message|Edit labels/);
    for (const label of ["Return to inbox", "Change time", "Reply all", "Forward message", "Edit labels"]) await ui.click(ui.button(label));
    assert.deepEqual(actions, ["inbox:a:2", "snooze:a:2", "reply:a:2", "forward:a:2", "labels:a:2"]);
    await ui.click(ui.button("Select for actions")); assert.equal(actions.at(-1), "open:a:1");
  } finally { await ui.close(); }
});

test("late initial cache cannot overwrite a completed expansion", async () => {
  const initial = deferred<unknown>();
  const ui = await fixture(async <T,>(_path: string, method?: string) =>
    (method === "POST" ? conversation([message(), message("a:new")]) : await initial.promise) as T);
  try {
    await ui.render();
    await ui.click(ui.button("Fetch bounded"));
    assert.equal(ui.container.querySelectorAll(".conversation-message").length, 2);
    await act(async () => initial.resolve(conversation([message()])));
    assert.equal(ui.container.querySelectorAll(".conversation-message").length, 2);
    assert.equal(ui.changed(), 1);
  } finally { await ui.close(); }
});
