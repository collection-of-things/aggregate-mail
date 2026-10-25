import { Parser } from "htmlparser2";

// Outbound composition is deliberately separate from inbound mail rendering.
export const COMPOSE_HTML_LIMIT = 256_000;
const tags = new Set("div p br strong em u a ul ol li blockquote".split(" "));
const active = new Set("script style iframe object embed svg math form input button textarea select link meta base img audio video source template head".split(" "));
type Node = string | { tag: string; href?: string; children: Node[] };
export const escapeComposeText = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const plainComposeHtml = (text: string) => escapeComposeText(text).replace(/\r\n?/g, "\n").replace(/\n/g, "<br>");
export function composeLink(value: string): string | undefined {
  if (value.length > 2048 || /[\s\u0000-\u001f\u007f]/.test(value)) return;
  try {
    const url = new URL(value);
    if (!["https:", "http:", "mailto:"].includes(url.protocol) || url.username || url.password) return;
    return url.href;
  } catch { return; }
}
function parse(html: string): Node[] {
  if (html.length > COMPOSE_HTML_LIMIT) throw new Error("Formatted message is too large.");
  const roots: Node[] = [];
  const stack: { children: Node[]; dropped: boolean }[] = [];
  let count = 0, exceeded = false;
  const budget = () => {
    if (++count <= 4000 && stack.length < 48) return true;
    exceeded = true; parser.pause(); return false;
  };
  const parser = new Parser({
    onopentag(input, attrs) {
      if (!budget()) return;
      const parent = stack.at(-1), children: Node[] = [];
      const tag = input === "b" ? "strong" : input === "i" ? "em" : input;
      const dropped = !!parent?.dropped || active.has(input);
      if (!dropped) {
        const target = parent?.children ?? roots;
        const href = tag === "a" ? composeLink(attrs.href || "") : undefined;
        if (tags.has(tag) && (tag !== "a" || href)) target.push({ tag, ...(href ? { href } : {}), children });
        else target.push({ tag: "", children });
      }
      stack.push({ children, dropped });
    },
    onclosetag() { stack.pop(); },
    ontext(text) { if (budget() && !stack.at(-1)?.dropped) (stack.at(-1)?.children ?? roots).push(text.replace(/\r\n?/g, "\n")); },
  }, { decodeEntities: true });
  parser.end(html);
  if (exceeded) throw new Error("Formatted message is too complex.");
  return roots;
}
const serialize = (nodes: Node[]): string => nodes.map(node => typeof node === "string" ? plainComposeHtml(node) :
  !node.tag ? serialize(node.children) : node.tag === "br" ? "<br>" : `<${node.tag}${node.href ? ` href="${escapeComposeText(node.href)}"` : ""}>${serialize(node.children)}</${node.tag}>`).join("");
const blockTags = new Set(["div", "p", "li", "ul", "ol", "blockquote"]);
function text(nodes: Node[]): string {
  let result = "";
  for (const node of nodes) {
    if (typeof node === "string") { result += node; continue; }
    const inner = text(node.children);
    if (blockTags.has(node.tag) && result && !result.endsWith("\n")) result += "\n";
    if (node.tag === "br") result += "\n";
    else if (node.tag === "a") result += inner === node.href ? inner : `${inner} (${node.href})`;
    else if (node.tag === "ul" || node.tag === "ol") {
      let ordinal = 0;
      for (const item of node.children) {
        if (typeof item === "string" && !item.trim()) continue;
        if (typeof item !== "string" && item.tag === "li") {
          ordinal++;
          const marker = node.tag === "ol" ? `${ordinal}. ` : "- ";
          result += marker + text(item.children).replace(/\n$/, "").replace(/\n/g, "\n" + " ".repeat(marker.length)) + "\n";
        } else result += text([item]);
      }
    } else if (node.tag === "blockquote") result += inner.replace(/\n$/, "").split("\n").map(line => `> ${line}`).join("\n") + "\n";
    else if (blockTags.has(node.tag)) result += inner + "\n";
    else result += inner;
  }
  return result;
}
export function composeMarkup(html: string): { html: string; body: string } {
  const flatten = (items: Node[], parent = ""): Node[] => items.flatMap((item): Node[] => {
    if (typeof item === "string") return ["ul", "ol"].includes(parent) && !item.trim() ? [] : [item];
    const children = flatten(item.children, item.tag);
    return item.tag ? [{ ...item, children }] : children;
  });
  const canonical = serialize(flatten(parse(html)));
  // Serialization can expand pasted line breaks; apply the parser budget to
  // the exact canonical representation before a draft can acknowledge it.
  const nodes = parse(canonical), last = nodes.at(-1), raw = text(nodes);
  const body = typeof last !== "string" && last && blockTags.has(last.tag) ? raw.replace(/\n$/, "") : raw;
  if (canonical.length > COMPOSE_HTML_LIMIT || body.length > 1_000_000) throw new Error("Formatted message is too large.");
  return { html: canonical, body };
}
export function validComposeMarkup(value: { html?: string; body: string }): boolean {
  if (value.html === undefined) return true;
  try {
    const content = composeMarkup(value.html);
    return content.html === value.html && content.body === value.body;
  } catch { return false; }
}

// Programmatic templates/signatures change a suffix. Keep all preceding rich
// nodes; only a partially changed structural node falls back to its visible text.
export function changeComposeText(value: { html?: string; body: string }, body: string): { html?: string; body: string } {
  if (value.html === undefined || body === value.body) return { body, ...(value.html === undefined ? {} : { html: value.html }) };
  let keep = 0;
  while (keep < value.body.length && keep < body.length && value.body[keep] === body[keep]) keep++;
  const prefix = (nodes: Node[], length: number): Node[] => {
    const result: Node[] = [];
    for (const node of nodes) {
      const current = text(result);
      if (typeof node !== "string" && blockTags.has(node.tag) && current && !current.endsWith("\n")) {
        if (length <= 0) break;
        result.push("\n"); length--;
      }
      const visible = text([node]);
      if (length >= visible.length) { result.push(node); length -= visible.length; continue; }
      if (length > 0) {
        if (typeof node === "string") result.push(node.slice(0, length));
        else if (["", "strong", "em", "u", "div", "p"].includes(node.tag)) result.push({ ...node, tag: ["div", "p"].includes(node.tag) ? "" : node.tag, children: prefix(node.children, length) });
        else result.push(visible.slice(0, length));
      }
      break;
    }
    return result;
  };
  const nodes = parse(value.html), last = nodes.at(-1);
  let tail = body.slice(keep);
  if (keep === value.body.length && typeof last !== "string" && last && blockTags.has(last.tag) && tail.startsWith("\n") && /[^\n]/.test(tail)) {
    return composeMarkup(value.html + plainComposeHtml(tail.slice(1)));
  }
  const changed = composeMarkup(serialize(prefix(nodes, keep)) + plainComposeHtml(tail));
  if (changed.body !== body) throw new Error("Text could not be changed without altering preceding formatting.");
  return changed;
}
