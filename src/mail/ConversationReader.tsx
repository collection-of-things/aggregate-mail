import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import type { RendererMail as Mail } from "../../shared/types";
import type { Conversation } from "../../shared/workspace";
import type { Api } from "../api";
import { MailPrivacy, Redact } from "../ui/Privacy";

type Props = {
  mail: Mail; gmail: boolean; api: Api; busy: boolean;
  onChanged: () => Promise<unknown>; onSelect: (mail: Mail) => void;
  renderMessage: (mail: Mail) => ReactNode;
  onMenu?: (event: MouseEvent<HTMLElement>, mail: Mail) => void;
  onMenuKey?: (event: KeyboardEvent<HTMLElement>, mail: Mail) => void;
};

// Validate the fields consumed by the reader before accepting untrusted response data.
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object";
function validMessage(value: unknown, accountId: string): value is Mail {
  if (!record(value) || value.accountId !== accountId) return false;
  const strings = ["id", "remoteId", "sender", "address", "to", "subject", "preview", "body", "reason"];
  if (!strings.every(key => typeof value[key] === "string") || !value.id) return false;
  if (typeof value.date !== "number" || !Number.isFinite(value.date) || Math.abs(value.date) > 8.64e15 ||
    typeof value.unread !== "boolean" || typeof value.archived !== "boolean" ||
    !(value.snoozedUntil === null || typeof value.snoozedUntil === "number" && Number.isFinite(value.snoozedUntil) && Math.abs(value.snoozedUntil) <= 8.64e15)) return false;
  if (!["cc", "messageId", "threadId"].every(key => value[key] === undefined || typeof value[key] === "string")) return false;
  if (value.html !== undefined && value.html !== null && typeof value.html !== "string") return false;
  if (value.labelIds !== undefined && (!Array.isArray(value.labelIds) || !value.labelIds.every(id => typeof id === "string"))) return false;
  if (value.images !== undefined && (!Array.isArray(value.images) || !value.images.every(image => record(image) && typeof image.src === "string" && typeof image.alt === "string"))) return false;
  if (value.attachments !== undefined && (!Array.isArray(value.attachments) || !value.attachments.every(file => record(file) &&
    ["id", "filename", "contentType"].every(key => typeof file[key] === "string") && typeof file.size === "number"))) return false;
  if (value.invitation !== undefined) {
    const cached = value.invitation;
    if (!record(cached)) return false;
    if (cached.status === "ok") {
      const invite = cached.invitation;
      if (!record(invite) || !["title", "organizer", "start", "end"].every(key => typeof invite[key] === "string") ||
        typeof invite.allDay !== "boolean" || !["location", "notes"].every(key => invite[key] === undefined || typeof invite[key] === "string")) return false;
    } else if (!["invalid", "unsupported"].includes(String(cached.status)) || typeof cached.reason !== "string") return false;
  }
  return true;
}
function validConversation(value: unknown, accountId: string): value is Conversation {
  return record(value) && value.accountId === accountId && Array.isArray(value.messages) &&
    value.messages.every(item => validMessage(item, accountId)) &&
    new Set(value.messages.map(item => item.id)).size === value.messages.length &&
    Array.isArray(value.gaps) && value.gaps.every(gap => typeof gap === "string");
}

export function ConversationReader({ mail, gmail, api, busy, onChanged, onSelect, renderMessage, onMenu, onMenuKey }: Props) {
  const [conversation, setConversation] = useState<Conversation>();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const region = useId();
  const active = useRef(false);
  const generation = useRef(0);
  const fetchLock = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    active.current = true;
    const request = ++generation.current;
    void api<Conversation>(`/messages/${encodeURIComponent(mail.id)}/conversation`, "GET", undefined, controller.signal)
      .then(value => {
        if (controller.signal.aborted || request !== generation.current) return;
        if (validConversation(value, mail.accountId)) setConversation(value); else setError("Cached conversation could not be loaded.");
      })
      .catch(() => { if (!controller.signal.aborted && request === generation.current) setError("Cached conversation could not be loaded."); });
    return () => { active.current = false; controller.abort(); };
  }, [mail.id, mail.accountId, api]);
  const fetchRest = async () => {
    if (fetchLock.current || pending || busy) return;
    fetchLock.current = true;
    const request = ++generation.current;
    setPending(true); setError("");
    try {
      const value = await api<Conversation>(`/messages/${encodeURIComponent(mail.id)}/conversation/expand`, "POST", {});
      if (!active.current || request !== generation.current) return;
      if (!validConversation(value, mail.accountId)) throw new Error("Invalid conversation");
      setConversation(value);
      await onChanged();
    } catch { if (active.current && request === generation.current) setError("Conversation refresh could not be completed. Cached messages remain available."); }
    finally { fetchLock.current = false; if (active.current) setPending(false); }
  };
  // Identity and membership come exclusively from the existing service model.
  const messages = [...(conversation?.accountId === mail.accountId ? conversation.messages : [])]
    .filter(item => item.accountId === mail.accountId && item.id !== mail.id);
  const ordered: Mail[] = [...messages, mail].sort((a, b) => a.date - b.date || a.id.localeCompare(b.id));
  return <section className="conversation-reader" aria-label="Conversation">
    <p className="conversation-coverage">{ordered.length} cached message{ordered.length === 1 ? "" : "s"}. Older or Sent messages may be missing. Local Inbox and bounded Sent history do not prove completeness.</p>
    {!gmail && <p>IMAP history uses cached Message-ID references only. Remote thread expansion is unavailable.</p>}
    {gmail && mail.threadId && <button type="button" className="link" disabled={pending || busy} onClick={() => void fetchRest()}>{pending ? "Fetching conversation…" : "Fetch bounded Gmail conversation (up to 100 messages)"}</button>}
    {error && <p role="alert">{error}</p>}
    {conversation?.gaps.map((gap, index) => <p key={index}><Redact text={gap} /></p>)}
    <p>Enter or click expands a message. Reader toolbar and shortcuts apply to the selected message. Use Select for actions to change it; each message has its own context menu.</p>
    {ordered.map((item, index) => {
      const open = expanded[item.id] ?? (item.id === mail.id);
      return <MailPrivacy mail={item} key={item.id}><section className="conversation-message" data-message-id={item.id}>
        <button type="button" className="conversation-toggle" aria-expanded={open} aria-controls={`${region}-${index}`}
          onContextMenu={event => onMenu?.(event, item)}
          onClick={() => setExpanded(current => ({ ...current, [item.id]: !open }))}
          onKeyDown={event => {
            onMenuKey?.(event, item);
            if (event.defaultPrevented) return;
            if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
            const keys = ["Enter", "ArrowUp", "ArrowDown", "Home", "End", "ArrowLeft", "ArrowRight"];
            if (!keys.includes(event.key)) return;
            event.preventDefault(); event.stopPropagation();
            if (event.key === "Enter") {
              setExpanded(current => ({ ...current, [item.id]: !open })); return;
            }
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              setExpanded(current => ({ ...current, [item.id]: event.key === "ArrowRight" })); return;
            }
            const buttons = event.currentTarget.closest('.conversation-reader')!.querySelectorAll<HTMLButtonElement>('.conversation-toggle');
            const target = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
            buttons[target]?.focus();
          }}>
          <span>{open ? "▾" : "▸"} <Redact text={item.sender} /></span>
          <time dateTime={new Date(item.date).toISOString()}>{new Date(item.date).toLocaleString()}</time>
          <span className="conversation-snippet"><Redact text={item.preview} /></span>
          {item.id === mail.id && <strong>Selected for actions</strong>}
          {item.unread && <span>Unread</span>}
        </button>
        {item.id !== mail.id && <button type="button" className="link" disabled={busy} onClick={() => onSelect(item)}>Select for actions</button>}
        {open && <div id={`${region}-${index}`}>{renderMessage(item)}</div>}
      </section></MailPrivacy>;
    })}
  </section>;
}
