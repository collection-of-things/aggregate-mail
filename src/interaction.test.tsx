import { test } from "node:test";
import assert from "node:assert/strict";
import { act, useState } from "react";
import { JSDOM } from "jsdom";
import { InteractionSettings } from "./settings/InteractionSettings";
import { defaults, interactionActions, interactionPlatform, commandsChord, matches, read, save, shortcutFromEvent, shortcutLabel, validateShortcut, type InteractionPreferences } from "./interaction";

const copy = () => structuredClone(defaults);

test("registry preserves existing keys, Teach alias, history defaults and exact modifiers", () => {
  const dom = new JSDOM();
  const key = (key: string, options = {}) => new dom.window.KeyboardEvent("keydown", { key, ...options }) as unknown as KeyboardEvent;
  assert.equal(defaults.opening, "double");
  for (const action of interactionActions) {
    assert.equal(validateShortcut(action.id, defaults.shortcuts[action.id], defaults), null);
    assert.equal(matches(key(action.key, { altKey: "alt" in action, shiftKey: "shift" in action }), action.id, defaults, "", false, "prefix" in action ? action.prefix : ""), true);
  }
  assert.equal(matches(key("t"), "teach", defaults), true);
  assert.equal(matches(key("[", { metaKey: true }), "back", defaults, "darwin"), true);
  assert.equal(matches(key("]", { metaKey: true }), "forward", defaults, "darwin"), true);
  assert.equal(matches(key("[", { metaKey: true }), "back", defaults, "linux"), false);
  assert.equal(matches(key("j", { ctrlKey: true }), "next", defaults), false);
  assert.equal(matches(key("?", { shiftKey: true }), "help", defaults), true);
  const custom = copy();
  custom.shortcuts.next = { key: "x", shift: true };
  assert.equal(matches(key("x", { shiftKey: true }), "next", custom), true);
  assert.equal(matches(key("x"), "next", custom), false);
  custom.shortcuts.teach = { key: "v" };
  assert.equal(matches(key("t"), "teach", custom), false);
  assert.equal(shortcutLabel(shortcutFromEvent(key("X", { shiftKey: true }))), "Shift+X");
  dom.window.close();
});

test("conflicts, fixed keys, editing, and known system combinations are rejected", () => {
  for (const binding of [{ key: "k" }, { key: "Escape" }, { key: "Tab" }, { key: "Backspace" },
    { key: "Delete" }, { key: "Shift" }, { key: "0" }, { key: "9" }, { key: "+" }, { key: "-" },
    { key: "c", ctrl: true }, { key: "v", meta: true }, { key: "F4", alt: true }, { key: "t" },
    { key: "[", meta: true }, { key: "j", alt: true }]) {
    assert.ok(validateShortcut("next", binding, defaults), JSON.stringify(binding));
  }
  assert.equal(validateShortcut("next", { key: "x", shift: true }, defaults), null);
  assert.equal(validateShortcut("next", { key: "x", alt: true, shift: true }, defaults), null);
});

test("matching never runs inside editing, dialogs or settings, or on consumed/IME/repeat events", () => {
  const dom = new JSDOM('<input><textarea></textarea><select></select><div contenteditable="true"><span></span></div><dialog><button></button></dialog><div role="dialog"><button></button></div><section data-interaction-settings><button></button></section><button id="plain"></button>');
  for (const selector of ["input", "textarea", "select", "[contenteditable] span", "dialog button", '[role="dialog"] button', "section button", "#plain"]) {
    const element = dom.window.document.querySelector(selector)!;
    const event = new dom.window.KeyboardEvent("keydown", { key: "j", bubbles: true });
    element.dispatchEvent(event);
    assert.equal(matches(event as unknown as KeyboardEvent, "next", defaults), selector === "#plain", selector);
  }
  for (const options of [{ repeat: true }, { isComposing: true }]) {
    assert.equal(matches(new dom.window.KeyboardEvent("keydown", { key: "j", ...options }) as unknown as KeyboardEvent, "next", defaults), false);
  }
  const consumed = new dom.window.KeyboardEvent("keydown", { key: "j", cancelable: true });
  consumed.preventDefault();
  assert.equal(matches(consumed as unknown as KeyboardEvent, "next", defaults), false);
  dom.window.close();
});

test("storage sanitizes fields, rejects corrupted bindings and tolerates unavailable storage", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const dom = new JSDOM("", { url: "http://localhost" });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: dom.window.localStorage });
  try {
    assert.deepEqual(read(), defaults);
    const legacy = copy(); legacy.shortcuts.next = { key: "v" };
    const {unread: _unread, inbox: _inbox, ...legacyShortcuts} = legacy.shortcuts;
    dom.window.localStorage.setItem("emc2.interaction.v1", JSON.stringify({...legacy, shortcuts:legacyShortcuts}));
    const migrated = read();
    assert.equal(migrated.shortcuts.next.key, "v");
    assert.equal(validateShortcut("inbox", migrated.shortcuts.inbox, migrated), null);
    const value = copy(); value.opening = "single"; value.shortcuts.next = { key: "x", shift: true };
    assert.equal(save({ ...value, unrelated: "discard" } as InteractionPreferences), true);
    assert.deepEqual(read(), { ...value, shortcuts: Object.fromEntries(interactionActions.map(({ id }) => [id, { ...shortcutFromEvent({ key: value.shortcuts[id].key, ctrlKey: !!value.shortcuts[id].ctrl, metaKey: !!value.shortcuts[id].meta, altKey: !!value.shortcuts[id].alt, shiftKey: !!value.shortcuts[id].shift }), ...(value.shortcuts[id].prefix ? { prefix: value.shortcuts[id].prefix } : {}) }])) });
    assert.equal(dom.window.localStorage.getItem("emc2.interaction.v1")!.includes("discard"), false);
    const forwardLegacy = structuredClone(value) as { shortcuts: Partial<InteractionPreferences["shortcuts"]> };
    delete forwardLegacy.shortcuts.forwardMail;
    forwardLegacy.shortcuts.search = { key: "f" };
    dom.window.localStorage.setItem("emc2.interaction.v1", JSON.stringify(forwardLegacy));
    assert.equal(read().shortcuts.search.key, "f");
    assert.equal(read().shortcuts.next.key, "x");
    assert.equal(read().shortcuts.forwardMail.shift, true);
    value.shortcuts.next = { key: "k" };
    assert.equal(save(value), false);
    dom.window.localStorage.setItem("emc2.interaction.v1", JSON.stringify(value));
    assert.deepEqual(read().shortcuts, defaults.shortcuts);
    dom.window.localStorage.setItem("emc2.interaction.v1", '{"shortcuts":{"next":{"key":"x"}}}');
    assert.deepEqual(read(), defaults);
    dom.window.localStorage.setItem("emc2.interaction.v1", "invalid");
    assert.deepEqual(read(), defaults);
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("unavailable"); } });
    assert.deepEqual(read(), defaults);
    assert.equal(save(copy()), false);
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
    dom.window.close();
  }
});

test("mounted settings captures without app dispatch, rejects conflicts, changes opening, resets and passes Escape", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
  const globals = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(dom.window.document.getElementById("root")!);
  let current = copy(); let changes = 0; let escapes = 0; let actions = 0;
  const handler = (event: Event) => {
    if ((event as KeyboardEvent).key === "Escape") escapes++;
    if (matches(event as KeyboardEvent, "next", current)) actions++;
  };
  dom.window.addEventListener("keydown", handler);
  function Harness() {
    const [value, setValue] = useState(current);
    return <InteractionSettings value={value} onChange={(next) => { changes++; current = next; setValue(next); }} />;
  }
  try {
    await act(async () => root.render(<Harness />));
    const fields = [...dom.window.document.querySelectorAll<HTMLInputElement>('input[type="text"]')];
    assert.equal(fields.length, interactionActions.length, "grouping keeps every shortcut editable");
    for (const { id, label } of interactionActions) {
      const input = fields.find(field => field.id.endsWith(`-${id}`))!;
      assert.ok(input, `missing shortcut: ${id}`);
      assert.equal(dom.window.document.querySelector(`label[for="${input.id}"]`)?.textContent, label);
      assert.ok(dom.window.document.getElementById(input.getAttribute("aria-describedby")!));
    }
    const field = dom.window.document.querySelector<HTMLInputElement>('input[type="text"]')!;
    field.focus();
    const press = async (key: string, options = {}) => {
      const event = new dom.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options });
      await act(async () => field.dispatchEvent(event));
      return event;
    };
    await press("x", { shiftKey: true });
    assert.equal(field.value, "Shift+X"); assert.equal(changes, 1); assert.equal(actions, 0);
    await press("k"); assert.equal(changes, 1);
    assert.match(dom.window.document.querySelector('[role="status"]')!.textContent!, /Already used/);
    await act(async () => dom.window.document.querySelector<HTMLButtonElement>('[aria-label="Record sequence for Next email"]')!.click());
    await press("z"); await press("x");
    assert.equal(field.value, "Z then X"); assert.equal(changes, 2);
    await act(async () => dom.window.document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    assert.equal(current.mouseHistory, false); assert.equal(changes, 3);
    await press("Shift"); await press("c", { ctrlKey: true });
    assert.equal(changes, 3);
    assert.equal((await press("Tab")).defaultPrevented, false);
    assert.equal((await press("Escape")).defaultPrevented, false); assert.equal(escapes, 1);
    await act(async () => [...dom.window.document.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(button => button.textContent === "Single click")!.click());
    assert.equal(current.opening, "single");
    await act(async () => [...dom.window.document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Reset interaction defaults")!.click());
    assert.deepEqual(current, defaults); assert.equal(field.value, "J"); assert.equal(dom.window.document.activeElement, field);
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});


test("Settings shell permits only safe shortcuts and its nearest child dialog and editors keep ownership", () => {
  const dom = new JSDOM('<div role="dialog" class="settings-dialog"><button id="shell"></button><input id="field"><div contenteditable="true" id="editor"></div><section data-interaction-settings><button id="capture"></button></section><div role="dialog"><button id="child"></button></div></div>');
  try {
    for (const action of interactionActions) {
      const event = new dom.window.KeyboardEvent("keydown", { key: action.key, altKey: "alt" in action, bubbles: true });
      dom.window.document.querySelector("#shell")!.dispatchEvent(event);
      assert.equal(matches(event as unknown as KeyboardEvent, action.id, defaults), ["search", "privacy", "back", "forward", "settings"].includes(action.id), action.id);
    }
    for (const selector of ["#field", "#editor", "#capture", "#child"]) {
      const event = new dom.window.KeyboardEvent("keydown", { key: "/", bubbles: true });
      dom.window.document.querySelector(selector)!.dispatchEvent(event);
      assert.equal(matches(event as unknown as KeyboardEvent, "search", defaults, "darwin", true), false, selector);
    }
  } finally { dom.window.close(); }
});


test("Gmail bindings, sequence conflicts, custom sequences and legacy preferences survive storage", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const dom = new JSDOM("", { url: "http://localhost" });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: dom.window.localStorage });
  try {
    assert.equal(defaults.shortcuts.pin.key, "s");
    assert.equal(defaults.shortcuts.snooze.key, "b");
    assert.equal(shortcutLabel(defaults.shortcuts.goInbox), "G then I");
    assert.ok(validateShortcut("next", { key: "g" }, defaults), "sequence prefix cannot shadow a single key");
    assert.ok(validateShortcut("next", { prefix: "c", key: "x" }, defaults), "single key cannot shadow a prefix");
    const custom = copy();
    custom.shortcuts.goInbox = { prefix: "z", key: "x" };
    custom.mouseHistory = false;
    assert.equal(save(custom), true);
    assert.equal(read().mouseHistory, false);
    assert.equal(shortcutLabel(read().shortcuts.goInbox), "Z then X");
    const event = new dom.window.KeyboardEvent("keydown", { key: "x" }) as unknown as KeyboardEvent;
    assert.equal(matches(event, "goInbox", custom), false);
    assert.equal(matches(event, "goInbox", custom, "", false, "z"), true);
    const legacy = copy();
    legacy.shortcuts.open = { key: "Enter" };
    legacy.shortcuts.other = { key: "o" };
    legacy.shortcuts.snooze = { key: "s" };
    legacy.shortcuts.next = { key: "a" };
    const old = Object.fromEntries(Object.entries(legacy.shortcuts).filter(([id]) =>
      !["pin", "replyAll", "read", "returnToList", "goInbox", "goSent", "goDrafts", "goAll", "goPinned", "goSnoozed"].includes(id)));
    dom.window.localStorage.setItem("emc2.interaction.v1", JSON.stringify({ opening: "single", shortcuts: old }));
    const restored = read();
    for (const [id, binding] of Object.entries(old)) assert.equal(shortcutLabel(restored.shortcuts[id as keyof typeof restored.shortcuts]), shortcutLabel(binding));
    assert.equal(restored.opening, "single");
    assert.equal(restored.mouseHistory, true);
    for (const { id } of interactionActions) assert.equal(validateShortcut(id, restored.shortcuts[id], restored), null);
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous); else Reflect.deleteProperty(globalThis, "localStorage");
    dom.window.close();
  }
});

test("web sessions detect Mac modifiers without the desktop bridge", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const dom = new JSDOM();
  Object.defineProperty(dom.window.navigator, "platform", { value: "MacIntel" });
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  try {
    assert.equal(interactionPlatform(), "darwin");
    assert.equal(commandsChord(), "⌘K");
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous); else Reflect.deleteProperty(globalThis, "window");
    dom.window.close();
  }
});
