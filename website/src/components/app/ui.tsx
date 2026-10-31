import type { ComponentChildren } from "preact";
import { marks } from "../../lib/logos";
import type { IconName } from "../../lib/icons";
import type { AccountKey, Category, Message } from "../../lib/messages";
import { providers, type Provider } from "../../lib/providers";

// Shared pieces of the app's real light interface, drawn in HTML at true
// size. Every fragment root carries data-ui so the page rules leave its
// chrome alone.

export const accounts: { key: AccountKey; label: string; glyph: string; tile: string; provider: string; mark: Provider }[] = [
  { key: "gmail", label: "you@gmail.com", glyph: "M", tile: "#e5484d", provider: "Gmail", mark: providers[0] },
  { key: "fastmail", label: "work@fastmail.com", glyph: "F", tile: "#3b6fc4", provider: "Fastmail", mark: providers[2] },
  { key: "yahoo", label: "me@yahoo.com", glyph: "y!", tile: "#7024de", provider: "Yahoo", mark: providers[3] },
];

export const accountNumber = (key: AccountKey) => accounts.findIndex((entry) => entry.key === key) + 1;

export const accountOf = (key: AccountKey) => accounts.find((entry) => entry.key === key)!;

// A provider's mark at a given size, drawn in its brand colour.
export function ProviderMark({ mark, size = 12 }: { mark: Provider; size?: number }) {
  return (
    <svg aria-hidden="true" className="pmark" height={size} viewBox={mark.viewBox} width={size}>
      {mark.paths.map((d) => (
        <path d={d} fill={mark.hex} key={d} />
      ))}
    </svg>
  );
}

// The six Inbox tabs, in the app's order, with their app's icons.
export const tabs: { key: Category; label: string; icon: IconName }[] = [
  { key: "primary", label: "Primary", icon: "inbox" },
  { key: "social", label: "Social", icon: "users" },
  { key: "promotions", label: "Promotions", icon: "megaphone" },
  { key: "newsletters", label: "Newsletters", icon: "newspaper" },
  { key: "transactions", label: "Transactions", icon: "receipt" },
  { key: "updates", label: "Updates", icon: "bell" },
];

// Unread counts per tab, per account, so the numbers add up across the filter.
export const counts: Record<AccountKey | "all", Record<Category, number>> = {
  gmail: { primary: 9, social: 4, promotions: 31, newsletters: 6, transactions: 14, updates: 22 },
  fastmail: { primary: 7, social: 2, promotions: 3, newsletters: 11, transactions: 5, updates: 48 },
  yahoo: { primary: 2, social: 0, promotions: 19, newsletters: 3, transactions: 6, updates: 9 },
  all: { primary: 18, social: 6, promotions: 53, newsletters: 20, transactions: 25, updates: 79 },
};

const luminance = (color: string) => {
  const hex = color.replace("#", "");
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export function SenderMark({ domain, letter, size = 13 }: { domain: string; letter: string; size?: number }) {
  const mark = marks[domain];
  if (!mark) return <span className="ava-letter">{letter}</span>;
  /* a wide wordmark (Stripe, Linear…) collapses to an unreadable squiggle at
     avatar size — only real glyphs and icons belong in the circle */
  const [, , w, h] = mark.viewBox.split(" ").map(Number);
  if (h > 0 && w / h > 1.6) return <span className="ava-letter">{letter}</span>;
  return (
    <svg aria-hidden="true" height={size} viewBox={mark.viewBox} width={size}>
      {mark.paths.map((path) => {
        const color = path.fill ?? mark.fallback;
        return <path d={path.d} fill={luminance(color) < 0.24 ? "#e6e6e6" : color} key={path.d} />;
      })}
    </svg>
  );
}

export function Avatar({ message, large }: { message: Message; large?: boolean }) {
  const account = accountOf(message.account);
  return (
    <span className={`ava${large ? " ava-lg" : ""}`}>
      <span>
        <SenderMark domain={message.domain} letter={message.sender.slice(0, 1)} size={large ? 20 : 13} />
      </span>
      <span className="badge">
        <ProviderMark mark={account.mark} size={large ? 12 : 9} />
      </span>
    </span>
  );
}

// Privacy mode: a row keeps its shape but gives away nothing personal.
export const maskMessage = (message: Message): Message => ({
  ...message,
  sender: `Account ${accountNumber(message.account)} · ${accountOf(message.account).provider}`,
  subject: "Hidden",
  preview: "Hidden",
  unread: false,
});

// Masked rows all get the same neutral disc holding the account number.
export function NumberedAvatar({ account }: { account: AccountKey }) {
  return (
    <span className="ava">
      <span>
        <span className="ava-letter">{accountNumber(account)}</span>
      </span>
    </span>
  );
}

// Dialog fragments keep a small window bar with the platform's controls.
export function WindowBar({ children, title }: { children?: ComponentChildren; title?: string }) {
  return (
    <div className="appwin-bar">
      <span aria-hidden="true" className="ctl-mac">
        <i></i>
        <i></i>
        <i></i>
      </span>
      {title && <span className="appwin-title">{title}</span>}
      {children}
      <span aria-hidden="true" className="ctl-win">
        <svg viewBox="0 0 10 10"><path d="M0 5h10" /></svg>
        <svg viewBox="0 0 10 10"><rect height="9" width="9" x=".5" y=".5" /></svg>
        <svg viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10" /></svg>
      </span>
      <span aria-hidden="true" className="ctl-linux">
        <i><svg viewBox="0 0 10 10"><path d="M2 6h6" /></svg></i>
        <i><svg viewBox="0 0 10 10"><rect height="6" width="6" x="2" y="2" /></svg></i>
        <i><svg viewBox="0 0 10 10"><path d="M2.5 2.5l5 5M7.5 2.5l-5 5" /></svg></i>
      </span>
    </div>
  );
}

// One mail card, as the app's list renders it in side-by-side reading mode:
// avatar, then sender + time on the first line, the subject, the preview, and
// the "May need you" reason in the app's reason colour for high relevance.
export function MailRow({
  message,
  unread,
  active,
  onSelect,
  avatar,
}: {
  message: Message;
  unread?: boolean;
  active?: boolean;
  onSelect?: () => void;
  avatar?: ComponentChildren;
}) {
  const className = `mrow card r${message.relevance}${unread ? " unread" : ""}${active ? " on" : ""}`;
  const body = (
    <>
      {unread && <i className="udot" aria-hidden="true" />}
      {avatar ?? <Avatar message={message} />}
      <span className="row-text">
        <span className="row-line">
          <strong className="from">{message.sender}</strong>
          <span className="time">{message.time}</span>
        </span>
        <span className="row-subject">{message.subject}</span>
        <span className="row-preview">{message.preview}</span>
        {message.relevance === 3 && <span className="row-reason">May need you · {message.reason}</span>}
      </span>
    </>
  );
  if (!onSelect) return <div className={className}>{body}</div>;
  return (
    <button className={className} onClick={onSelect} type="button">
      {body}
    </button>
  );
}
