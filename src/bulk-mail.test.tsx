import assert from "node:assert/strict";
import { test } from "node:test";
import { act, createRef, useState } from "react";
import { JSDOM } from "jsdom";
import type { Mail } from "../shared/types";
import type { Api } from "./api";
import { BulkMailSelection } from "./mail/BulkMailSelection";
import { MailList } from "./mail/MailList";

const messages: Mail[] = Array.from({ length: 250 }, (_, index) => ({ id: `local-${index}`, accountId: index % 2 ? "b" : "a", remoteId: String(index),
  sender: "Synthetic", address: "sender@example.test", to: "reader@example.test", subject: `Subject ${index}`,
  body: "", preview: "", date: 1, unread: true, archived: false, category: "important", relevance: 2, reason: "", snoozedUntil: null }));
const noop = () => {};
async function mount(api: Api = async <T,>() => ({ results: [] } as T), reload = async () => {}, selectionShortcut?: (event: KeyboardEvent) => "toggle" | "range" | null, syncing = false) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "http://localhost/" });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  dom.window.HTMLElement.prototype.scrollTo = function(options?: ScrollToOptions | number) { if (typeof options === "object") this.scrollTop = options.top ?? 0; };
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root")!);
  const ref = createRef<HTMLDivElement>();
  let opened = 0;
  function Harness({ items, scope }: { items: Mail[]; scope: string }) {
    const [cursor, setCursor] = useState(items[0]?.id);
    return <div ref={ref} className="list"><BulkMailSelection messages={items} accounts={[
      { id: "a", email: "a@example.test", provider: "imap" }, { id: "b", email: "b@example.test", provider: "imap" },
    ]} scope={scope} selectedId={cursor} onSelect={setCursor} api={api} reload={reload} disabled={false} syncing={syncing} onBlockingChange={noop} selectionShortcut={selectionShortcut}>
      <MailList messages={items} accounts={[]} listRef={ref} selectedId={cursor} focusSelection={true} density="comfortable" narrow={false} sort="relevance"
        opening="single" onSelect={setCursor} onOpen={() => { opened++; }} onMenu={noop} onMenuKey={noop} />
    </BulkMailSelection></div>;
  }
  const render = async (items = messages, scope = "inbox") => act(async () => root.render(<Harness items={items} scope={scope} />));
  await render();
  const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === text)!;
  const click = async (text: string) => act(async () => button(text).click());
  const key = async (id: string, value: string, options: KeyboardEventInit = {}) => act(async () => {
    const target = document.getElementById(`mail-${id}`)!; target.focus();
    target.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...options }));
  });
  const count = () => document.querySelector('[aria-live="polite"]')!.textContent;
  const master = () => document.querySelector<HTMLButtonElement>('[aria-label="Select all visible (up to 200)"]')!;
  return { dom, render, button, click, key, count, master, opened: () => opened, async close() {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  } };
}

test("keyboard toggles, inclusive ranges, Shift-click, Escape and virtualized select-all remain bounded", async () => {
  const ui = await mount();
  try {
    const master = () => document.querySelector<HTMLButtonElement>('[aria-label="Select all visible (up to 200)"]')!;
    const checkbox = () => document.querySelector<HTMLButtonElement>('.mail-row [role="checkbox"]')!;
    await act(async () => checkbox().click()); assert.match(ui.count()!, /^1 messages selected/);
    assert.equal(checkbox().getAttribute("aria-checked"), "true"); assert.equal(ui.opened(), 0);
    await act(async () => checkbox().click()); assert.match(ui.count()!, /^0 messages selected/);
    await ui.key("local-0", "x"); assert.match(ui.count()!, /^1 messages selected/);
    await ui.key("local-0", "ArrowDown", { shiftKey: true }); assert.match(ui.count()!, /^2 messages selected/);
    assert.equal(document.activeElement?.id, "mail-local-1");
    await ui.key("local-1", "ArrowDown", { shiftKey: true }); assert.match(ui.count()!, /^3 messages selected/);
    await ui.key("local-2", "ArrowUp", { shiftKey: true }); assert.match(ui.count()!, /^2 messages selected/);
    await act(async () => document.getElementById("mail-local-5")!.dispatchEvent(new ui.dom.window.MouseEvent("click", { shiftKey: true, bubbles: true })));
    assert.match(ui.count()!, /^6 messages selected/); assert.equal(ui.opened(), 0);
    await ui.key("local-5", "Escape"); assert.match(ui.count()!, /^0 messages selected/);
    await act(async () => master().click()); assert.match(ui.count()!, /^200 messages selected; selection limited to 200/);
    assert.ok(document.querySelectorAll('.mail-window-row').length < 200, "selection includes unmounted virtual rows");
    await ui.render(messages.slice(0, 5)); assert.match(ui.count()!, /^5 messages selected/);
    await ui.render([{ ...messages[0], accountId: "changed" }]); assert.match(ui.count()!, /^0 messages selected/);
    await ui.render(messages, "archive"); await ui.key("local-0", "x");
    await ui.render(messages, "inbox"); assert.match(ui.count()!, /^0 messages selected/);
    await ui.key("local-0", "a", { ctrlKey: true }); assert.match(ui.count()!, /^200 messages selected/);
    await ui.click("Clear selection"); assert.match(ui.count()!, /^0 messages selected/);
    await ui.key("local-0", "x");
    for (let index = 0; index < 32; index++) await ui.key(`local-${index}`, "ArrowDown", { shiftKey: true });
    assert.match(ui.count()!, /^33 messages selected/);
    assert.equal(document.activeElement?.id, "mail-local-32", "range navigation retains focus beyond the initial virtual window");
  } finally { await ui.close(); }
});

test("Trash captures exact count, cancel sends nothing, mixed results survive pruning and never retry", async () => {
  const calls: { url: string; body: any }[] = [];
  let refreshes = 0;
  const ui = await mount(async <T,>(url: string, _method?: string, body?: unknown) => {
    const input = body as { items: { id: string; accountId: string }[] };
    calls.push({ url, body });
    return { results: input.items.map((item, index) => ({ ...item, status: ["done", "failed", "unknown"][index % 3] })) } as T;
  }, async () => { refreshes++; });
  try {
    await ui.render(messages.slice(0, 3)); await act(async () => ui.master().click());
    await ui.click("Move to Trash");
    assert.match(document.querySelector('[role="dialog"]')!.textContent!, /Move exactly 3 messages to Trash/);
    assert.equal(calls.length, 0); await ui.click("Cancel"); assert.equal(calls.length, 0);
    await ui.click("Move to Trash"); await ui.click("Move 3 messages to Trash");
    assert.equal(calls.length, 1); assert.equal(calls[0].url, "/messages/batch");
    assert.equal(calls[0].body.operation.action, "trash"); assert.equal(calls[0].body.items.length, 3);
    assert.match(document.querySelector('.bulk-result')!.textContent!, /1 done, 1 failed, 1 unknown/);
    assert.match(document.querySelector('.bulk-result')!.textContent!, /Subject 1/);
    assert.match(document.querySelector('.bulk-result')!.textContent!, /Subject 2/);
    assert.match(ui.count()!, /^0 messages selected/); assert.equal(refreshes, 1);
    await ui.render([]); assert.match(document.querySelector('.bulk-result')!.textContent!, /1 done, 1 failed, 1 unknown/);
    assert.equal(calls.length, 1);
  } finally { await ui.close(); }
});

test("response loss marks every item unknown and cache refresh failure does not resubmit", async () => {
  let calls = 0;
  const ui = await mount(async () => { calls++; throw new Error("Synthetic response loss"); }, async () => { throw new Error("Synthetic refresh failure"); });
  try {
    await ui.render(messages.slice(0, 2)); await act(async () => ui.master().click()); await ui.click("Done");
    assert.equal(calls, 1);
    assert.match(document.querySelector('.bulk-result')!.textContent!, /0 done, 0 failed, 2 unknown/);
    assert.match(document.querySelector('.bulk-result')!.textContent!, /Refreshing mail failed/);
    assert.match(ui.count()!, /^0 messages selected/);
    await ui.click("Dismiss results"); assert.equal(calls, 1);
  } finally { await ui.close(); }
});

test("platform select-all works anywhere on a mail page but leaves fields, dialogs and the other modifier alone", async () => {
  const ui = await mount();
  const press = (target: EventTarget, init: KeyboardEventInit) => act(async () => {
    const event = new ui.dom.window.KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  });
  try {
    // Web target: no desktop bridge, non-Apple browser platform uses Control.
    (document.activeElement as HTMLElement | null)?.blur();
    assert.equal(await press(document.body, { ctrlKey: true }), true);
    assert.match(ui.count()!, /^200 messages selected; selection limited to 200/);
    await ui.click("Clear selection");
    assert.equal(await press(document.body, { metaKey: true }), false, "Command+A is not select-all off Apple platforms");
    assert.match(ui.count()!, /^0 messages selected/);

    const field = document.createElement("input"); document.body.append(field); field.focus();
    assert.equal(await press(field, { ctrlKey: true }), false, "text fields keep native select-all");
    assert.match(ui.count()!, /^0 messages selected/);
    field.remove();

    const dialog = document.createElement("div"); dialog.setAttribute("role", "dialog"); document.body.append(dialog);
    assert.equal(await press(document.body, { ctrlKey: true }), false, "an open dialog owns the keyboard");
    assert.match(ui.count()!, /^0 messages selected/);
    dialog.remove();

    // Desktop on macOS uses Command and leaves Control+A for line editing.
    Object.defineProperty(ui.dom.window, "desktop", { configurable: true, value: { platform: "darwin" } });
    assert.equal(await press(document.body, { ctrlKey: true }), false);
    assert.equal(await press(document.body, { metaKey: true }), true);
    assert.match(ui.count()!, /^200 messages selected/);
  } finally { await ui.close(); }
});

test("select-all over Sent mail offers only the actions Sent supports", async () => {
  const ui = await mount();
  try {
    await ui.render(messages.slice(0, 3).map(mail => ({ ...mail, direction: "sent" as const })), "sent");
    await ui.key("local-0", "a", { ctrlKey: true });
    assert.match(ui.count()!, /^3 messages selected/);
    assert.equal(ui.button("Mark as read").disabled, true);
    assert.equal(ui.button("Archive").disabled, true);
    assert.equal(ui.button("Pin").disabled, false);
    assert.equal(ui.button("Move to Trash").disabled, false);
    assert.match(document.getElementById(ui.button("Mark as read").getAttribute("aria-describedby")!)!.textContent!, /Sent mail supports Pin, Unpin and Move to Trash only/);
  } finally { await ui.close(); }
});

test("select-all chord follows the platform", async () => {
  const { isSelectAllShortcut } = await import("./mail/bulk-selection");
  const chord = (init: Partial<KeyboardEvent>) => ({ key: "a", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...init });
  assert.equal(isSelectAllShortcut(chord({ metaKey: true }), "darwin"), true);
  assert.equal(isSelectAllShortcut(chord({ ctrlKey: true }), "darwin"), false);
  assert.equal(isSelectAllShortcut(chord({ ctrlKey: true }), "win32"), true);
  assert.equal(isSelectAllShortcut(chord({ ctrlKey: true, key: "A" }), "linux"), true);
  assert.equal(isSelectAllShortcut(chord({ ctrlKey: true, shiftKey: true }), "linux"), false);
  assert.equal(isSelectAllShortcut(chord({ metaKey: true }), "linux"), false);
});


test("custom selection bindings and existing arrow shortcuts retain their owners", async () => {
  const ui = await mount(undefined, undefined, event => event.key === "y" ? "toggle" : null);
  try {
    await ui.key("local-0", "x"); assert.match(ui.count()!, /^0 messages selected/);
    await ui.key("local-0", "y"); assert.match(ui.count()!, /^1 messages selected/);
    await ui.key("local-0", "ArrowDown", { shiftKey: true });
    assert.match(ui.count()!, /^1 messages selected/, "a configured arrow action is not captured as a range");
    assert.equal(ui.opened(), 0);
  } finally { await ui.close(); }
});

test("selection stays available during sync while bulk actions wait for it", async () => {
  const calls: unknown[] = [];
  const ui = await mount(async <T,>(...args: unknown[]) => { calls.push(args); return { results: [] } as T; }, async () => {}, undefined, true);
  try {
    assert.equal(ui.master().disabled, false);
    await act(async () => document.querySelector<HTMLButtonElement>('.mail-row [role="checkbox"]')!.click());
    assert.match(ui.count()!, /^1 messages selected/);
    assert.equal(ui.button("Archive").disabled, true);
    assert.ok(document.body.textContent!.includes("Waiting for sync…"));
    await ui.click("Archive"); assert.equal(calls.length, 0);
  } finally { await ui.close(); }
});

test("a sync refresh keeps a still-listed range anchor", async () => {
  const ui = await mount();
  try {
    const check = (id: string, shiftKey = false) => act(async () => document.getElementById(`mail-${id}`)!.previousElementSibling!
      .dispatchEvent(new ui.dom.window.MouseEvent("click", { shiftKey, bubbles: true })));
    await ui.render(messages.slice(0, 10)); await check("local-3");
    await ui.render([{ ...messages[0], id: "new-0", remoteId: "new" }, ...messages.slice(0, 10)]);
    await check("local-5", true); assert.match(ui.count()!, /^3 messages selected/);
  } finally { await ui.close(); }
});

test("a sync refresh keeps an open bulk dialog until one of its messages disappears", async () => {
  const ui = await mount();
  try {
    const open = () => document.body.textContent!.includes("Snooze selected messages");
    await ui.render(messages.slice(0, 5)); await ui.key("local-1", "x"); await ui.click("Snooze"); assert.ok(open());
    await ui.render([{ ...messages[0], id: "new-0", remoteId: "new" }, ...messages.slice(0, 5)]); assert.ok(open(), "added mail keeps the dialog");
    await ui.render([messages[0], ...messages.slice(2, 5)]); assert.equal(open(), false, "a removed target closes the dialog");
  } finally { await ui.close(); }
});

test("master checkbox reports none, mixed and all selected, and clears when all are selected", async () => {
  const ui = await mount();
  try {
    assert.equal(ui.master().getAttribute("aria-checked"), "false");
    await act(async () => document.querySelector<HTMLButtonElement>('.mail-row [role="checkbox"]')!.click());
    assert.equal(ui.master().getAttribute("aria-checked"), "mixed");
    await act(async () => ui.master().click());
    assert.match(ui.count()!, /^200 messages selected/);
    assert.equal(ui.master().getAttribute("aria-checked"), "true");
    assert.equal(ui.master().textContent, "✓");
    await act(async () => ui.master().click());
    assert.match(ui.count()!, /^0 messages selected/);
    assert.equal(ui.master().getAttribute("aria-checked"), "false");
  } finally { await ui.close(); }
});

test("a 200-item range outside the first batch reads mixed, and the master then selects the first 200", async () => {
  const ui = await mount();
  try {
    const list = document.querySelector<HTMLElement>(".list")!;
    const scrollTo = async (top: number) => act(async () => {
      list.scrollTop = top;
      list.dispatchEvent(new ui.dom.window.Event("scroll"));
    });
    const rowHeight = parseFloat(document.querySelector<HTMLElement>(".mail-window")!.style.height) / messages.length;
    await scrollTo(50 * rowHeight);
    const middle = document.querySelector<HTMLButtonElement>('[data-mail-id="local-50"] [role="checkbox"]');
    assert.ok(middle, "row local-50 mounts once the window scrolls to it");
    await act(async () => middle.click());
    assert.match(ui.count()!, /^1 messages selected/);
    await scrollTo(249 * rowHeight);
    const last = document.getElementById("mail-local-249");
    assert.ok(last, "row local-249 mounts once the window scrolls to it");
    await act(async () => last.dispatchEvent(new ui.dom.window.MouseEvent("click", { shiftKey: true, bubbles: true })));
    assert.match(ui.count()!, /^200 messages selected/);
    assert.equal(ui.master().getAttribute("aria-checked"), "mixed", "a range outside the first 200 is not all-selected");
    await act(async () => ui.master().click());
    assert.match(ui.count()!, /^200 messages selected/);
    assert.equal(ui.master().getAttribute("aria-checked"), "true", "the master selects the first 200");
  } finally { await ui.close(); }
});
