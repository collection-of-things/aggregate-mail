import { Fragment, useContext, useEffect, useState } from "react";
import type { ContactList, SavedContact } from "../../shared/contacts";
import type { Account } from "../../shared/types";
import type { Api } from "../api";
import { accountLabel } from "../mail-ui";
import { Dropdown } from "../ui/Dropdown";
import { Address, PrivacyContext } from "../ui/Privacy";
import { PrivateField } from "./ComposeSettings";

type Editing = { kind: "new"; accountId: string; name: string; email: string } | { kind: "edit"; id: string; name: string; email: string };

// Lists, adds, edits and deletes saved contacts, and removes recent recipients.
export function ContactsSettings({ api, accounts, busy = false }: { api: Api; accounts: readonly Account[]; busy?: boolean }) {
  const { on: privacy } = useContext(PrivacyContext);
  const [contacts, setContacts] = useState<ContactList | null>(null);
  const [loadError, setLoadError] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const disabled = busy || saving;
  const load = async () => {
    setLoadError("");
    try { setContacts(await api<ContactList>("/contacts")); }
    catch { setLoadError("Could not load contacts."); }
  };
  useEffect(() => { void load(); }, []);
  const run = async (task: () => Promise<unknown>, done: string) => {
    if (disabled) return false;
    setSaving(true); setError(""); setStatus("");
    try {
      await task();
      setStatus(done);
      await load();
      return true;
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : "Could not update contacts. Try again.");
      return false;
    } finally { setSaving(false); }
  };
  const source = (accountId: string) => {
    const index = accounts.findIndex((account) => account.id === accountId);
    return index < 0 ? "" : accountLabel(accounts[index], index, privacy, accounts);
  };
  const form = (value: Editing) => <form className="contact-form" onSubmit={async (event) => {
    event.preventDefault();
    const body = { name: value.name.trim(), email: value.email.trim() };
    const saved = await run(() => value.kind === "new"
      ? api<SavedContact>("/contacts", "POST", { ...body, accountId: value.accountId })
      : api<SavedContact>(`/contacts/${encodeURIComponent(value.id)}`, "PUT", body), "Contact saved.");
    if (saved) setEditing(null);
  }}>
    {value.kind === "new" && accounts.length > 1 && <div className="settings-row"><span>Account</span>
      <Dropdown label="Account" value={value.accountId} disabled={disabled}
        options={accounts.map((account, index) => ({ value: account.id, label: accountLabel(account, index, privacy, accounts) }))}
        onChange={(accountId) => setEditing({ ...value, accountId })} />
    </div>}
    <PrivateField label="Name" value={value.name} maxLength={200} disabled={disabled} onChange={(name) => setEditing({ ...value, name })} />
    <PrivateField label="Email address" value={value.email} maxLength={320} required disabled={disabled} onChange={(email) => setEditing({ ...value, email })} />
    <div className="settings-row compose-settings-actions">
      <button type="submit" className="button" disabled={disabled}>{saving ? "Saving" : "Save contact"}</button>
      <button type="button" className="button" disabled={disabled} onClick={() => { setEditing(null); setError(""); }}>Cancel</button>
    </div>
  </form>;
  if (!accounts.length) return <p className="muted">Connect an account to save contacts.</p>;
  if (!contacts) return <div className="compose-settings-save">
    {loadError ? <><p role="alert">{loadError}</p><button type="button" className="button" onClick={() => void load()}>Try again</button></> : <p role="status">Loading contacts</p>}
  </div>;
  return <>
    <h2>Saved contacts</h2>
    <div className="settings-group">
      {contacts.saved.map((contact, index) => <Fragment key={contact.id}>
        <div className="account-row contact-row">
          <strong>{contact.name ? <Address value={contact.name} kind="name" /> : <Address value={contact.email} />}</strong>
          {contact.name && <span><Address value={contact.email} /></span>}
          <span>{source(contact.accountId)}</span>
          <button type="button" className="link" disabled={disabled} aria-label={`Edit contact ${index + 1}`}
            onClick={() => { setError(""); setEditing({ kind: "edit", id: contact.id, name: contact.name, email: contact.email }); }}>Edit</button>
          <button type="button" className="link" disabled={disabled} aria-label={`Delete contact ${index + 1}`} onClick={() => {
            if (confirm("Delete this contact from this device?"))
              void run(() => api(`/contacts/${encodeURIComponent(contact.id)}`, "DELETE"), "Contact deleted.");
          }}>Delete</button>
        </div>
        {editing?.kind === "edit" && editing.id === contact.id && form(editing)}
      </Fragment>)}
      {editing?.kind === "new" ? form(editing) : <div className="settings-row compose-settings-actions">
        {!contacts.saved.length && <span className="note">No saved contacts.</span>}
        <button type="button" className="button" disabled={disabled} onClick={() => {
          setError("");
          setEditing({ kind: "new", accountId: accounts[0].id, name: "", email: "" });
        }}>Add contact</button>
      </div>}
    </div>
    <h2>Recent recipients</h2>
    <p className="note">Addresses you sent to from Emc², newest first. Each account keeps its latest 200.</p>
    <div className="settings-group">
      {contacts.recent.map((recipient, index) => <div className="account-row contact-row" key={recipient.id}>
        <strong><Address value={recipient.email} /></strong>
        <span>{source(recipient.accountId)}</span>
        <button type="button" className="link" disabled={disabled} aria-label={`Remove recent recipient ${index + 1}`}
          onClick={() => void run(() => api(`/contacts/recent/${encodeURIComponent(recipient.id)}`, "DELETE"), "Recent recipient removed.")}>Remove</button>
      </div>)}
      {!contacts.recent.length && <div className="settings-row"><span className="note">No recent recipients.</span></div>}
    </div>
    <div className="compose-settings-save">
      {error && <p role="alert">{error}</p>}
      {status && <p role="status">{status}</p>}
    </div>
  </>;
}
