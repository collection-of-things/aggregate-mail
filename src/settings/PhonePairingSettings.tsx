import { useContext, useEffect, useRef, useState } from "react";
import type { PhoneDevices } from "../../shared/phone-access";
import type { Api } from "../api";
import { PrivacyContext } from "../ui/Privacy";

export function PhonePairingSettings({ api, canPair }: { api: Api; canPair: boolean }) {
  const { on: privacy } = useContext(PrivacyContext);
  const [value, setValue] = useState<PhoneDevices>({ devices: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef(true);
  const request = useRef(false);
  const revision = useRef(0);
  const load = async () => {
    if (request.current) return;
    const version = ++revision.current;
    try {
      const next = await api<PhoneDevices>("/phone-devices");
      if (active.current && !request.current && version === revision.current) setValue((old) => ({ ...next, pairing: next.pairing && old.pairing && next.pairing.id === old.pairing.id ? { ...next.pairing, qr: old.pairing.qr } : next.pairing }));
    } catch { if (active.current && !request.current && version === revision.current) { setValue({ devices: [] }); setError("Could not check paired phones. Refresh to try again."); } }
  };
  useEffect(() => { active.current = true; void load(); return () => { active.current = false; revision.current++; }; }, [api]);
  useEffect(() => {
    if (!canPair || !value.pairing || value.pairing.phase === "complete") return;
    const interval = setInterval(() => void load(), 2000);
    return () => clearInterval(interval);
  }, [value.pairing?.id, value.pairing?.phase, api, canPair]);
  const change = async (action: "connect" | "approve" | "cancel" | "revoke", id?: string) => {
    if (request.current || (action !== "revoke" && !canPair)) return;
    if ((action === "approve" || action === "revoke") && !confirm(action === "approve" ? "Does the code on your phone match this code? Approve only the phone you are connecting." : "Remove this phone's passkey and lock its active sessions?")) return;
    revision.current++; request.current = true; setBusy(true); setError("");
    try {
      const next = await api<PhoneDevices>(`/phone-devices/${action}`, "POST", { confirm: true, ...(id ? { id } : {}) });
      if (active.current) setValue(next);
    } catch { if (active.current) { setValue({ devices: [] }); setError("Could not change phone access. Refresh to check it on the host."); } }
    finally { request.current = false; if (active.current) setBusy(false); }
  };
  const pairing = canPair ? value.pairing : undefined;
  return <section aria-busy={busy}>
    <h2>Paired phones</h2>
    <p className="note">Scan, compare the code and approve on this host. Your phone saves a passkey for future unlocks with its screen lock. Invitations expire after two minutes.</p>
    {error && <p role="alert">{error}</p>}
    {!canPair && <p className="note">Enable and verify the private route before connecting another phone. You can still remove paired phones here.</p>}
    {!pairing && <button type="button" disabled={busy || !canPair || value.devices.length >= 8} onClick={() => void change("connect")}>Connect phone</button>}
    {pairing && <div className="settings-group">
      <p role="status">{pairing.phase === "waiting" ? "Scan with your phone's camera." : pairing.phase === "claimed" ? "Compare this code with your phone before approving." : pairing.phase === "approved" ? "Approved. Save the passkey on your phone." : "Phone connected. Use its passkey to unlock."}</p>
      {privacy ? <p>Pairing details hidden while Privacy is on.</p> : <>
        {pairing.phase === "waiting" && pairing.qr && <img src={pairing.qr} width="240" height="240" alt="Scan to connect this phone" />}
        {pairing.code && pairing.phase !== "complete" && <p>Matching code: <strong>{pairing.code}</strong></p>}
        {pairing.phase === "claimed" && <button type="button" disabled={busy} onClick={() => void change("approve", pairing.id)}>Approve matching phone</button>}
      </>}
      <button type="button" disabled={busy} onClick={() => void change("cancel", pairing.id)}>{pairing.phase === "complete" ? "Done" : "Cancel pairing"}</button>
    </div>}
    <div className="settings-group">{value.devices.length ? value.devices.map((device) => <div className="settings-row" key={device.id}>
      <span>{device.name}</span><button type="button" disabled={busy} onClick={() => void change("revoke", device.id)}>Remove {device.name}</button>
    </div>) : <p className="note">No phones paired.</p>}</div>
    <button type="button" disabled={busy} onClick={() => { setError(""); void load(); }}>Refresh phones</button>
  </section>;
}
