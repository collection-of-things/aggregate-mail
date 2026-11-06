import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { applyReadableInk, composite, parseColor, type Rgba } from "./readable-ink";

const defaults = `:where(body){color:var(--reader-foreground);font:calc(14px * var(--text-scale, 1))/1.5 system-ui,sans-serif}`;
const controls = `
body{margin:0;overflow-wrap:break-word}
img,table{max-width:100%}img{height:auto}a{cursor:pointer}
a{color:var(--link);text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:2px;text-decoration-color:color-mix(in srgb,var(--link) 60%,transparent)}a:hover{text-decoration-color:currentColor}
blockquote{margin:.75em 0;padding:0 0 0 14px;border-left:2px solid var(--accent);color:var(--text-2)}
code{font-family:var(--font-mono);font-size:.92em;background:var(--veil)!important;color:var(--code-ink)!important;border-radius:3px;padding:0 4px}
pre{font-family:var(--font-mono);font-size:calc(12px * var(--text-scale, 1));background:var(--veil)!important;border-radius:var(--radius-mark-sm);padding:10px 12px;color:var(--code-ink)!important;overflow-x:auto}
pre code{background:none!important;padding:0;color:inherit!important}
:is(code,pre) :not(img,.address,.formatted-mail-image-placeholder){color:inherit!important;background:transparent!important}
:is(code,pre) a{text-decoration-color:color-mix(in srgb,currentColor 60%,transparent)}
.address{all:initial!important;display:inline-block!important;font:inherit!important;color:inherit!important;cursor:pointer!important;vertical-align:baseline!important}
.address.veiled{width:8ch!important;height:1em!important;background:#888!important;border-radius:3px!important}
.address:focus-visible,a:focus-visible{outline:2px solid #6b9cff!important;outline-offset:2px!important}
.formatted-mail-image-placeholder{display:inline-block;max-width:100%;vertical-align:middle;background:#8883}
:is(p,ul,ol,blockquote,h1,h2,h3,h4,h5,h6,pre){max-width:70ch}table :is(p,ul,ol,blockquote,h1,h2,h3,h4,h5,h6,pre){max-width:none}
[data-ink=dark]{color:#1f1f1f!important}[data-ink=light]{color:#f5f5f5!important}
`;

function inheritTheme(element: HTMLIFrameElement, body: HTMLElement) {
  const theme = element.ownerDocument.defaultView!.getComputedStyle(element);
  for (const name of ['--text-scale', '--text', '--text-2', '--text-body', '--line', '--link', '--veil', '--accent', '--code-ink', '--font-mono', '--radius-mark-sm'])
    body.style.setProperty(name, theme.getPropertyValue(name));
  body.style.setProperty('--reader-foreground', theme.color);
}

const WHITE: Rgba = [255, 255, 255, 1];
// Composite host backgrounds through the nearest opaque ancestor, falling
// back to the white document canvas when every ancestor is translucent.
function readerSurface(element: HTMLIFrameElement): Rgba {
  const view = element.ownerDocument.defaultView!;
  let surface: Rgba = [0, 0, 0, 0];
  for (let current: Element | null = element; current; current = current.parentElement) {
    const color = parseColor(view.getComputedStyle(current).backgroundColor);
    if (color) surface = composite(surface, color);
    if (surface[3] >= 1) return surface;
  }
  return composite(surface, WHITE);
}

// The parent owns this blank document. No sender HTML, scripts, forms, popups
// or navigation permissions enter it. Same-origin permits the React portal.
export function IsolatedMail({ css, children, fallback }: { css: string; children: ReactNode; fallback: ReactNode }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [target, setTarget] = useState<HTMLElement>();
  const [failed, setFailed] = useState(false);
  useLayoutEffect(() => {
    const element = frame.current, doc = element?.contentDocument;
    if (!element || !doc?.body) { setFailed(true); return; }
    try {
      const Sheet = (doc.defaultView as unknown as { CSSStyleSheet: typeof CSSStyleSheet }).CSSStyleSheet;
      if (typeof Sheet.prototype.replaceSync === 'function') {
        const sheet = new Sheet(); sheet.replaceSync(defaults + css + controls); doc.adoptedStyleSheets = [sheet];
      } else {
        // DOM test environments and older engines. A blocked stylesheet keeps
        // the existing themed reader; CSP is never relaxed.
        const style = doc.createElement('style'); style.textContent = defaults + css + controls;
        doc.head.append(style);
        if (!style.sheet) throw Error('Styles unavailable');
      }
      inheritTheme(element, doc.body);
      setTarget(doc.body);
    } catch { setFailed(true); }
    return () => { doc.adoptedStyleSheets = []; };
  }, [css]);
  useEffect(() => {
    const element = frame.current, doc = target?.ownerDocument;
    if (!element || !doc) return;
    // Sender colors can change with theme and media queries, so low-contrast
    // text is re-inked on every resize, not only on the first render.
    const ink = () => applyReadableInk(target!, readerSurface(element));
    const resize = () => {
      element.style.height = `${Math.max(48, Math.min(100000, doc.documentElement.scrollHeight) || 48)}px`;
      ink();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || ['Tab', ' '].includes(event.key)) return;
      if (event.key === 'Enter' && (event.target as Element | null)?.closest?.('a,button,input,textarea,select,[role=button],[contenteditable],[tabindex]')) return;
      const Key = (element.ownerDocument.defaultView as Window & typeof globalThis).KeyboardEvent;
      const forwarded = new Key('keydown', { key: event.key, code: event.code, ctrlKey: event.ctrlKey, metaKey: event.metaKey,
        altKey: event.altKey, shiftKey: event.shiftKey, repeat: event.repeat, bubbles: true, cancelable: true });
      if (!element.dispatchEvent(forwarded)) event.preventDefault();
    };
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : undefined;
    observer?.observe(target!); resize();
    const Observer = (element.ownerDocument.defaultView as Window & typeof globalThis).MutationObserver;
    const themeObserver = new Observer(() => { inheritTheme(element, target!); ink(); });
    // React can replace this subscription before queued mutations arrive.
    // Every subscription starts from the current inherited snapshot.
    inheritTheme(element, target!);
    // Preferences live on .app; other theme values can come from any ancestor.
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement)
      themeObserver.observe(ancestor, { attributes: true, attributeFilter: ['style', 'class', 'data-theme'] });
    doc.addEventListener('load', resize, true);
    doc.defaultView!.addEventListener('keydown', keydown);
    return () => { observer?.disconnect(); themeObserver.disconnect(); doc.removeEventListener('load', resize, true); doc.defaultView?.removeEventListener('keydown', keydown); };
  }, [target, children]);
  if (failed) return <>{fallback}</>;
  return <><iframe ref={frame} className="isolated-mail" title="Formatted email" sandbox="allow-same-origin" referrerPolicy="no-referrer"
    style={{ width: '100%', border: 0, display: 'block', minHeight: 48 }} />
    {target ? createPortal(children, target) : fallback}</>;
}
