import { useContext, useEffect, useRef, useState } from "react";
import type { Draft, Mail } from "../../shared/types";
import type { Api } from "../api";
import { Dialog } from "../ui/Dialog";
import { PrivacyContext } from "../ui/Privacy";

type Result = { kind: "sent" } | { kind: "draft"; draft: Draft } | { kind: "link"; url: string };
export function UnsubscribeAction({ mail, api, busy, onOpenDraft, onReviewing }: {
  mail: Mail; api: Api; busy: boolean; onOpenDraft?: (draft: Draft) => void; onReviewing?: (open: boolean) => void;
}) {
  const action = mail.unsubscribe;
  const { on: privacy } = useContext(PrivacyContext);
  const [open, setOpen] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result>();
  const [error, setError] = useState("");
  const lock = useRef(false);
  useEffect(() => { if (privacy) setRevealed(false); }, [privacy]);
  useEffect(() => { onReviewing?.(open); return () => onReviewing?.(false); }, [open, onReviewing]);
  if (!action) return null;
  if (action.kind === "blocked") return <p className="message-labels">Unsubscribe unavailable: {action.reason === "headers" ? "the email has malformed or oversized list headers." : "the destination must be a public HTTPS address or a supported mailto draft."}</p>;
  if (action.kind === "mailto" && !onOpenDraft) return null;
  const hidden = privacy && !revealed;
  const destination = action.kind === "mailto" ? action.address : new URL(action.url).hostname;
  const close = () => { if (!lock.current) { setOpen(false); setRevealed(false); } };
  const confirm = async () => {
    if (lock.current || result || error || hidden) return;
    lock.current = true; setPending(true);
    try {
      const response = await api<Result>(`/messages/${encodeURIComponent(mail.id)}/unsubscribe`, "POST", { confirmed: true, expected: action });
      setResult(response);
      if (response.kind === "draft") { setOpen(false); onOpenDraft?.(response.draft); }
    } catch (error) { setError(error instanceof Error ? error.message : "The result could not be confirmed. Check with the sender before trying again."); }
    finally { lock.current = false; setPending(false); }
  };
  return <div className="message-labels">
    <button type="button" className="link" disabled={busy || pending || result?.kind === "sent"} onClick={() => { setError(""); setResult(undefined); setOpen(true); }}>
      {result?.kind === "sent" ? "Unsubscribe request accepted" : "Unsubscribe"}
    </button>
    {open && <Dialog title="Review unsubscribe" onClose={close} initialFocus="close">
      <p className="dialog-copy">Destination: {hidden ? "Hidden" : <strong className="unsubscribe-destination">{destination}</strong>}</p>
      {hidden && <button type="button" className="link" onClick={() => setRevealed(true)}>Reveal unsubscribe destination</button>}
      <p className="dialog-copy">{action.kind === "post" ? "Send an unsubscribe request directly to this service. This does not send email or change your mailbox." :
        action.kind === "mailto" ? "Create a normal draft from this email’s receiving account. Review its recipient, subject and body before sending. Nothing is sent now." :
        "Check the destination, then open its unsubscribe page in your system browser. The browser controls later navigation and may send its own cookies."}</p>
      <p className="dialog-copy">The destination was supplied by the sender and has not been authenticated. Continue only if you trust it. It may identify your subscription.</p>
      {error && <p role="alert">{error}</p>}
      {result?.kind === "sent" && <p role="status">Unsubscribe request accepted. The sender controls when mail stops.</p>}
      <div className="form-actions">
        <button type="button" className="button" disabled={pending} onClick={close}>{result || error ? "Close" : "Cancel"}</button>
        {!result && !error && <button type="button" className="button" disabled={pending || hidden} onClick={() => void confirm()}>
          {pending ? "Working…" : action.kind === "post" ? "Send unsubscribe request" : action.kind === "mailto" ? "Create draft" : "Check destination"}
        </button>}
        {result?.kind === "link" && !hidden && <a className="link" href={result.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" onClick={close}>Open in browser</a>}
      </div>
    </Dialog>}
  </div>;
}
