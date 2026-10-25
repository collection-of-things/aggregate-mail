import { useContext, type KeyboardEvent, type MouseEvent, type RefObject } from "react";
import type { Account, RendererMail as Mail } from "../../shared/types";
import { previewText } from "../../shared/mail-content";
import type { InteractionPreferences } from "../interaction";
import { MailListWindow } from "../MailListWindow";
import type { MailLocation } from "../navigation";
import { collectPrivateNames, redactPrivateText } from "../privacy";
import { MailPrivacy, PrivacyContext, Redact } from "../ui/Privacy";
import type { MenuAction } from "../ui/ContextMenu";
import { Archive, Check, Clock, Inbox, More, Pin, Reply, Trash } from "../ui/icons";
import { Avatar } from "./Avatar";
import { relative, shortLabel } from "./format";
import { accountLabel } from "../mail-ui";

type RowLayout = "inline" | "stacked" | "brief" | "card";
type RowAction = Omit<MenuAction, "run"> & { run: (event: MouseEvent<HTMLButtonElement>) => void };
const rowIcons = { read: Check, snooze: Clock, unsnooze: Inbox, reply: Reply, archive: Archive, pin: Pin, trash: Trash };

/**
 * Mail rows under sticky date headings. Wide lists keep sender and subject on
 * one line, with height following relevance; beside the reader the list is
 * narrow, so each row becomes a card: sender and time, the subject, then a
 * preview for medium and high relevance. Direct actions share the message
 * menu's handlers and guards; More actions, right-click and the menu key
 * retain the full menu.
 */
export function MailList<T extends Mail>({
  messages, selectedId, density, narrow, sort, opening, accounts, listRef, focusSelection, sizeByImportance = true,
  onOpen, onSelect, onMenu, onMenuKey, actions,
}: {
  messages: T[];
  listRef: RefObject<HTMLElement | null>;
  focusSelection: boolean;
  selectedId: string | undefined;
  density: "comfortable" | "compact";
  narrow: boolean;
  sort: MailLocation["sort"];
  opening: InteractionPreferences["opening"];
  accounts: Account[];
  sizeByImportance?: boolean;
  onOpen: (mail: T) => void;
  onSelect: (id: string) => void;
  onMenu: (event: MouseEvent<HTMLElement>, mail: T) => void;
  onMenuKey: (event: KeyboardEvent<HTMLElement>, mail: T) => void;
  actions?: (mail: T) => RowAction[];
}) {
  const { on: privacy } = useContext(PrivacyContext);
  const provider = (mail: Mail) => accounts.find((account) => account.id === mail.accountId)?.provider;
  return <MailListWindow messages={messages} selectedId={selectedId} focusSelection={focusSelection}
    density={density} sort={sort} listRef={listRef} narrow={narrow} sizeByImportance={sizeByImportance}>{(m) => {
    const relevance = sizeByImportance ? m.relevance : 2;
    const layout: RowLayout = narrow
      ? "card"
      : density === "compact" || relevance === 2
        ? "inline"
        : relevance === 3
          ? "stacked"
          : "brief";
    const current = m.id === selectedId;
    const accountIndex = accounts.findIndex((account) => account.id === m.accountId);
    const names = privacy ? collectPrivateNames(accounts, m) : [];
    const reason = privacy ? redactPrivateText(m.reason, names) : m.reason;
    const label = `${m.pinned ? "Pinned: " : ""}${m.unread ? "Unread: " : ""}${m.sender}, ${m.subject}`;
    const reasonLabel = relevance === 3 && reason && (
      <span className="row-label" title={reason}>
        <Redact text={shortLabel(reason)} />
      </span>
    );
    const time = <time>{relative(m.date)}</time>;
    return (
      <MailPrivacy key={m.id} mail={m}>
        <div className="mail-row">
          <button
            id={`mail-${m.id}`}
            className={`row r${relevance} ${layout}${current ? " selected" : ""}${m.unread ? " unread" : ""}`}
            onClick={(event) => opening === "single" ?
              (event.detail <= 1 && onOpen(m)) : onSelect(m.id)}
            onDoubleClick={() => { if (opening === "double") onOpen(m); }}
            onContextMenu={(event) => onMenu(event, m)}
            onKeyDown={(event) => onMenuKey(event, m)}
            aria-haspopup="menu"
            aria-label={privacy ? redactPrivateText(label, names) : label}
            aria-current={current ? "true" : undefined}
          >
            {m.unread && <i className="unread-dot" aria-hidden="true" />}
            {m.pinned && <span className="row-pin" aria-hidden="true"><Pin size={12} /></span>}
            <Avatar mail={m} provider={provider(m)} />
            {layout === "card" ? (
              <span className="row-text">
                <span className="row-line">
                  <strong><Redact text={m.sender} /></strong>
                  {reasonLabel}
                  {time}
                </span>
                <span className="row-subject"><Redact text={m.subject || "(no subject)"} /></span>
                {density === "comfortable" && relevance > 1 && (
                  <span className="row-preview"><Redact text={previewText(m.preview)} /></span>
                )}
                {density === "comfortable" && accountIndex >= 0 && <span className="row-account">{accountLabel(accounts[accountIndex], accountIndex, privacy, accounts)}</span>}
              </span>
            ) : (
              <>
                <span className="row-text">
                  <span className="row-line">
                    <strong><Redact text={m.sender} /></strong>
                    <span className="row-subject"><Redact text={m.subject} /></span>
                    {layout === "inline" && (
                      <span className="row-preview"><Redact text={previewText(m.preview)} /></span>
                    )}
                  </span>
                  {layout === "stacked" && (
                    <span className="row-preview"><Redact text={previewText(m.preview)} /></span>
                  )}
                </span>
                {reasonLabel}
                {time}
              </>
            )}
          </button>
          <div className="row-actions" role="group" aria-label="Email actions">
            {actions?.(m).filter((action) => action.id in rowIcons &&
              !(action.id === "snooze" && m.snoozedUntil && m.snoozedUntil > Date.now())).map((action) => {
              const Icon = rowIcons[action.id as keyof typeof rowIcons];
              return <button key={action.id} type="button" aria-label={action.label}
                aria-description={action.description} title={action.description || action.label}
                disabled={action.disabled} onClick={action.run}
                className={action.id === "trash" ? "trash-action" : undefined}
                aria-pressed={action.id === "pin" ? !!m.pinned : undefined}>
                <Icon size={16} />
              </button>;
            })}
            <button
              type="button"
              className="row-more"
              aria-label="More actions"
              aria-haspopup="menu"
              onClick={(event) => onMenu(event, m)}
              onKeyDown={(event) => onMenuKey(event, m)}
            >
              <More size={16} />
            </button>
          </div>
        </div>
      </MailPrivacy>
    );
  }}</MailListWindow>;
}
