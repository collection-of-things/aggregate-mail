import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * Keeps something mounted while it animates out: `closing` is true for
 * `duration` ms after `open` turns false, then `mounted` turns false.
 */
export function usePresence(open: boolean, duration = 160) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (open) { setMounted(true); setClosing(false); return; }
    if (!mounted) return;
    setClosing(true);
    const timer = setTimeout(() => { setMounted(false); setClosing(false); }, duration);
    return () => clearTimeout(timer);
  }, [open]);
  return { mounted, closing };
}

/** Calls `onOutside` for presses outside every given element while `active`. */
export function useOutsidePress(active: boolean, refs: RefObject<HTMLElement | null>[], onOutside: () => void) {
  const callback = useRef(onOutside);
  callback.current = onOutside;
  useEffect(() => {
    if (!active) return;
    const press = (event: PointerEvent) => {
      if (refs.every((ref) => !ref.current?.contains(event.target as Node))) callback.current();
    };
    document.addEventListener("pointerdown", press);
    return () => document.removeEventListener("pointerdown", press);
  }, [active]);
}
