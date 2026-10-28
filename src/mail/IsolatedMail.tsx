import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const defaults = `:where(body){color:var(--reader-foreground);font:calc(14px * var(--text-scale, 1))/1.5 system-ui,sans-serif}`;
const controls = `
body{margin:0;overflow-wrap:break-word}
img,table{max-width:100%}img{height:auto}a{cursor:pointer}
.address{all:initial!important;display:inline-block!important;font:inherit!important;color:inherit!important;cursor:pointer!important;vertical-align:baseline!important}
.address.veiled{width:8ch!important;height:1em!important;background:#888!important;border-radius:3px!important}
.address:focus-visible,a:focus-visible{outline:2px solid #6b9cff!important;outline-offset:2px!important}
.formatted-mail-image-placeholder{display:inline-block;max-width:100%;vertical-align:middle;background:#8883}
`;

function inheritTheme(element: HTMLIFrameElement, body: HTMLElement) {
  const theme = element.ownerDocument.defaultView!.getComputedStyle(element);
  for (const name of ['--text-scale', '--text', '--text-2', '--line', '--link', '--veil'])
    body.style.setProperty(name, theme.getPropertyValue(name));
  body.style.setProperty('--reader-foreground', theme.color);
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
    const resize = () => { element.style.height = `${Math.max(48, Math.min(100000, doc.documentElement.scrollHeight) || 48)}px`; };
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
    const themeObserver = new Observer(() => inheritTheme(element, target!));
    themeObserver.observe(element.ownerDocument.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-theme'] });
    doc.addEventListener('load', resize, true);
    doc.defaultView!.addEventListener('keydown', keydown);
    return () => { observer?.disconnect(); themeObserver.disconnect(); doc.removeEventListener('load', resize, true); doc.defaultView?.removeEventListener('keydown', keydown); };
  }, [target, children]);
  if (failed) return <>{fallback}</>;
  return <><iframe ref={frame} title="Formatted email" sandbox="allow-same-origin" referrerPolicy="no-referrer"
    style={{ width: '100%', border: 0, display: 'block', minHeight: 48 }} />
    {target ? createPortal(children, target) : fallback}</>;
}
