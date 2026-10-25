import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";
import { JSDOM } from "jsdom";
import { ComposePanel, type Compose } from "./compose/ComposePanel";

test("composer discloses empty Cc, keeps recovered recipients visible and preserves recovery controls", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
  const globals = { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(dom.window.document.getElementById("root")!);
  const document = dom.window.document;
  let retry = 0, copy = 0, close = 0;
  const draft: Compose = { accountId: "test", to: "to@example.test", subject: "Subject", body: "Message" };
  const render = async (value: Compose, phase: "saved" | "error" = "saved", busy = false, key = "new") => {
    await act(async () => root.render(<ComposePanel key={key} draft={value} setDraft={() => {}}
      accounts={[{ id: "test", email: "from@example.test", provider: "imap" }]} busy={busy}
      onClose={() => close++} onDiscard={() => {}} onRetry={() => retry++} onSaveCopy={() => copy++}
      progress={{ phase, message: phase === "error" ? "Draft could not be saved." : "Draft saved." }} onSend={() => {}} />));
  };
  const button = (text: string) => [...document.querySelectorAll("button")].find((item) => item.textContent === text)!;
  const cc = () => document.querySelector<HTMLInputElement>('input[type="email"][multiple]');
  try {
    await render(draft);
    assert.equal(document.querySelector('.compose-actions .compose-save-status')?.nextElementSibling?.getAttribute('type'), 'submit');
    assert.equal(cc(), null);
    const disclose = document.querySelector<HTMLButtonElement>('[aria-label="Add Cc recipients"]')!;
    assert.equal(disclose.type, "button");
    await act(async () => disclose.click());
    assert.ok(cc());
    assert.equal(document.activeElement, cc());
    assert.equal(cc()!.value, "");
    assert.equal(document.querySelector('[aria-label="Add Cc recipients"]'), null);

    await render({ ...draft, inReplyTo: "reply", cc: ["copy@example.test"], sendUnknown: true }, "error", false, "recovered");
    assert.equal(document.querySelector('[role="dialog"]')!.getAttribute("aria-label"), "Reply");
    assert.equal(cc()!.value, "copy@example.test");
    assert.match(document.body.textContent!, /Send status unknown/);
    assert.equal(document.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled, true);
    assert.equal(document.querySelector<HTMLButtonElement>('[role="combobox"][aria-label="From"]')!.disabled, true);
    await act(async () => { button("Retry save").click(); button("Save separate copy").click(); button("Keep draft").click(); });
    assert.deepEqual([retry, copy, close], [1, 1, 1]);
    assert.match(document.querySelector(".compose-footer")!.textContent!, /Draft could not be saved/);

    await render({ ...draft, cc: ["copy@example.test"] }, "saved", true, "recovered");
    assert.equal(cc()!.disabled, true);
    assert.equal(document.querySelector<HTMLTextAreaElement>("textarea")!.disabled, true);
    assert.equal(button("Keep draft").disabled, true);
    assert.equal(button("Delete draft").disabled, true);
    assert.equal(document.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled, true);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test("reply retains original context and file drops reuse attachment validation without sending", async () => {
  const dom = new JSDOM('<div id="root"></div>', {url:"http://localhost"});
  const globals = {window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,FileReader:dom.window.FileReader,IS_REACT_ACT_ENVIRONMENT:true};
  const previous = new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const[key,value]of Object.entries(globals))Object.defineProperty(globalThis,key,{configurable:true,value});
  const {createRoot}=await import("react-dom/client");const root=createRoot(document.getElementById("root")!);
  const draft:Compose={accountId:"a",to:"client@example.test",subject:"Reply",body:"My reply",inReplyTo:"<message>"};
  const source = {id:"mail",accountId:"a",sender:"Client",address:"client@example.test",to:"me@example.test",subject:"Original subject",body:"Please confirm the delivery date.",date:1} as import("../shared/types").Mail;
  let changed:Compose|undefined,task:Promise<void>|undefined,sends=0;
  const render=(busy=false)=>act(async()=>root.render(<ComposePanel draft={draft} source={source} setDraft={value=>{changed=value;}} accounts={[{id:"a",email:"me@example.test",provider:"imap"},{id:"b",email:"selected@example.test",provider:"imap"}]} busy={busy} onClose={()=>{}} onDiscard={()=>{}} onRetry={()=>{}} onSaveCopy={()=>{}} progress={{phase:"saved",message:"Saved"}} onSend={()=>{sends++;}} onAttachmentTask={value=>{task=value;}}/>));
  const drop=async(files:File[])=>{const event=new dom.window.Event("drop",{bubbles:true,cancelable:true});Object.defineProperty(event,"dataTransfer",{value:{files,types:["Files"]}});await act(async()=>{document.querySelector('form')!.dispatchEvent(event);await task;});assert.equal(event.defaultPrevented,true);};
  try{
    await render(); assert.match(document.querySelector('[aria-label="Original email"]')!.textContent!,/Please confirm the delivery date/);
    assert.equal(document.querySelector('[aria-label="Original email"]')?.getAttribute('tabindex'), '0', 'original email supports keyboard scrolling');
    assert.match(document.querySelector('.compose-from-row [role="combobox"]')!.textContent!,/me@example.test/);
    draft.accountId="b";await render();
    assert.match(document.querySelector('.compose-from-row [role="combobox"]')!.textContent!,/selected@example.test/);
    assert.equal(document.querySelector('.compose-footer .compose-format'), null, 'sender is shown once in From, without a repeated footer row');
    await drop([new dom.window.File(["hello"],"note.txt",{type:"text/plain"})]);
    assert.equal(changed?.body,draft.body);assert.deepEqual(changed?.attachments,[{filename:"note.txt",contentType:"text/plain",content:"aGVsbG8="}]);assert.equal(sends,0);
    changed=undefined; await drop([new dom.window.File(["bad"],"../bad.txt")]);assert.equal(changed,undefined);assert.match(document.querySelector('[role="alert"]')!.textContent!,/safe filenames/);
    await render(true);await drop([new dom.window.File(["hello"],"other.txt")]);assert.equal(changed,undefined);assert.equal(sends,0);
    draft.invitation = { uid: "synthetic-reply", sequence: 0, method: "REPLY", organizer: "client@example.test", attendees: [{ email: "me@example.test", response: "ACCEPTED" }], title: "Review", start: "2026-11-01", end: "2026-11-02", allDay: true };
    await render();
    assert.equal(document.querySelector('.compose-reply-layout')?.children.length, 2, 'RSVP replies keep exactly two working columns');
    assert.ok(document.querySelector('.compose-form .compose-invitation-note'));
  }finally{await act(async()=>root.unmount());dom.window.close();for(const[key,value]of previous)if(value)Object.defineProperty(globalThis,key,value);else Reflect.deleteProperty(globalThis,key);}
});

test("composer From hides account addresses in privacy mode", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
  const globals = { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  const { createRoot } = await import("react-dom/client");
  const { PrivacyContext } = await import("./ui/Privacy");
  const root = createRoot(dom.window.document.getElementById("root")!);
  const render = async (on: boolean) => act(async () => root.render(<PrivacyContext.Provider value={{ on, revealed: new Set(), toggle() {} }}>
    <ComposePanel draft={{ accountId: "test", to: "", subject: "", body: "" }} setDraft={() => {}}
      accounts={[{ id: "test", email: "from@example.test", provider: "imap" }]} busy={false}
      onClose={() => {}} onDiscard={() => {}} onRetry={() => {}} onSaveCopy={() => {}}
      progress={{ phase: "saved", message: "Draft saved." }} onSend={() => {}} />
  </PrivacyContext.Provider>));
  const from = () => dom.window.document.querySelector('[role="combobox"][aria-label="From"] > span')!.textContent!;
  try {
    await render(true);
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="From"]')!.click());
    assert.equal(document.querySelectorAll('[role="option"]').length, 1);
    assert.ok(!document.querySelector('[role="listbox"]')!.innerHTML.includes("from@example.test"));
    assert.ok(!from().includes("from@example.test"));
    assert.match(from(), /^Account 1/);
    assert.equal(document.querySelector('.compose-footer .compose-format'), null);
    assert.ok(!document.querySelector('.compose-from-row')!.innerHTML.includes("from@example.test"));
    await render(false);
    assert.equal(from(), "from@example.test");
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test("compose shares its action-row height across the app and cleans up the observer", async () => {
  const dom = new JSDOM('<div class="app" style="--text-scale:1.2"><div id="root"></div></div><div id="other" class="app" style="--app-footer-height:66px"></div>', { url: "http://localhost" });
  let resize: (() => void) | undefined, disconnected = 0, rowHeight = 30;
  class FooterObserver { constructor(callback: () => void) { resize = callback; } observe() {} disconnect() { disconnected++; } }
  const globals = { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, ResizeObserver: FooterObserver, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  const bounds = dom.window.HTMLElement.prototype.getBoundingClientRect;
  dom.window.HTMLElement.prototype.getBoundingClientRect = function() {
    return this.classList.contains("compose-actions") ? { x: 0, y: 0, top: 0, left: 0, right: 300, bottom: rowHeight, width: 300, height: rowHeight, toJSON() {} } : bounds.call(this);
  };
  const { createRoot } = await import("react-dom/client"); const root = createRoot(document.getElementById("root")!);
  const app = document.querySelector<HTMLElement>(".app")!;
  try {
    await act(async () => root.render(<ComposePanel draft={{ accountId: "a", to: "", subject: "", body: "" }} setDraft={() => {}}
      accounts={[{ id: "a", email: "from@example.test", provider: "imap" }]} busy={false} onClose={() => {}} onDiscard={() => {}} onRetry={() => {}} onSaveCopy={() => {}}
      progress={{ phase: "error", message: "Draft could not be saved. Your text is still here." }} onSend={() => {}} />));
    assert.equal(app.style.getPropertyValue("--app-footer-height"), "42px");
    assert.ok(document.querySelector('.draft-recovery-actions'));
    rowHeight = 58; resize!();
    assert.equal(app.style.getPropertyValue("--app-footer-height"), "70px", "wrapped status raises every footer track");
    resize!(); assert.equal(app.style.getPropertyValue("--app-footer-height"), "70px");
    assert.equal(document.getElementById("other")!.style.getPropertyValue("--app-footer-height"), "66px");
    await act(async () => root.unmount());
    assert.equal(app.style.getPropertyValue("--app-footer-height"), "");
    assert.equal(app.style.getPropertyValue("--text-scale"), "1.2");
    assert.equal(disconnected, 1);
  } finally {
    dom.window.close();
    for (const [key, descriptor] of previous) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
});
