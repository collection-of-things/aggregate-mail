import { useEffect, useRef, useState } from "react";
import { version } from "../../package.json";
import type { UpdateState } from "../../shared/updates";

const validBuild = (value: string | null | undefined) => value && /^[a-f0-9]{64}$/.test(value) ? value : undefined;

export function AboutVersion() {
  const desktop = typeof window !== "undefined" && !!window.desktop;
  const bridge = typeof window === "undefined" ? undefined : window.desktop?.updates;
  const build = typeof document === "undefined" ? undefined : validBuild(document.querySelector<HTMLMetaElement>('meta[name="emc2-build"]')?.content);
  const [state, setState] = useState<UpdateState>({ phase: "idle" });
  const [pending, setPending] = useState(false);
  const active = useRef(false);
  const locked = useRef(false);
  const revision = useRef(0);
  const check = async () => {
    if (locked.current) return;
    locked.current = true;
    setPending(true);
    const request = ++revision.current;
    try {
      let next: UpdateState;
      if (bridge) next = await bridge.command("check");
      else if (window.desktop || !build) next = { phase: "unavailable" };
      else {
        const response = await fetch("/auth/session", { cache: "no-store", signal: AbortSignal.timeout(5000) });
        const session = response.ok ? await response.json() : undefined;
        const latest = validBuild(response.headers.get("X-Emc2-Build"));
        if (session?.authenticated !== true || !latest) next = { phase: "unavailable" };
        else {
          next = { phase: latest === build ? "current" : "available" };
          if (latest !== build) window.dispatchEvent(new window.CustomEvent("emc2-update-ready", { detail: latest }));
        }
      }
      if (active.current && request === revision.current) setState(next);
    } catch {
      if (active.current && request === revision.current) setState({ phase: "error" });
    } finally {
      locked.current = false;
      if (active.current) setPending(false);
    }
  };
  useEffect(() => {
    active.current = true;
    const initial = bridge ? ++revision.current : revision.current;
    const unsubscribe = bridge?.onState(next => { revision.current++; setState(next); });
    if (bridge) void bridge.state().then(next => {
      if (active.current && initial === revision.current) setState(next);
    }, () => { if (active.current && initial === revision.current) setState({ phase: "error" }); });
    else void check();
    const update = (event: Event) => {
      if (validBuild((event as CustomEvent<string>).detail)) { revision.current++; setState({ phase: "available" }); }
    };
    if (!window.desktop) window.addEventListener("emc2-update-ready", update);
    return () => { active.current = false; unsubscribe?.(); window.removeEventListener("emc2-update-ready", update); };
  }, [bridge]);
  const busy = pending || ["checking", "downloading", "installing"].includes(state.phase);
  const text = pending || state.phase === "checking" ? "Checking for updates…"
    : state.phase === "current" ? desktop ? "You have the latest stable version." : "Latest version on this host."
    : ["available", "downloading", "ready", "installing"].includes(state.phase) ? desktop
      ? state.phase === "downloading" ? "Downloading update…" : state.phase === "installing" ? "Installing update…"
        : `Update ${state.version || ""} available. Use App update after closing Settings.`
      : "A newer build is ready on this host. Close Settings to update safely."
    : state.phase === "idle" ? "Check for updates to see if this version is current."
    : state.phase === "unsupported" ? "Update checks are unavailable for this build."
    : "Could not confirm the latest version. Try checking again.";
  return <>
    <div><dt>Version</dt><dd>Emc² {version}{!desktop && build && <> · Build {build.slice(0, 8)}</>}</dd></div>
    <div><dt>Updates</dt><dd>
      <p role="status">{text}</p>
      <button type="button" className="button" disabled={busy || state.phase === "unsupported" || (desktop && !bridge) || (!desktop && !build)} onClick={() => void check()}>Check for updates</button>
    </dd></div>
  </>;
}
