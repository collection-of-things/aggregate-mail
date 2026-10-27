import { Fragment, useContext, useEffect, useRef, useState } from "react";
import type { ContactList, SavedContact } from "../../shared/contacts";
import type { Account } from "../../shared/types";
import type { Api } from "../api";
import { accountLabel } from "../mail-ui";
import { Dropdown } from "../ui/Dropdown";
import { Address, PrivacyContext } from "../ui/Privacy";
import { PrivateField } from "../settings/ComposeSettings";
import { ContactImportPanel } from "./ContactImportPanel";

type Editing = { kind: "new"; accountId: string; name: string; email: string } | { kind: "edit"; id: string; name: string; email: string };

// Lists, adds, edits and deletes saved contacts, and removes recent recipients.
export function ContactsPage({ api, accounts, accountFilter = "all", busy = false }: { api: Api; accounts: readonly Account[]; accountFilter?: string; busy?: boolean }) {
  return <ContactsContent key={JSON.stringify(accounts.map(account => account.id).sort())} api={api} accounts={accounts} accountFilter={accountFilter} busy={busy} />;
}

function ContactsContent({ api, accounts, accountFilter, busy }: { api: Api; accounts: readonly Account[]; accountFilter: string; busy: boolean }) {
  const { on: privacy } = useContext(PrivacyContext);
  const [contacts, setContacts] = useState<ContactList | null>(null);
  const [loadError, setLoadError] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [section, setSection] = useState<"saved" | "recent" | "import">("saved");
  const [search, setSearch] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const lock = useRef(false);
  const disabled = busy || saving;
  const inAccount = (item: { accountId: string }) => accounts.some(account => account.id === item.accountId) && (accountFilter === "all" || item.accountId === accountFilter);
  const matches = (item: { email: string; name?: string }) => !search.trim() || `${item.name || ""} ${item.email}`.toLowerCase().includes(search.trim().toLowerCase());
  const load = async () => {
    setLoadError("");
    try { setContacts(await api<ContactList>("/contacts")); }
    catch { setLoadError("Could not load contacts."); }
  };
  useEffect(() => { void load(); }, []);
  const run = async (task: () => Promise<unknown>, done: string) => {
    if (disabled || lock.current) return false;
    lock.current = true;
    setSaving(true); setError(""); setStatus("");
    try {
      await task();
      setStatus(done);
      await load();
      return true;
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : "Could not update contacts. Try again.");
      return false;
    } finally { lock.current = false; setSaving(false); }
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
  const sections = [{ id: "saved", label: "Saved contacts" }, { id: "recent", label: "Recent recipients" }, { id: "import", label: "Import contacts" }] as const;
  const descriptions = { saved: "People you save or import. Available when you address a message.", recent: "People you have emailed from Emc². Each account keeps its latest 200.", import: "Bring your address book from another service. No developer account or paid service needed." };
  return <main className="settings contacts-page" aria-label="Contacts">
    <label className="settings-mobile-navigation"><span>Contacts section</span><select aria-label="Contacts section" value={section} disabled={disabled}
      onChange={event => { setSection(event.target.value as typeof section); setEditing(null); setError(""); setStatus(""); }}>
      {sections.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
    </select></label>
    <nav className="settings-navigation" aria-label="Contacts sections">
      <div className="settings-navigation-group">
        <span className="settings-rail-label">Contacts</span>
        {sections.map(item => <button key={item.id} type="button" aria-current={section === item.id ? "page" : undefined}
          disabled={disabled} onClick={() => { setSection(item.id); setEditing(null); setError(""); setStatus(""); }}>{item.label}</button>)}
      </div>
    </nav>
    <div className="settings-column">
      <header className="settings-section-heading"><span className="settings-section-context">Address book</span><h1>{sections.find(item => item.id === section)!.label}</h1><p>{descriptions[section]}</p></header>
      {section !== "import" && <label className="contacts-search"><span className="visually-hidden">Find contacts</span><input type="search" placeholder="Find a name or email" value={privacy && !searchFocused ? "" : search} onFocus={() => setSearchFocused(true)} onBlur={() => setSearchFocused(false)} onChange={event => setSearch(event.target.value)} /></label>}
      {section === "import" && <ContactImportPanel key={accountFilter} api={api} accounts={accounts} accountFilter={accountFilter} busy={disabled} onImported={load} />}
      {section === "saved" && <section>
    <h2>Saved contacts</h2>
    <div className="settings-group">
      {contacts.saved.filter(inAccount).filter(matches).map((contact, index) => <Fragment key={contact.id}>
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
          setEditing({ kind: "new", accountId: accounts.some(account => account.id === accountFilter) ? accountFilter : accounts[0].id, name: "", email: "" });
        }}>Add contact</button>
      </div>}
    </div>
    {contacts.saved.length > 0 && !contacts.saved.filter(inAccount).filter(matches).length && <p className="note">No contacts match this view.</p>}
    </section>}
    {section === "recent" && <section>
    <h2>Recent recipients</h2>
    <div className="settings-group">
      {contacts.recent.filter(inAccount).filter(matches).map((recipient, index) => <div className="account-row contact-row" key={recipient.id}>
        <strong><Address value={recipient.email} /></strong>
        <span>{source(recipient.accountId)}</span>
        <button type="button" className="link" disabled={disabled} aria-label={`Remove recent recipient ${index + 1}`}
          onClick={() => void run(() => api(`/contacts/recent/${encodeURIComponent(recipient.id)}`, "DELETE"), "Recent recipient removed.")}>Remove</button>
      </div>)}
      {!contacts.recent.length && <div className="settings-row"><span className="note">No recent recipients.</span></div>}
    </div>
    {contacts.recent.length > 0 && !contacts.recent.filter(inAccount).filter(matches).length && <p className="note">No recent recipients match this view.</p>}
    </section>}
    <div className="compose-settings-save">
      {loadError && <p role="alert">{loadError} <button type="button" className="link" onClick={() => void load()}>Try again</button></p>}
      {error && <p role="alert">{error}</p>}
      {status && <p role="status">{status}</p>}
    </div>
    </div>
  </main>;
}
