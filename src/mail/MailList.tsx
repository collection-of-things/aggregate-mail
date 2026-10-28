import { useContext, type KeyboardEvent, type MouseEvent, type RefObject } from "react";
import type { Account, RendererMail as Mail } from "../../shared/types";
import { previewText } from "../../shared/mail-content";
import type { InteractionPreferences } from "../interaction";
import { MailListWindow } from "../MailListWindow";
import type { MailLocation } from "../navigation";
import { collectPrivateNames, redactPrivateText } from "../privacy";
import { MailPrivacy, PrivacyContext, Redact } from "../ui/Privacy";
import type { MenuAction } from "../ui/ContextMenu";
import { Archive, Check, Clock, Inbox, Mail as MailIcon, More, Pin, Reply, Trash } from "../ui/icons";
import { Avatar } from "./Avatar";
import { relative, shortLabel } from "./format";
import { BulkSelectionContext, selectionKey } from "./bulk-selection";
import { accountLabel } from "../mail-ui";

type RowLayout = "inline" | "stacked" | "brief" | "card";
type RowAction = Omit<MenuAction, "run"> & { run: (event: MouseEvent<HTMLButtonElement>) => void };
const rowIcons = { unread: MailIcon, inbox: Inbox, read: Check, snooze: Clock, unsnooze: Inbox, reply: Reply, archive: Archive, pin: Pin, trash: Trash };

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
  onOpen, onSelect, onMenu, onMenuKey, actions, showAccount = accounts.length > 1,
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
  showAccount?: boolean;
  sizeByImportance?: boolean;
  onOpen: (mail: T) => void;
  onSelect: (id: string) => void;
  onMenu: (event: MouseEvent<HTMLElement>, mail: T) => void;
  onMenuKey: (event: KeyboardEvent<HTMLElement>, mail: T) => void;
  actions?: (mail: T) => RowAction[];
}) {
  const bulk = useContext(BulkSelectionContext);
  const { on: privacy } = useContext(PrivacyContext);
  return <>
    {showAccount && !narrow && <div className="mail-list-columns" aria-hidden="true"><span>Account</span><span>Status</span></div>}
    <MailListWindow messages={messages} selectedId={selectedId} focusSelection={focusSelection}
    density={density} sort={sort} listRef={listRef} narrow={narrow} sizeByImportance={sizeByImportance}>{(m, index) => {
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
    const accountName = accountIndex < 0 ? "Account unavailable" : accountLabel(accounts[accountIndex], accountIndex, privacy, accounts);
    const names = privacy ? collectPrivateNames(accounts, m) : [];
    const reason = privacy ? redactPrivateText(m.reason, names) : m.reason;
    const label = `${m.pinned ? "Pinned: " : ""}${m.unread ? "Unread: " : ""}${m.sender}, ${m.subject}`;
    const reasonLabel = m.relevance === 3 && reason && (
      <span className={`row-label${/^may need\b/i.test(reason) ? " row-label-attention" : ""}`} title={reason}>
        <Redact text={shortLabel(reason)} />
      </span>
    );
    const metadata = (showAccount || reasonLabel) && <span className={`row-meta${showAccount ? "" : " row-meta-status"}`}>
      {showAccount && <span className="row-account" title={accountName}>
        {accountIndex >= 0 && <i className="account-dot" data-tone={accountIndex % 4} aria-hidden="true" />}
        <span>{accountName}</span>
      </span>}
      <span className="row-status">{reasonLabel}</span>
    </span>;
    const accessibleLabel = `${privacy ? redactPrivateText(label, names) : label}, Account: ${accountName}${reasonLabel ? `, Status: ${reason}` : ""}`;
    const time = <time>{relative(m.date)}</time>;
    return (
      <MailPrivacy key={m.id} mail={m}>
        <div className={`mail-row${bulk?.selected.has(selectionKey(m)) ? " bulk-selected" : ""}`}>
          {bulk && <button type="button" role="checkbox" className="mail-select"
            aria-label={`Select message ${index + 1}`} aria-checked={bulk.selected.has(selectionKey(m))}
            disabled={bulk.disabled} onClick={event => bulk.toggle(m, event.shiftKey)}>
            {bulk.selected.has(selectionKey(m)) ? "✓" : ""}
          </button>}
          <button
            id={`mail-${m.id}`}
            className={`row r${relevance} ${layout}${current ? " selected" : ""}${m.unread ? " unread" : ""}`}
            onClick={(event) => {
              if (event.shiftKey && bulk) { bulk.toggle(m, true); return; }
              if (opening === "single") { if (event.detail <= 1) onOpen(m); } else onSelect(m.id);
            }}
            onDoubleClick={(event) => { if (!event.shiftKey && opening === "double") onOpen(m); }}
            onContextMenu={(event) => onMenu(event, m)}
            onKeyDown={(event) => onMenuKey(event, m)}
            aria-haspopup="menu"
            aria-label={accessibleLabel}
            aria-current={current ? "true" : undefined}
          >
            {m.unread && <i className="unread-dot" aria-hidden="true" />}
            {m.pinned && <span className="row-pin" aria-hidden="true"><Pin size={12} /></span>}
            <Avatar mail={m} />
            {layout === "card" ? (
              <span className="row-text">
                <span className="row-line">
                  <strong><Redact text={m.sender} /></strong>
                  {time}
                </span>
                {metadata}
                <span className="row-subject"><Redact text={m.subject || "(no subject)"} /></span>
                {density === "comfortable" && relevance > 1 && (
                  <span className="row-preview"><Redact text={previewText(m.preview)} /></span>
                )}
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
                {metadata}
                {time}
              </>
            )}
          </button>
          <div className="row-actions" role="group" aria-label="Email actions">
            {actions?.(m).filter((action) => action.id in rowIcons &&
              !(action.id === "read" && !m.unread) && !(action.id === "unread" && m.unread) &&
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
  }}</MailListWindow></>;
}
