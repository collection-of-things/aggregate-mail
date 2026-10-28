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
  const html = '<style>.summary {color:#123456;background-color:white;width:600px} @media (max-width:600px){.summary{width:100%}}</style><p class="summary">Hello Morgan Example</p><img src="https://images.example.test/public.png"><img src="https://images.example.test/Morgan%20Example.png">';
  const update = async (id: string, privacy: boolean, showImages: boolean) => {
    await act(async () => root.render(<FormattedMail mailId={id} html={html} showImages={showImages} privacy={privacy} privateNames={['Morgan Example']}
      renderText={(text) => privacy ? redactPrivateText(text, ['Morgan Example']) : text}
      redactText={(text) => privacy ? redactPrivateText(text, ['Morgan Example']) : text} />));
  };
  let keys = 0;
  const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') { keys++; event.preventDefault(); } };
  dom.window.addEventListener('keydown', handler);
  try {
    await update('one', false, false);
    let frame = dom.window.document.querySelector('iframe')!;
    assert.ok(frame, 'sender styles use a separate document');
    assert.equal(frame.getAttribute('sandbox'), 'allow-same-origin');
    assert.equal(frame.hasAttribute('srcdoc'), false);
    assert.equal(dom.window.document.querySelector('style'), null, 'sender CSS never enters host document');
    assert.equal(frame.contentDocument!.querySelector('p')?.textContent, 'Hello Morgan Example');
    assert.equal(frame.contentDocument!.querySelectorAll('img').length, 0);
    assert.doesNotMatch(frame.contentDocument!.body.innerHTML, /summary/);
    const event = new (frame.contentWindow as Window & typeof globalThis).KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    frame.contentDocument!.body.dispatchEvent(event);
    assert.equal(keys, 1);
    assert.equal(event.defaultPrevented, true);
    await update('one', true, false);
    assert.equal(frame.isConnected, false, 'privacy replaces the old document synchronously');
    frame = dom.window.document.querySelector('iframe')!;
    assert.doesNotMatch(frame.contentDocument!.body.innerHTML, /Morgan|Example/);
    await update('one', true, true);
    frame = dom.window.document.querySelector('iframe')!;
    assert.equal(frame.contentDocument!.querySelectorAll('img').length, 1, 'only consented nonprivate image is admitted');
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
