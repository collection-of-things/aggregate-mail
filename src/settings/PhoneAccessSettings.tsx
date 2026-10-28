import { useContext, useEffect, useState } from "react";
import type { PhoneAccessStatus } from "../../shared/phone-access";
import type { Api } from "../api";
import { PhonePairingSettings } from "./PhonePairingSettings";
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
      ? "Create a private Tailscale HTTPS route on this host? Your phone needs Tailscale. Connect it from Settings and save a passkey."
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
    <p className="note">Connect once, then open your inbox with your phone’s screen lock.</p>
    <ol className="note">
      <li>Keep the browser host running and connect both devices to Tailscale.</li>
      <li>Enable phone access here, then choose Connect phone.</li>
      <li>Scan the QR from another screen, or open the setup link on your phone.</li>
      <li>Compare the code, approve here and save the passkey on your phone.</li>
    </ol>
    {status && !status.supported && <div className="settings-group">
      <h3>Start the browser host first</h3>
      <p className="note">Phone access uses the protected browser host, not the desktop app. Start it using the Local browser access instructions in the README, then open its localhost address and unlock with your recovery passphrase. Return to Settings → Phone access there.</p>
      <p className="note">The browser host has a separate encrypted profile. Your desktop accounts do not move automatically.</p>
    </div>}
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
    {status?.supported && status.canManage && <PhonePairingSettings api={api} canPair={status.state === "ready"} />}
    {status?.supported && !status.canManage && !busy && <p className="note">Manage this route from the signed-in localhost browser on the host.</p>}
  </section>;
}
