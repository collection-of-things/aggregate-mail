import { test } from "node:test";
import assert from "node:assert/strict";
import { useState, act } from "react";
import { JSDOM } from "jsdom";
import { RichBody } from "./compose/RichBody";
import type { Compose } from "./compose/draft-session";
import { validComposeMarkup } from "../shared/compose-content";
import { PrivacyContext } from "./ui/Privacy";

test("rich compose preserves selection, saves alternatives and inserts only plain clipboard text", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
  const globals = { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root")!);
  let value: Compose = { accountId: "synthetic", to: [""], subject: "", body: "Hello team", sendUnknown: true };
  const commands: string[] = [];
  Object.defineProperty(document, "queryCommandSupported", { value: () => true, configurable: true });
  Object.defineProperty(document, "execCommand", { configurable: true, value: (command: string, _ui: boolean, input?: string) => {
    commands.push(command);
    if (command === "styleWithCSS") return true;
    const selection = window.getSelection()!, range = selection.getRangeAt(0);
    if (command === "insertText") {
      range.deleteContents(); range.insertNode(document.createTextNode(input!)); return true;
    }
    const tag = document.createElement(command === "bold" ? "b" : "em");
    tag.append(range.extractContents()); range.insertNode(tag); range.selectNodeContents(tag);
    return true;
  } });
  function Editor() {
    const [draft, update] = useState(value);
    return <RichBody draft={draft} disabled={false} onChange={next => { value = next; update(next); }} />;
  }
  try {
    await act(async () => root.render(<Editor />));
    assert.equal(value.html, undefined, "opening a plain message adds no HTML");
    const plain = document.querySelector("textarea")!;
    plain.focus(); plain.setSelectionRange(0, 5);
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Bold"]')!.click());
    assert.equal(value.html, '<strong>Hello</strong> team');
    assert.equal(value.body, 'Hello team'); assert.equal(value.sendUnknown, true);
    assert.ok(validComposeMarkup(value));
    const editor = document.querySelector<HTMLElement>('[contenteditable="true"]')!;
    editor.focus();
    const range = document.createRange(); range.selectNodeContents(editor); range.collapse(false);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    const paste = new dom.window.Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { getData: (type: string) => type === "text/plain" ? '<img src="https://example.com/">' : '<img src="https://example.com/track">' } });
    await act(async () => editor.dispatchEvent(paste));
    assert.equal(paste.defaultPrevented, true);
    assert.equal(editor.querySelector("img"), null);
    assert.match(value.html!, /&lt;img/); assert.ok(validComposeMarkup(value));
    assert.ok(commands.includes("insertText"));
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of previous) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
});

// Shared mount for the privacy-veil checks: the Outside button gives focus
// moves a destination outside the editor scope.
const mountPrivateBody = async (initial: Compose, on = true) => {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
  const globals = { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root")!);
  let value = initial;
  let apply = (next: Compose) => { value = next; };
  function Editor() {
    const [draft, update] = useState(value);
    apply = next => { value = next; update(next); };
    return <RichBody draft={draft} disabled={false} onChange={next => { value = next; update(next); }} />;
  }
  let privacyOn = on;
  const paint = () => act(async () => root.render(
    <PrivacyContext.Provider value={{ on: privacyOn, revealed: new Set(), toggle() {} }}>
      <div><button type="button" className="outside">Outside</button><Editor /></div>
    </PrivacyContext.Provider>));
  await paint();
  return {
    dom, get value() { return value; },
    setDraft: (next: Compose) => apply(next),
    setPrivacy: (next: boolean) => { privacyOn = next; return paint(); },
    outside: () => document.querySelector<HTMLButtonElement>(".outside")!,
    close: async () => {
      await act(async () => root.unmount()); dom.window.close();
      for (const [key, descriptor] of previous) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    },
  };
};

test("the privacy veil returns when focus leaves the whole editor scope", async () => {
  const app = await mountPrivateBody({ accountId: "a", to: [""], subject: "", body: "Draft for Sample Person", sendUnknown: true });
  Object.defineProperty(document, "queryCommandSupported", { value: () => true, configurable: true });
  Object.defineProperty(document, "execCommand", { configurable: true, value: () => true });
  try {
    const veil = document.querySelector<HTMLElement>(".compose-veiled-body")!;
    assert.ok(veil, "a non-empty draft starts veiled");
    await act(async () => veil.focus());
    assert.ok(document.querySelector("textarea"), "focusing the veil reveals the editor");
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Insert link"]')!.click());
    const addLink = [...document.querySelectorAll<HTMLButtonElement>(".compose-link-controls button")].find(button => button.textContent === "Add link")!;
    await act(async () => addLink.focus());
    assert.ok(document.querySelector("textarea"), "focus inside the scope keeps the body revealed");
    await act(async () => app.outside().focus());
    assert.ok(document.querySelector(".compose-veiled-body"), "leaving the scope re-veils the body");
    assert.equal(document.querySelector("textarea"), null, "the editor is out of the DOM");
    assert.equal(document.body.textContent!.includes("Sample Person"), false, "no body text stays in the DOM");
  } finally { await app.close(); }
});

test("the link address field veils and restores with the body under privacy", async () => {
  const app = await mountPrivateBody({ accountId: "a", to: [""], subject: "", body: "Draft for Sample Person", sendUnknown: true });
  const calls: [string, string | undefined][] = [];
  Object.defineProperty(document, "queryCommandSupported", { value: () => true, configurable: true });
  Object.defineProperty(document, "execCommand", { configurable: true, value: (command: string, _ui: boolean, input?: string) => { calls.push([command, input]); return true; } });
  try {
    await act(async () => document.querySelector<HTMLElement>(".compose-veiled-body")!.focus());
    assert.ok(document.querySelector("textarea"), "revealed");
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Insert link"]')!.click());
    const url = () => document.querySelector<HTMLInputElement>('[aria-label="Link address"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(app.dom.window.HTMLInputElement.prototype, "value")!.set!.call(url(), "https://vera-bloom.example.test/x");
      url().dispatchEvent(new app.dom.window.Event("input", { bubbles: true }));
    });
    assert.equal(url().value, "https://vera-bloom.example.test/x");
    await act(async () => app.outside().focus());
    assert.ok(document.querySelector(".compose-veiled-body"), "leaving the scope re-veils the body");
    assert.equal(url().value, "", "the link address is hidden with the body");
    assert.equal(url().placeholder, "Hidden. Focus to edit.");
    await act(async () => url().focus());
    assert.equal(url().value, "https://vera-bloom.example.test/x", "the saved address returns on focus");
    const addLink = [...document.querySelectorAll<HTMLButtonElement>(".compose-link-controls button")].find(button => button.textContent === "Add link")!;
    await act(async () => addLink.click());
    assert.ok(calls.some(([command, value]) => command === "createLink" && value === "https://vera-bloom.example.test/x"), "the real address is inserted");
  } finally { await app.close(); }
});

test("the link address field veils even when the body is empty", async () => {
  const app = await mountPrivateBody({ accountId: "a", to: [""], subject: "", body: "", sendUnknown: true });
  const calls: [string, string | undefined][] = [];
  Object.defineProperty(document, "queryCommandSupported", { value: () => true, configurable: true });
  Object.defineProperty(document, "execCommand", { configurable: true, value: (command: string, _ui: boolean, input?: string) => { calls.push([command, input]); return true; } });
  try {
    await act(async () => document.querySelector<HTMLTextAreaElement>("textarea")!.focus());
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Insert link"]')!.click());
    const url = () => document.querySelector<HTMLInputElement>('[aria-label="Link address"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(app.dom.window.HTMLInputElement.prototype, "value")!.set!.call(url(), "mailto:vera@example.test");
      url().dispatchEvent(new app.dom.window.Event("input", { bubbles: true }));
    });
    assert.equal(url().value, "mailto:vera@example.test");
    await act(async () => app.outside().focus());
    assert.equal(url().value, "", "an empty body does not keep the link address visible");
    assert.equal(url().placeholder, "Hidden. Focus to edit.");
    await act(async () => url().focus());
    assert.equal(url().value, "mailto:vera@example.test", "the saved address returns on focus");
    const addLink = [...document.querySelectorAll<HTMLButtonElement>(".compose-link-controls button")].find(button => button.textContent === "Add link")!;
    await act(async () => addLink.click());
    assert.ok(calls.some(([command, value]) => command === "createLink" && value === "mailto:vera@example.test"), "the real address is inserted");
  } finally { await app.close(); }
});

test("turning privacy on veils a focused body and an open link address", async () => {
  const app = await mountPrivateBody({ accountId: "a", to: [""], subject: "", body: "Draft for Sample Person", sendUnknown: true }, false);
  Object.defineProperty(document, "queryCommandSupported", { value: () => true, configurable: true });
  Object.defineProperty(document, "execCommand", { configurable: true, value: () => true });
  try {
    await act(async () => document.querySelector<HTMLTextAreaElement>("textarea")!.focus());
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Insert link"]')!.click());
    const url = () => document.querySelector<HTMLInputElement>('[aria-label="Link address"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(app.dom.window.HTMLInputElement.prototype, "value")!.set!.call(url(), "https://vera-bloom.example.test/x");
      url().dispatchEvent(new app.dom.window.Event("input", { bubbles: true }));
    });
    assert.equal(url().value, "https://vera-bloom.example.test/x");
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Bold"]')!.focus());
    await app.setPrivacy(true);
    assert.ok(document.querySelector(".compose-veiled-body"), "the body veils when privacy turns on while focused");
    assert.equal(document.body.textContent!.includes("Sample Person"), false);
    assert.equal(url().value, "", "the link address hides with the body");
    await act(async () => document.querySelector<HTMLElement>(".compose-veiled-body")!.dispatchEvent(new app.dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    assert.equal(document.querySelector<HTMLTextAreaElement>("textarea")!.value, "Draft for Sample Person");
    assert.equal(url().value, "https://vera-bloom.example.test/x");
  } finally { await app.close(); }
});

test("a veiled body keeps an entered link address for later insertion", async () => {
  const app = await mountPrivateBody({ accountId: "a", to: [""], subject: "", body: "Draft for Sample Person", html: "<p>Draft for Sample Person</p>", sendUnknown: true }, false);
  const calls: [string, string | undefined][] = [];
  Object.defineProperty(document, "queryCommandSupported", { value: () => true, configurable: true });
  Object.defineProperty(document, "execCommand", { configurable: true, value: (command: string, _ui: boolean, input?: string) => { calls.push([command, input]); return true; } });
  try {
    await act(async () => document.querySelector<HTMLElement>(".compose-rich-body")!.focus());
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Insert link"]')!.click());
    const url = () => document.querySelector<HTMLInputElement>('[aria-label="Link address"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(app.dom.window.HTMLInputElement.prototype, "value")!.set!.call(url(), "https://example.test/kept");
      url().dispatchEvent(new app.dom.window.Event("input", { bubbles: true }));
    });
    const html = app.value.html;
    await app.setPrivacy(true);
    assert.ok(document.querySelector(".compose-veiled-body"), "privacy veils the rich body");
    // Enter on the field and a click on Add link are no-ops while the editor
    // is veiled: the address is kept, not discarded or applied to nothing.
    await act(async () => url().dispatchEvent(new app.dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    const addLink = () => [...document.querySelectorAll<HTMLButtonElement>(".compose-link-controls button")].find(button => button.textContent === "Add link")!;
    await act(async () => addLink().click());
    assert.equal(calls.some(([command]) => command === "createLink"), false, "no link is inserted while veiled");
    assert.equal(app.value.html, html, "the body HTML is unchanged");
    await act(async () => document.querySelector<HTMLElement>(".compose-veiled-body")!.dispatchEvent(new app.dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    assert.ok(document.querySelector(".compose-rich-body"), "the editor returns");
    assert.equal(url().value, "https://example.test/kept", "the entered address survives the veil");
    await act(async () => addLink().click());
    assert.ok(calls.some(([command, input]) => command === "createLink" && input?.includes("example.test/kept")), "the saved address is inserted");
  } finally { await app.close(); }
});

test("an empty private draft keeps focus in the editor while typing", async () => {
  const app = await mountPrivateBody({ accountId: "a", to: [""], subject: "", body: "", sendUnknown: true });
  try {
    const plain = document.querySelector<HTMLTextAreaElement>("textarea")!;
    assert.equal(document.querySelector(".compose-veiled-body"), null, "an empty draft shows its editor");
    await act(async () => plain.focus());
    await act(async () => {
      Object.getOwnPropertyDescriptor(app.dom.window.HTMLTextAreaElement.prototype, "value")!.set!.call(plain, "S");
      plain.dispatchEvent(new app.dom.window.Event("input", { bubbles: true }));
    });
    assert.equal(app.value.body, "S", "the character reaches the draft");
    assert.ok(document.querySelector("textarea"), "the editor stays mounted");
    assert.equal(document.activeElement, plain, "focus stays in the editor");
    assert.equal(document.querySelector(".compose-veiled-body"), null, "typing does not veil the body");
  } finally { await app.close(); }
});

test("turning privacy on over a focused empty body keeps typing in the editor", async () => {
  const app = await mountPrivateBody({ accountId: "a", to: [""], subject: "", body: "", sendUnknown: true }, false);
  try {
    const plain = document.querySelector<HTMLTextAreaElement>("textarea")!;
    await act(async () => plain.focus());
    await app.setPrivacy(true);
    assert.equal(document.activeElement, plain, "focus stays in the empty editor");
    for (const text of ["Q", "Qz"]) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(app.dom.window.HTMLTextAreaElement.prototype, "value")!.set!.call(plain, text);
        plain.dispatchEvent(new app.dom.window.Event("input", { bubbles: true }));
      });
      assert.equal(app.value.body, text, "each keystroke reaches the draft");
      assert.equal(document.querySelector(".compose-veiled-body"), null, "typing does not veil the body");
      assert.equal(document.activeElement, plain, "focus stays in the editor");
    }
    await act(async () => app.outside().focus());
    assert.ok(document.querySelector(".compose-veiled-body"), "leaving the editor still veils the typed text");
    assert.equal(document.body.textContent!.includes("Qz"), false);
  } finally { await app.close(); }
});

test("turning privacy on over an empty body hides an entered link address", async () => {
  for (const focusLink of [true, false]) {
    const app = await mountPrivateBody({ accountId: "a", to: [""], subject: "", body: "", sendUnknown: true }, false);
    Object.defineProperty(document, "queryCommandSupported", { value: () => true, configurable: true });
    Object.defineProperty(document, "execCommand", { configurable: true, value: () => true });
    try {
      const plain = document.querySelector<HTMLTextAreaElement>("textarea")!;
      await act(async () => plain.focus());
      await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Insert link"]')!.click());
      const url = () => document.querySelector<HTMLInputElement>('[aria-label="Link address"]')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(app.dom.window.HTMLInputElement.prototype, "value")!.set!.call(url(), "https://private-host.example.test/x");
        url().dispatchEvent(new app.dom.window.Event("input", { bubbles: true }));
      });
      if (!focusLink) await act(async () => plain.focus());
      await app.setPrivacy(true);
      assert.equal(url().value, "", `the address hides (focus on ${focusLink ? "link field" : "body"})`);
      assert.equal(document.body.innerHTML.includes("private-host"), false);
      assert.equal(document.activeElement, plain, "focus is in the still-editable body");
      await act(async () => {
        Object.getOwnPropertyDescriptor(app.dom.window.HTMLTextAreaElement.prototype, "value")!.set!.call(plain, "Q");
        plain.dispatchEvent(new app.dom.window.Event("input", { bubbles: true }));
      });
      assert.equal(app.value.body, "Q", "typing still reaches the draft");
      assert.equal(document.activeElement, plain, "focus stays in the body");
      assert.equal(url().value, "", "the address stays hidden while typing in the body");
      await act(async () => url().focus());
      assert.equal(url().value, "https://private-host.example.test/x", "focusing the field reveals the saved address");
    } finally { await app.close(); }
  }
});

test("revealed format tools stay reachable and enabled while focused", async () => {
  const app = await mountPrivateBody({ accountId: "a", to: [""], subject: "", body: "Hello team", sendUnknown: true });
  try {
    await act(async () => document.querySelector<HTMLElement>(".compose-veiled-body")!.focus());
    assert.ok(document.querySelector("textarea"), "revealed");
    const bold = document.querySelector<HTMLButtonElement>('[aria-label="Bold"]')!;
    await act(async () => bold.focus());
    assert.equal(document.activeElement, bold, "focus lands on the format button");
    assert.equal(bold.disabled, false, "revealed tools stay enabled");
    assert.ok(document.querySelector("textarea"), "the body stays revealed");
    assert.equal(document.querySelector(".compose-veiled-body"), null);
  } finally { await app.close(); }
});

test("revealing the veil restores the saved selection in a plain body", async () => {
  const plainApp = await mountPrivateBody({ accountId: "a", to: [""], subject: "", body: "Hello brave world", sendUnknown: true });
  try {
    await act(async () => document.querySelector<HTMLElement>(".compose-veiled-body")!.focus());
    const plain = document.querySelector<HTMLTextAreaElement>("textarea")!;
    plain.setSelectionRange(6, 11);
    await act(async () => plainApp.outside().focus());
    assert.ok(document.querySelector(".compose-veiled-body"), "veiled again");
    await act(async () => document.querySelector<HTMLElement>(".compose-veiled-body")!.focus());
    const restored = document.querySelector<HTMLTextAreaElement>("textarea")!;
    assert.equal([restored.selectionStart, restored.selectionEnd].join(","), "6,11", "the plain selection returns");
    assert.equal(restored.value.slice(restored.selectionStart, restored.selectionEnd), "brave");
  } finally { await plainApp.close(); }
});

test("revealing the veil restores the saved selection in a rich body", async () => {
  // Rich editor: the same text offsets survive unmount and repaint.
  const richApp = await mountPrivateBody({ accountId: "a", to: [""], subject: "", body: "Hello brave world", html: "<p>Hello brave world</p>", sendUnknown: true });
  try {
    await act(async () => document.querySelector<HTMLElement>(".compose-veiled-body")!.focus());
    const editor = document.querySelector<HTMLElement>('[contenteditable="true"]')!;
    const text = editor.firstChild!.firstChild as Text;
    assert.equal(text.textContent, "Hello brave world");
    const range = document.createRange(); range.setStart(text, 6); range.setEnd(text, 11);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    // A real selection ends in a keyup/mouseup, which is when the editor
    // records it; jsdom collapses the live selection before blur fires.
    await act(async () => editor.dispatchEvent(new richApp.dom.window.MouseEvent("mouseup", { bubbles: true })));
    await act(async () => richApp.outside().focus());
    assert.ok(document.querySelector(".compose-veiled-body"), "veiled again");
    await act(async () => document.querySelector<HTMLElement>(".compose-veiled-body")!.focus());
    const current = window.getSelection()!;
    assert.equal(current.toString(), "brave", "the rich selection returns over the same text");
    assert.ok(document.querySelector('[contenteditable="true"]'), "the rich editor remounted");
  } finally { await richApp.close(); }
});

// The four boundary tests share one setup: reveal, place a selection, record
// it with a mouseup like a real selection, veil on outside focus and reveal.
const veilAndReveal = async (app: Awaited<ReturnType<typeof mountPrivateBody>>, editor: HTMLElement) => {
  await act(async () => editor.dispatchEvent(new app.dom.window.MouseEvent("mouseup", { bubbles: true })));
  await act(async () => app.outside().focus());
  assert.ok(document.querySelector(".compose-veiled-body"), "veiled again");
  await act(async () => document.querySelector<HTMLElement>(".compose-veiled-body")!.focus());
};

test("the rich caret restores at a paragraph boundary", async () => {
  const app = await mountPrivateBody({ accountId: "a", to: [""], subject: "", body: "FirstSecond", html: "<p>First</p><p>Second</p>", sendUnknown: true });
  try {
    await act(async () => document.querySelector<HTMLElement>(".compose-veiled-body")!.focus());
    const editor = document.querySelector<HTMLElement>('[contenteditable="true"]')!;
    const text = editor.childNodes[1].firstChild as Text;
    assert.equal(text.textContent, "Second");
    const range = document.createRange(); range.setStart(text, 0); range.collapse(true);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    await veilAndReveal(app, editor);
    const current = window.getSelection()!.getRangeAt(0);
    assert.equal((current.startContainer as Text).textContent, "Second", "the caret returns to the second paragraph's text, not the first");
    assert.equal(current.startOffset, 0);
  } finally { await app.close(); }
});

test("the rich caret restores at an inline-format boundary", async () => {
  const app = await mountPrivateBody({ accountId: "a", to: [""], subject: "", body: "Bold tail", html: "<p><strong>Bold</strong> tail</p>", sendUnknown: true });
  try {
    await act(async () => document.querySelector<HTMLElement>(".compose-veiled-body")!.focus());
    const editor = document.querySelector<HTMLElement>('[contenteditable="true"]')!;
    const tail = editor.firstChild!.childNodes[1] as Text;
    assert.equal(tail.textContent, " tail");
    const range = document.createRange(); range.setStart(tail, 0); range.collapse(true);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    await veilAndReveal(app, editor);
    const current = window.getSelection()!.getRangeAt(0);
    assert.equal(current.startContainer.nodeType, 3, "the caret lands on a text node");
    assert.equal((current.startContainer as Text).textContent, " tail", "the caret is in the tail text, not inside the strong");
    assert.equal(current.startOffset, 0);
  } finally { await app.close(); }
});

test("a rich selection spanning paragraph boundaries restores both ends", async () => {
  const app = await mountPrivateBody({ accountId: "a", to: [""], subject: "", body: "FirstSecond", html: "<p>First</p><p>Second</p>", sendUnknown: true });
  try {
    await act(async () => document.querySelector<HTMLElement>(".compose-veiled-body")!.focus());
    const editor = document.querySelector<HTMLElement>('[contenteditable="true"]')!;
    const first = editor.childNodes[0].firstChild as Text;
    const second = editor.childNodes[1].firstChild as Text;
    const range = document.createRange(); range.setStart(first, 2); range.setEnd(second, 0);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    await veilAndReveal(app, editor);
    const current = window.getSelection()!.getRangeAt(0);
    assert.equal((current.startContainer as Text).textContent, "First");
    assert.equal(current.startOffset, 2);
    assert.equal((current.endContainer as Text).textContent, "Second", "the end returns to the paragraph boundary, not after First");
    assert.equal(current.endOffset, 0);
  } finally { await app.close(); }
});

test("the rich caret restores when live text nodes merged in the published draft", async () => {
  const app = await mountPrivateBody({ accountId: "a", to: [""], subject: "", body: "FirstSecond", html: "<p>FirstSecond</p>", sendUnknown: true });
  try {
    await act(async () => document.querySelector<HTMLElement>(".compose-veiled-body")!.focus());
    const editor = document.querySelector<HTMLElement>('[contenteditable="true"]')!;
    const para = editor.firstChild!;
    // Adjacent live text nodes serialize as one into draft.html.
    (para.firstChild as Text).splitText(5);
    assert.equal(para.childNodes.length, 2, "the live structure has two text nodes");
    await act(async () => editor.dispatchEvent(new app.dom.window.Event("input", { bubbles: true })));
    assert.equal(app.value.html, "<p>FirstSecond</p>", "publish keeps the merged canonical text");
    const range = document.createRange(); range.setStart(para.childNodes[1], 2); range.collapse(true);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    await veilAndReveal(app, editor);
    const current = window.getSelection()!.getRangeAt(0);
    assert.equal((current.startContainer as Text).textContent, "FirstSecond", "the caret lands in the merged canonical text");
    assert.equal(current.startOffset, 7, "offset past the merge boundary");
  } finally { await app.close(); }
});

test("the rich caret restores across a stripped inline element", async () => {
  const app = await mountPrivateBody({ accountId: "a", to: [""], subject: "", body: "abcdef", html: "<p>abcdef</p>", sendUnknown: true });
  try {
    await act(async () => document.querySelector<HTMLElement>(".compose-veiled-body")!.focus());
    const editor = document.querySelector<HTMLElement>('[contenteditable="true"]')!;
    const para = editor.firstChild!;
    // Wrap part of the text in a live-only span; publish flattens it away.
    (para.firstChild as Text).splitText(4);
    const middle = (para.firstChild as Text).splitText(2);
    const span = document.createElement("span");
    para.insertBefore(span, middle.nextSibling); span.appendChild(middle);
    await act(async () => editor.dispatchEvent(new app.dom.window.Event("input", { bubbles: true })));
    assert.equal(app.value.html, "<p>abcdef</p>", "the span flattens into canonical text");
    const tail = para.childNodes[2] as Text;
    assert.equal(tail.textContent, "ef");
    const range = document.createRange(); range.setStart(tail, 1); range.collapse(true);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    await veilAndReveal(app, editor);
    const current = window.getSelection()!.getRangeAt(0);
    assert.equal((current.startContainer as Text).textContent, "abcdef", "the caret lands in the canonical text, not the removed span");
    assert.equal(current.startOffset, 5);
  } finally { await app.close(); }
});

test("a rich selection across merged text nodes restores both ends", async () => {
  const app = await mountPrivateBody({ accountId: "a", to: [""], subject: "", body: "FirstSecond", html: "<p>FirstSecond</p>", sendUnknown: true });
  try {
    await act(async () => document.querySelector<HTMLElement>(".compose-veiled-body")!.focus());
    const editor = document.querySelector<HTMLElement>('[contenteditable="true"]')!;
    const para = editor.firstChild!;
    (para.firstChild as Text).splitText(5);
    await act(async () => editor.dispatchEvent(new app.dom.window.Event("input", { bubbles: true })));
    const range = document.createRange();
    range.setStart(para.childNodes[0], 2); range.setEnd(para.childNodes[1], 3);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    await veilAndReveal(app, editor);
    const current = window.getSelection()!.getRangeAt(0);
    assert.equal(current.startContainer, current.endContainer, "both ends share the merged canonical text");
    assert.equal((current.startContainer as Text).textContent, "FirstSecond");
    assert.equal(current.startOffset, 2);
    assert.equal(current.endOffset, 8, "the end maps past the merge boundary");
  } finally { await app.close(); }
});

test("a veiled draft that drifted parks the caret at the end instead of throwing", async () => {
  const app = await mountPrivateBody({ accountId: "a", to: [""], subject: "", body: "FirstSecond", html: "<p>First</p><p>Second</p>", sendUnknown: true });
  try {
    await act(async () => document.querySelector<HTMLElement>(".compose-veiled-body")!.focus());
    const editor = document.querySelector<HTMLElement>('[contenteditable="true"]')!;
    const text = editor.childNodes[1].firstChild as Text;
    const range = document.createRange(); range.setStart(text, 0); range.collapse(true);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    await act(async () => editor.dispatchEvent(new app.dom.window.MouseEvent("mouseup", { bubbles: true })));
    await act(async () => app.outside().focus());
    assert.ok(document.querySelector(".compose-veiled-body"), "veiled again");
    // The draft changes while veiled; the saved path no longer resolves.
    await act(async () => app.setDraft({ ...app.value, html: "<p>Much longer paragraph</p>" }));
    await act(async () => document.querySelector<HTMLElement>(".compose-veiled-body")!.focus());
    const rebuilt = document.querySelector<HTMLElement>('[contenteditable="true"]')!;
    const current = window.getSelection()!.getRangeAt(0);
    assert.equal(current.startContainer, rebuilt, "a missing path falls back inside the editor");
    assert.equal(current.startOffset, rebuilt.childNodes.length, "the caret parks at the end");
  } finally { await app.close(); }
});

test("link entry uses an inline keyboard form without relying on a native browser prompt", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
  const globals = { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  Object.defineProperty(window, "prompt", { configurable: true, value: () => { throw Error("Native prompt unsupported"); } });
  window.onerror = () => true;
  Object.defineProperty(document, "queryCommandSupported", { configurable: true, value: () => true });
  Object.defineProperty(document, "execCommand", { configurable: true, value: (command: string, _ui: boolean, url?: string) => {
    if (command === "styleWithCSS") return true;
    const selection = window.getSelection()!, range = selection.getRangeAt(0), anchor = document.createElement("a");
    anchor.setAttribute("href", url!); anchor.append(range.extractContents()); range.insertNode(anchor); return true;
  } });
  let value: Compose = { accountId: "a", to: [""], subject: "", body: "Review this" };
  const { createRoot } = await import("react-dom/client"); const root = createRoot(document.getElementById("root")!);
  function Editor() { const [draft, update] = useState(value); return <RichBody draft={draft} disabled={false} onChange={next => { value = next; update(next); }} />; }
  try {
    await act(async () => root.render(<Editor />));
    const plain = document.querySelector("textarea")!; plain.focus(); plain.setSelectionRange(0, 6);
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Insert link"]')!.click());
    const input = document.querySelector<HTMLInputElement>('[aria-label="Link address"]');
    assert.ok(input, "link entry does not use unsupported native prompt");
    const enter = async (text: string) => act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, text);
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    await enter("javascript:alert(1)");
    await act(async () => input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    assert.equal(value.html, undefined); assert.equal(value.body, "Review this");
    await enter("https://example.test/review");
    await act(async () => input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    assert.equal(value.html, '<a href="https://example.test/review">Review</a> this');
    assert.ok(validComposeMarkup(value));
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Insert link"]')!.click());
    const cancel = document.querySelector<HTMLInputElement>('[aria-label="Link address"]')!;
    await act(async () => cancel.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    assert.equal(Boolean(document.querySelector('[aria-label="Link address"]')), false);
    assert.equal(value.html, '<a href="https://example.test/review">Review</a> this');
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of previous) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
});
