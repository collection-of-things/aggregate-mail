import { useEffect, useState, type ReactNode } from "react";

// Browser revocation must remove retained mail, not only deny future HTTP calls.
export function BrowserSession({ children }: { children: ReactNode }) {
  const desktop = !!window.desktop;
  const [allowed, setAllowed] = useState(desktop);
  const [visible, setVisible] = useState(desktop);
  useEffect(() => {
    if (desktop) return;
    let disposed = false;
    let revoked = false;
    let revision = 0;
    const lock = () => { revoked = true; revision++; setAllowed(false); setVisible(false); };
    const check = async () => {
      if (revoked || disposed) return;
      const current = ++revision;
      try {
        const response = await fetch("/auth/session", { cache: "no-store", signal: AbortSignal.timeout(5000) });
        const state = await response.json() as { authenticated?: boolean };
        if (disposed || current !== revision) return;
        if (!response.ok || state.authenticated !== true) { lock(); return; }
        setAllowed(true);
        setVisible(document.visibilityState !== "hidden");
      } catch { if (!disposed && current === revision) lock(); }
    };
    const visibility = () => { setVisible(false); if (document.visibilityState !== "hidden") void check(); };
    const channel = typeof BroadcastChannel === "undefined" ? undefined : new BroadcastChannel("emc2-browser-access");
    if (channel) channel.onmessage = (event) => { if (event.data === "locked") lock(); };
    window.addEventListener("emc2-browser-locked", lock);
    document.addEventListener("visibilitychange", visibility);
    const interval = setInterval(() => void check(), 10_000);
    void check();
    return () => { disposed = true; revision++; clearInterval(interval); channel?.close(); window.removeEventListener("emc2-browser-locked", lock); document.removeEventListener("visibilitychange", visibility); };
  }, [desktop]);
  if (desktop) return <>{children}</>;
  return <>
    {allowed && <div hidden={!visible} style={{ display: visible ? "contents" : "none" }}>{children}</div>}
    {!visible && <main><h1>Emc² browser access</h1><p>Your inbox is hidden until browser access is confirmed.</p><a href="/auth">Unlock inbox</a></main>}
  </>;
}
