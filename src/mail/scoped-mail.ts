import { useEffect, useId, useLayoutEffect, useState, type RefObject } from "react";
import { applyReadableInk, composite, parseColor, type Rgba } from "./readable-ink";

// Reader rules that sender CSS cannot override. They follow the sender rules in
// the same scope at equal or higher specificity, and code ink uses !important
// so a sender color cannot split it from its veil.
const controls = `
:scope{overflow-wrap:break-word}
:scope :is(img,table){max-width:100%}:scope img{height:auto}
:scope a{color:var(--link);text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:2px;text-decoration-color:color-mix(in srgb,var(--link) 60%,transparent)}:scope a:hover{text-decoration-color:currentColor}
:scope blockquote{margin:.75em 0;padding:0 0 0 14px;border-left:2px solid var(--accent);color:var(--text-2)}
:scope code{font-family:var(--font-mono);font-size:.92em;background:var(--veil)!important;color:var(--code-ink)!important;border-radius:3px;padding:0 4px}
:scope pre{font-family:var(--font-mono);font-size:calc(12px * var(--text-scale, 1));background:var(--veil)!important;border-radius:var(--radius-mark-sm);padding:10px 12px;color:var(--code-ink)!important;overflow-x:auto}
:scope pre code{background:none!important;padding:0;color:inherit!important}
:scope :is(code,pre) :not(img,.address,.formatted-mail-image-placeholder){color:inherit!important;background:transparent!important}
:scope :is(code,pre) a{text-decoration-color:color-mix(in srgb,currentColor 60%,transparent)}
:scope .formatted-mail-image-placeholder{display:inline-block;max-width:100%;vertical-align:middle}
:scope :is(p,ul,ol,blockquote,h1,h2,h3,h4,h5,h6,pre){max-width:70ch}:scope table :is(p,ul,ol,blockquote,h1,h2,h3,h4,h5,h6,pre){max-width:none}
:scope [data-ink=dark]{color:#1f1f1f!important}:scope [data-ink=light]{color:#f5f5f5!important}
`;

// Sender rules reach only this message. Address controls are the scope's lower
// boundary, so no sender selector can restyle or reveal a hidden address.
export function scopedSheet(css: string, scope: string): string {
  return `@scope ([data-mail-scope="${scope}"]) to (.address) {\n${css}\n${controls}}`;
}

// Installs the sender sheet as a constructable stylesheet: request CSP allows no
// inline <style>, and the sheet leaves with the message. `failed` reports an
// engine without constructable sheets so the caller can keep the themed view.
export function useScopedSheet(css: string): { scope: string; failed: boolean } {
  const scope = useId();
  const [failed, setFailed] = useState(false);
  useLayoutEffect(() => {
    if (!css) return;
    const doc = document, Sheet = doc.defaultView?.CSSStyleSheet;
    let sheet: CSSStyleSheet;
    try {
      if (!Sheet || typeof Sheet.prototype.replaceSync !== "function") throw Error("Constructable stylesheets unavailable");
      sheet = new Sheet();
      sheet.replaceSync(scopedSheet(css, scope));
    } catch { setFailed(true); return; }
    // Some DOM implementations leave the list undefined until first assigned.
    doc.adoptedStyleSheets = [...(doc.adoptedStyleSheets ?? []), sheet];
    return () => { doc.adoptedStyleSheets = (doc.adoptedStyleSheets ?? []).filter((installed) => installed !== sheet); };
  }, [css, scope]);
  return { scope, failed };
}

const WHITE: Rgba = [255, 255, 255, 1];
// Composite host backgrounds through the nearest opaque ancestor, falling back
// to the white canvas when every ancestor is translucent.
export function readerSurface(element: Element | null): Rgba {
  let surface: Rgba = [0, 0, 0, 0];
  for (let current = element; current; current = current.parentElement) {
    const color = parseColor(current.ownerDocument.defaultView!.getComputedStyle(current).backgroundColor);
    if (color) surface = composite(surface, color);
    if (surface[3] >= 1) return surface;
  }
  return composite(surface, WHITE);
}

// Sender colors keep their meaning, but text below 3:1 against its composited
// background is re-inked. Container queries, theme and preference changes can
// change either side, so marks are re-evaluated on resize, ancestor theme
// attributes and every render.
export function useReadableInk(ref: RefObject<HTMLElement | null>, enabled: boolean) {
  useEffect(() => {
    const root = ref.current;
    if (!enabled || !root) return;
    const view = root.ownerDocument.defaultView as Window & typeof globalThis;
    const ink = () => applyReadableInk(root, readerSurface(root.parentElement));
    ink();
    const resize = typeof view.ResizeObserver === "function" ? new view.ResizeObserver(ink) : undefined;
    resize?.observe(root);
    const theme = new view.MutationObserver(ink);
    for (let ancestor = root.parentElement; ancestor; ancestor = ancestor.parentElement)
      theme.observe(ancestor, { attributes: true, attributeFilter: ["style", "class", "data-theme"] });
    return () => { resize?.disconnect(); theme.disconnect(); };
  });
}

export const MIN_FIT = 0.5;
// Fixed-width mail wider than the reader scales down to fit, as desktop mail
// clients do, instead of scrolling sideways. Below MIN_FIT it stays legible and
// scrolls instead. Zoom resets before measuring so the natural width is read.
export function fitWidth(root: HTMLElement) {
  root.style.zoom = "";
  const available = root.clientWidth, needed = root.scrollWidth;
  if (available > 0 && needed > available + 1) root.style.zoom = String(Math.max(MIN_FIT, available / needed));
}

export function useFitWidth(ref: RefObject<HTMLElement | null>, inputs: readonly unknown[]) {
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const view = root.ownerDocument.defaultView as Window & typeof globalThis;
    const fit = () => fitWidth(root);
    fit();
    // Reader width and late content (images) both resize the root. The
    // callback settles on the same zoom, so the observer does not loop.
    const resize = typeof view.ResizeObserver === "function" ? new view.ResizeObserver(fit) : undefined;
    resize?.observe(root);
    root.addEventListener("load", fit, true);
    return () => { resize?.disconnect(); root.removeEventListener("load", fit, true); root.style.zoom = ""; };
  }, [ref, ...inputs]);
}
