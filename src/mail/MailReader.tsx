import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Account, Mail, MailBodyResponse, MailSummary } from "../../shared/types";
import { request } from "../api";
import { ArchiveIcon, CloseIcon, DownloadIcon, PinIcon, ReplyIcon, SnoozeIcon, TrackIcon, TrashIcon } from "../ui/icons";
import { useOutsidePress, usePresence } from "../ui/presence";
import { fullDate } from "../ui/time";
import { initial } from "./format";

type Menu = "snooze" | "track" | "trash" | null;

/** Snooze choices: a few hours, tomorrow morning, the weekend and next week. */
function snoozeChoices(now = new Date()) {
  const at = (days: number, hour: number) => { const date = new Date(now); date.setDate(date.getDate() + days); date.setHours(hour, 0, 0, 0); return date.getTime(); };
  const toSaturday = (6 - now.getDay() + 7) % 7 || 7;
  const toMonday = (8 - now.getDay()) % 7 || 7;
  return [
    { label: "Later today", until: now.getTime() + 3 * 3600000 },
    { label: "Tomorrow", until: at(1, 9) },
    { label: "This weekend", until: at(toSaturday, 9) },
    { label: "Next week", until: at(toMonday, 9) },
  ];
}
const whenLabel = (time: number) => new Date(time).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });

/** A header button that opens a small card below it, animated in and out. */
function MenuButton({ open, label, icon, align = "right", disabled, onToggle, onClose, children }: {
  open: boolean; label: string; icon: ReactNode; align?: "left" | "right"; disabled?: boolean;
  onToggle: () => void; onClose: () => void; children: ReactNode;
}) {
  const area = useRef<HTMLDivElement>(null);
  const presence = usePresence(open, 140);
  useOutsidePress(open, [area], onClose);
  return (
    <div ref={area} className="popover-anchor">
      <button type="button" className={open ? "icon-button active" : "icon-button"} title={label} aria-label={label} aria-expanded={open} disabled={disabled} onClick={onToggle}>{icon}</button>
      {presence.mounted && <div className={`popover menu-popover ${align}${presence.closing ? " closing" : ""}`}>{children}</div>}
    </div>
  );
}

/**
 * The opened email: actions in the header, then sender, recipients, the plain
 * text body and attachments. Unread mail is marked read once its body loads,
 * since marking read changes the version the body route checks.
 */
export function MailReader({ mail, account, csrf, onChanged, onReply, onLeaving, onClose }: {
  mail: MailSummary;
  account?: Account;
  csrf: string;
  onChanged: () => Promise<void> | void;
  onReply: (mail: MailSummary) => Promise<void>;
  // Called before an action that removes the email from its list.
  onLeaving: () => void;
  // `left` is true when the email left the list, so the next one can open.
  onClose: (message?: string, left?: boolean) => void;
}) {
  const [body, setBody] = useState<Mail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [busy, setBusy] = useState(false);
  const [track, setTrack] = useState({ status: "needs-reply", text: mail.subject || "Follow up" });

  useEffect(() => {
    let current = true;
    const query = new URLSearchParams({ accountId: mail.accountId, contentVersion: mail.contentVersion });
    request<MailBodyResponse>(`/api/messages/${encodeURIComponent(mail.id)}/body?${query}`)
      .then(async (data) => {
        if (!current) return;
        setBody(data.mail);
        if (mail.unread && mail.direction !== "sent") {
          await request(`/api/messages/${encodeURIComponent(mail.id)}`, { method: "PATCH", csrf, body: { action: "read" } }).catch(() => {});
          await onChanged();
        }
      })
      .catch((reason: Error) => { if (current && !body) setError(reason.message); });
    return () => { current = false; };
  }, [mail.id]);

  const act = async (action: string, message: string, extra: Record<string, unknown> = {}, close = true) => {
    setMenu(null);
    setBusy(true);
    if (close) onLeaving();
    try {
      await request(`/api/messages/${encodeURIComponent(mail.id)}`, { method: "PATCH", csrf, body: { action, ...extra } });
      await onChanged();
      if (close) onClose(message, true);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const addToToday = async () => {
    setMenu(null);
    try {
      await request("/api/commitments", { method: "POST", csrf, body: { accountId: mail.accountId, sourceMailId: mail.id, text: track.text.trim() || mail.subject || "Follow up", reason: "Added from an email.", status: track.status } });
      onClose("Added to Today.");
    } catch (reason) {
      setError((reason as Error).message);
    }
  };
  const reply = async () => {
    setBusy(true);
    try { await onReply(mail); } catch (reason) { setError((reason as Error).message); setBusy(false); }
  };
  const keys = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    if (menu) setMenu(null); else onClose();
  };

  const isSent = mail.direction === "sent";
  const snoozed = !!mail.snoozedUntil && mail.snoozedUntil > Date.now();
  const toggle = (name: Exclude<Menu, null>) => setMenu(menu === name ? null : name);
  return (
    <section className="reader" aria-label="Email" onKeyDown={keys} tabIndex={-1}>
      <header className="reader-head">
        {!isSent && <button type="button" className="icon-button" title="Reply" aria-label="Reply" disabled={busy} onClick={() => void reply()}><ReplyIcon /></button>}
        <MenuButton open={menu === "track"} label="Add to Today" icon={<TrackIcon />} align="left" disabled={busy} onToggle={() => toggle("track")} onClose={() => setMenu(null)}>
          <form onSubmit={(event) => { event.preventDefault(); void addToToday(); }}>
            <p className="popover-title">Add to Today</p>
            <div className="segmented" role="radiogroup" aria-label="List">
              {[["needs-reply", "Needs reply"], ["needs-work", "Needs work"], ["waiting", "Waiting"]].map(([id, label]) => (
                <button key={id} type="button" role="radio" aria-checked={track.status === id} className={track.status === id ? "active" : ""} onClick={() => setTrack({ ...track, status: id })}>{label}</button>
              ))}
            </div>
            <label className="popover-field"><span>Task</span><input autoFocus value={track.text} onChange={(event) => setTrack({ ...track, text: event.target.value })} /></label>
            <div className="popover-actions">
              <button type="button" className="popover-button" onClick={() => setMenu(null)}>Cancel</button>
              <button type="submit" className="popover-button primary">Add</button>
            </div>
          </form>
        </MenuButton>
        {!isSent && (snoozed
          ? <button type="button" className="icon-button" title="Unsnooze" aria-label="Unsnooze" disabled={busy} onClick={() => void act("unsnooze", "Back in Inbox.")}><SnoozeIcon /></button>
          : <MenuButton open={menu === "snooze"} label="Snooze" icon={<SnoozeIcon />} align="left" disabled={busy} onToggle={() => toggle("snooze")} onClose={() => setMenu(null)}>
            <p className="popover-title">Snooze until</p>
            <div className="menu-list">
              {snoozeChoices().map((choice) => (
                <button key={choice.label} type="button" onClick={() => void act("snooze", `Snoozed until ${whenLabel(choice.until)}.`, { until: choice.until })}>
                  <span>{choice.label}</span><span className="menu-meta">{whenLabel(choice.until)}</span>
                </button>
              ))}
            </div>
          </MenuButton>)}
        {!isSent && !mail.archived && <button type="button" className="icon-button" title="Archive" aria-label="Archive" disabled={busy} onClick={() => void act("archive", "Archived.")}><ArchiveIcon /></button>}
        <button type="button" className={mail.pinned ? "icon-button pinned" : "icon-button"} title={mail.pinned ? "Unpin" : "Pin"} aria-label={mail.pinned ? "Unpin" : "Pin"} aria-pressed={!!mail.pinned}
          disabled={busy} onClick={() => void act(mail.pinned ? "unpin" : "pin", "", {}, false)}><PinIcon /></button>
        {!isSent && (
          <MenuButton open={menu === "trash"} label="Move to Trash" icon={<TrashIcon />} disabled={busy} onToggle={() => toggle("trash")} onClose={() => setMenu(null)}>
            <p className="popover-title">Move to Trash?</p>
            <p className="popover-text">It moves to your provider's Trash and leaves this list.</p>
            <div className="popover-actions">
              <button type="button" className="popover-button" onClick={() => setMenu(null)}>Cancel</button>
              <button type="button" className="popover-button danger" autoFocus onClick={() => void act("trash", "Moved to Trash.")}>Move to Trash</button>
            </div>
          </MenuButton>
        )}
        <span className="reader-head-space" />
        <button type="button" className="icon-button" title="Close (Esc)" aria-label="Close" onClick={() => onClose()}><CloseIcon /></button>
      </header>
      <div className="reader-scroll">
        <h1 className="reader-subject">{mail.subject || "(no subject)"}</h1>
        <div className="reader-from">
          <span className="avatar large" aria-hidden="true">{initial(mail)}</span>
          <span className="reader-people">
            <span><strong>{isSent ? account?.name || account?.email : mail.sender || mail.address}</strong> <span className="muted">{isSent ? account?.email : mail.address}</span></span>
            <span className="muted">To {mail.to}{mail.cc ? `, Cc ${mail.cc}` : ""}</span>
          </span>
          <time className="muted">{fullDate(mail.date)}</time>
        </div>
        {error ? <p className="reader-note error">{error}</p>
          : !body ? <p className="reader-note">Loading…</p>
          : <div className="reader-body">{body.body || body.preview || "This email has no text."}</div>}
        {!!mail.attachments?.length && (
          <ul className="reader-attachments" aria-label="Attachments">
            {mail.attachments.map((file) => (
              <li key={file.id}>
                <a className="attachment-chip" href={`/api/messages/${encodeURIComponent(mail.id)}/attachments/${encodeURIComponent(file.id)}`} download={file.filename}>
                  <DownloadIcon /><span className="attachment-name">{file.filename}</span>
                  <span className="attachment-size">{Math.max(1, Math.round(file.size / 1024))} KB</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
