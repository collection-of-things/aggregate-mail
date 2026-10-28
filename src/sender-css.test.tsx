import assert from "node:assert/strict";
import { test } from "node:test";
import * as content from "../shared/mail-content";

test("sender class styles retain bounded columns and responsive colors without resource or selector metadata", () => {
  assert.equal(typeof content.mailStylesheet, "function", "sender style blocks are currently discarded");
  const result = content.mailStylesheet('<style>.summary { color:#123456; width:600px; background:url(https://example.test/track) } @media screen and (max-width:600px) { .summary { width:100%; padding:12px } }</style>');
  assert.match(result.css, /color:#123456/);
  assert.match(result.css, /width:600px/);
  assert.match(result.css, /@media screen and \(max-width:600px\)/);
  assert.doesNotMatch(result.css, /summary|https|url\(/);
  assert.ok(result.identifiers.get('.summary'));
});

test("sender CSS rejects active features, private attribute selectors, escapes and hidden text", () => {
  const result = content.mailStylesheet('<style>@import "https://example.test/font"; @font-face{font-family:x;src:url(https://example.test/font)} .ok{position:fixed;z-index:999;display:none;visibility:hidden;opacity:0;content:"private";background-image:url(https://example.test/a);font-size:0;color:red} a:visited{color:blue} [title="private"]{color:red} .escaped\\31{color:red}</style>');
  assert.match(result.css, /color:red/);
  assert.doesNotMatch(result.css, /https|url|import|font-face|position|z-index|none|hidden|opacity|content|private|visited|escaped|font-size/);
  assert.equal(content.mailStylesheet('<style>' + 'x'.repeat(content.MAIL_HTML_LIMIT) + '</style>').css, '');
  assert.equal(content.mailStylesheet('<style>private-name {color:red}</style>').css, '', 'unknown tag selectors cannot carry sender metadata');
  assert.equal(content.mailStylesheet('<style>#1234567890 {color:red}</style>').css, '', 'unsupported numeric identifiers cannot retain sender metadata');
});

import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { FormattedMail } from "./mail/FormattedMail";
import { redactPrivateText } from "./privacy";

test("isolated reader binds document, privacy, image consent and keyboard lifetime to the current opening", async () => {
  const dom = new JSDOM('<!doctype html><main><div id="root"></div></main>', { url: 'https://app.example.test' });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
  const root = createRoot(dom.window.document.getElementById('root')!);
  const html = '<style>body{color:#111;background-color:#fff}.summary {color:#123456;background-color:white;width:600px} .photo{width:120px} #undefined{color:red} @media (max-width:600px){.summary{width:100%}}</style><p class="summary">Hello Morgan Example</p><img class="photo" src="https://images.example.test/public.png"><img src="https://images.example.test/Morgan%20Example.png">';
  const update = async (id: string, privacy: boolean, showImages: boolean, scale = 1) => {
    await act(async () => root.render(<div className="app" style={{ "--text-scale": scale } as import("react").CSSProperties}><FormattedMail mailId={id} html={html} showImages={showImages} privacy={privacy} privateNames={['Morgan Example']}
      renderText={(text) => privacy ? redactPrivateText(text, ['Morgan Example']) : text}
      redactText={(text) => privacy ? redactPrivateText(text, ['Morgan Example']) : text} /></div>));
  };
  let keys = 0;
  const handler = (event: KeyboardEvent) => { if (event.key === 'Escape' || event.key === 'Enter') { keys++; event.preventDefault(); } };
  dom.window.addEventListener('keydown', handler);
  try {
    await update('one', false, false);
    let frame = dom.window.document.querySelector('iframe')!;
    assert.ok(frame, 'sender styles use a separate document');
    assert.equal(frame.getAttribute('sandbox'), 'allow-same-origin');
    assert.equal(frame.hasAttribute('srcdoc'), false);
    assert.equal(dom.window.document.querySelector('style'), null, 'sender CSS never enters host document');
    assert.equal(frame.contentDocument!.querySelector('p')?.textContent, 'Hello Morgan Example');
    // jsdom does not include adopted sheets in computed styles. Materialize
    // their exact rules only in this synthetic document to exercise cascade.
    const installed = frame.contentDocument!.adoptedStyleSheets.flatMap(sheet => Array.from(sheet.cssRules, rule => rule.cssText)).join('\n');
    const style = frame.contentDocument!.createElement('style'); style.textContent = installed;
    frame.contentDocument!.head.append(style);
    assert.equal(frame.contentWindow!.getComputedStyle(frame.contentDocument!.body).color, 'rgb(17, 17, 17)', 'sender body foreground wins over host defaults');
    assert.match(installed, /font: calc\(14px \* var\(--text-scale, 1\)\)/, 'default body font also follows text scaling');
    assert.equal(frame.contentDocument!.querySelectorAll('img').length, 0);
    assert.equal(frame.contentDocument!.querySelector('p')?.hasAttribute('id'), false, 'absent ids cannot match a sender selector');
    assert.doesNotMatch(frame.contentDocument!.body.innerHTML, /summary/);
    await act(async () => { dom.window.document.documentElement.style.color = 'rgb(10, 20, 30)'; });
    assert.equal(frame.contentDocument!.body.style.getPropertyValue('--reader-foreground'), 'rgb(10, 20, 30)', 'unstyled text follows host theme changes');
    await act(async () => { dom.window.document.querySelector<HTMLElement>('.app')!.style.setProperty('--text-scale', '1.5'); });
    assert.equal(frame.contentDocument!.body.style.getPropertyValue('--text-scale'), '1.5', 'open mail follows preference changes on .app');
    await update('one', false, false, 1.25);
    assert.equal(dom.window.document.querySelector('iframe'), frame, 'React scale update keeps the same opening');
    assert.equal(frame.contentDocument!.body.style.getPropertyValue('--text-scale'), '1.25', 'React rerender refreshes inherited values even when queued mutations are discarded');
    const event = new (frame.contentWindow as Window & typeof globalThis).KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    frame.contentDocument!.body.dispatchEvent(event);
    assert.equal(keys, 1);
    assert.equal(event.defaultPrevented, true);
    const enter = new (frame.contentWindow as Window & typeof globalThis).KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    frame.contentDocument!.querySelector('p')!.dispatchEvent(enter);
    assert.equal(keys, 2, 'plain reader text forwards configurable Enter shortcuts');
    assert.equal(enter.defaultPrevented, true);
    const link = frame.contentDocument!.createElement('a'); link.href = 'https://example.test';
    frame.contentDocument!.body.append(link);
    link.dispatchEvent(new (frame.contentWindow as Window & typeof globalThis).KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert.equal(keys, 2, 'link activation does not invoke host Enter shortcuts');
    await update('one', true, false);
    assert.equal(frame.isConnected, false, 'privacy replaces the old document synchronously');
    frame = dom.window.document.querySelector('iframe')!;
    assert.doesNotMatch(frame.contentDocument!.body.innerHTML, /Morgan|Example/);
    await update('one', true, true);
    frame = dom.window.document.querySelector('iframe')!;
    assert.equal(frame.contentDocument!.querySelectorAll('img').length, 1, 'only consented nonprivate image is admitted');
    assert.match(frame.contentDocument!.querySelector('img')?.className || '', /^sender-\d+$/, 'image class rules survive consent activation');
    assert.equal(frame.contentDocument!.querySelector('img')?.getAttribute('referrerpolicy'), 'no-referrer');
    await update('two', false, false);
    assert.equal(frame.isConnected, false, 'message changes discard old content and consent presentation');
    assert.equal(dom.window.document.querySelector('iframe')!.contentDocument!.querySelectorAll('img').length, 0);
    await act(async () => root.unmount());
    assert.equal(dom.window.document.querySelector('iframe'), null);
  } finally {
    await act(async () => root.unmount());
    dom.window.removeEventListener('keydown', handler);
    dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test("embedded image responses cannot cross message bindings and release owned blobs", async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://app.example.test' });
  const pending: { url: string; resolve: (response: Response) => void }[] = [];
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true, fetch: (url: string) => new Promise<Response>(resolve => pending.push({ url, resolve })) })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
  const oldCreate = URL.createObjectURL, oldRevoke = URL.revokeObjectURL;
  const revoked: string[] = [];
  let blobs = 0;
  URL.createObjectURL = () => `blob:synthetic-${++blobs}`;
  URL.revokeObjectURL = url => { revoked.push(url); };
  const root = createRoot(dom.window.document.getElementById('root')!);
  const html = '<style>.body{color:blue}</style><p class="body">Cached</p><img src="cid:logo">';
  const attachments = [{ id: 'logo', contentId: 'logo', contentType: 'image/png', filename: 'logo.png', size: 3 }];
  const update = async (id: string) => {
    await act(async () => root.render(<FormattedMail mailId={id} html={html} attachments={attachments}
      showImages privacy={false} renderText={text => text} redactText={text => text} />));
  };
  const image = () => dom.window.document.querySelector('iframe')!.contentDocument!.querySelector('img');
  try {
    await update('one');
    await update('two');
    assert.match(pending[0].url, /messages\/one\/attachments\/logo$/);
    assert.match(pending[1].url, /messages\/two\/attachments\/logo$/);
    await act(async () => pending[0].resolve(new Response(new Uint8Array([1, 2, 3]))));
    assert.equal(image(), null, 'late response from old message is ignored');
    await act(async () => pending[1].resolve(new Response(new Uint8Array([4, 5, 6]))));
    assert.equal(image()?.getAttribute('src'), 'blob:synthetic-1');
    await update('three');
    assert.equal(image(), null, 'old blob never appears under the new message id');
    assert.deepEqual(revoked, ['blob:synthetic-1']);
    await act(async () => root.unmount());
  } finally {
    await act(async () => root.unmount());
    URL.createObjectURL = oldCreate; URL.revokeObjectURL = oldRevoke;
    dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test("sender stylesheet font sizes use the reader text-scale preference", () => {
  const result = content.mailStylesheet('<style>body{font-size:16px}.sized{font-size:20px}</style>');
  assert.match(result.css, /font-size:calc\(16px \* var\(--text-scale, 1\)\)/);
  assert.match(result.css, /font-size:calc\(20px \* var\(--text-scale, 1\)\)/);
});
