import { useCallback, useContext, useLayoutEffect, useRef, type KeyboardEvent, type MouseEvent, type RefObject, type ReactNode } from "react";
import type { Account, RendererMail as Mail } from "../../shared/types";
import { previewText } from "../../shared/mail-content";
import type { InteractionPreferences } from "../interaction";
import { MailListWindow } from "../MailListWindow";
import type { MailLocation } from "../navigation";
import { redactPrivateText } from "../privacy";
import { MailPrivacy, PrivacyContext, Redact, scopedPrivateNames } from "../ui/Privacy";
import type { MenuAction } from "../ui/ContextMenu";
import { Archive, Check, Clock, Important, Inbox, Mail as MailIcon, More, Pin, Reply, Trash } from "../ui/icons";
import { Avatar } from "./Avatar";
import { relative, shortLabel } from "./format";
import { BulkSelectionContext, selectionKey } from "./bulk-selection";
import { accountLabel } from "../mail-ui";
import { useSwipe } from "../ui/useSwipe";

type RowLayout = "inline" | "card";
type RowAction = Omit<MenuAction, "run"> & { run: (event: MouseEvent<HTMLButtonElement>) => void };
// Toolbar order: Archive (or Move to Inbox), Snooze, Trash, then Reply, read state and Pin.
const rowIcons = { archive: Archive, inbox: Inbox, snooze: Clock, unsnooze: Inbox, trash: Trash, reply: Reply, read: Check, unread: MailIcon, pin: Pin };
const rowOrder = Object.keys(rowIcons);

function MailGestureRow({ mail, enabled, onSwipe, children }: {
  mail: Mail; enabled: boolean; onSwipe?: (direction: "left" | "right") => void; children: ReactNode;
}) {
  const bulk = useContext(BulkSelectionContext);
  const ref = useSwipe(direction => {
    if (!bulk?.selected.size) onSwipe?.(direction);
  }, enabled && !bulk?.disabled, bulk ? () => bulk.toggle(mail, false) : undefined);
  return <div ref={ref} data-mail-gestures={enabled ? "" : undefined}
    className={`mail-row${bulk?.selected.has(selectionKey(mail)) ? " bulk-selected" : ""}`}>
    {children}
  </div>;
}

/**
 * Mail rows under sticky date headings. Comfortable lists use the rebuild
 * cards at every width. Compact wide lists retain one-line rows; beside the
 * reader both densities use cards: sender and time, the subject, then a preview in comfortable
 * density. High-relevance mail carries an importance marker inside the sender
 * column. Direct actions share the message menu's handlers and guards; More
 * actions, right-click and the menu key retain the full menu.
 */
export function MailList<T extends Mail>({
  messages, selectedId, density, narrow, sort, opening, accounts, listRef, focusSelection,
  onOpen, onSelect, onMenu, onMenuKey, actions, showAccount = accounts.length > 1,
  mailGestures = false, onSwipe,
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
  onOpen: (mail: T) => void;
  onSelect: (id: string) => void;
  onMenu: (event: MouseEvent<HTMLElement>, mail: T) => void;
  onMenuKey: (event: KeyboardEvent<HTMLElement>, mail: T) => void;
  actions?: (mail: T) => RowAction[];
  mailGestures?: boolean;
  onSwipe?: (mail: T, direction: "left" | "right") => void;
}) {
  const cardLayout = narrow || density === "comfortable";
  const cardContent = useCallback((mail: T) => {
    const preview = density === "comfortable" && !!previewText(mail.preview).trim();
    // Compact cards are two lines: metadata trails the subject. Comfortable
    // metadata keeps its own line only without a preview; otherwise it leads it.
    return {
      metadata: density === "comfortable" && !preview && (showAccount || !!(mail.relevance === 3 && mail.reason)),
      preview,
    };
  }, [showAccount, density]);
  const bulk = useContext(BulkSelectionContext);
  const privacyContext = useContext(PrivacyContext);
  const privacy = privacyContext.on;
  // Full-width density changes swap inline rows for cards, which removes any
  // focused control inside the message. Focus then moves to that message row.
  const focused = useRef<{ id: string; element: Element }>(undefined);
  useLayoutEffect(() => {
    const last = focused.current;
    if (!last || last.element.isConnected) return;
    focused.current = undefined;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    document.getElementById(`mail-${last.id}`)?.focus({ preventScroll: true });
  }, [density, cardLayout]);
  return <>
    {showAccount && !cardLayout && <div className="mail-list-columns" aria-hidden="true"><span>Account</span><span>Status</span></div>}
    <MailListWindow messages={messages} selectedId={selectedId} focusSelection={focusSelection}
    density={density} sort={sort} listRef={listRef} narrow={cardLayout} cardContent={cardContent}>{(m, index) => {
    const relevance = m.relevance;
    const layout: RowLayout = cardLayout ? "card" : "inline";
    const current = m.id === selectedId;
    const accountIndex = accounts.findIndex((account) => account.id === m.accountId);
    const accountName = accountIndex < 0 ? "Account unavailable" : accountLabel(accounts[accountIndex], accountIndex, privacy, accounts);
    const names = privacy ? scopedPrivateNames(privacyContext, m) : [];
    const reason = privacy ? redactPrivateText(m.reason, names) : m.reason;
    const label = `${m.pinned ? "Pinned: " : ""}${relevance === 3 ? "Important: " : ""}${m.unread ? "Unread: " : ""}${m.sender}, ${m.subject}`;
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
        <MailGestureRow mail={m} enabled={mailGestures} onSwipe={direction => onSwipe?.(m, direction)}>
          {bulk && <button type="button" role="checkbox" className="mail-select"
            aria-label={`Select message ${index + 1}`} aria-checked={bulk.selected.has(selectionKey(m))}
            disabled={bulk.disabled} onClick={event => bulk.toggle(m, event.shiftKey)}>
            {bulk.selected.has(selectionKey(m)) ? "✓" : ""}
          </button>}
          <button
            id={`mail-${m.id}`}
            className={`row r${relevance} ${layout}${relevance === 3 ? " important" : ""}${current ? " selected" : ""}${m.unread ? " unread" : ""}`}
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
            onFocus={(event) => { focused.current = { id: m.id, element: event.target }; }}
          >
            {!cardLayout && m.unread && <i className="unread-dot" aria-hidden="true" />}
            <Avatar mail={m} unread={cardLayout && m.unread} />
            {layout === "card" ? (
              <span className="row-text">
                <span className="row-line">
                  {relevance === 3 && <span className="row-important" aria-hidden="true"><Important size={12} /></span>}
                  <strong><Redact text={m.sender} /></strong>
                  {m.pinned && <span className="row-pin" aria-hidden="true"><Pin size={12} /></span>}
                  {time}
                </span>
                {/* The subject keeps one position across densities so a
                    focused reveal control inside it survives the switch. */}
                {density === "comfortable" && !cardContent(m).preview && metadata}
                <span className={density === "compact" ? "row-subject-line" : "row-subject-slot"}>
                  <span className="row-subject"><Redact text={m.subject || "(no subject)"} /></span>
                  {density === "compact" && metadata}
                </span>
                {density === "comfortable" && cardContent(m).preview && (
                  <span className="row-preview">{metadata}<span className="row-preview-text"><Redact text={previewText(m.preview)} /></span></span>
                )}
              </span>
            ) : (
              <>
                <span className="row-text">
                  <span className="row-line">
                    {relevance === 3 && <span className="row-important" aria-hidden="true"><Important size={12} /></span>}
                    <strong><Redact text={m.sender} /></strong>
                    <span className="row-subject"><Redact text={m.subject} /></span>
                    <span className="row-preview"><Redact text={previewText(m.preview)} /></span>
                  </span>
                </span>
                {metadata}
                {m.pinned && <span className="row-pin" aria-hidden="true"><Pin size={12} /></span>}
                {time}
              </>
            )}
          </button>
          <div className="row-actions" role="group" aria-label="Email actions">
            {actions?.(m).filter((action) => action.id in rowIcons &&
              !(action.id === "read" && !m.unread) && !(action.id === "unread" && m.unread) &&
              !(action.id === "archive" && m.archived) && !(action.id === "inbox" && !m.archived) &&
              !(action.id === "snooze" && m.snoozedUntil && m.snoozedUntil > Date.now()))
              .sort((a, b) => rowOrder.indexOf(a.id) - rowOrder.indexOf(b.id)).map((action) => {
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
        </MailGestureRow>
      </MailPrivacy>
    );
  }}</MailListWindow></>;
}
