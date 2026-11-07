import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import type { Draft, GmailLabel, RendererMail as Mail, Provider, RendererState as State } from "../../shared/types";
import type { Api } from "../api";
import { customLabels } from "../mail-ui";
import { Address, MailPrivacy, Redact } from "../ui/Privacy";
import { Avatar } from "./Avatar";
import { ConversationReader } from "./ConversationReader";
import { OfferTimes } from "../work/OfferTimes";
import { InvitationPanel } from "../work/InvitationActions";
import { ReaderContent } from "./MessageContent";
import { mailBodyKey, useMailBody } from "../mail-body";
import { UnsubscribeAction } from "./UnsubscribeAction";

// Today's mail shows its time, this year's its day and time, older mail the full date.
function readerDate(date: number) {
  const value = new Date(date);
  const now = new Date();
  const time: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  if (value.toDateString() === now.toDateString()) return value.toLocaleTimeString(undefined, time);
  return value.toLocaleString(undefined, {
    month: "short", day: "numeric", ...(value.getFullYear() === now.getFullYear() ? time : { year: "numeric" }),
  });
}

/**
 * An opened email: subject, then one sender line with the recipient beneath
 * and the date at the right, Gmail labels, and the body with its image consent.
 */
function SingleReader({ mail, provider, labels, busy, isMutationPending, api, onLabels, onMenu, onMenuKey, onOpen, onChanged, onReplyAll, onForward, onOpenDraft, onUnsnooze, onChangeTime, onReviewingUnsubscribe, state, fromMeta }: {
  mail: Mail;
  state?: State;
  provider?: Provider;
  labels: GmailLabel[];
  busy: boolean;
  isMutationPending?: (mail: Mail) => boolean;
  api: Api;
  onLabels: () => void;
  onOpen?: (mail: Mail) => void;
  onChanged?: () => Promise<unknown>;
  onReplyAll?: () => void;
  onForward?: () => void;
  onOpenDraft?: (draft: Draft) => void;
  onReviewingUnsubscribe?: (open: boolean) => void;
  onUnsnooze?: () => void;
  onChangeTime?: (event: MouseEvent<HTMLElement>) => void;
  onMenu: (event: MouseEvent<HTMLElement>, mail: Mail) => void;
  onMenuKey: (event: KeyboardEvent<HTMLElement>, mail: Mail) => void;
  /* A quiet note on the sender line, just left of the date — the conversation
     reader places its "Selected for actions" text here. */
  fromMeta?: ReactNode;
}) {
  const mutationBusy = busy || !!isMutationPending?.(mail);
  const content = useMailBody(mail, api);
  const hydrated = content.mail;
  return (
    <MailPrivacy mail={mail}>
      <article className="message" tabIndex={-1} onContextMenu={(event) => onMenu(event, mail)} onKeyDown={(event) => onMenuKey(event, mail)}>
        <h1><Redact text={mail.subject || "(no subject)"} /></h1>
        <div className="message-from">
          <Avatar mail={mail} provider={provider} />
          <div className="from-text">
            <p className="from-line">
              <strong><Redact text={mail.sender} /></strong>
              <span className="from-address"><Address value={mail.address} /></span>
            </p>
            <p className="from-to">To <Redact text={mail.to} /></p>
            {mail.cc && <p className="from-to">Cc <Redact text={mail.cc}/></p>}
          </div>
          {fromMeta}
          <time dateTime={new Date(mail.date).toISOString()} title={new Date(mail.date).toLocaleString()}>
            {readerDate(mail.date)}
          </time>
        </div>
        {mail.snoozedUntil !== null && mail.snoozedUntil > Date.now() && <p className="message-return">
          Returns to Inbox <time dateTime={new Date(mail.snoozedUntil).toISOString()}>{new Date(mail.snoozedUntil).toLocaleString()}</time> (local time)
          {onUnsnooze && <> · <button type="button" className="link" disabled={mutationBusy} onClick={onUnsnooze}>Return to inbox</button></>}
          {onChangeTime && <> · <button type="button" className="link" disabled={mutationBusy} onClick={onChangeTime}>Change time</button></>}
        </p>}
        {hydrated && <InvitationPanel key={`invitation:${mailBodyKey(mail)}`} mail={hydrated} api={api} onOpenDraft={onOpenDraft} onChanged={onChanged} />}
        {!hydrated && <p role="status">{content.error || "Loading cached email…"}{content.error && <> <button type="button" className="link" onClick={content.retry}>Try again</button></>}</p>}
        {hydrated && <ReaderContent api={api} key={`content:${mailBodyKey(mail)}`} mail={hydrated}
          loadContent={(id) => api(`/messages/${encodeURIComponent(id)}/content`, "POST")}
          loadImages={(id) => api(`/messages/${encodeURIComponent(id)}/images`, "POST")} />}
        <footer className="reader-secondary-tools">
        {hydrated && <UnsubscribeAction key={`unsubscribe:${mailBodyKey(mail)}`} mail={hydrated} api={api} busy={mutationBusy} onOpenDraft={onOpenDraft} onReviewing={onReviewingUnsubscribe} />}
        {onReplyAll && <div className="message-labels reader-reply-all"><button type="button" className="link" disabled={busy} onClick={onReplyAll}>Reply all</button></div>}
        {onForward && <div className="message-labels"><button type="button" className="link" disabled={busy} onClick={onForward}>Forward message</button></div>}
        {state && onOpenDraft && <OfferTimes key={`offers:${mail.id}`} mail={mail} state={state} api={api} onOpenDraft={onOpenDraft} />}
        {provider === "gmail" && (
          <div className="message-labels">
            <span className="reader-labels">
              {customLabels(mail, labels).filter((label) => mail.labelIds?.includes(label.id)).map((label) =>
                <span className="reader-label" key={label.id}><Redact text={label.name} /></span>)}
              {customLabels(mail, labels).every((label) => !mail.labelIds?.includes(label.id)) && <Redact text="No labels" />}
            </span>
            <button className="link" disabled={mutationBusy} onClick={onLabels}>Edit labels</button>
          </div>
        )}
        </footer>
      </article>
    </MailPrivacy>
  );
}

// Only the selected message receives callbacks that close over the App action target.
export function Reader(props: Parameters<typeof SingleReader>[0]) {
  if (!props.onOpen || !props.onChanged) return <SingleReader {...props} />;
  return <ConversationReader key={JSON.stringify([props.mail.accountId, props.mail.id])}
    mail={props.mail} gmail={props.provider === "gmail"} api={props.api} busy={props.busy}
    onChanged={props.onChanged} onSelect={props.onOpen} onMenu={props.onMenu} onMenuKey={props.onMenuKey}
    renderMessage={(mail, fromMeta) => <SingleReader {...props} mail={mail}
      provider={mail.id === props.mail.id ? props.provider : undefined}
      onReplyAll={mail.id === props.mail.id ? props.onReplyAll : undefined}
      onForward={mail.id === props.mail.id ? props.onForward : undefined}
      onUnsnooze={mail.id === props.mail.id ? props.onUnsnooze : undefined}
      onChangeTime={mail.id === props.mail.id ? props.onChangeTime : undefined}
      state={mail.id === props.mail.id ? props.state : undefined}
      fromMeta={fromMeta} />} />;
}

/** The reading pane whenever no email is open: empty, loading or idle. */
export function ReaderEmpty({ selected, openKey, loading = false }: { selected: boolean; openKey: string; loading?: boolean }) {
  return (
    <div className="reader-empty">
      <span className="reader-empty-mark" aria-hidden="true"><span className="empty-mark-glyph" /></span>
      <p className="empty-title">No email open</p>
      <p className={loading ? "reader-empty-hint reader-empty-hint-reserved" : "reader-empty-hint"}>{selected ? <>Press <kbd>{openKey}</kbd> to open the selected email.</> : "Choose an email to read it here."}</p>
    </div>
  );
}
