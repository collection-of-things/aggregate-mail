import { test } from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { FormattedMail } from "./mail/FormattedMail";
import { fitWidth, MIN_FIT } from "./mail/scoped-mail";
import { MAIL_HTML_LIMIT, MAIL_NODE_LIMIT, MAIL_DEPTH_LIMIT } from "../shared/mail-content";
import { redactPrivateText } from "./privacy";
import { PrivacyContext, Redact } from "./ui/Privacy";

const redact = (text: string) => text.replace(/reader@example\.com|Morgan Example/gi, "[hidden]");
const render = (html: string | null | undefined, privacy = false, showImages = false, fallbackText = "Plain fallback") => renderToStaticMarkup(
  <FormattedMail html={html} privacy={privacy} showImages={showImages}
    privateNames={["Morgan Example"]}
    renderText={(text, segments) => privacy ? segments ? segments.map((part) => part.kind === "text" ? redact(part.text) : "[hidden]").join("") : redact(text) : text}
    redactText={(text) => privacy ? redact(text) : text} fallbackText={fallbackText} />,
);
const documentOf = (markup: string) => new JSDOM(markup).window.document;

test("formatted tables retain whole-word intrinsic widths instead of shrinking to individual letters", () => {
  const document = documentOf(render('<table><tr><td>Email</td><td>Facebook</td></tr></table>'));
  assert.equal(document.querySelector<HTMLElement>(".formatted-mail")!.style.overflowWrap, "break-word");
});

test("embedded image-only mail keeps its position without bypassing consent", () => {
  const document = documentOf(renderToStaticMarkup(<FormattedMail html='<img src="cid:piece">' mailId="a:one"
    attachments={[{ id: "one", contentId: "piece", filename: "piece.png", contentType: "image/png", size: 4 }]}
    showImages={false} privacy={false} renderText={(text) => text} redactText={(text) => text} fallbackText="Fallback" />));
  assert.equal(document.querySelector(".formatted-mail-fallback"), null);
  assert.equal(document.querySelector("img"), null);
  assert.ok(document.querySelector(".formatted-mail-image-placeholder"));
});

test("formatted renderer keeps headings, nested formatting, tables and validated inline presentation", () => {
  const document = documentOf(render('<table width="600" bgcolor="#ffffff" cellpadding="4"><tbody><tr><td colspan="2" style="color:#123456;font-size:18pt;text-align:center"><h2>Heading</h2><p>Hello <strong>team</strong><br>Next line</p><font color="red" size="4">Legacy</font></td></tr></tbody></table>'));
  assert.equal(document.querySelector("h2")?.textContent, "Heading");
  assert.equal(document.querySelector("strong")?.textContent, "team");
  assert.equal(document.querySelectorAll("br").length, 1);
  const td = document.querySelector("td")!;
  assert.equal(td.colSpan, 2);
  assert.equal(td.style.fontSize, "calc(24px * var(--text-scale, 1))");
  assert.equal(td.style.textAlign, "center");
  assert.equal(td.style.color, "");
  const table = document.querySelector("table")!;
  assert.equal(table.style.width, "600px");
  assert.equal(table.cellPadding, "4");
  assert.equal(table.style.backgroundColor, "transparent");
  assert.equal(document.querySelector("td span")?.textContent, "Legacy");
  assert.equal((document.querySelector("td span") as HTMLElement).style.fontSize, "calc(18px * var(--text-scale, 1))");
  assert.equal((document.querySelector(".formatted-mail") as HTMLElement).style.overflowX, "auto", "wide content scrolls sideways inside the mail, never vertically");
});

test("tiny newsletter preheader typography and box height do not overlap the body", () => {
  for (const [fontSize, lineHeight] of [["1px", "1px"], ["1px", "0"], ["0", "1px"], ["0", "0"]]) {
    const document = documentOf(render(`<div style="font-size:${fontSize};line-height:${lineHeight};height:1px;max-height:1px">Preview text</div><div>Body</div>`));
    const [preheader, body] = document.querySelectorAll<HTMLElement>(".formatted-mail > div");
    assert.equal(preheader.textContent, "Preview text");
    assert.equal(body.textContent, "Body");
    for (const property of ["fontSize", "lineHeight", "height", "maxHeight"] as const)
      assert.equal(preheader.style[property], "", `${fontSize}/${lineHeight}: ${property}`);
  }
});

test("newsletter image loading does not add prose inside a narrow icon cell", () => {
  const document = documentOf(render('<table><tr><td width="24"><img src="https://example.com/icon.png" width="24" height="24" alt="Company icon"></td><td>Newsletter body</td></tr></table>', false, true));
  assert.equal(document.querySelector("img")?.getAttribute("alt"), "Company icon");
  assert.equal(document.querySelector(".formatted-mail-image-status"), null);
  assert.equal(document.querySelector("td:last-child")?.textContent, "Newsletter body");
});

test("sender active tags, handlers, global styles, font resources and positioning never reach DOM", () => {
  const markup = render('<style>body{background:url(https://example.com/track)}</style><script>alert(1)</script><form>form payload<input name="secret"></form><iframe src="https://example.com/frame"></iframe><object data="https://example.com/object"></object><svg><a href="https://example.com/svg">svg payload</a></svg><p id="spoof" class="button" onclick="alert(1)" title="reader@example.com" aria-label="Morgan Example" style="position:fixed;top:0;z-index:999;background-image:url(https://example.com/track);font-family:remote;transform:scale(100);color:blue">Safe &lt;script&gt;text&lt;/script&gt;</p>');
  const document = documentOf(markup);
  assert.equal(document.querySelector("script,style,form,input,iframe,object,svg"), null);
  const p = document.querySelector("p")!;
  assert.equal(p.textContent, "Safe <script>text</script>");
  for (const attribute of ["id", "class", "onclick", "title", "aria-label"]) assert.equal(p.getAttribute(attribute), null);
  assert.equal(p.style.cssText, "background-color: transparent;");
  for (const secret of ["reader@example.com", "Morgan Example", "form payload", "svg payload", "https://example.com/track"])
    assert.ok(!markup.includes(secret), secret);
});

test("links reject unsafe destinations and suppress hidden tokens including percent-encoded names and addresses", () => {
  const html = '<a href="https://example.com/public">Public</a><a href="http://example.com/plain">HTTP</a>' +
    '<a href="javascript:alert(1)">Unsafe</a><a href="/api/state">Relative</a>' +
    '<a href="https://example.com/?to=reader%40example.com&amp;byte=%FF" title="reader@example.com">Contact Morgan Example</a>' +
    '<a href="https://example.com/?name=Morgan+Example" aria-label="Morgan Example">Private link</a>';
  const hidden = render(html, true);
  const document = documentOf(hidden);
  assert.equal(document.querySelectorAll("a").length, 2);
  assert.ok(!hidden.includes("reader"));
  assert.ok(!hidden.includes("Morgan"));
  assert.ok(!hidden.includes("%40"));
  assert.ok(hidden.includes("[hidden]"));
  for (const anchor of document.querySelectorAll("a")) {
    assert.equal(anchor.target, "_blank");
    assert.equal(anchor.rel, "noopener noreferrer");
    assert.equal(anchor.getAttribute("referrerpolicy"), "no-referrer");
  }
  assert.equal(documentOf(render(html)).querySelectorAll("a").length, 4);
});

test("nested formatted text uses the same parent redactor and cannot split hidden tokens across tags", () => {
  const html = '<p>Contact Morgan <strong>Example<img src="https://images.example.com/pixels.png" alt="Morgan Example"></strong>: reader<span>@example.com<img src="https://images.example.com/second.png" alt="reader@example.com"></span></p>';
  const hidden = render(html, true, true);
  assert.ok(hidden.includes("[hidden]"));
  for (const token of ["Morgan", "Example", "reader", "@example.com"])
    assert.ok(!hidden.includes(token), token);
  assert.deepEqual([...documentOf(hidden).querySelectorAll("img")].map((image) => [image.src, image.alt]), [
    ["https://images.example.com/pixels.png", "[hidden]"], ["https://images.example.com/second.png", "[hidden]"],
  ]);
  const blocked = render(html, true, false);
  assert.equal(documentOf(blocked).querySelector("img,[src]"), null);
  assert.ok(!blocked.includes("images.example.com"));
  assert.equal(documentOf(hidden).querySelectorAll("p").length, 1);
  const entityText = documentOf(render('<table><tbody><tr><td><strong>Morgan&#32;Example</strong></td></tr></tbody></table>', true));
  assert.equal(entityText.querySelector("strong")?.textContent, "[hidden]");
  assert.ok(entityText.querySelector("table"));
  const callbackText: string[] = [];
  const markup = renderToStaticMarkup(<FormattedMail html="<p>First <b>second</b></p>" privacy={false} showImages={false}
    renderText={(text) => { callbackText.push(text); return <mark>{text}</mark>; }} redactText={(text) => text} />);
  assert.deepEqual(callbackText, ["First ", "second"]);
  assert.equal(documentOf(markup).querySelectorAll("mark").length, 2);
});

test("inline images require consent and suppress private sources and metadata in privacy mode", () => {
  const html = '<p>Before</p><img src="https://images.example.com/photo.png" srcset="https://example.com/tracker 2x" onerror="bad()" alt="Photo" width="9000"><p>After</p>' +
    '<img src="cid:embedded"><img src="data:image/png;base64,eA=="><img src="https://localhost/private"><img src="http://example.com/insecure">';
  for (const privacy of [false, true]) {
    const blocked = render(html, privacy, false);
    assert.equal(documentOf(blocked).querySelector("img,[src],[srcset]"), null);
    assert.ok(!blocked.includes("images.example.com"));
  }
  const privateImages = '<img src="https://images.example.com/?to=reader%2540example.com" alt="reader@example.com">' +
    '<img src="https://images.example.com/Morgan+Example.png" alt="Morgan Example">' +
    '<img src="https://images.example.com/?name=Morgan%20Example" alt="Morgan Example">';
  const hidden = render(html + privateImages, true, true);
  assert.equal(documentOf(hidden).querySelectorAll("img").length, 1);
  assert.equal(documentOf(hidden).querySelectorAll('[aria-label="Image unavailable while personal information is hidden."]').length, 3);
  for (const token of ["reader", "Morgan", "%2540", "Example"]) assert.ok(!hidden.includes(token), token);
  assert.equal(documentOf(render(privateImages, false, true)).querySelectorAll("img").length, 3);
  const document = documentOf(render(html, false, true));
  assert.equal(document.querySelectorAll("img").length, 1);
  const image = document.querySelector("img")!;
  assert.equal(image.src, "https://images.example.com/photo.png");
  assert.equal(image.getAttribute("srcset"), null);
  assert.equal(image.getAttribute("onerror"), null);
  assert.equal(image.getAttribute("referrerpolicy"), "no-referrer");
  assert.equal(image.style.maxWidth, "100%");
  assert.equal(image.style.height, "auto");
  assert.equal(image.style.width, "");
  assert.equal(image.parentElement?.previousElementSibling?.textContent, "Before");
  assert.equal(image.parentElement?.nextElementSibling?.textContent, "After");
});

for (const [description, expected] of [
  ["x".repeat(490) + " reader@example.com", "x".repeat(490) + " ••••••••"],
  ["x".repeat(497) + " Nora Lane", "x".repeat(497) + " ••"],
  ["😀".repeat(248) + " Nora Lane", "😀".repeat(248) + " •••"],
  ["Photo for Nora Lane and reader@example.com", "Photo for •••••••• and ••••••••"],
  ["Public landscape", "Public landscape"],
] as const) {
  test(`formatted image alt redacts complete metadata before the display limit: ${description.length} units, ${description.includes("@") ? "address" : "description"}`, () => {
    const html = `<img src="https://images.example.com/photo.png" alt="${description}">`;
    const renderImage = (privacy: boolean, showImages = true) => documentOf(renderToStaticMarkup(
      <FormattedMail html={html} showImages={showImages} privacy={privacy}
        renderText={(text) => text} redactText={(text) => privacy ? redactPrivateText(text, ["Nora Lane"]) : text} />,
    ));
    assert.equal(renderImage(true, false).querySelector("img"), null, "metadata correction cannot grant consent");
    assert.equal(renderImage(false).querySelector("img")?.alt, description.slice(0, 500));
    assert.equal(renderImage(true).querySelector("img")?.alt, expected.slice(0, 500));
  });
}

for (const acrossImage of [false, true]) {
  test(`privacy preserves interleaved captions with private tokens split across ${acrossImage ? "images" : "tags"}`, () => {
    const first = '<img src="https://images.example.com/first.png" alt="Morgan Example">';
    const second = '<img src="https://images.example.com/second.png" alt="reader@example.com">';
    const html = acrossImage ?
      `<p>😀BEFORE Morgan <b>Ex${first}ample</b> BETWEEN reader<span>@${second}example.com</span> AFTER</p>` :
      `<p>😀BEFORE Morgan <b>Example</b>${first} BETWEEN reader<span>@example.com</span>${second} AFTER</p>`;
    const hidden = render(html, true, true);
    for (const token of ["Morgan", "Example", "reader", "@example.com"])
      assert.ok(!hidden.includes(token), token);
    const document = documentOf(hidden);
    const images = [...document.querySelectorAll("img")];
    assert.equal(images.length, 2);
    assert.deepEqual(images.map((image) => image.alt), ["[hidden]", "[hidden]"]);
    document.querySelectorAll(".formatted-mail-image-status").forEach((status) => status.remove());
    images.forEach((image, index) => image.replaceWith(` [image${index + 1}] `));
    assert.match(document.body.textContent || "", /😀BEFORE.*\[image1\].*BETWEEN.*\[image2\].*AFTER/s);
  });
}

test("privacy leaf offsets stay aligned after nested blocks and void separators", () => {
  const hidden = render('<div><p>Public</p><br><hr><table><tbody><tr><td>😀Morgan <b>Example</b></td><td>reader<span>@example.com</span></td></tr></tbody></table><p>After</p></div>', true);
  for (const token of ["Morgan", "Example", "reader", "@example.com"])
    assert.ok(!hidden.includes(token), token);
  const document = documentOf(hidden);
  assert.equal(document.querySelector("b")?.textContent, "[hidden]");
  assert.equal(document.querySelectorAll("td").length, 2);
  assert.equal(document.querySelectorAll("br,hr").length, 2);
  assert.match(document.body.textContent || "", /^Public😀\[hidden\]\[hidden\]\[hidden\]\[hidden\]After$/);
});

test("supported image-only mail keeps its formatted image without replacing it with fallback text", () => {
  const html = '<div><img src="https://images.example.com/photo.png"></div>';
  const blocked = documentOf(render(html, true));
  assert.equal(blocked.querySelector(".formatted-mail-fallback"), null);
  assert.equal(blocked.querySelector("img"), null);
  assert.match(blocked.querySelector(".formatted-mail-image-placeholder")?.getAttribute("aria-label") ?? "", /Use Show images/);
  const shown = documentOf(render(html, true, true));
  assert.equal(shown.querySelectorAll("img").length, 1);
  assert.ok(!shown.body.textContent?.includes("Plain fallback"));
});

test("unsupported, missing and over-budget content falls back through the parent text renderer", () => {
  for (const html of [null, undefined, "", "<script>discard</script>", "x".repeat(MAIL_HTML_LIMIT + 1),
    "<br>".repeat(MAIL_NODE_LIMIT + 1), "<div>".repeat(MAIL_DEPTH_LIMIT + 1) + "text"]) {
    const markup = render(html, true, true, "Contact Morgan Example and reader@example.com");
    assert.ok(markup.includes("[hidden]"));
    assert.ok(!markup.includes("reader"));
    assert.ok(!markup.includes("Morgan"));
    const document = documentOf(markup);
    assert.equal(document.querySelector("img,script"), null);
    assert.equal((document.querySelector(".formatted-mail-fallback") as HTMLElement).style.whiteSpace, "pre-wrap");
  }
  assert.equal(documentOf(render("<unknown-wrapper>Supported text</unknown-wrapper>")).body.textContent, "Supported text");
});

test("mounted inline images report load/error and leave DOM when consent is revoked", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>");
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const html = '<p>Text</p><img src="https://images.example.com/photo.png" alt="Photo" style="width:120px;height:800px;max-height:24px">';
  const update = async (showImages: boolean, privacy = false) => {
    await act(async () => root.render(<FormattedMail html={html} showImages={showImages} privacy={privacy}
      renderText={(text) => privacy ? redact(text) : text} redactText={(text) => privacy ? redact(text) : text} />));
  };
  try {
    await update(false);
    assert.equal(container.querySelector("img"), null);
    await update(true);
    assert.equal(container.querySelector("img")?.style.maxHeight, "24px");
    await act(async () => container.querySelector("img")!.dispatchEvent(new dom.window.Event("load")));
    assert.ok(container.querySelector("img"));
    await act(async () => container.querySelector("img")!.dispatchEvent(new dom.window.Event("error")));
    assert.equal(container.querySelector("img"), null);
    const failed = container.querySelector<HTMLElement>('[aria-label="Image could not be loaded."]');
    assert.equal(failed?.getAttribute("role"), "img");
    assert.equal(failed?.style.width, "min(120px, 100%)");
    assert.equal(failed?.style.getPropertyValue("aspect-ratio"), "120 / 800");
    assert.equal(failed?.style.maxHeight, "24px");
    await update(false);
    await update(true);
    assert.ok(container.querySelector("img"));
    await update(false, true);
    assert.equal(container.querySelector("img"), null);
    await update(true, true);
    assert.ok(container.querySelector("img"));
    await update(false, false);
    assert.equal(container.querySelector("img"), null);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow); else Reflect.deleteProperty(globalThis, "window");
    if (oldDocument) Object.defineProperty(globalThis, "document", oldDocument); else Reflect.deleteProperty(globalThis, "document");
    delete actGlobal.IS_REACT_ACT_ENVIRONMENT;
  }
});

test("styled mail re-inks sender text that matches its background and re-evaluates each render", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>");
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const html = '<style>.pre{color:#fefefe}</style><table bgcolor="#ffffff"><tbody><tr><td>' +
    '<div class="pre" style="display:none;max-height:0;font-size:0">Your weekly digest&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>' +
    '<p style="color:#222">Visible body text</p><p>Reach reader@example.com anytime</p></td></tr></tbody></table>';
  const update = (privacy = false) => act(async () => root.render(
    <PrivacyContext.Provider value={{ on: privacy, revealed: new Set(["reader@example.com"]), toggle() {}, names: ["Morgan Example"] }}>
      <FormattedMail html={html} privacy={privacy} showImages={false} privateNames={["Morgan Example"]}
        renderText={(text, segments) => privacy ? <Redact text={text} segments={segments} /> : <>{text}</>}
        redactText={(text) => privacy ? redact(text) : text} />
    </PrivacyContext.Provider>));
  // jsdom does not cascade @scope, so sender-class colors are stubbed per
  // element; everything else uses real jsdom computed values.
  const colors = new Map<Element, string>();
  const real = dom.window.getComputedStyle.bind(dom.window);
  dom.window.getComputedStyle = ((element: Element) =>
    colors.has(element) ? { color: colors.get(element), backgroundColor: "rgba(0, 0, 0, 0)" } as CSSStyleDeclaration :
      real(element)) as typeof dom.window.getComputedStyle;
  try {
    await update();
    assert.equal(container.querySelector("iframe"), null, "styled mail renders in the reader document");
    const pre = container.querySelector<HTMLElement>(".formatted-mail .sender-0")!;
    assert.equal(pre.textContent, "Your weekly digest ", "padding entities collapse to one space");
    assert.equal(pre.getAttribute("data-ink"), null, "real jsdom color (black) needs no ink");
    colors.set(pre, "rgb(254, 254, 254)");
    await update();
    assert.equal(pre.getAttribute("data-ink"), "dark", "near-white text on white is re-inked dark");
    const body = container.querySelector(".formatted-mail p")!;
    assert.equal(body.textContent, "Visible body text");
    assert.equal(body.getAttribute("data-ink"), null, "real jsdom #222 keeps its sender color");
    pre.setAttribute("data-ink", "light");
    await update();
    assert.equal(pre.getAttribute("data-ink"), "dark", "re-render re-evaluates the mark");
    // A privacy-mode address control is skipped even at preheader contrast.
    await update(true);
    const address = container.querySelector<HTMLElement>(".formatted-mail .address")!;
    assert.ok(address, "revealed address control renders");
    colors.set(address, "rgb(254, 254, 254)");
    await update(true);
    assert.equal(address.textContent, "reader@example.com");
    assert.equal(address.getAttribute("data-ink"), null);
    assert.equal(container.querySelector(".formatted-mail .sender-0")!.getAttribute("data-ink"), "dark", "the preheader stays marked under privacy");
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow); else Reflect.deleteProperty(globalThis, "window");
    if (oldDocument) Object.defineProperty(globalThis, "document", oldDocument); else Reflect.deleteProperty(globalThis, "document");
    delete actGlobal.IS_REACT_ACT_ENVIRONMENT;
  }
});

test("links keep the sender's text decoration and leave plain links to the sheet's hover underline", () => {
  const document = documentOf(render('<a href="https://example.com/a" style="text-decoration:none">Card</a><a href="https://example.com/b">Plain</a>'));
  const [card, plain] = document.querySelectorAll("a");
  assert.equal(card.style.textDecoration, "none");
  assert.equal(plain.style.textDecoration, "");
});

test("loaded images sit in the sender's line instead of an inline-block box", () => {
  const document = documentOf(render('<p><img src="https://images.example.com/pin.png" width="12" style="vertical-align:middle"> Remote</p>', false, true));
  const image = document.querySelector("img")!;
  assert.equal(image.style.verticalAlign, "middle");
  assert.equal(image.style.width, "12px");
  assert.equal((image.parentElement as HTMLElement).style.display, "contents");
});

test("images sized only by height keep that height instead of their natural size", () => {
  const document = documentOf(render('<img src="https://images.example.com/icon.png" height="25" style="height:25px"><img src="https://images.example.com/logo.png" width="120" height="40" style="max-height:2px">', false, true));
  const [icon, logo] = document.querySelectorAll("img");
  assert.equal(icon.style.height, "25px");
  assert.equal(logo.style.width, "120px");
  assert.equal(logo.style.height, "auto"); // Width wins so a narrowed image keeps its shape.
  assert.equal(logo.style.getPropertyValue("aspect-ratio"), "120 / 40");
  assert.equal(logo.style.maxHeight, "2px");
});

test("loaded images keep the sender's declared proportions instead of their natural size", () => {
  const document = documentOf(render(
    '<img src="https://images.example.com/spacer.png" width="600" height="1">' +
    '<img src="https://images.example.com/pixel.png" width="100%" height="1">' +
    '<img src="https://images.example.com/hero.png" width="600">' +
    '<img src="https://images.example.com/icon.png" height="25">', false, true));
  const [spacer, pixel, hero, icon] = document.querySelectorAll("img");
  // A px width and height pin the declared aspect ratio; a natural square
  // can no longer stretch a spacer into a giant empty box.
  assert.equal(spacer.style.height, "auto");
  assert.equal(spacer.style.getPropertyValue("aspect-ratio"), "600 / 1");
  // A non-px width leaves the declared height in place.
  assert.equal(pixel.style.height, "1px");
  assert.equal(pixel.style.getPropertyValue("aspect-ratio"), "");
  // Width alone keeps natural proportions.
  assert.equal(hero.style.height, "auto");
  assert.equal(hero.style.getPropertyValue("aspect-ratio"), "");
  // Height alone is unchanged.
  assert.equal(icon.style.height, "25px");
  assert.equal(icon.style.getPropertyValue("aspect-ratio"), "");
  // Blocked placeholders already carry the declared shape, before consent,
  // and narrow with the reader exactly as the loaded image would.
  const blocked = documentOf(render('<img src="https://images.example.com/spacer.png" width="600" height="1">'));
  const box = blocked.querySelector<HTMLElement>(".formatted-mail-image-placeholder")!;
  assert.equal(box.style.width, "min(600px, 100%)");
  assert.equal(box.style.height, "auto");
  assert.equal(box.style.getPropertyValue("aspect-ratio"), "600 / 1");
});

test("blocked images keep their size as an empty box and carry the reason as a label", () => {
  const document = documentOf(render('<img src="https://images.example.com/icon.png" width="24" height="24" alt="Icon">' +
    '<img src="https://images.example.com/bar.png" width="100%" height="4"><img src="https://images.example.com/tall.png" height="40">'));
  const [box, bar, tall] = document.querySelectorAll<HTMLElement>(".formatted-mail-image-placeholder");
  assert.equal(box.style.width, "min(24px, 100%)");
  assert.equal(box.style.getPropertyValue("aspect-ratio"), "24 / 24");
  assert.equal(bar.style.width, "100%", "relative widths pass through");
  assert.equal(bar.style.height, "4px");
  assert.equal(tall.style.width, "24px", "an unsized width keeps the 24px box");
  assert.equal(tall.style.height, "40px");
  assert.equal(box.textContent, "");
  assert.equal(box.getAttribute("aria-label"), "Image blocked. Use Show images to load it.");
});

test("image max-height caps survive blocked, unsupported and private placeholders", () => {
  const image = (src: string) => `<img src="${src}" width="120" height="800" style="max-height:24px">`;
  const cases = [
    [render(image("https://images.example.com/photo.png")), "Image blocked. Use Show images to load it."],
    [render(`<p>Context</p>${image("http://images.example.com/photo.png")}`, false, true), "Unsupported image."],
    [render(image("https://images.example.com/?name=Morgan%20Example"), true, true), "Image unavailable while personal information is hidden."],
  ] as const;
  for (const [markup, reason] of cases) {
    const box = documentOf(markup).querySelector<HTMLElement>(".formatted-mail-image-placeholder");
    assert.ok(box, reason);
    assert.equal(box.style.width, "min(120px, 100%)");
    assert.equal(box.style.getPropertyValue("aspect-ratio"), "120 / 800");
    assert.equal(box.style.maxHeight, "24px");
    assert.equal(box.getAttribute("aria-label"), reason);
  }
});

test("legacy alignment centers tables, center wraps blocks and quotes take the app inset", () => {
  const document = documentOf(render('<center><table align="center" width="600"><tbody><tr><td>Column</td></tr></tbody></table></center>' +
    '<img src="https://images.example.com/a.png" align="right"><blockquote style="margin:0 0 0 .8ex;border-left:1px #ccc solid;padding-left:1ex;font-size:13px">Quoted</blockquote>'));
  const table = document.querySelector("table")!;
  assert.equal(table.style.marginLeft, "auto");
  assert.equal(table.style.marginRight, "auto");
  assert.equal(table.parentElement!.tagName, "DIV", "center renders as a block");
  const quote = document.querySelector("blockquote")!;
  assert.equal(quote.style.margin, "");
  assert.equal(quote.style.borderLeft, "");
  assert.equal(quote.style.paddingLeft, "");
  assert.equal(quote.style.fontSize, "calc(13px * var(--text-scale, 1))", "sender sizes follow the app text size");
});

test("social icon rows keep their sender layout: table cells, inline-block wrappers and floated tables", () => {
  const icon = (name: string) => `<a href="https://example.com/${name}"><img src="https://images.example.com/${name}.png" width="24" height="24" alt="${name}"></a>`;
  // Five cells inside one row stay beside each other.
  const cells = ["Facebook", "X", "LinkedIn", "WhatsApp", "Messenger"].map((name) => `<td>${icon(name)}</td>`).join("");
  const cellRow = documentOf(render(`<table><tbody><tr>${cells}</tr></tbody></table>`));
  assert.equal(cellRow.querySelectorAll("tr").length, 1);
  assert.equal(cellRow.querySelector("tr")?.querySelectorAll("td").length, 5);
  // Inline-block wrappers place consecutive icons on the same line.
  const wrapped = documentOf(render(`<p>${["a", "b"].map((name) => `<div style="display:inline-block">${icon(name)}</div>`).join("")}</p>`));
  assert.deepEqual([...wrapped.querySelectorAll<HTMLElement>(".formatted-mail div")].map((node) => node.style.display), ["inline-block", "inline-block"]);
  // Newsletter footers float a small table per icon with align="left". Without
  // the float each table is block-level and every icon lands on its own line.
  const floated = documentOf(render(`${["a", "b", "c", "d", "e"].map((name) => `<table align="left"><tr><td>${icon(name)}</td></tr></table>`).join("")}`));
  const tables = floated.querySelectorAll<HTMLElement>(".formatted-mail > table");
  assert.equal(tables.length, 5);
  assert.deepEqual([...tables].map((node) => node.style.float), ["left", "left", "left", "left", "left"]);
});

test("an image the browser refuses is retried once through the mail service", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>");
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const oldFetch = globalThis.fetch, oldCreate = URL.createObjectURL, oldRevoke = URL.revokeObjectURL;
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  const requests: string[] = [], revoked: string[] = [];
  let ok = true;
  globalThis.fetch = (async (url: string) => {
    requests.push(url);
    return new Response(ok ? new Blob(["GIF89a"], { type: "image/gif" }) : "{}", { status: ok ? 200 : 502 });
  }) as typeof fetch;
  URL.createObjectURL = () => `blob:copy-${requests.length}`;
  URL.revokeObjectURL = (url: string) => { revoked.push(url); };
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const src = "https://images.example.com/hero.gif?size=2";
  const show = (mailId: string) => act(async () => root.render(<FormattedMail key={mailId} mailId={mailId} html={`<img src="${src}" alt="Hero" width="120" height="40">`}
    showImages privacy={false} renderText={(text) => text} redactText={(text) => text} />));
  const fail = () => act(async () => { container.querySelector("img")!.dispatchEvent(new dom.window.Event("error")); });
  try {
    await show("a:1");
    assert.equal(container.querySelector("img")?.getAttribute("src"), src);
    await fail();
    assert.deepEqual(requests, [`/api/messages/a%3A1/remote-image?src=${encodeURIComponent(src)}`]);
    assert.equal(container.querySelector("img")?.getAttribute("src"), "blob:copy-1");
    await fail();
    assert.equal(requests.length, 1, "the service copy is not requested again");
    assert.equal(container.querySelector("img"), null);
    assert.ok(container.querySelector('[aria-label="Image could not be loaded."]'));
    assert.deepEqual(revoked, ["blob:copy-1"]);
    ok = false;
    await show("a:2");
    await fail();
    assert.equal(requests.length, 2);
    assert.equal(container.querySelector("img"), null);
    assert.equal(container.querySelector<HTMLElement>('[aria-label="Image could not be loaded."]')?.style.width, "min(120px, 100%)");
    // Closing the reader mid-retry cancels the request and creates no blob URL.
    let signal: AbortSignal | undefined, created = 0;
    globalThis.fetch = ((_url: string, init?: RequestInit) => { signal = init?.signal ?? undefined; return new Promise<Response>(() => {}); }) as typeof fetch;
    URL.createObjectURL = () => `blob:late-${++created}`;
    await show("a:3");
    await fail();
    assert.ok(container.querySelector('[aria-label="Loading image…"]'));
    assert.equal(signal?.aborted, false);
    await act(async () => root.render(<></>));
    assert.equal(signal?.aborted, true);
    assert.equal(created, 0);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    globalThis.fetch = oldFetch; URL.createObjectURL = oldCreate; URL.revokeObjectURL = oldRevoke;
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow); else Reflect.deleteProperty(globalThis, "window");
    if (oldDocument) Object.defineProperty(globalThis, "document", oldDocument); else Reflect.deleteProperty(globalThis, "document");
    delete actGlobal.IS_REACT_ACT_ENVIRONMENT;
  }
});


test("styled mail selects ink over translucent host layers and canvas fallbacks", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>");
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  try {
    for (const [app, body, canvas, ink] of [
      ["rgba(0,0,0,.9)", "white", "", "light"],
      ["rgba(255,255,255,.9)", "black", "", "dark"],
      ["rgba(0,0,0,.9)", "", "", "light"],
      ["rgba(0,0,0,.5)", "rgba(0,0,0,.8)", "", "light"],
      ["", "rgba(0,0,0,.9)", "", "light"],
      ["", "", "black", "light"],
      ["white", "black", "", "dark"],
      ["", "", "", "dark"],
    ]) {
      dom.window.document.body.style.backgroundColor = body;
      dom.window.document.documentElement.style.backgroundColor = canvas;
      await act(async () => root.render(
        <div className="app" style={{ backgroundColor: app }}>
          <FormattedMail html='<style>p{margin:0}</style><p style="color:transparent">Preview</p>' privacy={false} showImages={false}
            renderText={(text) => text} redactText={(text) => text} />
        </div>,
      ));
      assert.equal(container.querySelector(".formatted-mail p")!.getAttribute("data-ink"), ink,
        `app=${app}, body=${body}, canvas=${canvas}`);
    }
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow); else Reflect.deleteProperty(globalThis, "window");
    if (oldDocument) Object.defineProperty(globalThis, "document", oldDocument); else Reflect.deleteProperty(globalThis, "document");
    delete actGlobal.IS_REACT_ACT_ENVIRONMENT;
  }
});

test("wide mail zooms to the reader width down to the legibility floor, then scrolls", () => {
  const dom = new JSDOM("<!doctype html><div class='formatted-mail'></div>");
  const box = dom.window.document.querySelector<HTMLElement>(".formatted-mail")!;
  const measure = (client: number, scroll: number) => {
    Object.defineProperty(box, "clientWidth", { configurable: true, get: () => client });
    // Measurement must happen at natural size, so zoom is reset first.
    Object.defineProperty(box, "scrollWidth", { configurable: true, get: () => box.style.zoom ? -1 : scroll });
    fitWidth(box);
    return box.style.zoom;
  };
  try {
    assert.equal(measure(500, 500), "", "mail that fits keeps its size");
    assert.equal(measure(500, 501), "", "a subpixel rounding difference is not overflow");
    assert.equal(Number(measure(450, 600)), 0.75, "a 600px newsletter fits a 450px reader");
    assert.equal(measure(500, 500), "", "a wider reader removes the zoom");
    assert.equal(Number(measure(200, 800)), MIN_FIT, "very wide mail stops at the floor and scrolls");
    assert.equal(measure(0, 600), "", "an unmeasured box is left alone");
  } finally {
    dom.window.close();
  }
});
