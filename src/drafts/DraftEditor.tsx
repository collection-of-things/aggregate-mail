import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import type { Account, Draft, DraftAttachment, DraftContent } from "../../shared/types";
import { request } from "../api";
import { BulletsIcon, CloseIcon, LinkIcon, NumbersIcon, PaperclipIcon, QuoteIcon, SignatureIcon, TrashIcon } from "../ui/icons";
import { useOutsidePress, usePresence } from "../ui/presence";

const email = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;
const splitList = (value: string) => value.split(",").map((part) => part.trim()).filter(Boolean);
// The send route's limits: ten files, 512 KiB each, 1 MiB in total.
const maxFiles = 10;
const maxFile = 512 * 1024;
const maxTotal = 1024 * 1024;
const mac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

/** The fields the draft routes accept; ids, revisions and timestamps stay out. */
function content(draft: Draft): DraftContent {
  const { to, cc, subject, body, attachments, inReplyTo, threadId, references, invitation } = draft;
  return { to, subject, body, ...(cc?.length ? { cc } : {}), ...(attachments?.length ? { attachments } : {}), ...(inReplyTo ? { inReplyTo } : {}),
    ...(threadId ? { threadId } : {}), ...(references ? { references } : {}), ...(invitation ? { invitation } : {}) };
}

const decodedSize = (base64: string) => Math.floor(base64.length * 3 / 4) - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
const sizeLabel = (bytes: number) => bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`;

function readFile(file: File): Promise<DraftAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({
      // The send route refuses path separators, colons and control characters.
      filename: file.name.replace(/[\u0000-\u001f\u007f/\\:]/g, "_").slice(0, 255) || "attachment",
      contentType: /^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(file.type) ? file.type : "application/octet-stream",
      content: String(reader.result).split(",")[1] ?? "",
    });
    reader.onerror = () => reject(new Error(`${file.name} could not be read.`));
    reader.readAsDataURL(file);
  });
}

/** Rewrites the whole lines touched by [start, end) in a plain-text body. */
function editLines(text: string, start: number, end: number, transform: (lines: string[]) => string[]) {
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const found = text.indexOf("\n", Math.max(end - (end > start && text[end - 1] === "\n" ? 1 : 0), start));
  const lineEnd = found === -1 ? text.length : found;
  return { from: lineStart, to: lineEnd, text: transform(text.slice(lineStart, lineEnd).split("\n")).join("\n") };
}
const toggleBullets = (lines: string[]) => lines.every((line) => line.startsWith("• ")) ? lines.map((line) => line.slice(2)) : lines.map((line) => `• ${line.replace(/^(• |\d+\. |> )/, "")}`);
const toggleNumbers = (lines: string[]) => lines.every((line) => /^\d+\. /.test(line)) ? lines.map((line) => line.replace(/^\d+\. /, "")) : lines.map((line, index) => `${index + 1}. ${line.replace(/^(• |\d+\. |> )/, "")}`);
const toggleQuote = (lines: string[]) => lines.every((line) => line.startsWith("> ")) ? lines.map((line) => line.slice(2)) : lines.map((line) => `> ${line}`);

type Status = "loading" | "saved" | "saving" | "sending" | "error";

/**
 * Edits one draft. Changes save about 0.7s after typing stops, one save at a
 * time with the latest revision. Sending first marks the draft as having an
 * unknown send status, so a failure part-way never invites a duplicate send;
 * a successful send then deletes the draft.
 */
export function DraftEditor({ id, account, csrf, signature, onSaved, onClose }: {
  id: string;
  account: Account;
  csrf: string;
  signature?: string;
  onSaved: () => void;
  onClose: (message?: string) => void;
}) {
  const url = `/api/accounts/${encodeURIComponent(account.id)}/drafts/${encodeURIComponent(id)}`;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [cc, setCc] = useState("");
  const [showCc, setShowCc] = useState(false);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  // The link form and discard confirmation stay mounted while they animate out.
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkForm, setLinkForm] = useState({ text: "", url: "", from: 0, to: 0 });
  const [confirming, setConfirming] = useState(false);
  const [leaving, setLeaving] = useState<number | null>(null);
  const linkPresence = usePresence(linkOpen, 140);
  const confirmPresence = usePresence(confirming, 140);
  const ccPresence = usePresence(showCc, 200);
  const linkArea = useRef<HTMLDivElement>(null);
  const confirmArea = useRef<HTMLDivElement>(null);
  const linkInput = useRef<HTMLInputElement>(null);
  useOutsidePress(linkOpen, [linkArea], () => setLinkOpen(false));
  useOutsidePress(confirming, [confirmArea], () => setConfirming(false));
  // The link field takes focus as the form opens, even when opened from the keyboard.
  useEffect(() => { if (linkOpen && linkPresence.mounted) linkInput.current?.focus(); }, [linkOpen, linkPresence.mounted]);
  const latest = useRef<Draft | null>(null);
  const revision = useRef(0);
  const dirty = useRef(false);
  const saving = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const toField = useRef<HTMLInputElement>(null);
  const body = useRef<HTMLTextAreaElement>(null);
  const files = useRef<HTMLInputElement>(null);

  useEffect(() => {
    request<Draft>(url)
      .then((loaded) => {
        latest.current = loaded;
        revision.current = loaded.revision;
        setDraft(loaded);
        setCc((loaded.cc ?? []).join(", "));
        setShowCc(!!loaded.cc?.length);
        setStatus("saved");
        // Start where the writing is: the recipient for a new draft, otherwise the end of the text.
        requestAnimationFrame(() => {
          if (!loaded.to) toField.current?.focus();
          else if (body.current) { body.current.focus(); body.current.setSelectionRange(loaded.body.length, loaded.body.length); }
        });
      })
      .catch((reason: Error) => { setError(reason.message); setStatus("error"); });
  }, [url]);

  const flush = async (): Promise<void> => {
    clearTimeout(timer.current);
    if (saving.current) await saving.current;
    if (!dirty.current || !latest.current) return;
    dirty.current = false;
    setStatus("saving");
    let failed = false;
    saving.current = request<Draft>(url, { method: "PUT", csrf, body: { ...content(latest.current), revision: revision.current } })
      .then((saved) => { revision.current = saved.revision; setStatus("saved"); setError(null); onSaved(); })
      .catch((reason: Error) => { failed = true; dirty.current = true; setStatus("error"); setError(reason.message); })
      .finally(() => { saving.current = null; });
    await saving.current;
    if (failed) throw new Error("The draft could not be saved.");
    if (dirty.current) return flush();
  };

  // Save whatever is pending when the editor closes or switches drafts.
  useEffect(() => () => { flush().catch(() => {}); }, []);

  const update = (patch: Partial<Draft>) => {
    if (!latest.current) return;
    latest.current = { ...latest.current, ...patch };
    setDraft(latest.current);
    dirty.current = true;
    setStatus("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { flush().catch(() => {}); }, 700);
  };

  /** Replaces body[from, to) through the browser's editing, so undo still works. */
  const replaceBody = (from: number, to: number, text: string) => {
    const area = body.current;
    if (!area) return;
    area.focus();
    area.setSelectionRange(from, to);
    if (!document.execCommand("insertText", false, text)) {
      update({ body: area.value.slice(0, from) + text + area.value.slice(to) });
      requestAnimationFrame(() => area.setSelectionRange(from + text.length, from + text.length));
    }
  };
  const lines = (transform: (lines: string[]) => string[]) => {
    const area = body.current;
    if (!area) return;
    const edit = editLines(area.value, area.selectionStart, area.selectionEnd, transform);
    replaceBody(edit.from, edit.to, edit.text);
    area.setSelectionRange(edit.from, edit.from + edit.text.length);
  };
  const openLink = () => {
    const area = body.current;
    if (!area) return;
    const from = area.selectionStart;
    const to = area.selectionEnd;
    setLinkForm({ text: area.value.slice(from, to).trim(), url: "", from, to });
    setLinkOpen(true);
  };
  const closeLink = () => { setLinkOpen(false); body.current?.focus(); };
  const insertLink = () => {
    const area = body.current;
    let target = linkForm.url.trim();
    if (!area || !target) return;
    if (!/^(https?:|mailto:)/i.test(target)) target = email.test(target) ? `mailto:${target}` : `https://${target}`;
    const text = area.value;
    const label = linkForm.text.trim();
    // Keep a link from running into the words around it.
    const before = linkForm.from > 0 && !/\s/.test(text[linkForm.from - 1]) ? " " : "";
    const after = linkForm.to < text.length && !/\s/.test(text[linkForm.to]) ? " " : "";
    setLinkOpen(false);
    replaceBody(linkForm.from, linkForm.to, `${before}${label && label !== target ? `${label} (${target})` : target}${after}`);
  };
  const insertSignature = () => {
    if (!signature || !body.current) return;
    const text = body.current.value;
    if (text.includes(signature)) return;
    const end = text.replace(/\s+$/, "").length;
    replaceBody(end, text.length, `${end ? "\n\n" : ""}-- \n${signature}`);
  };
  const attach = async (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = [...(event.target.files ?? [])];
    event.target.value = "";
    const current = latest.current?.attachments ?? [];
    if (current.length + chosen.length > maxFiles) return setError(`Attach up to ${maxFiles} files.`);
    const tooBig = chosen.find((file) => file.size > maxFile);
    if (tooBig) return setError(`${tooBig.name} is larger than 512 KB.`);
    const total = current.reduce((sum, file) => sum + decodedSize(file.content), 0) + chosen.reduce((sum, file) => sum + file.size, 0);
    if (total > maxTotal) return setError("Attachments can add up to 1 MB.");
    try {
      const added = await Promise.all(chosen.map(readFile));
      setError(null);
      update({ attachments: [...current, ...added] });
    } catch (reason) {
      setError((reason as Error).message);
    }
  };
  // The chip shrinks away first, then leaves the draft.
  const removeAttachment = (index: number) => {
    setLeaving(index);
    setTimeout(() => {
      setLeaving(null);
      update({ attachments: (latest.current?.attachments ?? []).filter((_, position) => position !== index) });
    }, 160);
  };
  const removeCc = () => {
    setShowCc(false);
    setCc("");
    update({ cc: [] });
    toField.current?.focus();
  };

  const send = async () => {
    const current = latest.current;
    if (!current || status === "sending" || current.sendUnknown) return;
    const ccList = splitList(cc);
    if (!email.test(current.to.trim())) { setError("Add one valid recipient in To."); toField.current?.focus(); return; }
    if (ccList.some((address) => !email.test(address))) return setError("Check the addresses in Cc.");
    if (!current.body.trim()) { setError("Write a message before sending."); body.current?.focus(); return; }
    setError(null);
    try {
      await flush();
    } catch {
      return;
    }
    setStatus("sending");
    try {
      // Mark first: from here on, a failure leaves the draft flagged instead of sendable twice.
      const marked = await request<Draft>(url, { method: "PUT", csrf, body: { ...content(current), to: current.to.trim(), cc: ccList, sendUnknown: true, revision: revision.current } });
      revision.current = marked.revision;
      latest.current = { ...current, sendUnknown: true };
      const result = await request<{ ok: boolean; warning?: string }>("/api/send", {
        method: "POST", csrf,
        body: { accountId: account.id, to: current.to.trim(), subject: current.subject, body: current.body,
          ...(ccList.length ? { cc: ccList } : {}), ...(current.attachments?.length ? { attachments: current.attachments } : {}),
          ...(current.inReplyTo ? { inReplyTo: current.inReplyTo } : {}), ...(current.references ? { references: current.references } : {}),
          ...(current.threadId ? { threadId: current.threadId } : {}) },
      });
      await request(url, { method: "DELETE", csrf, body: { revision: revision.current, confirmUnknown: true } });
      onClose(result.warning ? `Sent. ${result.warning}` : "Sent.");
    } catch (reason) {
      setStatus("error");
      if (latest.current) setDraft(latest.current);
      setError(latest.current?.sendUnknown
        ? `${(reason as Error).message} The send status is unknown; check Sent before sending again.`
        : (reason as Error).message);
      onSaved();
    }
  };

  const discard = async () => {
    const current = latest.current;
    if (!current) return;
    setConfirming(false);
    clearTimeout(timer.current);
    dirty.current = false;
    if (saving.current) await saving.current;
    try {
      await request(url, { method: "DELETE", csrf, body: { revision: revision.current, ...(current.sendUnknown ? { confirmUnknown: true } : {}) } });
      onClose("Draft discarded.");
    } catch (reason) {
      setStatus("error");
      setError((reason as Error).message);
    }
  };

  const keys = (event: KeyboardEvent) => {
    const command = mac ? event.metaKey : event.ctrlKey;
    if (command && event.key === "Enter") { event.preventDefault(); void send(); }
    else if (command && event.key.toLowerCase() === "k" && event.target === body.current) { event.preventDefault(); openLink(); }
    else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (confirming) setConfirming(false);
      else if (linkOpen) closeLink();
      else onClose();
    }
  };

  if (!draft) return <section className="editor editor-empty">{error ?? "Loading…"}</section>;
  const busy = status === "sending";
  const statusText = error ?? (draft.sendUnknown ? "Send status unknown. Check Sent before sending again."
    : status === "saving" ? "Saving…" : status === "sending" ? "Sending…" : "Saved");
  return (
    <section className="editor" aria-label="Draft" onKeyDown={keys}>
      <header className="editor-head">
        <span key={statusText} className={`editor-status ${error || draft.sendUnknown ? "error" : status}`} role="status">{statusText}</span>
        <div ref={confirmArea} className="popover-anchor">
          <button type="button" className={confirming ? "icon-button active" : "icon-button"} title="Discard draft" aria-label="Discard draft"
            aria-expanded={confirming} disabled={busy} onClick={() => setConfirming(!confirming)}><TrashIcon /></button>
          {confirmPresence.mounted && (
            <div className={`popover confirm-popover${confirmPresence.closing ? " closing" : ""}`} role="alertdialog" aria-labelledby="discard-title">
              <p id="discard-title" className="popover-title">Discard this draft?</p>
              <p className="popover-text">{draft.sendUnknown ? "It may already have been sent. Check Sent first." : "It will be deleted from this device. This can't be undone."}</p>
              <div className="popover-actions">
                <button type="button" className="popover-button" onClick={() => setConfirming(false)}>Cancel</button>
                <button type="button" className="popover-button danger" autoFocus onClick={() => void discard()}>Discard</button>
              </div>
            </div>
          )}
        </div>
        <button type="button" className="icon-button" title="Close (Esc)" aria-label="Close" onClick={() => onClose()}><CloseIcon /></button>
      </header>
      <div className="editor-field">
        <span className="editor-label">From</span>
        <span className="editor-from"><strong>{account.name || account.email}</strong>{account.name && <span>{account.email}</span>}</span>
      </div>
      <label className="editor-field">
        <span className="editor-label">To</span>
        <input ref={toField} value={draft.to} disabled={busy} spellCheck={false} autoComplete="off"
          onChange={(event) => update({ to: event.target.value })} placeholder="Recipient" />
        <button type="button" className={showCc ? "editor-cc-toggle hidden" : "editor-cc-toggle"} tabIndex={showCc ? -1 : 0}
          aria-hidden={showCc} onClick={() => setShowCc(true)}>Cc</button>
      </label>
      {ccPresence.mounted && (
        <label className={`editor-field editor-cc${ccPresence.closing ? " closing" : ""}`}>
          <span className="editor-label">Cc</span>
          <input value={cc} disabled={busy} spellCheck={false} autoComplete="off" placeholder="Separate addresses with commas" autoFocus={!cc && !ccPresence.closing}
            onChange={(event) => { setCc(event.target.value); update({ cc: splitList(event.target.value) }); }} />
          <button type="button" className="field-remove" title="Remove Cc" aria-label="Remove Cc" disabled={busy} onClick={removeCc}><CloseIcon /></button>
        </label>
      )}
      <label className="editor-field editor-subject">
        <span className="editor-label">Subject</span>
        <input value={draft.subject} disabled={busy} onChange={(event) => update({ subject: event.target.value })} placeholder="What's it about?" />
      </label>
      <div className="editor-tools" role="toolbar" aria-label="Formatting">
        <button type="button" className="icon-button" title="Attach files" aria-label="Attach files" disabled={busy} onClick={() => files.current?.click()}><PaperclipIcon /></button>
        <input ref={files} type="file" multiple hidden onChange={(event) => void attach(event)} />
        <span className="editor-tools-divider" />
        <div ref={linkArea} className="popover-anchor">
          <button type="button" className={linkOpen ? "icon-button active" : "icon-button"} title={`Add link (${mac ? "⌘" : "Ctrl+"}K)`} aria-label="Add link"
            aria-expanded={linkOpen} disabled={busy} onClick={() => linkOpen ? closeLink() : openLink()}><LinkIcon /></button>
          {linkPresence.mounted && (
            <form className={`popover link-popover${linkPresence.closing ? " closing" : ""}`} aria-label="Add link"
              onSubmit={(event) => { event.preventDefault(); insertLink(); }}>
              <p className="popover-title">Add link</p>
              <label className="popover-field">
                <span>Text</span>
                <input value={linkForm.text} onChange={(event) => setLinkForm({ ...linkForm, text: event.target.value })} placeholder="Shown in the message (optional)" />
              </label>
              <label className="popover-field">
                <span>Link</span>
                <input ref={linkInput} value={linkForm.url} onChange={(event) => setLinkForm({ ...linkForm, url: event.target.value })}
                  placeholder="example.com or name@example.com" spellCheck={false} inputMode="url" />
              </label>
              <div className="popover-actions">
                <span className="popover-hint">↵ to add</span>
                <button type="button" className="popover-button" onClick={closeLink}>Cancel</button>
                <button type="submit" className="popover-button primary" disabled={!linkForm.url.trim()}>Add link</button>
              </div>
            </form>
          )}
        </div>
        <button type="button" className="icon-button" title="Bulleted list" aria-label="Bulleted list" disabled={busy} onClick={() => lines(toggleBullets)}><BulletsIcon /></button>
        <button type="button" className="icon-button" title="Numbered list" aria-label="Numbered list" disabled={busy} onClick={() => lines(toggleNumbers)}><NumbersIcon /></button>
        <button type="button" className="icon-button" title="Quote" aria-label="Quote" disabled={busy} onClick={() => lines(toggleQuote)}><QuoteIcon /></button>
        <span className="editor-tools-divider" />
        <button type="button" className="icon-button" title={signature ? "Insert signature" : "No signature for this account yet"} aria-label="Insert signature"
          disabled={busy || !signature} onClick={insertSignature}><SignatureIcon /></button>
      </div>
      <textarea ref={body} className="editor-body" value={draft.body} disabled={busy} aria-label="Message"
        onChange={(event) => update({ body: event.target.value })} placeholder="Write your message…" />
      {!!draft.attachments?.length && (
        <ul className="editor-attachments" aria-label="Attachments">
          {draft.attachments.map((file, index) => (
            <li key={`${file.filename}:${index}`} className={index === leaving ? "attachment-chip leaving" : "attachment-chip"}>
              <PaperclipIcon />
              <span className="attachment-name">{file.filename}</span>
              <span className="attachment-size">{sizeLabel(decodedSize(file.content))}</span>
              <button type="button" aria-label={`Remove ${file.filename}`} disabled={busy || leaving !== null} onClick={() => removeAttachment(index)}><CloseIcon /></button>
            </li>
          ))}
        </ul>
      )}
      <footer className="editor-foot">
        <span className="editor-hint">{mac ? "⌘" : "Ctrl"} Enter to send · Esc to close</span>
        <button type="button" className="blue-button send-button" disabled={busy || draft.sendUnknown} onClick={() => void send()}>
          {busy ? "Sending…" : "Send"}
        </button>
      </footer>
    </section>
  );
}
