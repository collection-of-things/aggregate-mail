import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Mail } from "../shared/types";
import type { Api } from "./api";
import { Reader } from "./mail/Reader";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { ReaderContent } from "./mail/MessageContent";
import { parsePlainTextQuotes, PLAIN_QUOTE_DEPTH_LIMIT, type PlainTextBlock } from "../shared/mail-content";

const api: Api = async () => { throw Error("Static reader must not fetch"); };

test("reader opens a single cached message without conversation chrome and shows the local snooze return time", () => {
  const until = Date.now() + 86400000;
  const mail: Mail = { id: "mail", accountId: "a", remoteId: "one", sender: "Team", address: "team@example.test", to: "me@example.test", subject: "Plan", preview: "", body: "Cached text", date: 1, unread: false, archived: false, snoozedUntil: until, relevance: 2, category: "important", reason: "", html: null, images: [], attachments: [] };
  const html = renderToStaticMarkup(<Reader mail={mail} provider="imap" labels={[]} busy={false} api={api} onLabels={() => {}} onMenu={() => {}} onMenuKey={() => {}} onOpen={() => {}} onChanged={async () => {}} />);
  assert.ok(html.includes('class="conversation-reader"'));
  assert.ok(!html.includes("conversation-toggle"));
  assert.ok(!html.includes("conversation-bar"));
  assert.ok(!html.includes("Selected for actions"));
  assert.ok(!html.includes(' open=""'));
  assert.ok(!html.includes('Track work'));
  assert.ok(!html.includes('class="message-labels"'));
  assert.ok(html.includes('Returns to Inbox'));
  assert.ok(html.includes(new Date(until).toLocaleString()));
  assert.ok(html.includes('(local time)'));
  assert.ok(!html.includes('aria-label="Attachments"'));
});

const quotedReplyBody = `Sounds good, see you Thursday.

Cheers,
Synthetic Team

On Mon, Nov 2, 2026 at 9:00 AM Alex Example <alex@example.test> wrote:
> Can we move the review to Thursday? The earlier slot conflicts with the
> planning
> session that runs long every week, so Thursday afternoon works better.
>
>
>
>    On Sun, Nov 1, 2026 at 8:00 PM Sam Sample <sam@example.test> wrote:
> > First draft of the quarterly report is ready. Please send comments by
> > Friday.
> >
> >
> > > Original request from the kickoff meeting about the zebrafinch survey.`;

const texts = (blocks: readonly PlainTextBlock[]): string[] =>
  blocks.flatMap((block) => block.kind === "text" ? [block.text] : texts(block.blocks));

test("plain-text parser splits reply text from collapsed nested quote history", () => {
  const { blocks, history } = parsePlainTextQuotes(quotedReplyBody);
  assert.deepEqual(blocks, [
    { kind: "text", text: "Sounds good, see you Thursday." },
    { kind: "text", text: "Cheers,\nSynthetic Team" },
  ]);
  assert.equal(history.length, 2);
  assert.deepEqual(history[0], {
    kind: "text", attribution: true,
    text: "On Mon, Nov 2, 2026 at 9:00 AM Alex Example <alex@example.test> wrote:",
  });
  const quote = history[1];
  assert.equal(quote.kind, "quote");
  if (quote.kind !== "quote") return;
  assert.equal(quote.blocks[0].kind, "text");
  assert.equal(quote.blocks[0].kind === "text" && quote.blocks[0].text,
    "Can we move the review to Thursday? The earlier slot conflicts with the planning session that runs long every week, so Thursday afternoon works better.");
  assert.deepEqual(quote.blocks[1], {
    kind: "text", attribution: true,
    text: "On Sun, Nov 1, 2026 at 8:00 PM Sam Sample <sam@example.test> wrote:",
  });
  assert.ok(quote.blocks[1].kind === "text" && quote.blocks[1].text.startsWith("On Sun"), "nested attribution is trimmed");
  const nested = quote.blocks[2];
  assert.equal(nested.kind, "quote");
  const deepest = nested.kind === "quote" && nested.blocks[1];
  assert.equal(nested.kind === "quote" && nested.blocks[0].kind === "text" &&
    (nested.blocks[0] as { text: string }).text,
    "First draft of the quarterly report is ready. Please send comments by Friday.");
  assert.ok(deepest && deepest.kind === "quote", "three quote levels survive");
  assert.equal(deepest && deepest.kind === "quote" && deepest.blocks[0].kind === "text" &&
    (deepest.blocks[0] as { text: string }).text,
    "Original request from the kickoff meeting about the zebrafinch survey.");
  const all = [...texts(blocks), ...texts(history)];
  for (const text of all) {
    assert.ok(text.trim(), "no empty text blocks");
    for (const line of text.split("\n")) assert.doesNotMatch(line, /^\s*>/, `no quote markers remain: ${line}`);
  }
});

test("parser edge cases: inline quotes, wrapped attribution, blank runs, depth clamp, untouched unquoted text", () => {
  const inline = parsePlainTextQuotes("Top reply\n\n> quoted line\n\nBottom reply");
  assert.equal(inline.history.length, 0);
  assert.deepEqual(inline.blocks.map((block) => block.kind), ["text", "quote", "text"]);
  const wrapped = parsePlainTextQuotes("Reply\n\nOn Mon, Nov 2, 2026 at 9:00 AM Alex Example <\nalex@example.test> wrote:\n> quoted");
  assert.equal(wrapped.history.length, 2);
  assert.deepEqual(wrapped.history[0], {
    kind: "text", attribution: true,
    text: "On Mon, Nov 2, 2026 at 9:00 AM Alex Example <alex@example.test> wrote:",
  });
  const blanks = parsePlainTextQuotes("Reply\n\n> first\n>\n>\n> second");
  const quote = blanks.history.at(-1);
  assert.ok(quote && quote.kind === "quote");
  assert.deepEqual(quote.kind === "quote" && quote.blocks, [
    { kind: "text", text: "first" },
    { kind: "text", text: "second" },
  ]);
  const only = parsePlainTextQuotes("> only a quote");
  assert.equal(only.history.length, 0);
  assert.equal(only.blocks.length === 1 && only.blocks[0].kind, "quote");
  const deep = parsePlainTextQuotes(`${"> ".repeat(12)}deep`);
  let levels = 0, node: PlainTextBlock | undefined = deep.blocks[0];
  while (node && node.kind === "quote") { levels++; node = node.blocks[0]; }
  assert.equal(levels, PLAIN_QUOTE_DEPTH_LIMIT);
  assert.ok(node && node.kind === "text" && node.text === "deep");
  const plain = parsePlainTextQuotes("first  kept\nlines\n\n\nsecond paragraph");
  assert.deepEqual(plain.blocks, [
    { kind: "text", text: "first  kept\nlines" },
    { kind: "text", text: "second paragraph" },
  ]);
  assert.equal(plain.history.length, 0);
  const listed = parsePlainTextQuotes("Reply\n\n> a wrapped line that runs on and on past the wrap column yes\n> - item one\n> - item two\n> continuation that is also long enough to keep going on and on");
  const listedQuote = listed.history.at(-1);
  assert.ok(listedQuote && listedQuote.kind === "quote");
  const listedText = listedQuote.kind === "quote" && listedQuote.blocks[0];
  assert.ok(listedText && listedText.kind === "text");
  assert.match((listedText as { text: string }).text, /yes\n- item one\n- item two\ncontinuation/);
  assert.ok(quotedReplyBody.includes(">\n>\n>"), "fixture keeps a blank quote run");
  assert.equal(texts(parsePlainTextQuotes(quotedReplyBody).history).filter((text) => !text.trim()).length, 0);
  // reflow stays linear: 20k wrapped lines join into one block without a newline.
  const start = Date.now();
  const longReflow = parsePlainTextQuotes("Reply\n\n" + ("> " + "a".repeat(70) + "\n").repeat(20_000) + "> tail");
  console.log(`[reflow] 20k wrapped lines joined in ${Date.now() - start}ms`);
  const longBlock = longReflow.history.at(-1);
  assert.ok(longBlock && longBlock.kind === "quote");
  const longText = longBlock.kind === "quote" && longBlock.blocks[0];
  assert.ok(longText && longText.kind === "text");
  assert.ok(!(longText as { text: string }).text.includes("\n"));
  const longRuns = parsePlainTextQuotes("Reply\n\n" + "> a\n" + ">\n".repeat(20000) + "> b");
  const longQuote = longRuns.history.at(-1);
  assert.ok(longQuote && longQuote.kind === "quote");
  assert.deepEqual(longQuote.kind === "quote" && longQuote.blocks, [
    { kind: "text", text: "a" },
    { kind: "text", text: "b" },
  ]);
});

test("plain-text reader collapses quoted history behind an accessible toggle", async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const originals = ["window", "document", "IS_REACT_ACT_ENVIRONMENT"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  try {
    const mail: Mail = { id: "m", accountId: "a", remoteId: "1", sender: "Alex Example", address: "alex@example.test", to: "me@example.test", subject: "Review", preview: "", body: quotedReplyBody, date: 1, unread: false, archived: false, snoozedUntil: null, relevance: 2, category: "important", reason: "", html: null, images: [], attachments: [] };
    await act(async () => root.render(<ReaderContent mail={mail} loadImages={async () => ({ images: [] })} />));
    const toggle = container.querySelector<HTMLButtonElement>("button.quoted-toggle")!;
    assert.ok(toggle, "a toggle controls the collapsed history");
    assert.equal(toggle.type, "button");
    assert.equal(toggle.textContent, "Show quoted text");
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
    const region = container.ownerDocument.getElementById(toggle.getAttribute("aria-controls")!)!;
    assert.ok(region && region.classList.contains("quoted-history"), "aria-controls points at the history region");
    const bodyText = container.textContent!;
    assert.ok(bodyText.indexOf("Sounds good, see you Thursday.") < bodyText.indexOf("Show quoted text"), "reply text precedes the toggle");
    assert.doesNotMatch(container.innerHTML, /Alex Example|zebrafinch/);
    await act(async () => toggle.click());
    assert.equal(toggle.getAttribute("aria-expanded"), "true");
    assert.equal(toggle.textContent, "Hide quoted text");
    assert.ok(region.querySelector("blockquote blockquote blockquote"), "three nested quote levels render");
    assert.match(region.textContent!, /zebrafinch/);
    for (const line of region.textContent!.split("\n")) assert.doesNotMatch(line, /^\s*>/);
    for (const paragraph of region.querySelectorAll("p")) assert.ok(paragraph.textContent!.trim(), "no empty paragraphs");
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
