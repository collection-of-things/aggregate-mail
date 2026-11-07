// Readable ink for the isolated mail document (ADR 0125). Sender text below
// 3:1 contrast against its effective background is re-inked to the stronger
// of a fixed dark or light; text at 3:1 or better keeps the sender color.

export type Rgba = [red: number, green: number, blue: number, alpha: number];

export const DARK_INK: Rgba = [0x1f, 0x1f, 0x1f, 1];
export const LIGHT_INK: Rgba = [0xf5, 0xf5, 0xf5, 1];

const numeric = (value: string) => /^(\d+(?:\.\d+)?)(%?)$/.exec(value.trim());

// The rgb()/rgba() serializations getComputedStyle returns, comma or space
// separated. Anything else cannot be composited and returns null.
export function parseColor(css: string): Rgba | null {
  const body = /^rgba?\(\s*([^()]*?)\s*\)$/i.exec(css.trim())?.[1];
  if (!body) return null;
  const slash = body.split("/").map((part) => part.trim());
  if (slash.length > 2) return null;
  const comma = slash[0].includes(",");
  const items = comma ? slash[0].split(",").map((part) => part.trim()) : slash[0].split(/\s+/);
  if (slash.length === 2) items.push(slash[1]);
  if (items.length !== 3 && !(items.length === 4 && (comma || slash.length === 2))) return null;
  const channels = items.slice(0, 3).map((value) => {
    const match = numeric(value);
    return match ? Math.min(255, parseFloat(match[1]) * (match[2] ? 2.55 : 1)) : null;
  });
  const alpha = items.length === 4 ? (() => {
    const match = numeric(items[3]);
    return match ? Math.min(1, match[2] ? parseFloat(match[1]) / 100 : parseFloat(match[1])) : null;
  })() : 1;
  const [r, g, b] = channels;
  return r == null || g == null || b == null || alpha === null ? null : [r, g, b, alpha];
}

export function composite(top: Rgba, bottom: Rgba): Rgba {
  const alpha = top[3] + bottom[3] * (1 - top[3]);
  if (alpha <= 0) return [0, 0, 0, 0];
  const mix = (a: number, b: number) => (a * top[3] + b * bottom[3] * (1 - top[3])) / alpha;
  return [mix(top[0], bottom[0]), mix(top[1], bottom[1]), mix(top[2], bottom[2]), alpha];
}

const linear = (value: number) => {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
};
const luminance = (color: Rgba) => 0.2126 * linear(color[0]) + 0.7152 * linear(color[1]) + 0.0722 * linear(color[2]);

export function contrastRatio(a: Rgba, b: Rgba): number {
  const first = luminance(a), second = luminance(b);
  return ((first > second ? first : second) + 0.05) / ((first > second ? second : first) + 0.05);
}

// `layers` are the element's backgrounds from nearest to farthest; the reader
// surface sits behind all of them. Text already at 3:1 keeps its color.
export function readableInk(text: Rgba, layers: Rgba[], surface: Rgba): "dark" | "light" | null {
  const background = layers.reduceRight((below, layer) => composite(layer, below), surface);
  return inkOnBackground(text, background);
}

function inkOnBackground(text: Rgba, background: Rgba): "dark" | "light" | null {
  if (contrastRatio(composite(text, background), background) >= 3) return null;
  return contrastRatio(DARK_INK, background) >= contrastRatio(LIGHT_INK, background) ? "dark" : "light";
}

// A direct text child counts only when something remains once whitespace and
// the invisible padding characters collapseInvisiblePadding removes are gone.
const DIRECT_TEXT = /[^\s\u034F\u200B\u200C\u2060\uFEFF\u00AD]/;
const PROTECTED = ".address,.formatted-mail-image-placeholder";

// Batched in three phases — clear, read computed styles, then mark — so each
// element costs no extra style recalculation.
export function applyReadableInk(body: HTMLElement, surface: Rgba) {
  const view = body.ownerDocument.defaultView!;
  for (const element of body.querySelectorAll("[data-ink]")) element.removeAttribute("data-ink");
  // Cache one composited color per ancestor instead of copying each ancestor's
  // entire layer chain for every descendant. This bounds scratch memory to O(n).
  const backgrounds = new Map<Element, Rgba>();
  const backgroundOf = (element: Element): Rgba => {
    const cached = backgrounds.get(element);
    if (cached) return cached;
    const layer = parseColor(view.getComputedStyle(element).backgroundColor);
    const below = element.parentElement && !(layer && layer[3] >= 1) ? backgroundOf(element.parentElement) : surface;
    const background = layer ? composite(layer, below) : below;
    backgrounds.set(element, background);
    return background;
  };
  const candidates: { element: HTMLElement; color: Rgba; background: Rgba }[] = [];
  // querySelectorAll visits parents before children. Carry protection forward
  // rather than walking back through the same ancestors for every text node.
  const protectedElements = new Set<Element>(body.closest(PROTECTED) ? [body] : []);
  for (const element of body.querySelectorAll<HTMLElement>("*")) {
    if (element.matches(PROTECTED) || element.parentElement && protectedElements.has(element.parentElement)) {
      protectedElements.add(element);
      continue;
    }
    if (![...element.childNodes].some((node) => node.nodeType === node.TEXT_NODE && DIRECT_TEXT.test(node.nodeValue || ""))) continue;
    const color = parseColor(view.getComputedStyle(element).color);
    if (!color) continue;
    candidates.push({ element, color, background: backgroundOf(element) });
  }
  for (const { element, color, background } of candidates) {
    const ink = inkOnBackground(color, background);
    if (ink) element.setAttribute("data-ink", ink);
  }
}
