import { useEffect, useRef, useState } from "react";
import { providerNames, type Account } from "../../shared/types";
import { request } from "../api";
import { modules } from "../shell/Sidebar";
import { Empty, Page } from "../ui/Page";
import { Tabs } from "../ui/Tabs";
import { PlusIcon, RetryIcon, TrashIcon } from "../ui/icons";
import { useOutsidePress, usePresence } from "../ui/presence";

type ImapProvider = "icloud" | "fastmail" | "yahoo" | "gmail-imap" | "imap";
const providers: { id: ImapProvider; label: string; help?: string }[] = [
  { id: "icloud", label: "iCloud", help: "Use an app-specific password from account.apple.com." },
  { id: "fastmail", label: "Fastmail", help: "Use an app password from Fastmail settings." },
  { id: "yahoo", label: "Yahoo", help: "Use an app password from Yahoo account security." },
  { id: "gmail-imap", label: "Gmail", help: "Use the 16-letter app password from your Google account." },
  { id: "imap", label: "Other" },
];

/** Connected accounts, each a card you can rename, sync again or remove, and the form to add one. */
export function AccountsPage({ accounts, csrf, onChanged }: { accounts: Account[]; csrf: string; onChanged: () => Promise<void> | void }) {
  const [tab, setTab] = useState(accounts.length ? "connected" : "add");
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  const Icon = modules.accounts.icon;
  return (
    <Page section="Accounts" icon={<Icon />} title="Manage accounts" notice={notice}
      actions={tab !== "add" && <button type="button" className="ghost-button" onClick={() => setTab("add")}><PlusIcon />Add account</button>}>
      <Tabs tabs={[{ id: "connected", label: "Connected", count: accounts.length }, { id: "add", label: "Add account" }]} value={tab} onChange={setTab} label="Accounts" />
      <div className="page-scroll">
        {tab === "connected"
          ? accounts.length
            ? <div className="card-grid">{accounts.map((account, index) => <AccountCard key={account.id} account={account} index={index} csrf={csrf} onChanged={onChanged} onNotice={setNotice} />)}</div>
            : <Empty title="No accounts yet">Add one to start syncing mail.</Empty>
          : <AddAccount csrf={csrf} onAdded={async (email) => { await onChanged(); setTab("connected"); setNotice(`${email} connected.`); }} />}
      </div>
    </Page>
  );
}

function AccountCard({ account, index, csrf, onChanged, onNotice }: {
  account: Account; index: number; csrf: string; onChanged: () => Promise<void> | void; onNotice: (text: string) => void;
}) {
  const [name, setName] = useState(account.name ?? "");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const area = useRef<HTMLDivElement>(null);
  const presence = usePresence(confirming, 140);
  useOutsidePress(confirming, [area], () => setConfirming(false));
  useEffect(() => setName(account.name ?? ""), [account.name]);

  const run = async (work: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try { await work(); await onChanged(); onNotice(message); } catch (reason) { onNotice((reason as Error).message); } finally { setBusy(false); }
  };
  const saveName = () => {
    if (name.trim() === (account.name ?? "")) return;
    void run(() => request(`/api/accounts/${encodeURIComponent(account.id)}`, { method: "PATCH", csrf, body: { name: name.trim() } }), "Name saved.");
  };
  return (
    <article className="card account-card">
      <div className="account-card-head">
        <span className="user-avatar" aria-hidden="true">{index + 1}</span>
        <span className="account-card-text">
          <input className="inline-input" value={name} placeholder={account.email} aria-label="Account name" maxLength={80}
            onChange={(event) => setName(event.target.value)} onBlur={saveName} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
          <span className="muted">{account.email}</span>
        </span>
        <span className="tag">{providerNames[account.provider]}</span>
      </div>
      <p className={account.error ? "account-status error" : "account-status"}>
        {account.syncStatus === "running" ? "Syncing…" : account.syncStatus === "queued" ? "Sync queued" : account.error ?? "Up to date"}
      </p>
      <div className="card-actions">
        <button type="button" className="ghost-button" disabled={busy} onClick={() => void run(() => request(`/api/accounts/${encodeURIComponent(account.id)}/reconnect`, { method: "POST", csrf }), "Sync started.")}>
          <RetryIcon />Sync now
        </button>
        <div ref={area} className="popover-anchor">
          <button type="button" className="ghost-button danger" disabled={busy} aria-expanded={confirming} onClick={() => setConfirming(!confirming)}><TrashIcon />Remove</button>
          {presence.mounted && (
            <div className={`popover menu-popover left${presence.closing ? " closing" : ""}`} role="alertdialog">
              <p className="popover-title">Remove {account.name || account.email}?</p>
              <p className="popover-text">Its cached mail, drafts and settings leave this device. Your mailbox stays as it is.</p>
              <div className="popover-actions">
                <button type="button" className="popover-button" onClick={() => setConfirming(false)}>Cancel</button>
                <button type="button" className="popover-button danger" autoFocus
                  onClick={() => { setConfirming(false); void run(() => request(`/api/accounts/${encodeURIComponent(account.id)}`, { method: "DELETE", csrf }), "Account removed."); }}>Remove</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

/** IMAP connection form. Known providers fill in their servers; Other asks for them. */
function AddAccount({ csrf, onAdded }: { csrf: string; onAdded: (email: string) => Promise<void> }) {
  const [provider, setProvider] = useState<ImapProvider>("icloud");
  const [form, setForm] = useState({ email: "", password: "", username: "", imapHost: "", imapPort: "993", smtpHost: "", smtpPort: "465" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = (key: keyof typeof form) => ({ value: form[key], onChange: (event: { target: { value: string } }) => setForm({ ...form, [key]: event.target.value }) });
  const chosen = providers.find((item) => item.id === provider)!;
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await request("/api/accounts/imap", {
        method: "POST", csrf,
        body: { provider, email: form.email.trim(), password: form.password, ...(provider === "imap" ? {
          username: form.username.trim() || undefined, imapHost: form.imapHost.trim(), smtpHost: form.smtpHost.trim(),
          imapPort: Number(form.imapPort) || 993, smtpPort: form.smtpPort === "587" ? 587 : 465,
        } : {}) },
      });
      await onAdded(form.email.trim());
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="card form-card" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <p className="card-title">Connect a mail account</p>
      <div className="segmented wide" role="radiogroup" aria-label="Provider">
        {providers.map((item) => (
          <button key={item.id} type="button" role="radio" aria-checked={provider === item.id} className={provider === item.id ? "active" : ""} onClick={() => setProvider(item.id)}>{item.label}</button>
        ))}
      </div>
      {chosen.help && <p className="form-help">{chosen.help}</p>}
      <label className="form-field"><span>Email</span><input type="email" required autoComplete="off" spellCheck={false} placeholder="you@example.com" {...field("email")} /></label>
      <label className="form-field"><span>App password</span><input type="password" required autoComplete="new-password" {...field("password")} /></label>
      {provider === "imap" && <>
        <label className="form-field"><span>Username</span><input autoComplete="off" spellCheck={false} placeholder="Defaults to the email" {...field("username")} /></label>
        <div className="form-row">
          <label className="form-field grow"><span>IMAP server</span><input required spellCheck={false} placeholder="imap.example.com" {...field("imapHost")} /></label>
          <label className="form-field port"><span>Port</span><input inputMode="numeric" {...field("imapPort")} /></label>
        </div>
        <div className="form-row">
          <label className="form-field grow"><span>SMTP server</span><input required spellCheck={false} placeholder="smtp.example.com" {...field("smtpHost")} /></label>
          <label className="form-field port"><span>Port</span>
            <select {...field("smtpPort")}><option value="465">465</option><option value="587">587</option></select>
          </label>
        </div>
      </>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="card-actions end">
        <p className="form-note">The app checks sending and receiving before saving. Credentials stay encrypted on this device.</p>
        <button type="submit" className="blue-button form-submit" disabled={busy}>{busy ? "Checking…" : "Connect"}</button>
      </div>
    </form>
  );
}
