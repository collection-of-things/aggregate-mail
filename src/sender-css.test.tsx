import assert from "node:assert/strict";
import { test } from "node:test";
import * as content from "../shared/mail-content";

test("sender class styles retain bounded columns and responsive colors without resource or selector metadata", () => {
  assert.equal(typeof content.mailStylesheet, "function", "sender style blocks are currently discarded");
  const result = content.mailStylesheet('<style>.summary { color:#123456; width:600px; background:url(https://example.test/track) } @media screen and (max-width:600px) { .summary { width:100%; padding:12px } }</style>');
  assert.match(result.css, /color:#123456/);
  assert.match(result.css, /width:600px/);
  assert.match(result.css, /@container \(max-width:600px\)\{:scope \.sender-0\{/, 'width queries measure the message');
  assert.doesNotMatch(result.css, /summary|https|url\(/);
  assert.ok(result.identifiers.get('.summary'));
});

test("sender selectors anchor at the message root, which stands in for html and body", () => {
  const css = (rules: string) => content.mailStylesheet(`<style>${rules}</style>`).css;
  assert.equal(css('body{color:red}'), ':scope{color:red}');
  assert.equal(css('html body p{color:red}'), ':scope p{color:red}');
  assert.equal(css('body > table td{color:red}'), ':scope > table td{color:red}');
  assert.equal(css('body.dark p{color:red}'), ':scope.sender-0 p{color:red}');
  assert.equal(css('td, .note{color:red}'), ':scope td,:scope .sender-0{color:red}');
  assert.equal(css('*{color:red}'), ':scope *{color:red}');
  assert.equal(css('p body{color:red}'), '', 'a nested root never matches');
  assert.equal(css('body + p{color:red}'), '', 'the root has no siblings');
  assert.equal(css('p body, td{color:red}'), ':scope td{color:red}', 'only the impossible selector in a list is dropped');
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
import { readFileSync } from "node:fs";
import { FormattedMail } from "./mail/FormattedMail";
import { redactPrivateText } from "./privacy";
import { PrivacyContext, Redact } from "./ui/Privacy";
import { applyPalette, contrastRatio } from "./themes";

// jsdom parses @scope but leaves it out of computed styles. Flatten each
// installed scope into plain selectors so synthetic checks can read the
// cascade. The `to (.address)` boundary is not modeled here.
function materialize(doc: Document) {
  const style = doc.createElement("style");
  style.textContent = doc.adoptedStyleSheets.flatMap((sheet) => Array.from(sheet.cssRules, (rule) => {
    const scope = /^@scope \(([^)]+)\) to \(\.address\) \{([\s\S]*)\}$/.exec(rule.cssText.trim());
    return scope ? scope[2].replaceAll(":scope", scope[1]) : rule.cssText;
  })).join("\n");
  doc.head.append(style);
  return style;
}
const installedCss = (doc: Document) => doc.adoptedStyleSheets.flatMap((sheet) => Array.from(sheet.cssRules, (rule) => rule.cssText)).join("\n");

test("styled mail renders in the reader document with its sheet scoped to the current opening", async () => {
  const dom = new JSDOM('<!doctype html><main><div id="root"></div></main>', { url: 'https://app.example.test' });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
  const root = createRoot(dom.window.document.getElementById('root')!);
  const html = '<style>body{color:#111;background-color:#fff}p{color:#222}.summary {color:#123456;background-color:white;width:600px} .photo{width:120px} #undefined{color:red} @media (max-width:600px){.summary{width:100%}}</style><p class="summary">Hello Morgan Example</p><img class="photo" src="https://images.example.test/public.png"><img src="https://images.example.test/Morgan%20Example.png">';
  const update = async (id: string, privacy: boolean, showImages: boolean) => {
    await act(async () => root.render(<div className="app message-body"><FormattedMail mailId={id} html={html} showImages={showImages} privacy={privacy} privateNames={['Morgan Example']}
      renderText={(text) => privacy ? redactPrivateText(text, ['Morgan Example']) : text}
      redactText={(text) => privacy ? redactPrivateText(text, ['Morgan Example']) : text} /></div>));
  };
  const doc = dom.window.document;
  try {
    const readerStyle = doc.createElement('style');
    readerStyle.textContent = readFileSync(new URL('./styles/reader.css', import.meta.url), 'utf8');
    doc.head.append(readerStyle);
    await update('one', false, false);
    assert.equal(doc.querySelector('iframe'), null, 'sender styles no longer need a separate document');
    const mail = doc.querySelector<HTMLElement>('.formatted-mail')!;
    assert.equal(mail.closest('.formatted-mail-frame')?.parentElement?.className, 'app message-body', 'the mail sits in the reader body');
    const body = doc.querySelector('.message-body')!;
    assert.equal(dom.window.getComputedStyle(body).maxWidth, '100%', 'styled mail keeps the full reader width');
    const plain = doc.createElement('div'); plain.className = 'message-body';
    doc.body.append(plain);
    assert.ok(['65ch', '520px'].includes(dom.window.getComputedStyle(plain).maxWidth), 'plain text retains its readable line length');
    const outside = doc.createElement('p'); outside.textContent = 'Reader text';
    doc.body.append(outside);
    assert.equal(doc.querySelectorAll('style').length, 1, 'sender CSS never enters the page as a style element');
    assert.equal(doc.adoptedStyleSheets.length, 1, 'one constructable sheet carries the sender rules');
    const scope = mail.getAttribute('data-mail-scope')!;
    assert.ok(scope, 'the mail root names its scope');
    const installed = installedCss(doc);
    assert.ok(installed.startsWith(`@scope ([data-mail-scope="${scope}"]) to (.address)`), 'sender rules reach only this message and never address controls');
    assert.match(installed, /@container \(max-width:\s*600px\)/, 'width queries measure the message, not the window');
    assert.match(installed, /:scope \{\s*color: rgb\(17, 17, 17\)/, 'sender body rules apply to the message root');
    assert.match(installed, /:scope a\s*\{[^}]*text-decoration[^;}]*underline/, 'links keep a persistent underline');
    assert.match(installed, /:scope code\s*\{[^}]*background:[^;}]*!important[^}]*color:[^;}]*!important/, 'sender styles cannot split code ink from its surface');
    assert.match(installed, /:scope pre\s*\{[^}]*background:[^;}]*!important[^}]*color:[^;}]*!important/, 'sender styles cannot split pre ink from its surface');
    assert.match(installed, /:scope pre code\s*\{[^}]*background:[^;}]*!important/, 'nested code stays on the pre surface');
    assert.match(installed, /:scope :is\(p,\s*ul,\s*ol,\s*blockquote,\s*h1,\s*h2,\s*h3,\s*h4,\s*h5,\s*h6,\s*pre\)\s*\{\s*max-width:\s*70ch/, 'prose keeps the readable measure');
    assert.match(installed, /:scope table :is\(p,\s*ul,\s*ol,\s*blockquote,\s*h1,\s*h2,\s*h3,\s*h4,\s*h5,\s*h6,\s*pre\)\s*\{\s*max-width:\s*none/, 'table content keeps the full reader width');
    assert.match(installed, /:scope :is\(code,\s*pre\) :not\(img,\s*\.address,\s*\.formatted-mail-image-placeholder\)\s*\{[^}]*color:[^;}]*!important[^}]*background:[^;}]*!important/,
      'code descendants keep the app ink and no sender background');
    assert.match(installed, /:scope :is\(code,\s*pre\) a\s*\{[^}]*text-decoration-color:[^;}]*currentColor/i, 'links inside code keep an underline in the code ink');
    const flat = materialize(doc);
    assert.equal(dom.window.getComputedStyle(mail).color, 'rgb(17, 17, 17)', 'sender body foreground wins over the reader default');
    assert.equal(dom.window.getComputedStyle(mail.querySelector('p')!).color, 'rgb(18, 52, 86)', 'sender class rules outrank sender element rules');
    assert.notEqual(dom.window.getComputedStyle(outside).color, 'rgb(34, 34, 34)', 'sender element rules do not leak to the reader');
    flat.remove(); outside.remove(); plain.remove(); readerStyle.remove();
    assert.equal(mail.querySelectorAll('img').length, 0);
    assert.equal(mail.querySelector('p')?.hasAttribute('id'), false, 'absent ids cannot match a sender selector');
    assert.doesNotMatch(mail.innerHTML, /summary/);
    await update('one', true, false);
    assert.doesNotMatch(doc.querySelector('.formatted-mail')!.innerHTML, /Morgan|Example/);
    await update('one', true, true);
    const images = doc.querySelectorAll('.formatted-mail img');
    assert.equal(images.length, 1, 'only consented nonprivate image is admitted');
    assert.match(images[0].className, /^sender-\d+$/, 'image class rules survive consent activation');
    assert.equal(images[0].getAttribute('referrerpolicy'), 'no-referrer');
    await update('two', false, false);
    assert.equal(doc.querySelectorAll('.formatted-mail img').length, 0, 'a new opening starts without consent');
    assert.equal(doc.adoptedStyleSheets.length, 1, 'rerenders keep one sheet');
    await act(async () => root.unmount());
    assert.equal(doc.adoptedStyleSheets.length, 0, 'the sheet leaves with the message');
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test("code surfaces keep the veil-safe ink under sender colors", async () => {
  const dom = new JSDOM('<!doctype html><main><div id="root"></div></main>', { url: 'https://app.example.test' });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
  // A white-on-dark veil palette makes --code-ink resolve to the safe ink.
  // Link and secondary text equal the veil, so any code text that keeps
  // either ink renders at 1:1.
  const palette = { canvas: "#ffffff", surface: "#ffffff", raised: "#f6f4f4", text: "#000000", secondaryText: "#111111",
    mutedText: "#444444", accent: "#a50570", link: "#111111", border: "#cccccc", danger: "#c93434", reason: "#888888", veil: "#111111" };
  const resolved = dom.window.document.createElement("div");
  applyPalette(palette, resolved);
  const codeInk = resolved.style.getPropertyValue("--code-ink").trim() || palette.text;
  const codeInkRgb = `rgb(${[1, 3, 5].map((offset) => parseInt(codeInk.slice(offset, offset + 2), 16)).join(", ")})`;
  const host = dom.window.document.createElement("div");
  host.className = "app";
  host.style.setProperty("--veil", palette.veil);
  host.style.setProperty("--code-ink", codeInk);
  host.style.setProperty("--link", palette.link);
  host.style.setProperty("--text-2", palette.secondaryText);
  host.style.setProperty("--text-scale", "1");
  dom.window.document.body.append(host);
  const mount = dom.window.document.createElement("div");
  host.append(mount);
  const root = createRoot(mount);
  const readerStyle = dom.window.document.createElement("style");
  readerStyle.textContent = readFileSync(new URL('./styles/reader.css', import.meta.url), 'utf8');
  dom.window.document.head.append(readerStyle);
  const viewOf = (element: Element) => (element.ownerDocument.defaultView || dom.window).getComputedStyle(element);
  const rgbToHex = (rgb: string) => `#${(rgb.match(/\d+/g) || []).slice(0, 3).map((v) => (+v).toString(16).padStart(2, "0")).join("")}`;
  const resolvedColor = (element: Element, property: "color" | "backgroundColor") => {
    const raw = viewOf(element)[property];
    const name = /^var\((--[\w-]+)\)/.exec(raw);
    return name ? (host.style.getPropertyValue(name[1]).trim() || raw) : raw;
  };
  // jsdom cannot decompose the controls' `background:` shorthand into a
  // computed color; the declared surface is the host veil, asserted on the
  // stylesheet text above.
  const paintOf = (element: Element) => {
    const shorthand = viewOf(element).background;
    const token = shorthand.match(/#[\da-f]{3,8}\b|rgba?\([^)]*\)/i)?.[0];
    if (token && !/^rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)$|transparent/i.test(token)) return token;
    const computed = resolvedColor(element, "backgroundColor");
    if (computed !== "rgba(0, 0, 0, 0)") return computed;
    return host.style.getPropertyValue("--veil").trim() || "#111111";
  };
  const fgOf = (element: Element) => resolvedColor(element, "color");
  const structures: [string, (inner: string) => string][] = [
    ["inline code", (inner) => `<code>${inner}</code>`],
    ["plain pre", (inner) => `<pre>${inner}</pre>`],
    ["pre with nested code", (inner) => `<pre><code>${inner}</code></pre>`],
  ];
  const inner = '<span class="tint">sheet</span><span style="color:#111111">inline</span>';
  const mount_ = async (html: string, privacy = false, showImages = false) => {
    await act(async () => root.render(<PrivacyContext.Provider value={{ on: privacy, revealed: new Set(), toggle() {} }}><FormattedMail mailId={`msg-${html.length}-${privacy}-${showImages}`} html={html}
      showImages={showImages} privacy={privacy} privateNames={["Morgan Example", "morgan@example.com"]}
      attachments={[{ id: 'logo', contentId: 'logo', contentType: 'image/png', filename: 'logo.png', size: 3 }]}
      renderText={(text, segments) => privacy ? <Redact text={text} segments={segments} /> : text}
      redactText={(text) => privacy ? redactPrivateText(text, ["Morgan Example", "morgan@example.com"]) : text} /></PrivacyContext.Provider>));
  };
  try {
    for (const [name, wrap] of structures) {
      // Styled path: a sender stylesheet supplies class tints, inline styles supply the rest.
      const html = `<style>.tint{color:#111111;background-color:#ffffff}pre{color:#111111;background:#ffffff}</style>${wrap(inner)}`;
      await mount_(html);
      const styled = mount.querySelector("[data-mail-scope]")!;
      assert.ok(styled, `${name}: sender stylesheet scopes the mail`);
      const sheet = materialize(dom.window.document);
      for (const span of styled.querySelectorAll("code span, pre span")) {
        const fg = fgOf(span), paint = paintOf(span.closest("pre, code")!);
        const ratio = contrastRatio(fg.startsWith("#") ? fg : rgbToHex(fg), paint.startsWith("#") ? paint : rgbToHex(paint));
        assert.ok(ratio >= 4.5, `${name}: span foreground ${fg} on ${paint} = ${ratio.toFixed(2)}:1`);
        assert.equal(resolvedColor(span, "backgroundColor").replace(/\s/g, ""), "rgba(0,0,0,0)", `${name}: no sender bg survives under code`);
      }
      const codePaint = styled.querySelector(wrap === structures[0][1] ? "code" : "pre")!;
      assert.equal((paintOf(codePaint).startsWith("#") ? paintOf(codePaint) : rgbToHex(paintOf(codePaint))), "#111111",
        `${name}: the code surface paints the dark veil`);
      const inkCheck = fgOf(styled.querySelector("code span, pre span")!);
      assert.equal(inkCheck.startsWith("#") ? inkCheck : rgbToHex(inkCheck), codeInk, `${name}: descendants read the code ink`);
      sheet.remove();
      await act(async () => root.render(<></>));
      // Themed path: no stylesheet, sender colors are removed at render; reader.css owns code ink.
      await mount_(wrap(inner));
      const inline = mount.querySelector(".formatted-mail");
      assert.equal(inline?.hasAttribute("data-mail-scope"), false, `${name}: styleless sender mail takes the themed path`);
      for (const span of inline!.querySelectorAll("code span, pre span")) {
        const fg = fgOf(span), paint = paintOf(span.closest("pre, code")!);
        const ratio = contrastRatio(fg.startsWith("#") ? fg : rgbToHex(fg), paint.startsWith("#") ? paint : rgbToHex(paint));
        assert.ok(ratio >= 4.5, `${name} themed: span ${fg} on ${paint} = ${ratio.toFixed(2)}:1`);
      }
      await act(async () => root.render(<></>));
    }
    // Review counterexamples: links (including nested link text) and quotes
    // inside code take the code ink on both paths. jsdom resolves inherited
    // color and var() for color, but not var() inside the background
    // shorthand, so the code surface is the host's declared --veil. This is
    // synthetic computed-style proof, not native paint.
    const counterexamples: [string, string, string][] = [
      ["sender-tinted link in code", '<code><a class="sample" href="https://example.test">Readable code</a></code>', "code a"],
      ["nested link text in code", '<code><a href="https://example.test"><span>Nested link</span></a></code>', "code a span"],
      ["nested link text in pre", '<pre><a href="https://example.test"><span>Nested link</span></a></pre>', "pre a span"],
      ["quote in pre", '<pre><blockquote>Readable code</blockquote></pre>', "pre blockquote"],
    ];
    for (const [name, body, selector] of counterexamples) for (const styled of [true, false]) {
      const path = styled ? "styled" : "themed";
      await mount_(styled ? `<style>.sample{background-color:#ffffff}</style>${body}` : body);
      assert.equal(!!mount.querySelector("[data-mail-scope]"), styled, `${name}: ${path} path renders where expected`);
      const sheet = styled ? materialize(dom.window.document) : undefined;
      const target = mount.querySelector(selector);
      assert.ok(target, `${name}: ${path} renders ${selector}`);
      const fg = fgOf(target), paint = paintOf(target.closest("pre, code")!);
      const ratio = contrastRatio(fg.startsWith("#") ? fg : rgbToHex(fg), paint.startsWith("#") ? paint : rgbToHex(paint));
      assert.ok(ratio >= 4.5, `${name} ${path}: ${fg} on ${paint} = ${ratio.toFixed(2)}:1`);
      for (let node: Element | null = target; node && !node.matches("pre, code"); node = node.parentElement)
        assert.equal(resolvedColor(node, "backgroundColor").replace(/\s/g, ""), "rgba(0,0,0,0)", `${name} ${path}: no sender background under code`);
      sheet?.remove();
      await act(async () => root.render(<></>));
    }
    // Privacy inside code still hides names, and consented images still gate on showImages.
    const privateHtml = '<style>.x{color:#333333}</style><pre><code>send to morgan@example.com for Morgan Example <img src="https://images.example.test/logo.png"></code></pre>';
    await mount_(privateHtml, true, true);
    const privateMail = mount.querySelector(".formatted-mail")!;
    assert.doesNotMatch(privateMail.innerHTML, /Morgan|morgan@/, "privacy still redacts inside code");
    assert.ok(privateMail.querySelector("code .address, pre .address"), "addresses still render inside code");
    const veiled = privateMail.querySelector("code .address.veiled, pre .address.veiled");
    assert.ok(veiled, "privacy bar renders inside code");
    assert.equal(veiled.textContent, "", "the privacy bar holds no private text");
    // jsdom cannot resolve var() in the base.css background shorthand, so
    // check that neither the code rule nor the sender scope reaches the bar.
    assert.equal(veiled.matches(":is(code,pre) :not(img,.address,.formatted-mail-image-placeholder)"), false, "the code rule leaves the privacy bar's own fill");
    assert.match(installedCss(dom.window.document), /to \(\.address\)/, "sender rules stop at the privacy bar");
    assert.ok(privateMail.querySelector("img"), "consented image renders inside pre");
    await mount_(privateHtml, true, false);
    assert.equal(mount.querySelectorAll(".formatted-mail img").length, 0, "unconsented image stays a placeholder");
    assert.ok(mount.querySelector(".formatted-mail .formatted-mail-image-placeholder"), "placeholder keeps its marker inside pre");
  } finally {
    await act(async () => root.unmount());
    readerStyle.remove();
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
  const image = () => dom.window.document.querySelector('.formatted-mail img');
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
