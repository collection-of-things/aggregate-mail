import type { LocalMailUndo } from "../../shared/local-mail-undo";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { notificationDefaults, type NotificationPreferences } from "../notifications";
import { mailNotice, type NotificationMail } from "../../shared/notifications";
import { PrivacyContext, Redact } from "./Privacy";
import { Bell, Check, ChevronRight, Close, Info, Mail } from "./icons";
import { createPortal } from "react-dom";
import { notificationSound } from "./notification-sound";
import { useSwipe } from "./useSwipe";

export type Toast = { id: number; text: string; kind: "info" | "success" | "error"; eventId?: string; duration?: number; mail?: NotificationMail; undo?: LocalMailUndo };

export const NotificationContext = createContext<((text: string, kind?: Toast["kind"]) => void) | null>(null);
export const NotificationHostContext = createContext<((host: HTMLElement) => () => void) | null>(null);
const NotificationTargetContext = createContext<HTMLElement | null>(null);

export function NotificationProvider({ push, children }: { push: NonNullable<React.ContextType<typeof NotificationContext>>; children: ReactNode }) {
  const [hosts, setHosts] = useState<HTMLElement[]>([]);
  const register = useCallback((host: HTMLElement) => {
    setHosts(current => [...current, host]);
    return () => setHosts(current => current.filter(value => value !== host));
  }, []);
  return <NotificationContext.Provider value={push}><NotificationHostContext.Provider value={register}>
    <NotificationTargetContext.Provider value={[...hosts].sort((a, b) => a.compareDocumentPosition(b) & 4 ? -1 : 1).at(-1) ?? null}>{children}</NotificationTargetContext.Provider>
  </NotificationHostContext.Provider></NotificationContext.Provider>;
}

// Keep field descriptions accessible while routing page feedback to one stack.
export function Notice({ text, kind = "error", id }: { text?: string; kind?: Toast["kind"]; id?: string }) {
  const push = useContext(NotificationContext);
  useEffect(() => { if (text) push?.(text, kind); }, [push, text, kind]);
  if (!text) return null;
  if (push) return id ? <span id={id} className="visually-hidden"><Redact text={text} /></span> : null;
  return <p id={id} role={kind === "error" ? "alert" : "status"}><Redact text={text} /></p>;
}

// Publish every attempt, even when an identical validation error was dismissed.
export function useFeedbackState(kind: Toast["kind"] = "error") {
  const push = useContext(NotificationContext);
  const [text, setText] = useState("");
  const set = useCallback((value: string) => {
    setText(value);
    if (value) push?.(value, kind);
  }, [push, kind]);
  return [text, set] as const;
}

export function useToasts(preferences: NotificationPreferences = notificationDefaults) {
  const currentPreferences = useRef(preferences);
  currentPreferences.current = preferences;
  const [toasts, setToasts] = useState<Toast[]>([]);
  const audio = useRef<ReturnType<typeof notificationSound> | undefined>(undefined);
  const sounded = useRef(0);
  useEffect(() => {
    if (window.desktop) return;
    const sound = notificationSound(window);
    audio.current = sound;
    return () => { audio.current = undefined; sound.close(); };
  }, []);
  useEffect(() => {
    const newest = toasts.at(-1)?.id ?? 0;
    if (newest <= sounded.current) return;
    sounded.current = newest;
    if (currentPreferences.current.sound === "system") audio.current?.play();
  }, [toasts]);
  const nextId = useRef(0);
  const push = useCallback((text: string, kind: Toast["kind"] = "info", eventId?: string, mail?: NotificationMail, undo?: LocalMailUndo) => {
    const value = currentPreferences.current;
    if (kind === "success" && !value.confirmations) return;
    if (kind === "info" && eventId?.startsWith("arrival:") && !value.newMail) return;
    const id = ++nextId.current;
    setToasts((current) => current.some((toast) => toast.kind === kind &&
      (eventId ? toast.eventId === eventId : !toast.eventId && toast.text === text))
      // Keep queued and mounted notices on the duration chosen when they arrived.
      ? current : [...current, { id, text, kind, eventId, duration: value.duration, mail, undo }]);
  }, []);
  const dismiss = useCallback((id: number) => setToasts((current) => current.filter((toast) => toast.id !== id)), []);
  const consumeUndo = useCallback((token: string) => setToasts(current => current.filter(toast => toast.undo?.token !== token)), []);
  return { toasts, push, dismiss, consumeUndo };
}

// Matches the slot collapse in mail-features.css so neighbours finish moving first.
const exitMs = 200;

function ToastItem({ toast, leaving, onDismiss, preferences, onOpen, onUndo, undoDisabled, undoPending }: { toast: Toast; leaving: boolean; onDismiss: (id: number) => void; preferences: NotificationPreferences; onOpen?: (id: string) => void; onUndo?: (receipt: LocalMailUndo) => void; undoPending?: (receipt: LocalMailUndo) => boolean; undoDisabled?: boolean }) {
  const { on: privacy } = useContext(PrivacyContext);
  const swipe = useSwipe(() => onDismiss(toast.id), !leaving);
  const isMail = toast.kind === "info" && (Boolean(toast.mail) || toast.eventId?.startsWith("arrival:"));
  const Icon = toast.kind === "error" ? Info : toast.kind === "success" ? Check : isMail ? Mail : Bell;
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const remaining = useRef(toast.duration ?? 6000);
  useEffect(() => {
    if (leaving || toast.kind === "error" || toast.duration === 0 || hovered || focused) return;
    const started = Date.now();
    const timer = setTimeout(() => onDismiss(toast.id), remaining.current);
    return () => { clearTimeout(timer); remaining.current = Math.max(0, remaining.current - (Date.now() - started)); };
  }, [toast.id, toast.kind, toast.duration, leaving, hovered, focused, onDismiss]);
  const mail = toast.mail;
  const text = mail ? mailNotice(mail, preferences, privacy) : toast.text;
  const countOnly = isMail && /^\d+ new unread emails?\.$/.test(text);
  return <div className={leaving ? "toast-slot leaving" : "toast-slot"} inert={leaving}><div>
    <div ref={swipe} className={`toast toast-${toast.kind}`} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
      <span className="toast-icon" aria-hidden="true"><Icon size={18} /></span>
      <div className="toast-body">
        {countOnly ? <strong role="status" aria-atomic="true" className="toast-title toast-text">{text.slice(0, -1)}</strong> : <>
          <strong className={toast.kind === "success" ? "visually-hidden" : "toast-title"}>{toast.kind === "error" ? "Needs attention" : toast.kind === "success" ? "Done" : isMail ? "New email" : "Update"}</strong>
          <div role={toast.kind === "error" ? "alert" : "status"} aria-atomic="true" className="toast-text">{mail ? text : <Redact text={text} />}</div>
        </>}
        {toast.undo && onUndo && <div className="toast-actions">
          <button type="button" className="toast-open" disabled={undoDisabled || !!(toast.undo && undoPending?.(toast.undo))} onClick={() => { onUndo(toast.undo!); onDismiss(toast.id); }}>Undo</button>
        </div>}
        {mail && preferences.openMail && onOpen && <div className="toast-actions">
          <button type="button" className="toast-open" onClick={() => { if (mail.id !== "sample") onOpen(mail.id); onDismiss(toast.id); }}>Open email<ChevronRight size={14} /></button>
        </div>}
      </div>
      <button type="button" className="toast-dismiss" aria-label="Dismiss notification" title="Dismiss notification" onClick={() => onDismiss(toast.id)}><Close size={14} /></button>
    </div>
  </div></div>;
}

export function ToastStack({ outbox, toasts, onDismiss, position = "bottom-right", preferences = notificationDefaults, onOpen, onUndo, undoDisabled, undoPending }: { outbox?: ReactNode; onUndo?: (receipt: LocalMailUndo) => void; undoPending?: (receipt: LocalMailUndo) => boolean; undoDisabled?: boolean; preferences?: NotificationPreferences; onOpen?: (id: string) => void; toasts: Toast[]; onDismiss: (id: number) => void; position?: NotificationPreferences["position"] }) {
  const host = useContext(NotificationTargetContext);
  const anchor = useRef<HTMLDivElement>(null);
  const [container] = useState(() => typeof document === "undefined" ? null : document.createElement("div"));
  useLayoutEffect(() => {
    if (!container) return;
    (host ?? anchor.current)?.append(container);
    return () => container.remove();
  }, [host, container]);
  // Dismissed notices stay mounted while they fade and their slot collapses.
  const [leaving, setLeaving] = useState<ReadonlySet<number>>(new Set());
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  useEffect(() => { const pending = timers.current; return () => pending.forEach(clearTimeout); }, []);
  const close = useCallback((id: number) => {
    if (timers.current.has(id)) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { onDismiss(id); return; }
    setLeaving((current) => new Set(current).add(id));
    timers.current.set(id, setTimeout(() => {
      timers.current.delete(id);
      setLeaving((current) => { const next = new Set(current); next.delete(id); return next; });
      onDismiss(id);
    }, exitMs));
  }, [onDismiss]);
  const queued = toasts.length - 4;
  const stack = <section className={`toast-stack toast-stack-${position}`} aria-label="Notifications">
    {outbox}
    {toasts.length > 1 && <div className="toast-heading">
      <span>{toasts.length} notifications</span>
      {queued > 0 && <span className="toast-pending" role="status">{queued} more {queued === 1 ? "notification" : "notifications"}</span>}
      <button type="button" onClick={() => toasts.forEach((toast) => close(toast.id))}>Dismiss all</button>
    </div>}
    {toasts.slice(0, 4).map((toast) => <ToastItem key={toast.id} toast={toast} leaving={leaving.has(toast.id)} onDismiss={close} preferences={preferences} onOpen={onOpen} onUndo={onUndo} undoDisabled={undoDisabled} undoPending={undoPending} />)}
  </section>;
  return container ? <><div ref={anchor} className="notification-host" />{createPortal(stack, container)}</> : stack;
}
