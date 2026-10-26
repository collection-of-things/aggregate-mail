import { useState } from "react";
import type { Api, Perform } from "../api";
import type { BackupPreview } from "../../shared/workspace-backup";

const recordNames: Record<string, string> = {
  commitment: "Commitments", project: "Projects", decision: "Decisions", rule: "Teach rules",
  draft: "Drafts", proposal: "Agent history", template: "Templates", signature: "Signatures",
  workspaceMailState: "Pins and snoozes",
};
type Preview = BackupPreview & { previewToken: string };
export function WorkspaceBackup({ api, perform, busy }: { api: Api; perform: Perform; busy: boolean }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [file, setFile] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState("");
  const bridge = window.desktop?.workspaceBackup;
  const disabled = busy || working;
  const run = (task: () => Promise<void>) => {
    if (disabled) return;
    setWorking(true); setNotice("");
    void perform(task).finally(() => setWorking(false));
  };
  const clear = () => { setPassword(""); setConfirmation(""); setPreview(null); setFile(null); };
  return <section>
    <h2>Encrypted workspace backup</h2>
    <p className="note">Export local commitments, projects, Teach rules, pins, snoozes, drafts, templates, signatures and agent history. Account credentials, OAuth tokens, agent and MCP secrets, and cached provider mail bodies are excluded. Drafts and history can contain private text.</p>
    <p className="note">Keep the passphrase separately. It cannot be recovered. Backups are limited to 32 MiB. Restore requires connected accounts with matching email addresses and providers. Source mail can remain unavailable after resync.</p>
    {!bridge ? <p className="note">Open the desktop app to save or open backup files.</p> : <>
      <label className="settings-row stacked"><span>Backup passphrase</span><input type="password" autoComplete="new-password" minLength={12} maxLength={1024} value={password} disabled={disabled || !!preview} onChange={event => setPassword(event.target.value)} /></label>
      <label className="settings-row stacked"><span>Confirm passphrase for export</span><input type="password" autoComplete="new-password" maxLength={1024} value={confirmation} disabled={disabled || !!preview} onChange={event => setConfirmation(event.target.value)} /></label>
      <div className="settings-row compose-settings-actions">
        <button type="button" disabled={disabled || !!preview || password.length < 12 || password !== confirmation} onClick={() => run(async () => {
          const result = await api<{ file: string }>("/api/workspace-backup/export", "POST", { passphrase: password });
          if (await bridge.save(result.file)) { clear(); setNotice("Encrypted backup saved."); }
        })}>Export encrypted backup</button>
        <button type="button" disabled={disabled || !!preview || password.length < 12} onClick={() => run(async () => {
          const encrypted = await bridge.open();
          if (encrypted === null) return;
          const result = await api<Preview>("/api/workspace-backup/preview", "POST", { file: encrypted, passphrase: password });
          setFile(encrypted); setPreview(result); setConfirmation("");
        })}>Open backup and preview</button>
      </div>
      {preview && <div className="settings-group">
        <p>Backup created {preview.manifest.createdAt}, Emc² {preview.manifest.appVersion}.</p>
        <table><caption>Import preview</caption><thead><tr><th>Records</th><th>In file</th><th>Add</th><th>Skip existing</th></tr></thead>
          <tbody>{Object.entries(preview.manifest.counts).map(([kind, count]) => <tr key={kind}><th scope="row">{recordNames[kind] ?? kind}</th><td>{count}</td><td>{preview.added[kind]}</td><td>{preview.skipped[kind]}</td></tr>)}</tbody></table>
        <p className="note">Existing IDs, templates, signatures and active pin/snooze flags win. Nothing is deleted. Pending and interrupted agent actions become unknown history and cannot resume. Counts are checked again at import. Reload after importing to refresh all views.</p>
        {preview.missingAccounts > 0 && <p role="alert">{preview.missingAccounts} account mappings are missing or ambiguous. Cancel and connect matching accounts first.</p>}
        <button type="button" disabled={disabled || preview.missingAccounts > 0} onClick={() => run(async () => {
          await api("/api/workspace-backup/import", "POST", { file, passphrase: password, previewToken: preview.previewToken });
          clear(); setNotice("Workspace imported. Existing records were kept. Reload to refresh all views.");
        })}>Merge into current profile</button>
        <button type="button" disabled={disabled} onClick={clear}>Cancel import</button>
      </div>}
    </>}
    <p role="status">{working ? "Processing encrypted backup…" : notice}</p>
  </section>;
}
