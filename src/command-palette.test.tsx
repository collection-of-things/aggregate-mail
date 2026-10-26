import assert from "node:assert/strict";
import { test } from "node:test";
import { act, createRef, useState } from "react";
import { JSDOM } from "jsdom";
import { CommandPalette, type PaletteCommand } from "./dialogs/CommandPalette";
import { SearchToolbar } from "./shell/SearchToolbar";

test("command search wraps enabled choices, rejects disabled commands, and restores focus", async () => {
  const dom = new JSDOM('<button id="opener">Commands</button><div id="root"></div>');
  const globals = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root")!);
  const calls: string[] = [];
  const commands: PaletteCommand[] = [
    { id: "compose", label: "New message", shortcut: "C", group: "navigation", run: () => calls.push("compose") },
    { id: "archive", label: "Archive message", disabled: true, group: "mail", run: () => calls.push("archive") },
    { id: "settings", label: "Settings", group: "navigation", run: () => calls.push("settings") },
  ];
  function Harness() {
    const [open, setOpen] = useState(true);
    return open ? <CommandPalette commands={commands} onClose={() => { calls.push("close"); setOpen(false); }} /> : null;
  }
  const mount = async () => { await act(async () => root.render(<Harness key={calls.length} />)); };
  const press = async (key: string) => { await act(async () => document.activeElement!.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }))); };
  const search = async (value: string) => {
    const input = document.querySelector("input")!;
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, value);
    await act(async () => input.dispatchEvent(new dom.window.Event("input", { bubbles: true })));
  };
  try {
    document.getElementById("opener")!.focus();
    await mount();
    assert.equal(document.activeElement?.getAttribute("role"), "combobox");
    const selected = () => document.querySelector('[aria-selected="true"]')?.textContent;
    await press("ArrowUp"); assert.equal(selected(), "Settings");
    await press("ArrowDown"); assert.equal(selected(), "New messageC");
    await act(async () => (document.querySelector('[aria-disabled="true"]') as HTMLElement).click());
    assert.deepEqual(calls, []);
    await search("SET"); assert.equal(document.querySelectorAll('[role="option"]').length, 1);
    await press("Enter"); assert.deepEqual(calls, ["close", "settings"]);
    assert.equal(document.activeElement?.id, "opener");
    await mount(); await search("missing");
    assert.match(document.querySelector('[role="status"]')!.textContent!, /No matching commands/);
    await press("Enter"); assert.equal(calls.length, 2);
    await search("archive"); await press("Enter"); assert.equal(calls.length, 2);
    await press("Escape"); assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.equal(document.activeElement?.id, "opener");
    await mount();
    await act(async () => [...document.querySelectorAll<HTMLElement>('[role="option"]')]
      .find((option) => option.textContent === "New messageC")!.click());
    assert.deepEqual(calls.slice(-2), ["close", "compose"]);
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});

test("command search ranks exact labels, then aliases, then substrings inside quiet groups", async () => {
  const dom = new JSDOM('<button id="opener">Commands</button><div id="root"></div>');
  const globals = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root")!);
  const commands: PaletteCommand[] = [
    { id: "archive", label: "Archive", aliases: ["done"], group: "mail", run: () => undefined },
    { id: "trash", label: "Move to Trash", disabled: true, disabledReason: "Select an email first", group: "mail", run: () => undefined },
    { id: "settings", label: "Settings", group: "navigation", run: () => undefined },
    { id: "app-settings", label: "App settings", group: "navigation", run: () => undefined },
    { id: "prefs", label: "Preferences", aliases: ["settings"], group: "navigation", run: () => undefined },
  ];
  const search = async (value: string) => {
    const input = document.querySelector("input")!;
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, value);
    await act(async () => input.dispatchEvent(new dom.window.Event("input", { bubbles: true })));
  };
  const options = () => [...document.querySelectorAll('[role="option"]')].map((option) => option.textContent);
  const groupLabels = () => [...document.querySelectorAll(".command-group-label")].map((label) => label.textContent);
  try {
    await act(async () => root.render(<CommandPalette commands={commands} onClose={() => undefined} />));
    assert.deepEqual(groupLabels(), ["Selected email", "Navigation"]);
    assert.deepEqual(options(), ["Archive", "Move to TrashSelect an email first", "Settings", "App settings", "Preferences"]);
    const disabled = document.querySelector('[aria-disabled="true"]')!;
    assert.match(disabled.textContent!, /Select an email first/);
    assert.equal(disabled.getAttribute("aria-description"), "Select an email first");
    await search("settings");
    assert.deepEqual(options(), ["Settings", "Preferences", "App settings"]);
    assert.deepEqual(groupLabels(), ["Navigation"]);
    await search("done");
    assert.deepEqual(options(), ["Archive"]);
    assert.equal(document.querySelector('[aria-selected="true"]')?.textContent, "Archive");
    await search("archive");
    assert.deepEqual(options(), ["Archive"]);
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});

test("Commands button shows the platform modifier", async () => {
  for (const [platform, chord] of [["darwin", "⌘K"], ["win32", "Ctrl+K"]] as const) {
    const dom = new JSDOM('<div id="root"></div>');
    const globals = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true };
    const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
    const desktop: NonNullable<Window["desktop"]> = {
      platform, materials: false, oauthUrl: "", windowCommand() {},
      onNavigation: () => () => {}, onMailChanged: () => () => {},
      onWindowState: () => () => {}, onAccountConnected: () => () => {},
    };
    (dom.window as unknown as Window).desktop = desktop;
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.getElementById("root")!);
    try {
      const inputRef = createRef<HTMLInputElement>();
      await act(async () => root.render(<SearchToolbar inputRef={inputRef} query="" label="Search mail"
        invalid={false} disabled={false} shortcut="/" onFocus={() => undefined} onChange={() => undefined}
        onClear={() => undefined} onCommands={() => undefined} />));
      const button = document.querySelector<HTMLButtonElement>(".commands-button")!;
      assert.equal(button.querySelector("kbd")?.textContent, chord);
      assert.equal(button.title, `Commands (${chord})`);
    } finally {
      await act(async () => root.unmount()); dom.window.close();
      for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
    }
  }
});
