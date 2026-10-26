import { useContext, useEffect, useState } from "react";
import type { PhoneAccessStatus } from "../../shared/phone-access";
import type { Api } from "../api";
import { PrivacyContext } from "../ui/Privacy";

export function PhoneAccessSettings({ api, onCopied }: { api: Api; onCopied: (message: string) => void }) {
  const { on: privacy } = useContext(PrivacyContext);
  const [status, setStatus] = useState<PhoneAccessStatus>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void api<PhoneAccessStatus>("/phone-access").then((value) => { if (active) setStatus(value); })
      .catch(() => { if (active) setError("Could not check phone access. Refresh to try again."); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [api]);
  const update = async (action?: "enable" | "disable") => {
    if (busy) return;
    if (action && !confirm(action === "enable"
      ? "Create a private Tailscale HTTPS route on this host? Your phone needs Tailscale and your Emc² browser password."
      : "Disable this host's Emc² phone route and lock its phone session?")) return;
    setBusy(true);
    setError("");
    try {
      setStatus(await api<PhoneAccessStatus>(`/phone-access${action ? `/${action}` : ""}`, action ? "POST" : "GET", action ? { confirm: true } : undefined));
    } catch {
      // Discard a previously verified address when the host cannot confirm it.
      setStatus(undefined);
      setError("Phone access could not be confirmed. Refresh to check its status on the host.");
    } finally { setBusy(false); }
  };
  return <section aria-busy={busy}>
    <h2>Private browser access</h2>
    <p className="note">Keep Emc² running on this host. Connect your phone to the same Tailscale network, open the verified address and enter your browser password. A new login locks the previous browser session.</p>
    <p role="status">{busy ? "Checking phone access…" : status?.message}</p>
    {error && <p role="alert">{error}</p>}
    {status?.url && status.state === "ready" && !busy && <div className="settings-group">
      <div className="mcp-copy"><div><strong>Private HTTPS address</strong><p>{privacy ? "Address hidden while Privacy is on." : <a href={status.url} target="_blank" rel="noreferrer">{status.url}</a>}</p></div>
        {!privacy && <button type="button" onClick={() => {
          void navigator.clipboard.writeText(status.url!).then(() => onCopied("Phone address copied."))
            .catch(() => setError("Could not copy the address. Select it and copy manually."));
        }}>Copy URL</button>}
      </div>
    </div>}
    <div className="section-head">
      <button type="button" disabled={busy} onClick={() => void update()}>Refresh</button>
      {status?.supported && status.canManage && <button type="button" disabled={busy || (!status.hasRoute && status.state !== "off")}
        onClick={() => void update(status.hasRoute ? "disable" : "enable")}>
        {status.hasRoute ? "Disable phone access" : "Enable phone access"}
      </button>}
    </div>
    {status?.supported && !status.canManage && !busy && <p className="note">Manage this route from the signed-in localhost browser on the host.</p>}
  </section>;
}
