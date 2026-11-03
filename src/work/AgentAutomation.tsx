import { useEffect, useId, useRef, useState } from "react";
import type { AgentAutomationScope, AgentAutomationSettings, AgentProviderSettings } from "../../shared/agent-provider";
import type { AgentGrant } from "../../shared/workspace";
import type { Api } from "../api";
import { Notice, useFeedbackState } from "../ui/Toasts";
import { Segmented } from "../ui/Segmented";
import { PrivateField } from "../ui/PrivateField";
import { Redact } from "../ui/Privacy";

export const automationDefaults = { enabled: true, scope: "important" as AgentAutomationScope, instruction: "", dailyLimit: 20 };
export const automationRoute = (grant: AgentGrant) => `/agent/grants/${encodeURIComponent(grant.id)}/automation`;

// The user's per-assistant switch for preparing replies to new mail.
export function AgentAutomation({ grant, api, disabled, reload, mcpEnabled }: { grant: AgentGrant; api: Api; disabled: boolean; reload: number; mcpEnabled: boolean }) {
  const scopeLabel = useId();
  const route = automationRoute(grant);
  const [loaded, setLoaded] = useState(false);
  const [provider, setProvider] = useState<AgentProviderSettings | null>(null);
  const [saved, setSaved] = useState<AgentAutomationSettings | null>(null);
  const [scope, setScope] = useState<AgentAutomationScope>(automationDefaults.scope);
  const [instruction, setInstruction] = useState("");
  const [limit, setLimit] = useState(String(automationDefaults.dailyLimit));
  const [pending, setPending] = useState(false);
  const [error, setError] = useFeedbackState();
  const [status, setStatus] = useFeedbackState("success");
  const active = useRef(true);
  // Only the newest load may apply, and never over a save that started after it.
  const loads = useRef(0);
  const saves = useRef(0);
  const dirty = useRef(false);
  const permitted = grant.tools.includes("read_email") && grant.tools.includes("propose_draft");
  const show = (value: AgentAutomationSettings | null) => {
    setSaved(value);
    setScope(value?.scope ?? automationDefaults.scope); setInstruction(value?.instruction ?? ""); setLimit(String(value?.dailyLimit ?? automationDefaults.dailyLimit));
  };
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    if (!permitted || disabled) return;
    let cancelled = false;
    const request = ++loads.current;
    const saveAt = saves.current;
    void Promise.all([api<AgentProviderSettings | null>(`/agent/grants/${encodeURIComponent(grant.id)}/provider`), api<AgentAutomationSettings | null>(route)]).then(([key, value]) => {
      if (cancelled || request !== loads.current || saveAt !== saves.current) return;
      // A reload keeps option edits the user has not saved yet.
      setProvider(key); if (dirty.current) setSaved(value); else show(value); setLoaded(true); setError("");
    }).catch(() => { if (!cancelled) setError("Automatic reply settings could not be loaded."); });
    return () => { cancelled = true; };
  }, [api, route, grant.id, permitted, disabled, reload]);
  if (!permitted) return null;
  const dailyLimit = Math.max(1, Math.min(200, Math.trunc(Number(limit)) || 1));
  // The switch keeps saved options; Save options stores the edited ones.
  const save = async (enabled: boolean, message: string, edited?: { scope: AgentAutomationScope; instruction: string; dailyLimit: number }, options = edited ?? { scope: saved?.scope ?? automationDefaults.scope, instruction: saved?.instruction ?? "", dailyLimit: saved?.dailyLimit ?? automationDefaults.dailyLimit }) => {
    const request = ++saves.current;
    setPending(true); setError(""); setStatus("");
    try {
      const value = await api<AgentAutomationSettings>(route, "PUT", { enabled, ...options, revision: saved?.revision ?? null });
      if (!active.current || request !== saves.current) return;
      // The switch leaves unsaved option edits in place.
      if (edited) show(value); else setSaved(value);
      setStatus(message);
    } catch { if (active.current) setError("Automatic reply settings were not saved. Reload Agent Reviews and try again."); }
    finally { if (active.current) setPending(false); }
  };
  const enabled = Boolean(saved?.enabled);
  const unchanged = saved ? saved.scope === scope && saved.instruction === instruction.trim() && limit.trim() === String(saved.dailyLimit) : false;
  dirty.current = Boolean(saved) && !unchanged;
  const count = saved?.day === new Date().toLocaleDateString("en-CA") ? saved.count ?? 0 : 0;
  return <div className="settings-form work-form agent-automation">
    {error && <Notice text={error} />}
    {status && <Notice text={status} kind="success" />}
    <label className="settings-row"><span>Prepare replies automatically</span>
      <input type="checkbox" role="switch" checked={enabled} disabled={!loaded || pending || disabled || !provider?.hasKey && !enabled}
        onChange={(event) => void save(event.target.checked, event.target.checked ? "Automatic replies on." : "Automatic replies off.")} /></label>
    {!loaded ? null : !provider?.hasKey ? <p className="work-meta">Add a provider key under Bring your own key to run this assistant automatically.</p> : <>
      <p className="work-meta">{enabled
        ? <>On. For each new email in its accounts, this assistant sends the email's subject, sender, recipient and plain text to <Redact text={provider.baseURL} /> and puts a reply proposal in the Review queue. Nothing is sent. {count} of {saved!.dailyLimit} today.</>
        : "Off. This assistant prepares replies only when you click Prepare draft."}
        {enabled && !mcpEnabled && " Approving a proposal requires MCP enabled in Settings."}</p>
      {saved?.lastRunAt && saved.lastResult && <p className="work-meta">Last run {new Date(saved.lastRunAt).toLocaleString()}: {saved.lastResult}</p>}
      <details>
        <summary>Automatic reply options</summary>
        <fieldset disabled={pending || disabled} className="work-editing">
          <div><span id={scopeLabel}>New mail</span><Segmented labelledBy={scopeLabel} value={scope}
            choices={[{ id: "important" as const, label: "Important only" }, { id: "all" as const, label: "All new mail" }]} onChange={setScope} /></div>
          <PrivateField label="Reply instruction (optional)" value={instruction} onChange={setInstruction} multiline maxLength={2000} />
          <label>Daily limit<input type="number" min={1} max={200} value={limit} onChange={(event) => setLimit(event.target.value)} onBlur={() => setLimit(String(dailyLimit))} /></label>
          <button type="button" className="button" disabled={unchanged} onClick={() => { setLimit(String(dailyLimit)); void save(enabled, "Automatic reply options saved.", { scope, instruction, dailyLimit }); }}>Save options</button>
        </fieldset>
      </details>
    </>}
  </div>;
}
