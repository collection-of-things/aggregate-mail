import { Notice, useFeedbackState } from "../ui/Toasts";
import { useContext, useRef, useState } from "react";
import type { ContactImport, ContactImportPreview } from "../../shared/contacts";
import type { Account } from "../../shared/types";
import { ApiError, type Api } from "../api";
import { accountLabel } from "../mail-ui";
import { Dropdown } from "../ui/Dropdown";
import { Address, PrivacyContext } from "../ui/Privacy";

const sources = [
  { value: "google", label: "Google Contacts / Gmail", url: "https://contacts.google.com/", help: "In Google Contacts, select the people to bring over, choose Export, then Google CSV or vCard." },
  { value: "yahoo", label: "Yahoo", url: "https://mail.yahoo.com/", help: "In Yahoo Mail, open Contacts and export your contacts as a CSV file." },
  { value: "outlook", label: "Outlook / Microsoft", url: "https://outlook.live.com/people/", help: "In People, choose Manage contacts, then Export contacts to download a CSV file." },
  { value: "icloud", label: "iCloud / Apple Contacts", url: "https://www.icloud.com/contacts/", help: "In iCloud Contacts, select your contacts and choose Export vCard. Apple Contacts can also export a vCard." },
  { value: "other", label: "Another contacts provider", url: "", help: "Export a UTF-8 vCard (.vcf) or a Google, Yahoo or Outlook-compatible CSV from your address book." },
];

export function ContactImportPanel({ api, accounts, accountFilter, busy, onImported }: {
  api: Api; accounts: readonly Account[]; accountFilter: string; busy: boolean; onImported: () => Promise<unknown>;
}) {
  const { on: privacy } = useContext(PrivacyContext);
  const [provider, setProvider] = useState("google");
  const [accountId, setAccountId] = useState(accounts.some(account => account.id === accountFilter) ? accountFilter : accounts[0]?.id || "");
  const [input, setInput] = useState<ContactImport>();
  const [preview, setPreview] = useState<ContactImportPreview>();
  const [updateNames, setUpdateNames] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useFeedbackState();
  const [status, setStatus] = useFeedbackState("success");
  const lock = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const disabled = busy || pending;
  const source = sources.find(item => item.value === provider)!;
  const reset = () => { setInput(undefined); setPreview(undefined); setUpdateNames(false); setError(""); setStatus(""); if (fileInput.current) fileInput.current.value = ""; };
  const chooseFile = async (file?: File) => {
    if (disabled || lock.current) return;
    reset();
    if (!file) return;
    lock.current = true; setPending(true);
    try {
      if (file.size > 512 * 1024) throw new Error("Choose a contact file no larger than 512 KB.");
      const extension = file.name.split(".").pop()?.toLowerCase();
      if (extension !== "csv" && extension !== "vcf") throw new Error("Choose a CSV or vCard (.vcf) file.");
      const content = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      const value: ContactImport = { accountId, format: extension, content };
      const result = await api<ContactImportPreview>("/contacts/import/preview", "POST", value);
      setInput(value); setPreview(result);
    } catch { setError("Could not preview this file. Use a UTF-8 CSV or vCard, up to 512 KB, 5000 addresses and 1000 saved contacts per account. Existing contacts are unchanged."); }
    finally { lock.current = false; setPending(false); }
  };
  const importFile = async () => {
    if (!input || !preview || (!preview.added && !(updateNames && preview.changed)) || disabled || lock.current || !accounts.some(account => account.id === input.accountId)) return;
    lock.current = true; setPending(true); setError(""); setStatus("");
    try {
      const result = await api<ContactImportPreview>("/contacts/import", "POST", { ...input, revision: preview.revision, ...(updateNames ? { updateNames: true } : {}) });
      reset();
      setStatus(`Added ${result.added}, updated ${result.updated}, skipped ${result.unchanged + result.changed - result.updated} already saved and ${result.skipped} invalid or repeated. None removed.`);
      try { await onImported(); } catch { setError("Import saved, but the contact list could not refresh. Open Saved contacts again to check it."); }
    } catch (failure) {
      // A 409 means the contacts moved since the preview; refresh it so the
      // next confirm sends the new revision instead of retrying the stale one.
      if (failure instanceof ApiError && failure.status === 409) {
        try {
          setPreview(await api<ContactImportPreview>("/contacts/import/preview", "POST", { accountId: input.accountId, format: input.format, content: input.content }));
          setUpdateNames(false);
          setError("Contacts changed since your preview. Review the updated preview before importing.");
        } catch { reset(); setError("Import could not be confirmed. Preview the file again to check what remains; existing contacts are never removed."); }
      } else setError("Import could not be confirmed. Preview the file again to check what remains; existing contacts are never removed.");
    }
    finally { lock.current = false; setPending(false); }
  };
  return <section aria-label="Import contacts">
    <h2>1. Export from your provider</h2>
    <div className="settings-group">
      <div className="settings-row"><span>Import from</span><Dropdown label="Contacts provider" value={provider} options={sources} disabled={disabled} onChange={value => { setProvider(value); reset(); }} /></div>
      <div className="settings-row stacked"><p>{source.help}</p>{source.url && <a className="link" href={source.url} target="_blank" rel="noreferrer">Open {source.label}</a>}</div>
    </div>
    <h2>2. Choose where to save</h2>
    <div className="settings-group"><div className="settings-row"><span>Destination account</span>
      <Dropdown label="Destination account" value={accountId} disabled={disabled} options={accounts.map((account, index) => ({ value: account.id, label: accountLabel(account, index, privacy, accounts) }))}
        onChange={value => { setAccountId(value); reset(); }} />
    </div></div>
    <h2>3. Preview and import</h2>
    <div className="settings-group"><div className="settings-row stacked">
      <input ref={fileInput} type="file" hidden accept=".csv,.vcf,text/csv,text/vcard" disabled={disabled || !accounts.some(account => account.id === accountId)} onChange={event => void chooseFile(event.target.files?.[0])} />
      <button type="button" className="button" disabled={disabled || !accounts.some(account => account.id === accountId)} onClick={() => fileInput.current?.click()}>Choose contact file</button>
      <p className="note">Names and email addresses only. Saved on this device, encrypted with your mail. Existing contacts are never removed; their names change only if you choose to update them. This is a one-time import, not ongoing sync.</p>
      {pending && <p role="status">Processing contacts…</p>}
      {preview && <div className="contact-import-preview">
        <p role="status">{preview.added} new, {preview.changed} with a changed name, {preview.unchanged} unchanged, {preview.missing} not in this file. {preview.skipped} invalid or repeated addresses skipped.</p>
        {!!preview.sample.length && <ul aria-label="Import preview">{preview.sample.map(contact => <li key={contact.email}><Address value={contact.name || contact.email} kind={contact.name ? "name" : "address"} />{contact.name && <> · <Address value={contact.email} /></>}</li>)}</ul>}
        {!!preview.changes.length && <ul aria-label="Changed names">{preview.changes.slice(0, 5).map(change => <li key={change.email}>
          {change.previousName ? <Address value={change.previousName} kind="name" /> : "No name"} → <Address value={change.name} kind="name" /> · <Address value={change.email} />
        </li>)}</ul>}
        {preview.changes.length > 5 && <details className="contact-import-changes"><summary>Show all {preview.changes.length} changed names</summary>
          <ul aria-label="Changed names (all)">{preview.changes.slice(5).map(change => <li key={change.email}>
            {change.previousName ? <Address value={change.previousName} kind="name" /> : "No name"} → <Address value={change.name} kind="name" /> · <Address value={change.email} />
          </li>)}</ul>
        </details>}
        {preview.changed > 0 && <label className="settings-row"><input type="checkbox" checked={updateNames} disabled={disabled} onChange={event => setUpdateNames(event.target.checked)} />
          Update {preview.changed} existing {preview.changed === 1 ? "name" : "names"} from this file
        </label>}
        {preview.missing > 0 && <p className="note">Saved contacts that are missing from the file stay saved.</p>}
        <div className="contacts-actions"><button type="button" className="button" disabled={disabled || (!preview.added && !(updateNames && preview.changed))} onClick={() => void importFile()}>
          {preview.added > 0 && updateNames && preview.changed > 0 ? `Import ${preview.added} and update ${preview.changed}`
            : updateNames && preview.changed > 0 ? `Update ${preview.changed} ${preview.changed === 1 ? "name" : "names"}`
            : `Import ${preview.added} ${preview.added === 1 ? "contact" : "contacts"}`}
        </button><button type="button" className="button" disabled={disabled} onClick={reset}>Cancel import</button></div>
      </div>}
    </div></div>
    {error && <Notice text={error} />}{status && <Notice text={status} kind="success" />}
  </section>;
}
