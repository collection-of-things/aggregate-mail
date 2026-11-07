import { Parser } from "htmlparser2";
import type { Mail } from "./types";

export const embeddedImageTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp", "image/avif"]);

// Older imports lack CID metadata and may contain parser-expanded data URLs.
export function needsEmbeddedContentRecovery(mail: Pick<Mail, "html" | "attachments">): boolean {
  let embedded = false;
  if (mail.html && mail.html.length <= MAIL_HTML_LIMIT) {
    const parser = new Parser({ onopentag(tag, attrs) {
      if (tag === "img" && /^(?:cid:|data:image\/)/i.test(attrs.src || "")) { embedded = true; parser.pause(); }
    } });
    parser.end(mail.html);
  }
  return embedded && mail.attachments === undefined || (!mail.html || embedded) &&
    !!mail.attachments?.some((file) => file.contentId === undefined && embeddedImageTypes.has(file.contentType.toLowerCase()));
}

export const MAIL_HTML_LIMIT = 256_000;
// Plain-text conversion leaves image sources as [url]; previews drop them,
// including one cut off by the stored preview length. One left-to-right pass
// drops markers; the expression rescanned runs of unmatched "[" once each.
export const previewText = (text: string) => {
  const bounded = text.slice(0, 8192);
  let result = "", at = 0;
  while (at < bounded.length) {
    const open = bounded.indexOf("[", at);
    if (open < 0) { result += bounded.slice(at); break; }
    const prefix = bounded.slice(open + 1, open + 7).toLowerCase();
    const marker = prefix.startsWith("https:") ? 7 : prefix.startsWith("http:") ? 6 : prefix.startsWith("cid:") ? 5 : 0;
    if (!marker) { result += bounded.slice(at, open + 1); at = open + 1; continue; }
    let close = open + marker;
    while (close < bounded.length && bounded[close] !== "]" && !/\s/.test(bounded[close])) close++;
    if (close >= bounded.length || bounded[close] === "]") { result += `${bounded.slice(at, open)} `; at = close + 1; }
    else { result += bounded.slice(at, open + 1); at = open + 1; }
  }
  return result.replace(/\s+/g, " ").trim();
};
export const PLAIN_QUOTE_DEPTH_LIMIT = 8;
// Lines this long were almost certainly wrapped by the sender's client.
const QUOTE_WRAP_COLUMN = 60;
const QUOTE_LIST_MARKER = /^(?:[-*•+]|\d{1,3}[.)])\s/;
const QUOTE_ATTRIBUTION_LIMIT = 400;

export type PlainTextBlock =
  | { kind: "text"; text: string; attribution?: true }
  | { kind: "quote"; blocks: PlainTextBlock[] };

type PlainLine = { depth: number; effective: number; text: string; blank: boolean };

// Split a plain-text body into reply text and nested `>` quotes in one linear
// pass. Quote markers allow spaces between `>` characters; one leading space
// after the last marker is not content. Blank lines take the surrounding
// non-blank depth so `>> a\n>\n>> b` stays one quote.
export function parsePlainTextQuotes(text: string): { blocks: PlainTextBlock[]; history: PlainTextBlock[] } {
  const lines: PlainLine[] = text.replace(/\r\n?/g, "\n").split("\n").map((raw) => {
    let depth = 0, at = 0;
    for (;;) {
      let scan = at;
      while (scan < raw.length && (raw[scan] === " " || raw[scan] === "\t")) scan++;
      if (raw[scan] === ">") { depth++; at = scan + 1; } else break;
    }
    let content = raw.slice(at);
    if (at > 0 && content.startsWith(" ")) content = content.slice(1);
    return { depth: Math.min(depth, PLAIN_QUOTE_DEPTH_LIMIT), effective: 0, text: content, blank: !content.trim() };
  });
  // Nearest non-blank neighbour on each side, one pass per direction.
  const prevDepth: (number | null)[] = new Array(lines.length);
  const nextNonBlank: number[] = new Array(lines.length);
  let seen: number | null = null;
  lines.forEach((line, index) => { prevDepth[index] = seen; if (!line.blank) seen = line.depth; });
  let next = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].blank) next = i;
    nextNonBlank[i] = next;
  }
  lines.forEach((line, index) => {
    if (!line.blank) { line.effective = line.depth; return; }
    const previous = prevDepth[index], following = nextNonBlank[index] >= 0 ? lines[nextNonBlank[index]].depth : null;
    line.effective = Math.max(line.depth, Math.min(previous ?? line.depth, following ?? line.depth));
  });
  const build = (start: number, end: number, depth: number): PlainTextBlock[] => {
    const blocks: PlainTextBlock[] = [];
    let paragraph: string[] = [];
    const nextContent = (index: number) => {
      const found = index < lines.length ? nextNonBlank[index] : -1;
      return found >= 0 && found < end ? lines[found] : null;
    };
    const flush = () => {
      if (!paragraph.length) return;
      blocks.push({ kind: "text", text: reflow(paragraph, depth) });
      paragraph = [];
    };
    for (let i = start; i < end; i++) {
      const line = lines[i];
      if (line.effective > depth) {
        flush();
        let stop = i;
        while (stop < end && lines[stop].effective > depth) stop++;
        const inner = build(i, stop, depth + 1);
        if (inner.length) blocks.push({ kind: "quote", blocks: inner });
        i = stop - 1;
        continue;
      }
      if (line.blank) { flush(); continue; }
      const trimmed = line.text.trim();
      const following = nextContent(i + 1);
      if (trimmed.length <= QUOTE_ATTRIBUTION_LIMIT && /\bwrote:$/i.test(trimmed) && following && following.effective > depth) {
        // A wrapped attribution keeps its `On … <` lead-in line with the `wrote:` tail.
        const lead = paragraph.at(-1);
        const attribution = !trimmed.startsWith("On ") && lead && lead.trim().startsWith("On ")
          ? `${lead.trim()}${lead.trim().endsWith("<") ? "" : " "}${trimmed}` : trimmed;
        if (attribution !== trimmed) paragraph.pop();
        flush();
        blocks.push({ kind: "text", text: attribution, attribution: true });
        continue;
      }
      paragraph.push(line.text);
    }
    flush();
    return blocks;
  };
  const blocks = build(0, lines.length, 0);
  const history: PlainTextBlock[] = [];
  // Trailing quoted history collapses; quotes followed by reply text stay inline.
  if (blocks.at(-1)?.kind === "quote") {
    history.unshift(blocks.pop()!);
    const attribution = blocks.at(-1);
    if (attribution?.kind === "text" && attribution.attribution) history.unshift(blocks.pop()!);
    if (!blocks.length) { blocks.push(...history); history.length = 0; }
  }
  return { blocks, history };
}

// Unquoted text keeps the sender's line breaks; inside quotes, wrapped lines
// rejoin unless the next line opens a list. A short spill line rejoins only
// when the following line is again long enough to be wrapped.
function reflow(lines: string[], depth: number): string {
  if (depth === 0) return lines.join("\n");
  const parts = [lines[0]];
  let joinedLong = false;
  for (let i = 1; i < lines.length; i++) {
    const previous = lines[i - 1], next = lines[i];
    const join: boolean = !QUOTE_LIST_MARKER.test(next.trimStart()) &&
      (previous.endsWith(" ") || previous.trimEnd().length >= QUOTE_WRAP_COLUMN ||
        (joinedLong && previous.trimEnd().length < QUOTE_WRAP_COLUMN && next.length >= QUOTE_WRAP_COLUMN));
    if (join) { parts[parts.length - 1] = parts[parts.length - 1].trimEnd(); parts.push(` ${next.trimStart()}`); }
    else parts.push(`\n${next}`);
    joinedLong = join && previous.trimEnd().length >= QUOTE_WRAP_COLUMN;
  }
  return parts.join("");
}

const VALEDICTION = /^(?:cheers|thanks|thank you|many thanks|best|best regards|kind regards|warm regards|regards|all the best|sincerely|take care)[,.!]*$/i;
// The preview is cut to 220 chars, so only the first short run of text needs collecting.
const PREVIEW_LINE_BUDGET = 2_000;
const PREVIEW_SCAN_LINES = 20_000;

// Display-time preview: reply text without signatures or trailing quoted
// history. Stored previews and search stay unchanged. The scan below is its
// own bounded pass, independent of the display parser, so collapsed rows stay
// cheap even on multi-megabyte bodies.
export function replyPreview(body: string, preview: string): string {
  if (body.trim()) {
    const quoted = (raw: string) => /^[ \t]*>/.test(raw);
    const lineAt = (pos: number) => {
      const nl = body.indexOf("\n", pos);
      const raw = body.slice(pos, nl < 0 ? body.length : nl).replace(/\r$/, "");
      return { raw, next: nl < 0 ? -1 : nl + 1 };
    };
    // Skips blanks to answer "is the next real line quoted", sharing the scan cap.
    const nextIsQuoted = (from: number, spent: number) => {
      let pos = from;
      for (let look = spent; look < PREVIEW_SCAN_LINES && pos >= 0 && pos < body.length; look++) {
        const { raw, next } = lineAt(pos);
        pos = next;
        if (!raw.trim()) continue;
        return quoted(raw);
      }
      return false;
    };
    const lines: string[] = [];
    let collected = 0, pos = 0, adjacent = false;
    for (let scanned = 0; pos >= 0 && pos < body.length && scanned < PREVIEW_SCAN_LINES && collected <= PREVIEW_LINE_BUDGET; scanned++) {
      const { raw, next } = lineAt(pos);
      pos = next;
      const trimmed = raw.trim();
      if (!trimmed || quoted(raw)) { adjacent = false; continue; }
      if (trimmed.length <= QUOTE_ATTRIBUTION_LIMIT && /\bwrote:$/i.test(trimmed) && nextIsQuoted(pos, scanned + 1)) {
        // A wrapped attribution absorbs its "On …" lead-in only when the lead-in
        // is the line scanned right before, matching the parser's paragraph rule.
        if (adjacent && !trimmed.startsWith("On ") && lines.length && lines[lines.length - 1].trim().startsWith("On ")) lines.pop();
        adjacent = false;
        continue;
      }
      lines.push(raw);
      collected += raw.length;
      adjacent = true;
    }
    const kept: string[] = [];
    for (const line of lines) {
      if (line === "--" || line === "-- " || line.startsWith("Sent from my ")) break;
      kept.push(line);
    }
    for (let i = 0; i < kept.length; i++) {
      if (!VALEDICTION.test(kept[i].trim())) continue;
      const rest = kept.slice(i + 1).filter((line) => line.trim());
      if (rest.length <= 4 && rest.every((line) => line.length <= QUOTE_WRAP_COLUMN) &&
          rest.every((line) => !/[.?!:]$/.test(line.trim())) &&
          kept.slice(0, i).some((line) => line.trim())) { kept.length = i; break; }
    }
    const result = previewText(kept.join("\n")).slice(0, 220);
    if (result.trim()) return result;
  }
  let flat = previewText(preview);
  let cut = -1;
  for (let scan = 0; ;) {
    const on = flat.indexOf("On ", scan);
    if (on < 0) break;
    const wrote = flat.indexOf("wrote:", on + 3);
    if (wrote >= 0 && wrote - on <= 300) { cut = on; break; }
    scan = on + 3;
  }
  for (const marker of [" > ", " -- "]) {
    const at = flat.indexOf(marker);
    if (at >= 0 && (cut < 0 || at < cut)) cut = marker === " -- " ? at + 1 : at;
  }
  if (cut >= 0) flat = flat.slice(0, cut);
  const valediction = /(?:best regards,|kind regards,|cheers,|thanks,|best,|regards,)([\s\S]{0,60})$/i.exec(flat);
  // A valediction is a signature only when its tail is a name, not a request
  // that ends with sentence punctuation.
  if (valediction && !/[.?!:]\s*$/.test(valediction[1]) && flat.slice(0, valediction.index).trim()) flat = flat.slice(0, valediction.index);
  return flat.trim() || previewText(preview);
}

export const MAIL_NODE_LIMIT = 4_000;
// Newsletters nest tables about 50 deep; the node limit bounds the total work.
export const MAIL_DEPTH_LIMIT = 96;

// Keep decoded source bytes intact inside the limit; larger mail uses its text body.
export function boundedMailHtml(value: string | false | undefined): string | null {
  return typeof value === "string" && value.length <= MAIL_HTML_LIMIT && value.trim() ? value : null;
}

export type MailContentNode = string | {
  tag: string;
  attributes: Record<string, string>;
  children: MailContentNode[];
};

const allowedTags = new Set(("div span p br hr h1 h2 h3 h4 h5 h6 strong b em i u s del center " +
  "blockquote pre code ul ol li table thead tbody tfoot tr td th caption colgroup col a img font").split(" "));
const droppedTags = new Set(("head script style title iframe frame frameset object embed svg math " +
  "form input button select option textarea template noscript audio video source link meta base").split(" "));
const allowedAttributes = new Set(("style href src alt width height align valign bgcolor color size " +
  "colspan rowspan cellpadding cellspacing border start").split(" "));

// Senders pad preview text with runs of invisible characters and spacing so a
// preheader fills the excerpt without showing in the body. Three or more
// consecutive units — zero-width spaces and joiners, grapheme joiner, word
// joiner, byte-order mark or soft hyphen, each with any spacing after it —
// collapse to one space. Single occurrences stay, so script shaping (ZWNJ)
// and hyphenation hints survive; ZWJ is never matched, so emoji sequences
// are untouched (ADR 0125).
export function collapseInvisiblePadding(text: string): string {
  return text.replace(/(?:[\u034F\u200B\u200C\u2060\uFEFF\u00AD]+[\s\u00A0\u2002-\u200A\u202F]*){3,}/g, " ");
}

// Unknown wrappers keep their text. Active content and its children are discarded.
export function parseMailContent(html: string, selectors = false): MailContentNode[] | null {
  if (boundedMailHtml(html) === null) return null;
  const roots: MailContentNode[] = [];
  const stack: { children: MailContentNode[]; dropped: boolean }[] = [];
  let count = 0, exceeded = false;
  const budget = () => {
    if (++count <= MAIL_NODE_LIMIT && stack.length < MAIL_DEPTH_LIMIT) return true;
    exceeded = true;
    parser.pause();
    return false;
  };
  const parser = new Parser({
    onopentag(tag, attributes) {
      if (!budget()) return;
      const parent = stack.at(-1);
      const children: MailContentNode[] = [];
      const dropped = !!parent?.dropped || droppedTags.has(tag);
      if (!dropped) (parent?.children ?? roots).push({
        tag: allowedTags.has(tag) ? tag : "span",
        attributes: Object.fromEntries(Object.entries(attributes).filter(([key]) => allowedAttributes.has(key) || selectors && (key === "class" || key === "id"))),
        children,
      });
      stack.push({ children, dropped });
    },
    onclosetag() { stack.pop(); },
    ontext(text) {
      if (!budget() || stack.at(-1)?.dropped) return;
      const children = stack.at(-1)?.children ?? roots;
      const last = children.at(-1);
      if (typeof last === "string") children[children.length - 1] = last + text;
      else children.push(text);
    },
  }, { decodeEntities: true });
  parser.end(html);
  // Runs as a post-pass: htmlparser2 can split one text run into several
  // chunks around entities, and a padding run can span chunk boundaries.
  const collapse = (nodes: MailContentNode[]) => {
    nodes.forEach((node, index) => {
      if (typeof node === "string") nodes[index] = collapseInvisiblePadding(node);
      else collapse(node.children);
    });
  };
  if (!exceeded) collapse(roots);
  return exceeded ? null : roots;
}

// CSS values use a small grammar so escapes, functions that fetch, and custom properties never pass.
export function mailStyle(value: string): Record<string, string | number> {
  const style: Record<string, string | number> = {};
  for (const declaration of value.slice(0, 8_000).split(";")) {
    const colon = declaration.indexOf(":");
    if (colon < 0) continue;
    const name = declaration.slice(0, colon).trim().toLowerCase();
    // Inline styles cannot be overridden here, so the priority flag carries no meaning.
    let input = declaration.slice(colon + 1).trim().toLowerCase();
    const priority = input.lastIndexOf("!");
    if (priority >= 0 && /^\s*important\s*$/.test(input.slice(priority + 1))) input = input.slice(0, priority).trimEnd();
    let output: string | number | null = null;
    if (["color", "background-color", "border-color"].includes(name)) output = color(input);
    if (name === "background") output = color(input);
    if (name === "font-size") output = length(input, 72);
    if (name === "font-weight" && /^(normal|bold|[1-9]00)$/.test(input)) output = input;
    if (name === "font-style" && /^(normal|italic|oblique)$/.test(input)) output = input;
    if (name === "text-align" && /^(left|center|right|justify)$/.test(input)) output = input;
    if (name === "vertical-align" && /^(top|middle|bottom|baseline)$/.test(input)) output = input;
    if (name === "text-decoration" && /^(none|underline|line-through)$/.test(input)) output = input;
    if (name === "white-space" && /^(normal|pre-wrap|pre-line)$/.test(input)) output = input;
    if (name === "border-collapse" && /^(collapse|separate)$/.test(input)) output = input;
    // Layout modes that newsletters use for columns and icon rows. Values that
    // hide content (none, visibility) stay rejected so all sender text is visible.
    if (name === "display" && /^(block|inline|inline-block|inline-table|table|table-row|table-cell)$/.test(input)) output = input;
    if (name === "float" && /^(left|right|none)$/.test(input)) output = input;
    if (name === "clear" && /^(left|right|both|none)$/.test(input)) output = input;
    if (name === "line-height") {
      if (/^\d+(?:\.\d+)?$/.test(input) && Number(input) >= 1 && Number(input) <= 3) output = input;
      else output = length(input, 96);
    }
    if (/^(width|min-width|max-width|height|max-height)$/.test(name)) {
      output = length(input, 1200, name.includes("width"));
      // Zero boxes hide text (preview lines) and would wrap it one letter per line.
      if (output !== null && parseFloat(output) === 0) output = null;
    }
    if (/^(margin|padding)(-(top|right|bottom|left))?$/.test(name)) {
      // `margin: 0 auto` is how most newsletters center their column.
      const parts = input.split(/\s+/).map((part) => part === "auto" && name.startsWith("margin") ? part : length(part, 48));
      if (parts.length <= 4 && parts.every((part) => part !== null)) output = parts.join(" ");
    }
    if (name === "border" || /^border-(top|right|bottom|left)$/.test(name)) output = border(input);
    if (output !== null) {
      const property = (name === "background" ? "background-color" : name)
        .replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
      style[property] = output;
    }
  }
  return style;
}

function color(value: string): string | null {
  return value.length <= 80 && /^(#[\da-f]{3,4}|#[\da-f]{6}|#[\da-f]{8}|[a-z]{1,20}|(?:rgb|rgba|hsl|hsla)\([\d.,%\s+-]+\))$/.test(value) ? value : null;
}
function length(value: string, maximum: number, percent = false): string | null {
  if (value === "0") return "0";
  // The digit groups cannot overlap, so a non-match fails without backtracking.
  const match = value.length <= 32 && /^(\d+(?:\.\d+)?|\.\d+)(px|pt|em|rem|ex|ch|%)$/.exec(value);
  if (!match) return null;
  const amount = Number(match[1]);
  if (match[2] === "%") return percent && amount <= 100 ? value : null;
  // Mail uses ex and ch for quote insets; at the 16px body size each is about half an em.
  const scale = { px: 1, pt: 4 / 3, em: 16, rem: 16, ex: 8, ch: 8 }[match[2] as "px"];
  const pixels = Math.round(amount * scale * 100) / 100;
  return pixels <= maximum ? `${pixels}px` : null;
}
// A border shorthand in any word order, as Gmail writes `1px #ccc solid`. The
// result is always `width style color`, so the renderer can swap the color.
function border(value: string): string | null {
  if (value.length > 128) return null;
  const functional = /(?:rgba?|hsla?)\([^)]*\)/.exec(value);
  let colorValue = functional ? color(functional[0]) : null;
  if (functional && !colorValue) return null;
  let width: string | null = null, style: string | null = null;
  const rest = functional ? value.replace(functional[0], " ") : value;
  for (const token of rest.trim().split(/\s+/)) {
    if (!style && /^(solid|dashed|dotted)$/.test(token)) style = token;
    else if (!width && /\d/.test(token) && length(token, 4) !== null) width = length(token, 4);
    else if (!colorValue && color(token)) colorValue = token;
    else return null;
  }
  return style && colorValue ? `${width === "0" ? "0px" : width ?? "1px"} ${style} ${colorValue}` : null;
}

export function mailLink(value: string): string | null {
  if (value.length > 2048 || !/^https?:\/\//i.test(value) || /[\\\s\u0000-\u001f\u007f]|%(?![\da-f]{2})/i.test(value)) return null;
  try {
    const url = new URL(value);
    return url.hostname && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

// Check both literal and decoded URL text; malformed UTF-8 must not conceal %40.
export function privateMailLink(value: string, redactText: (text: string) => string): boolean {
  for (let pass = 0; pass < 5; pass++) {
    if (redactText(value) !== value || redactText(value.replace(/\+/g, " ")) !== value.replace(/\+/g, " ")) return true;
    let decoded: string;
    try { decoded = decodeURIComponent(value); }
    catch { decoded = value.replace(/%([\da-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))); }
    if (decoded === value) return false;
    value = decoded;
  }
  // Deeply encoded destinations cannot be proven free of hidden text.
  return true;
}

// Only resource-free declarations reach the reader. Original selector names
// stay in memory; the page receives opaque per-message identifiers. Every
// selector is anchored at `:scope`, the message root that stands in for the
// sender's html and body, so the renderer can confine the sheet with @scope and
// sender rules outrank the reader's own element defaults. Width media queries
// become container queries: the sender wrote them for the message width, not
// the window width.
export function mailStylesheet(html: string) {
  const identifiers = new Map<string, string>();
  if (boundedMailHtml(html) === null) return { css: "", identifiers };
  let source = "", inStyle = false;
  const parser = new Parser({
    onopentag(tag) { if (tag === "style") inStyle = true; },
    onclosetag(tag) { if (tag === "style") { inStyle = false; source += "\n"; } },
    ontext(text) { if (inStyle) source += text; },
  });
  parser.end(html);
  if (source.length > 32_000) return { css: "", identifiers };
  source = source.replace(/\/\*[\s\S]*?\*\//g, "");
  let rules = 0;
  const declarations = (raw: string) => Object.entries(mailStyle(raw)).filter(([name, value]) =>
    // A stylesheet must not conceal text or create tiny overflowing boxes.
    !["height", "maxHeight"].includes(name) &&
    (!['fontSize', 'lineHeight'].includes(name) || parseFloat(String(value)) >= 6 || !String(value).endsWith('px') && Number(value) >= 1)
  ).map(([name, value]) => `${name.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase())}:${name === 'fontSize' ? `calc(${value} * var(--text-scale, 1))` : value}`).join(';');
  const selector = (raw: string) => {
    if (raw.length > 500 || !/^[a-zA-Z0-9_.#*\s,>+~-]+$/.test(raw) || !raw.trim()) return null;
    if (raw.trim().split(/[\s,>+~]+/).some(part => !/^(?:[a-zA-Z][\w-]*|\*)?(?:[.#][a-zA-Z_][\w-]*)*$/.test(part))) return null;
    let valid = true;
    const result = raw.trim().replace(/([.#]?)([a-zA-Z_][\w-]*)/g, (key: string, prefix: string, name: string) => {
      if (!prefix) {
        if (!allowedTags.has(name.toLowerCase()) && name !== 'body' && name !== 'html') valid = false;
        return name.toLowerCase();
      }
      if (!identifiers.has(key)) identifiers.set(key, `sender-${identifiers.size}`);
      return prefix + identifiers.get(key);
    });
    return valid ? anchored(result) : null;
  };
  function block(input: string, nested = false): string {
    let css = '', at = 0;
    while (at < input.length && rules < 128) {
      const open = input.indexOf('{', at), semi = input.indexOf(';', at);
      if (semi >= 0 && (open < 0 || semi < open)) { at = semi + 1; continue; }
      if (open < 0) break;
      let close = open + 1, depth = 1;
      for (; close < input.length && depth; close++) {
        if (input[close] === '{') depth++;
        if (input[close] === '}') depth--;
      }
      if (depth) break;
      const head = input.slice(at, open).trim(), body = input.slice(open + 1, close - 1);
      at = close; rules++;
      if (/^@media\s/i.test(head)) {
        const media = head.slice(6).trim().toLowerCase();
        if (!nested && /^(?:(?:only )?screen(?: and )?)?\((?:min|max)-width:\s*\d{1,4}px\)(?: and \((?:min|max)-width:\s*\d{1,4}px\))*$/.test(media)) {
          const children = block(body, true);
          if (children) css += `@container ${media.replace(/^(?:only )?screen(?: and )?/, '')}{${children}}`;
        }
      } else if (!head.startsWith('@') && !/[{}]/.test(body)) {
        const safe = selector(head), values = declarations(body);
        if (safe && values) css += `${safe}{${values}}`;
      }
    }
    return css;
  }
  return { css: block(source), identifiers };
}

const ROOT_TAG = /^(?:html|body)(?![\w-])/;
// `body > p, .note` becomes `:scope > p,:scope .note`. The sender's html and
// body are both the message root, so a leading html/body chain collapses into
// one `:scope` that keeps their classes. A root that is not leading, or a
// sibling of the root, can never match, so that selector is dropped.
function anchored(list: string): string | null {
  const selectors = list.split(',').flatMap((raw) => {
    const tokens = raw.trim().replace(/\s*([>+~])\s*/g, ' $1 ').split(/\s+/);
    let root = '', at = 0, child = false;
    while (ROOT_TAG.test(tokens[at] ?? '')) {
      root += tokens[at++].replace(ROOT_TAG, '');
      child = tokens[at] === '>';
      if (child) at++;
      else if (tokens[at] === '+' || tokens[at] === '~') return [];
    }
    const rest = tokens.slice(at);
    if (rest.some((token) => ROOT_TAG.test(token))) return [];
    return [`:scope${root}${rest.length ? (child ? ' > ' : ' ') + rest.join(' ') : ''}`];
  });
  return selectors.length ? selectors.join(',') : null;
}
