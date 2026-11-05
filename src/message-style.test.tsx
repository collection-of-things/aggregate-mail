import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageText } from "./mail/MessageContent";
import { FormattedMail } from "./mail/FormattedMail";
import { AppearanceSettings } from "./settings/AppearanceSettings";
import { defaultAppearance } from "./appearance";
import type { Mail } from "../shared/types";
import { MailList } from "./mail/MailList";
import { BulkSelectionContext, selectionKey } from "./mail/bulk-selection";
import { InboxTabs } from "./mail/InboxTabs";
import { inboxTabs } from "../shared/inbox-tabs";

// The stylesheet entry imports one file per area; jsdom does not follow @import.
const stylesheet = () => readFileSync(new URL("./style.css", import.meta.url), "utf8")
  .match(/@import "[^"]+";/g)!
  .map((line) => readFileSync(new URL(line.slice(9, -2), import.meta.url), "utf8")).join("\n");

test("opaque sticky date captions cover the rows scrolling beneath them", () => {
  const dom = new JSDOM('<div class="mail-window-date"><div class="group">Today</div></div>');
  try {
    dom.window.document.head.insertAdjacentHTML("beforeend", `<style>${stylesheet()}</style>`);
    const style = dom.window.getComputedStyle(dom.window.document.querySelector(".group")!);
    assert.equal(style.position, "sticky");
    assert.equal(style.backgroundColor, "var(--rebuild-canvas)");
  } finally { dom.window.close(); }
});

test("the list width re-evaluates the text scale where the preference lives", () => {
  // --text-scale is written inline on .app, so --list-width must be declared
  // there; the :root expression would always resolve with the fallback.
  const rules = stylesheet();
  assert.match(rules, /\.app\s*\{[^}]*--list-width:\s*clamp\(320px,\s*calc\(31vw \* var\(--text-scale/);
});

test("rendered mail rows keep their gutter across checkbox states after the complete stylesheet cascade", () => {
  const mail: Mail = { id: "a:1", accountId: "a", remoteId: "1", sender: "Team", address: "sender@example.com",
    to: "reader@example.com", subject: "Work", preview: "Preview", body: "", date: 1, unread: true,
    category: "important", relevance: 2, reason: "", archived: false, snoozedUntil: null };
  const dom = new JSDOM("<!doctype html>");
  try {
    dom.window.document.head.insertAdjacentHTML("beforeend", `<style>${stylesheet()}</style>`);
    for (const density of ["compact", "comfortable"] as const) for (const narrow of [false, true]) {
      for (const state of ["absent", "unchecked", "checked"] as const) {
        const selected = new Set(state === "checked" ? [selectionKey(mail)] : []);
        dom.window.document.body.innerHTML = renderToStaticMarkup(<div className={`list ${density}`}>
          <BulkSelectionContext.Provider value={state === "absent" ? null : { selected, disabled: false, toggle: () => {} }}>
            <MailList messages={[mail]} selectedId={undefined} density={density} narrow={narrow} sort="newest"
              opening="double" accounts={[]} listRef={{ current: null }} focusSelection={false}
              onOpen={() => {}} onSelect={() => {}} onMenu={() => {}} onMenuKey={() => {}} />
          </BulkSelectionContext.Provider>
        </div>);
        const context = `${density}, narrow=${narrow}, checkbox=${state}`;
        const row = dom.window.document.querySelector(".mail-window-row > .mail-row > .row")!;
        const checkbox = dom.window.document.querySelector(".mail-select");
        assert.ok(row, context);
        assert.equal(checkbox?.getAttribute("aria-checked"), state === "absent" ? undefined : String(state === "checked"), context);
        assert.equal(dom.window.getComputedStyle(row).paddingLeft, "34px", context);
        if (checkbox) {
          const style = dom.window.getComputedStyle(checkbox);
          assert.equal(style.position, "absolute", context);
          assert.equal(style.left, "10px", context);
          assert.equal(style.top, "50%", context);
          assert.equal(style.transform, "translateY(-50%)", context);
        }
      }
    }
  } finally { dom.window.close(); }
});

test("Inbox categories show only the active name in both reading layouts", () => {
  const dom = new JSDOM("<!doctype html>");
  try {
    dom.window.document.head.insertAdjacentHTML("beforeend", `<style>${stylesheet()}</style>`);
    for (const reading of ["full", "split"]) for (const active of inboxTabs) {
      dom.window.document.body.innerHTML = renderToStaticMarkup(<div className="app"><div className="app-main">
        <div className="mail-category-bar"><InboxTabs tab={active.id} unread={new Map(inboxTabs.map(({ id }) => [id, 3]))} onTab={() => {}} /></div>
        <div className={`workspace ${reading === "split" ? "split" : ""}`} />
      </div></div>);
      for (const button of dom.window.document.querySelectorAll<HTMLButtonElement>(".inbox-tabs button")) {
        const label = button.querySelector(".tab-label")!;
        const style = dom.window.getComputedStyle(label);
        const selected = button.getAttribute("aria-current") === "page";
        assert.equal(button.title, label.textContent);
        assert.equal(style.position === "absolute", !selected, `${reading}: ${button.title}`);
        if (!selected) {
          assert.equal(style.clipPath, "inset(50%)");
          assert.notEqual(style.display, "none", "the category name remains accessible");
        }
        assert.ok(button.querySelector("svg"));
        assert.notEqual(dom.window.getComputedStyle(button.querySelector(".tab-count")!).display, "none");
      }
    }
  } finally { dom.window.close(); }
});

test("dark selection is distinct and rebuild headers and footers retain shared geometry", () => {
  const dom = new JSDOM('<div class="app"><div class="list"><button class="row card selected"></button></div><section class="work-pane"><header class="main-head"></header></section><div class="compose-dialog"><footer class="compose-footer"></footer></div></div>');
  try {
    const document = dom.window.document;
    document.documentElement.dataset.scheme = "dark";
    document.head.insertAdjacentHTML("beforeend", `<style>${stylesheet()}</style>`);
    const style = (selector: string) => dom.window.getComputedStyle(document.querySelector(selector)!);
    assert.equal(style(".row").backgroundColor, "var(--selected-card)");
    assert.equal(style(".main-head").height, "auto");
    assert.equal(style(".compose-footer").minHeight, "var(--app-footer-height)");
  } finally { dom.window.close(); }
});

test("theme choices grow above accent swatches without inheriting the mail-row height", () => {
  const dom = new JSDOM("<!doctype html>");
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  try {
    const document = dom.window.document;
    document.body.innerHTML = renderToStaticMarkup(<>
      <AppearanceSettings value={defaultAppearance} scheme="dark" onChange={() => true} />
      <div className="row" />
    </>);
    document.head.insertAdjacentHTML("beforeend", `<style>${stylesheet()}</style>`);
    const height = (selector: string) => dom.window.getComputedStyle(document.querySelector(selector)!).height;
    assert.ok(["", "auto"].includes(height(".settings-row.stacked")), "Theme rows must grow with their previews and labels");
    assert.equal(height(".theme-preview"), "56px");
    assert.equal(height(".accent-choices button"), "22px");
    assert.equal(height(".row"), "calc(var(--mail-row-medium) * var(--text-scale, 1))", "Mail rows keep shared scaled windowing geometry");
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    dom.window.close();
  }
});

test("image status styles preserve body paragraph size, spacing and sender presentation", () => {
  const markup = renderToStaticMarkup(<section className="message-images">
    <div className="message-body"><MessageText text="Plain text" />
      <FormattedMail html='<p>Formatted text</p><p style="font-size:24px">Large text</p>'
        showImages={false} privacy={false} renderText={(text) => text} redactText={(text) => text} />
    </div><p role="status">Loading images</p>
  </section>);
  const dom = new JSDOM(`<style></style>${markup}`);
  try {
    const document = dom.window.document;
    document.querySelector("style")!.textContent = stylesheet();
    // jsdom does not resolve inherited font sizes, so read the first specified ancestor.
    const fontSize = (element: Element): string => {
      for (let current: Element | null = element; current; current = current.parentElement) {
        const size = dom.window.getComputedStyle(current).fontSize;
        if (size) return size;
      }
      return "";
    };
    const paragraphs = [...document.querySelectorAll(".message-body p")];
    assert.deepEqual(paragraphs.map(fontSize), [13, 13, 24].map(size => `calc(${size}px * var(--text-scale, 1))`));
    assert.deepEqual(paragraphs.map((p) => dom.window.getComputedStyle(p).marginBottom), ["18px", "18px", "18px"]);
    assert.equal(fontSize(document.querySelector('[role="status"]')!), "calc(13px * var(--text-scale, 1))");
  } finally { dom.window.close(); }
});

test("sender colors, backgrounds, borders and links use the app theme", () => {
  const markup = renderToStaticMarkup(<div className="message-body">
    <FormattedMail html='<table bgcolor="#fff" style="border:2px solid #000"><tbody><tr><td style="color:black;background:#fff;border:1px dashed red">Text <a href="https://example.com" style="color:black"><strong style="color:black">Link</strong></a><a href="javascript:alert(1)">Unsafe</a></td></tr></tbody></table>'
      showImages={false} privacy={false} renderText={(text) => text} redactText={(text) => text} />
  </div>);
  const dom = new JSDOM(markup);
  try {
    const document = dom.window.document;
    const css = stylesheet();
    document.head.insertAdjacentHTML("beforeend", `<style>${css}</style>`);
    const table = document.querySelector("table")!;
    const cell = document.querySelector("td")!;
    const link = document.querySelector("a")!;
    assert.match(table.getAttribute("style") || "", /border:\s*2px solid var\(--line\)/);
    // jsdom drops declarations after a border shorthand containing a CSS variable.
    assert.match(table.getAttribute("style") || "", /background-color:\s*transparent/);
    assert.equal(cell.style.color, "");
    assert.match(cell.getAttribute("style") || "", /background-color:\s*transparent/);
    assert.match(cell.getAttribute("style") || "", /border:\s*1px dashed var\(--line\)/);
    assert.equal(link.style.color, "var(--link)");
    assert.equal((link.querySelector("strong") as HTMLElement).style.color, "");
    assert.equal((cell.querySelector("span") as HTMLElement).style.color, "");
    assert.equal((cell.querySelector("span") as HTMLElement).style.textDecoration, "");
    assert.match(css, /\.formatted-mail a\s*\{[^}]*text-decoration-thickness:\s*1px/);
  } finally { dom.window.close(); }
});


test("selected mail rail grows around wrapping counts and actions without a scroll-only toolbar", () => {
  const dom = new JSDOM('<div class="mail-category-bar"><div class="rail-actions"><div class="rail-triage" data-selection="true"><span class="rail-count">200 messages selected; selection limited to 200</span><span class="rail-tools"><button class="tool">Move to Trash</button></span></div></div></div>');
  try {
    dom.window.document.head.insertAdjacentHTML("beforeend", `<style>${stylesheet()}</style>`);
    const style = (selector: string) => dom.window.getComputedStyle(dom.window.document.querySelector(selector)!);
    assert.equal(style(".mail-category-bar").height, "auto");
    assert.equal(style(".rail-triage").flexWrap, "wrap");
    assert.equal(style(".rail-tools").flexWrap, "wrap");
    assert.notEqual(style(".rail-triage").overflowX, "auto");
    assert.notEqual(style(".rail-count").whiteSpace, "nowrap");
  } finally { dom.window.close(); }
});
