import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import type { Mail } from "../shared/types";
import { ComposePanel } from "./compose/ComposePanel";

const source: Mail = {
  id: "source", accountId: "a", remoteId: "1", messageId: "<source@example.test>",
  sender: "Synthetic team", address: "team@example.test", to: "reader@example.test",
  subject: "Synthetic update", date: 1, unread: false, archived: false, snoozedUntil: null,
  category: "important", relevance: 2, reason: "", preview: "Read the update",
  body: "Read the update\n[https://click.example.test/long-tracking-token]",
  html: '<table><tbody><tr><td><strong>Readable original</strong><p><a href="https://click.example.test/long-tracking-token">Read the update</a></p><img src="https://images.example.test/banner.png" alt="Synthetic banner"><script>untrusted()</script></td></tr></tbody></table>',
  images: [{ src: "https://images.example.test/banner.png", alt: "Synthetic banner" }], attachments: [],
};

test("reply context uses safe sender formatting instead of raw plaintext tracking URLs", () => {
  const html = renderToStaticMarkup(<ComposePanel
    source={source} draft={{ accountId: "a", inReplyTo: source.messageId, to: source.address, subject: "Reply", body: "Draft text" }}
    accounts={[{ id: "a", email: "reader@example.test", provider: "imap" }]} setDraft={() => {}}
    busy={false} onClose={() => {}} onDiscard={() => {}} onRetry={() => {}} onSaveCopy={() => {}}
    onSend={() => {}} progress={{ phase: "saved", message: "Draft saved." }} />);
  const dom = new JSDOM(html);
  try {
    const context = dom.window.document.querySelector('[aria-label="Original email"]')!;
    assert.equal(Boolean(context.querySelector('.formatted-mail table strong')), true);
    assert.equal(context.textContent!.includes("long-tracking-token"), false);
    assert.equal(context.querySelector('a')?.textContent, "Read the update");
    assert.equal(context.querySelector('script, img[src]'), null);
    assert.match(context.textContent!, /Show images/);
  } finally { dom.window.close(); }
});

test("reply context recovers formatted content and resets image consent on privacy and source changes", async () => {
  const { act } = await import("react");
  const { PrivacyContext } = await import("./ui/Privacy");
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
  const globals = { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById('root')!);
  const calls: string[] = [];
  const api: import("./api").Api = async <T,>(url: string) => {
    calls.push(url);
    return { html: source.html, images: source.images, attachments: [] } as T;
  };
  const recovered = { ...source, html: undefined, attachments: undefined };
  const render = (mail: Mail, privacy = false) => act(async () => root.render(
    <PrivacyContext.Provider value={{ on: privacy, revealed: new Set(), toggle() {}, accounts: [{ id: "a", email: "reader@example.test", provider: "imap" }] }}>
      <ComposePanel source={mail} api={api} draft={{ accountId: "a", to: source.address, subject: "Reply", body: "Unchanged reply" }}
        accounts={[{ id: "a", email: "reader@example.test", provider: "imap" }]} setDraft={() => {}} busy={false}
        onClose={() => {}} onDiscard={() => {}} onRetry={() => {}} onSaveCopy={() => {}} onSend={() => {}}
        progress={{ phase: "saved", message: "Draft saved." }} />
    </PrivacyContext.Provider>));
  const context = () => document.querySelector('[aria-label="Original email"]')!;
  const show = () => [...context().querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Show images')!;
  try {
    await render(recovered);
    assert.deepEqual(calls, ['/messages/source/content']);
    assert.equal(Boolean(context().querySelector('.formatted-mail table strong')), true);
    assert.equal(context().querySelector('img[src]'), null);
    await act(async () => show().click());
    assert.equal(context().querySelector('img')?.getAttribute('src'), 'https://images.example.test/banner.png');
    await render(recovered, true);
    assert.equal(context().querySelector('img[src]'), null);
    await act(async () => show().click());
    assert.ok(context().querySelector('img[src]'));
    await render({ ...source, id: 'replacement', accountId: 'b' }, true);
    assert.equal(context().querySelector('img[src]'), null, 'another source requires new consent');
    assert.equal((document.querySelector('[aria-label="Message body"]') as HTMLTextAreaElement).value, 'Unchanged reply');
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of previous) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
});

test("empty-body replies keep the cached preview when HTML is absent or rejected", () => {
  for (const html of [null, '<script>untrusted()</script>']) {
    const markup = renderToStaticMarkup(<ComposePanel source={{ ...source, body: '', preview: 'Cached original preview', html }}
      draft={{ accountId: 'a', to: source.address, subject: 'Reply', body: 'My draft' }}
      accounts={[{ id: 'a', email: 'reader@example.test', provider: 'imap' }]} setDraft={() => {}} busy={false}
      onClose={() => {}} onDiscard={() => {}} onRetry={() => {}} onSaveCopy={() => {}} onSend={() => {}}
      progress={{ phase: 'saved', message: 'Draft saved.' }} />);
    assert.match(markup, /Cached original preview/);
    assert.doesNotMatch(markup, /This email has no plain-text body/);
  }
});
