import { useEffect, useRef, useState, type RefObject } from "react";

export type BrowserWrites = { pending: number; uncertain: boolean };
const activeWork = () => !!document.querySelector('form, [role="dialog"], [role="menu"], [contenteditable="true"], [aria-busy="true"], .attachment-preview') || !!document.activeElement?.matches("input, textarea, select");

export function BrowserUpdateNotice({ blocked, writes, onReload }: {
  blocked: boolean; writes: RefObject<BrowserWrites>; onReload: () => void;
}) {
  const [version, setVersion] = useState("");
  const [later, setLater] = useState(false);
  const [working, setWorking] = useState(false);
  const idleSince = useRef(Date.now());
  const reloading = useRef(false);
  const current = useRef({ blocked, onReload, later, version });
  current.current = { blocked, onReload, later, version };
  const refresh = (automatic = false) => {
    const state = current.current;
    if (!state.version || state.blocked || reloading.current || writes.current.pending || writes.current.uncertain || document.visibilityState !== "visible") return;
    if (activeWork()) return;
    if (automatic && (state.later || Date.now() - idleSince.current < 30_000)) return;
    reloading.current = true;
    state.onReload();
  };
  const refreshRef = useRef(refresh); refreshRef.current = refresh;
  useEffect(() => {
    if (window.desktop) return;
    let lastVersion = "";
    const update = (event: Event) => {
      const next = (event as CustomEvent<unknown>).detail;
      if (typeof next !== "string" || !/^[a-f0-9]{64}$/.test(next) || next === lastVersion) return;
      lastVersion = next; idleSince.current = Date.now(); setVersion(next); setLater(false); setWorking(activeWork());
    };
    const activity = () => { idleSince.current = Date.now(); };
    const events = ["pointerdown", "pointermove", "keydown", "input", "wheel", "scroll", "visibilitychange"];
    window.addEventListener("emc2-update-ready", update);
    for (const event of events) document.addEventListener(event, activity, true);
    const timer = setInterval(() => { if (current.current.version) { setWorking(activeWork()); refreshRef.current(true); } }, 1000);
    return () => { clearInterval(timer); window.removeEventListener("emc2-update-ready", update); for (const event of events) document.removeEventListener(event, activity, true); };
  }, []);
  if (window.desktop || !version) return null;
  const waiting = blocked || working || writes.current.pending > 0 || writes.current.uncertain;
  return <aside className="browser-update-notice" aria-label="Browser update">
    <span role="status">Update ready. {writes.current.uncertain ? "A request has an unknown outcome. Check its result before refreshing manually." : waiting ? "Finish your current work before updating." : later ? "Update when you are ready." : "Updates automatically when idle."}</span>
    <button type="button" disabled={waiting} onClick={() => refreshRef.current()}>Update now</button>
    {!later && <button type="button" onClick={() => setLater(true)}>Later</button>}
  </aside>;
}
