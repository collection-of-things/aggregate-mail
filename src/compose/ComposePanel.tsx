import { RichBody } from "./RichBody";
import { useContext, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Account, Mail } from "../../shared/types";
import { emptyComposePreferences, type ComposePreferences } from "../../shared/mail-features";
import { MailPrivacy, PrivacyContext, Redact } from "../ui/Privacy";
import { accountLabel } from "../mail-ui";
import { Dialog } from "../ui/Dialog";
import { Dropdown } from "../ui/Dropdown";
import type { Api } from "../api";
import { ReaderContent } from "../mail/MessageContent";
import { mailBodyKey } from "../mail-body";
import { changeComposeAccount, ComposePreferenceControls } from "./ComposePreferences";
import type { Compose, DraftProgress } from "./draft-session";
import { Paperclip, Trash } from "../ui/icons";
import { RecipientInput } from "./RecipientInput";

export type { Compose } from "./draft-session";
export const unknownSendNotice =
  "Send status unknown. This message may already have been sent. Sending again may send a duplicate.";

export async function sendCompose(
  draft: Compose,
  { lock, prepare, send, complete, reload, setDraft, setBusy, setNotice, confirm }: {
    lock: { current: boolean };
    prepare: () => Promise<void>;
    send: (draft: Compose) => Promise<{ ok?: boolean; warning?: string }>;
    complete: () => Promise<void>;
    reload: () => Promise<unknown>;
    setDraft: Dispatch<SetStateAction<Compose | null>>;
    setBusy: (busy: boolean) => void;
    setNotice: (notice: string) => void;
    confirm: (message: string) => boolean;
  },
) {
  if (lock.current) return;
  if (
    draft.sendUnknown &&
    !confirm("This message may already have been sent. Sending again may send a duplicate. Send again?")
  )
    return;
  lock.current = true;
  setBusy(true);
  try {
    try {
      await prepare();
    } catch {
      setNotice("Draft save could not be confirmed. No send was attempted. Keep this window open and check the draft save status.");
      return;
    }
    let result: { warning?: string };
    try {
      const accepted = await send(draft);
      if (accepted.ok !== true) throw new Error("Unconfirmed send");
      result = accepted;
    } catch {
      setDraft((current) => current ? { ...current, sendUnknown: true } : current);
      setNotice(unknownSendNotice);
      return;
    }
    let sentNotice = result.warning || "Email sent.";
    try {
      await complete();
    } catch {
      sentNotice += "\nSaved draft cleanup could not be confirmed. A recovered copy may remain. Do not resend.";
    }
    setDraft(null);
    setNotice(sentNotice);
    try {
      await reload();
    } catch {
      setNotice(`${sentNotice}\nInbox refresh failed. Refresh the inbox separately.`);
    }
  } finally {
    lock.current = false;
    setBusy(false);
  }
}
export function ComposePanel({
  draft,
  setDraft,
  accounts,
  busy,
  onClose,
  onDiscard,
  onRetry,
  onSaveCopy,
  progress,
  onSend,
  preferences = emptyComposePreferences,
  onAttachmentTask,
  source,
  api,
}: {
  draft: Compose;
  source?: Mail;
  api?: Api;
  setDraft: (value: Compose) => void;
  accounts: Account[];
  busy: boolean;
  onClose: () => void;
  onDiscard: () => void;
  onRetry: () => void;
  onSaveCopy: () => void;
  progress: DraftProgress;
  onSend: () => void;
  preferences?: ComposePreferences;
  onAttachmentTask?: (task: Promise<void>) => void;
}) {
  const { on: privacy } = useContext(PrivacyContext);
  const sourceKey = useMemo(() => mailBodyKey(source), [source]);
  const footerActions = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const row = footerActions.current;
    const app = row?.closest<HTMLElement>(".app");
    if (!row || !app) return;
    const measure = () => {
      const height = `${Math.max(42, Math.ceil(row.getBoundingClientRect().height + 12))}px`;
      if (app.style.getPropertyValue("--app-footer-height") !== height) app.style.setProperty("--app-footer-height", height);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(row);
    return () => { observer?.disconnect(); app.style.removeProperty("--app-footer-height"); };
  }, []);

  const [attachmentError, setAttachmentError] = useState("");
  const [loadingFiles, setLoadingFiles] = useState(false);
  const filesBusy = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [showCc, setShowCc] = useState(false);
  const ccVisible = showCc || Boolean(draft.cc?.some((address) => address.trim()));
  const addFiles = async (files: File[]) => {
    if (!files.length || busy || filesBusy.current) return;
    if (files.some((file) => file.size > 524288 || !file.name || file.name.length > 255 || /[\u0000-\u001f\u007f/\\:]/.test(file.name) || file.name === "." || file.name === "..") || files.reduce((sum, file) => sum + file.size, 0) + (draft.attachments || []).reduce((sum, file) => sum + file.content.length * 3 / 4, 0) > 1048576 || files.length + (draft.attachments?.length || 0) > 10) {
      setAttachmentError("Choose up to 10 files with safe filenames, at most 512 KiB each and 1 MiB total."); return;
    }
    filesBusy.current = true; setLoadingFiles(true); setAttachmentError("");
    const task = (async () => { try {
      const attachments = await Promise.all(files.map((file) => new Promise<{ filename: string; contentType: string; content: string }>((resolve, reject) => {
        const reader = new FileReader(); reader.onerror = () => reject(new Error());
        reader.onload = () => resolve({ filename: file.name, contentType: file.type || "application/octet-stream", content: String(reader.result).split(",")[1] });
        reader.readAsDataURL(file);
      })));
      setDraft({ ...draft, attachments: [...(draft.attachments || []), ...attachments] });
    } catch { setAttachmentError("Attachment could not be read. Choose it again."); throw new Error("Attachment read failed"); }
    finally { filesBusy.current = false; setLoadingFiles(false); } })();
    onAttachmentTask?.(task); await task.catch(() => {});
  };
  return (
    <Dialog
      toolbarAccess
      actions={<button type="button" className="compose-discard" title="Delete draft" aria-label="Delete draft" disabled={busy || loadingFiles} onClick={() => {
            if (confirm(draft.sendUnknown
              ? "Discard this saved draft? This message may already have been sent."
              : "Discard this draft from this device?")) onDiscard();
          }}><Trash size={15} color="currentColor" /><span>Delete draft</span></button>}
      title={source || draft.inReplyTo ? "Reply" : "New message"}
      className={source ? "compose-dialog compose-with-context" : "compose-dialog"}
      onClose={() => { if (!busy && !loadingFiles) onClose(); }}
    >
      <div className={source ? "compose-layout compose-reply-layout" : "compose-layout"}>
      {source && <MailPrivacy mail={source}><aside className="compose-context" aria-label="Original email" tabIndex={0}>
        <span className="compose-context-label">Replying to</span>
        <h3><Redact text={source.subject || "No subject"} /></h3>
        <p><Redact text={source.sender} /> · {new Date(source.date).toLocaleDateString()}</p>
        <div className="compose-context-body"><ReaderContent key={sourceKey} mail={{ ...source, body: source.body || source.preview || "No message text in cache." }}
          loadContent={api ? (id) => api(`/messages/${encodeURIComponent(id)}/content`, "POST") : undefined}
          loadImages={(id) => api ? api(`/messages/${encodeURIComponent(id)}/images`, "POST") : Promise.reject(new Error("Images unavailable"))} /></div>
      </aside></MailPrivacy>}
      <form
        className={`compose-form${dragging ? " dragging-files" : ""}`}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.dataTransfer.dropEffect = busy || loadingFiles ? "none" : "copy"; setDragging(!busy && !loadingFiles); }
        }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
        onDrop={(event) => { event.preventDefault(); setDragging(false); void addFiles(Array.from(event.dataTransfer.files)); }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!e.currentTarget.reportValidity()) return;
          if (!draft.body) { e.currentTarget.querySelector<HTMLElement>('[aria-label="Message body"]')?.focus(); return; }
          onSend();
        }}
      >
        <div className="compose-scroll">
        {draft.invitation && <p className="compose-invitation-note" role="status">Review {draft.invitation.method === "REPLY" ? "your calendar response" : draft.invitation.method === "CANCEL" ? "this cancellation" : "this invitation"}. Calendar details and recipients are fixed. Nothing is sent until you press Send.</p>}
        <div className="compose-envelope">
          <div className="compose-from-row">
          <div className="compose-from-field">
            <span>From</span>
            <Dropdown
              label="From"
              value={draft.accountId}
              disabled={!!draft.invitation || busy || loadingFiles || progress.phase === "saving" || progress.phase === "error"}
              options={accounts.map((account, index) => ({
                value: account.id,
                label: privacy ? accountLabel(account, index, true) : account.name ? `${account.name} · ${account.email}` : account.email,
              }))}
              onChange={(accountId) => {
                try { setDraft(changeComposeAccount(draft, accountId, preferences)); }
                catch { setAttachmentError("Unable to update the signature without changing your message. Your text is unchanged."); }
              }}
            />
          </div>

          </div>
          <div className="compose-to-row">
            <RecipientInput label="To" required value={draft.to} accountId={draft.accountId} accounts={accounts} api={api}
              disabled={!!draft.invitation || busy || loadingFiles}
              onChange={(to) => setDraft({ ...draft, to })} />
            {!ccVisible && <button className="compose-cc-toggle" type="button" disabled={busy || loadingFiles}
              aria-label="Add Cc recipients" aria-expanded={false} onClick={() => setShowCc(true)}>Cc</button>}
          </div>
          {ccVisible && <RecipientInput label="Cc" multiple autoFocus={showCc} value={(draft.cc || []).join(", ")}
            accountId={draft.accountId} accounts={accounts} api={api} disabled={!!draft.invitation || busy || loadingFiles}
            onChange={(cc) => setDraft({ ...draft, cc: cc.split(",") })} />}
          <label className="compose-subject">
            <span>Subject</span>
            <input
              disabled={busy || loadingFiles}
              value={draft.subject}
              maxLength={998}
              onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
            />
          </label>
        </div>
        <div className="compose-toolbar">
          <label className="compose-file-action" aria-disabled={busy || loadingFiles}>
            <Paperclip size={15} color="currentColor" /><span>Attach files</span>
            <input aria-label="Attach files" aria-describedby="compose-attachment-limits" type="file" multiple disabled={busy || loadingFiles} onChange={(event) => {
              const files = Array.from(event.target.files || []);
              event.target.value = "";
              void addFiles(files);
            }} />
          </label>
          <span id="compose-attachment-limits" className="compose-attachment-limits">Up to 10 files · 512 KiB each · 1 MiB total</span>
        </div>
        <RichBody draft={draft} disabled={busy || loadingFiles} onChange={setDraft} />
        <div className="compose-extras">
          {(draft.attachments || []).map((file, index) => <p className="compose-attachment" key={index}><Redact text={file.filename} /> <button type="button" disabled={busy || loadingFiles} aria-label={`Remove attachment ${index + 1}`} onClick={() => setDraft({ ...draft, attachments: draft.attachments?.filter((_, i) => i !== index) })}>Remove</button></p>)}
          {attachmentError && <p role="alert">{attachmentError}</p>}
          {loadingFiles && <p role="status">Reading attachments…</p>}
          <ComposePreferenceControls draft={draft} preferences={preferences} busy={busy || loadingFiles} onChange={setDraft} />
        </div>
        {draft.sendUnknown && (
          <p className="dialog-copy" role="status">{unknownSendNotice}</p>
        )}
        </div>
        <div className="compose-footer">
          {progress.phase === "error" && (
            <div className="draft-recovery-actions">
              <button type="button" disabled={busy || loadingFiles} onClick={onRetry}>Retry save</button>
              <button type="button" disabled={busy || loadingFiles} onClick={onSaveCopy}>Save separate copy</button>
            </div>
          )}
          <div className="compose-actions" ref={footerActions}>
            <button type="button" disabled={busy || loadingFiles} onClick={onClose}>Keep draft</button>
            <p className={`compose-save-status${progress.phase === "error" ? " save-error" : ""}`} role="status">{progress.message}</p>
            <button className="button primary-button compose-send" disabled={busy || loadingFiles || progress.phase === "error"} type="submit">
              {busy ? "Please wait" : "Send"}
            </button>
          </div>

        </div>
      </form>
      </div>
    </Dialog>
  );
}
