import type { JSX } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { messages, type AccountKey, type Message } from "../../lib/messages";
import { providers } from "../../lib/providers";
import { searchMail } from "../../lib/search";
import { Icon } from "../../lib/icons";
import {
  accountOf,
  accounts,
  Avatar,
  MailRow,
  maskMessage,
  NumberedAvatar,
  ProviderMark,
  counts,
  tabs,
  WindowBar,
} from "./ui";

// Cropped pieces of the real app, at app size, used by the Features tile and
// the how-it-works stage. Each roots in .appwin frag so the window chrome and
// the app's own greys apply.

const byId = (id: string) => messages.find((message) => message.id === id)!;
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function ConnectFragment() {
  return (
    <div className="appwin frag" data-ui>
      <WindowBar title="Add account" />
      <div className="frag-pad">
        <p className="frag-h">Choose your provider</p>
        <div className="provider-grid">
          {providers.map((provider) => (
            <span className="provider" key={provider.name}>
              <svg aria-hidden="true" height="16" viewBox={provider.viewBox} width="16">
                {provider.paths.map((d) => (
                  <path d={d} fill={provider.hex} key={d} />
                ))}
              </svg>
              {provider.name}
            </span>
          ))}
          <span className="provider">Other IMAP server</span>
        </div>
        <p className="frag-note">Gmail opens Google's own sign-in. Passwords for IMAP accounts are stored encrypted.</p>
      </div>
    </div>
  );
}

export function SyncFragment() {
  const rows = [
    { tile: "#e5484d", glyph: "M", label: "you@gmail.com", what: "Up to date · 2,341 messages", pct: 100 },
    { tile: "#3b6fc4", glyph: "F", label: "work@fastmail.com", what: "Syncing · 418 of 906", pct: 46 },
    { tile: "#7024de", glyph: "y!", label: "me@yahoo.com", what: "Queued", pct: 0 },
  ];
  return (
    <div className="appwin frag" data-ui>
      <WindowBar title="Accounts" />
      <div className="frag-pad">
        {rows.map((row) => (
          <div className="sync-row" key={row.label}>
            <span className="acct-tile" style={{ background: row.tile }}>
              {row.glyph}
            </span>
            <span className="grow">
              <b>{row.label}</b>
              <small>{row.what}</small>
              <span className="sync-bar">
                <i style={{ "--pct": row.pct / 100 }} />
              </span>
            </span>
          </div>
        ))}
        <p className="frag-note">Stored in mail.db · encrypted · key held by the system keychain</p>
        <p className="frag-note sync-last">Last sync 12s ago</p>
      </div>
    </div>
  );
}

export function SortFragment() {
  const shown = ["m12", "m2", "m3", "m7", "m14"].map(byId);
  return (
    <div className="appwin frag" data-ui>
      <WindowBar title="Inbox" />
      <nav className="appwin-tabs frag-tabs">
        {tabs.slice(0, 4).map((tab, index) => (
          <span className={`appwin-tab${index === 0 ? " on" : ""}`} key={tab.key}>
            {tab.label}
          </span>
        ))}
      </nav>
      <div className="appwin-list sort-list">
        {shown.map((message, index) => (
          <span className="sort-row" key={message.id} style={{ "--i": index }}>
            <MailRow message={message} unread={message.relevance === 3} />
          </span>
        ))}
      </div>
    </div>
  );
}

export function TeachFragment({ compact }: { compact?: boolean } = {}) {
  return (
    <div className="appwin frag" data-ui>
      {!compact && <WindowBar title="Teach" />}
      {/* the app's settings-form, drawn as an aligned label/field grid */}
      <div className="frag-pad teach">
        {!compact && (
          <p className="frag-note teach-note">
            Applies only to this account and sender billing@railway.app.
          </p>
        )}
        <span className="teach-k">Send to</span>
        <span className="teach-v">Sort by type</span>
        <span className="teach-k">Relevance</span>
        <span className="teach-v">Low · compact row</span>
        <span className="teach-k">Condition</span>
        <span className="teach-v">Every message from this sender</span>
        {!compact && <p className="frag-preview">14 cached matches · future messages only</p>}
        <div className="teach-actions">
          {!compact && <span className="frag-note">Rules take priority over AI.</span>}
          <span className="frag-btn">Apply reviewed rule</span>
        </div>
      </div>
    </div>
  );
}

// --- Features tile fragments -------------------------------------------------

const listFormat = new Intl.ListFormat("en", { style: "long", type: "conjunction" });
const SEARCH_QUERY = "from:stripe payout";

export function SearchFragment() {
  const [typed, setTyped] = useState(() => (reducedMotion() ? SEARCH_QUERY.length : 0));
  useEffect(() => {
    if (typed >= SEARCH_QUERY.length || reducedMotion()) return;
    const timer = window.setInterval(() => {
      setTyped((current) => {
        if (current + 1 >= SEARCH_QUERY.length) clearInterval(timer);
        return Math.min(current + 1, SEARCH_QUERY.length);
      });
    }, 40);
    return () => clearInterval(timer);
  }, []);

  const done = typed >= SEARCH_QUERY.length;
  const query = SEARCH_QUERY.slice(0, typed);
  // partial queries hit wrong mail ("f" matches everything) — the window
  // shows the empty prompt until the whole query is in
  const results = useMemo(() => (done ? searchMail(messages, SEARCH_QUERY) : []), [done]);
  const providersFound = [...new Set(results.map((message) => accountOf(message.account).label.split("@")[1]))];
  const summary = !done
    ? "Type anything you remember about a message."
    : results.length === 0
      ? "No cached mail matches. Try fewer words."
      : `${results.length} ${results.length === 1 ? "message" : "messages"} from ${listFormat.format(providersFound)}.`;

  return (
    <div className="appwin frag" data-ui>
      <WindowBar title="Search" />
      <div className="frag-pad">
        <div className="frag-search">
          <span aria-hidden="true" className="frag-search-icon" />
          <span className="frag-search-text">
            {query}
            <span aria-hidden="true" className="caret" />
          </span>
        </div>
        <p aria-live="polite" className="frag-note">
          {summary}
        </p>
        <div className="appwin-list">
          {results.slice(0, 3).map((message) => (
            <MailRow key={message.id} message={message} unread={message.unread} />
          ))}
        </div>
      </div>
    </div>
  );
}

// six rows render; the list's clip shows five, so when the top one leaves
// the sixth slides up from below — the window's height never changes
const ARCHIVE_ROWS = ["m11", "m14", "m20", "m25", "m17", "m24", "m27"].map(byId);

export function ArchiveFragment() {
  // 0: settled, 1: top row leaving while the rest close up, 2: done + toast.
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (reducedMotion()) {
      setPhase(2);
      return;
    }
    const timers = [
      window.setTimeout(() => setPhase(1), 700),
      window.setTimeout(() => setPhase(2), 1100),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  const rows = phase === 2 ? ARCHIVE_ROWS.slice(1) : ARCHIVE_ROWS.slice(0, 6);
  return (
    <div className="appwin frag" data-ui>
      <WindowBar title="Inbox" />
      <div className="appwin-list frag-arch">
        {rows.map((message, index) => (
          <span
            className={`arch-row${phase === 1 && index === 0 ? " arch-out" : ""}${phase === 1 && index > 0 ? " arch-up" : ""}`}
            key={message.id}
          >
            <MailRow message={message} />
          </span>
        ))}
      </div>
      {phase === 2 && (
        <div className="frag-toast">
          <span className="frag-toast-i">
            <Icon name="archive" size={15} />
          </span>
          <span className="frag-toast-t">Archived</span>
          <span className="frag-toast-a">Undo</span>
        </div>
      )}
    </div>
  );
}

const PRIVACY_ROWS = ["m6", "m1", "m16", "m12"].map(byId);

export function PrivacyFragment() {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (reducedMotion()) {
      setHidden(true);
      return;
    }
    const timer = window.setTimeout(() => setHidden(true), 600);
    return () => clearTimeout(timer);
  }, []);

  const renderRow = (message: Message, mask: boolean) => {
    return (
      <span className={mask ? "priv-row" : undefined} key={message.id}>
        <MailRow
          avatar={mask ? <NumberedAvatar account={message.account} /> : undefined}
          message={mask ? maskMessage(message) : message}
          unread={!mask && message.unread}
        />
      </span>
    );
  };

  return (
    <div className="appwin frag" data-ui>
      <WindowBar title="Inbox" />
      <div className="appwin-list priv-swap">
        <div className={`priv-side${hidden ? " off" : ""}`}>{PRIVACY_ROWS.map((m) => renderRow(m, false))}</div>
        <div aria-hidden={hidden ? undefined : true} className={`priv-side${hidden ? "" : " off"}`}>
          {PRIVACY_ROWS.map((m) => renderRow(m, true))}
        </div>
      </div>
    </div>
  );
}

const DENSITY_ROWS = ["m12", "m17", "m3", "m7", "m14"].map(byId);

export function DensityFragment() {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    if (reducedMotion()) return;
    const timer = window.setInterval(() => setCompact((current) => !current), 2000);
    return () => clearInterval(timer);
  }, []);

  /* one list — Compact collapses the preview (and any reason line) through
     a 0fr row so the rows below glide up; the may-need-you row keeps its
     extra lines, as the copy promises */
  return (
    <div className="appwin frag" data-ui>
      <WindowBar title={compact ? "Compact" : "Comfortable"} />
      <div className={`appwin-list dense-rows${compact ? " compact" : ""}`}>
        {DENSITY_ROWS.map((message) => {
          const keep = message.relevance === 3;
          return (
            <div className={`mrow card r${message.relevance} dense-row${keep ? " keep" : ""}${keep ? " unread" : ""}`} key={message.id}>
              {keep && <i className="udot" aria-hidden="true" />}
              <Avatar message={message} />
              <span className="row-text">
                <span className="row-line">
                  <strong className="from">{message.sender}</strong>
                  <span className="time">{message.time}</span>
                </span>
                <span className="row-subject">{message.subject}</span>
                <span className="row-preview">
                  <span className="row-sub">{message.preview}</span>
                </span>
                {message.reason && (
                  <span className="row-reason">
                    <span className="row-sub">May need you · {message.reason}</span>
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ComposeFragment() {
  return (
    <div className="appwin frag compose-win" data-ui>
      <WindowBar title="New message">
        <span className="compose-discard">
          <Icon name="trash" size={15} />
          Delete draft
        </span>
      </WindowBar>
      <div className="compose">
        <div className="compose-envelope">
          <p className="compose-line">
            <span className="compose-k">From</span>
            <span className="compose-v">
              Sam · work@fastmail.com
              <Icon name="chevronDown" size={14} />
            </span>
          </p>
          <p className="compose-line">
            <span className="compose-k">To</span>
            <span className="compose-v">
              <span className="compose-chip">priya@studio-north.com</span>
            </span>
            <span className="compose-cc">Cc</span>
            <span className="compose-cc">Bcc</span>
          </p>
          <p className="compose-line compose-subj">
            <span className="compose-k">Subject</span>
            <span className="compose-v">Thursday review</span>
          </p>
        </div>
        <p className="compose-tools">
          <span className="compose-attach">
            <Icon name="paperclip" size={15} />
            Attach files
          </span>
          <span className="compose-limits">Up to 10 files · 512 KiB each · 1 MiB total</span>
        </p>
        <p className="compose-body">
          Friday at 10:00 works. I will bring the new boards.
          <br />
          Want me to invite Alex too?
          <span aria-hidden="true" className="caret" />
        </p>
        <p className="compose-sig">-- <br />Sam</p>
        <p className="compose-foot">
          <span className="compose-act">Keep draft</span>
          <span className="compose-status">Draft saved</span>
          <span className="compose-act">Send later</span>
          <span className="frag-btn compose-send">Send</span>
        </p>
      </div>
    </div>
  );
}

// Only the active fragment ever renders. Keying the pane on `active` remounts
// it on every switch, and the enter animation replays for each mount: exactly
// one window is on screen at all times.
export function Swap({ active, items }: { active: number; items: (() => JSX.Element)[] }) {
  const Incoming = items[active];
  return (
    <div className="frag-swap">
      <div className="frag-pane" key={active}>
        <Incoming />
      </div>
    </div>
  );
}

// --- bento crops ---------------------------------------------------------
// Bare app regions (no window chrome, no frame shadow) cropped by the
// card's bottom edge.

export function TabsCrop() {
  const shown = ["m12", "m6"].map(byId);
  return (
    <div className="crop" data-ui>
      <div className="appwin-tabs">
        {tabs.slice(0, 5).map((tab, index) => (
          <span className={`appwin-tab${index === 0 ? " on" : ""}`} key={tab.key}>
            {tab.label} <span className="n">{counts.all[tab.key]}</span>
          </span>
        ))}
      </div>
      {shown.map((message) => (
        <MailRow key={message.id} message={message} unread={message.unread} />
      ))}
    </div>
  );
}

export function RailCrop() {
  const [selected, setSelected] = useState<AccountKey | "all">("all");
  const pick = (key: AccountKey | "all") => ({
    "aria-pressed": selected === key,
    className: `srow${selected === key ? " sel" : ""}`,
    onClick: () => setSelected(key),
    type: "button" as const,
  });
  return (
    <div className="crop" data-ui>
      <p className="sg-h">Accounts</p>
      <button {...pick("all")}>
        <kbd>0</kbd>All accounts
      </button>
      {accounts.map((account, index) => (
        <button {...pick(account.key)} key={account.key}>
          <kbd>{index + 1}</kbd>
          <span className="sacct">
            <ProviderMark mark={account.mark} />
            {account.label}
          </span>
          <span className="snum">{counts[account.key].primary + counts[account.key].newsletters + counts[account.key].transactions + counts[account.key].updates}</span>
        </button>
      ))}
      <span className="srow sadd"><Icon name="plus" />Add account</span>
    </div>
  );
}

export function SearchCrop() {
  const results = searchMail(messages, "receipt");
  return (
    <div className="crop crop-search" data-ui>
      <div className="frag-search">
        <span aria-hidden="true" className="frag-search-icon" />
        <span className="frag-search-text">receipt</span>
      </div>
      {results.slice(0, 2).map((message) => (
        <MailRow key={message.id} message={message} unread={message.unread} />
      ))}
    </div>
  );
}

export function ComposeCrop() {
  return (
    <div className="crop" data-ui>
      <div className="compose">
        <p className="compose-line">
          <span className="compose-k">From</span> work@fastmail.com
        </p>
        <p className="compose-line">
          <span className="compose-k">To</span> priya@studio-north.com
        </p>
        <p className="compose-line">
          <span className="compose-k">Subject</span> Thursday review
        </p>
        <p className="compose-body">
          Friday at 10:00 works. I will bring the new boards.
          <br />
          Want me to invite Alex too?
        </p>
      </div>
    </div>
  );
}

export function MaskedRowsCrop() {
  return (
    <div className="crop" data-ui>
      {["m1", "m16", "m6"].map(byId).map((message) => (
        <span className="priv-row" key={message.id}>
          <MailRow avatar={<NumberedAvatar account={message.account} />} message={maskMessage(message)} />
        </span>
      ))}
    </div>
  );
}

const CAL_DAYS: { d: number; dim?: boolean; today?: boolean; chips?: [string, string?][] }[] = [
  { d: 28, dim: true }, { d: 29, dim: true }, { d: 30, dim: true }, { d: 1 }, { d: 2 }, { d: 3 }, { d: 4 },
  { d: 5 }, { d: 6 }, { d: 7 }, { d: 8, chips: [["Follow up · Priya"]] }, { d: 9 }, { d: 10 }, { d: 11 },
  { d: 12 }, { d: 13 }, { d: 14 }, { d: 15, chips: [["Invoice due", "warn"]] }, { d: 16 }, { d: 17 }, { d: 18 },
  { d: 19 }, { d: 20 }, { d: 21 }, { d: 22, chips: [["Invoice review"]] }, { d: 23 }, { d: 24 }, { d: 25 },
  { d: 26 }, { d: 27, today: true }, { d: 28 }, { d: 29 }, { d: 30 }, { d: 31 }, { d: 1, dim: true },
];

const CAL_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function CalendarCrop() {
  return (
    <div className="crop" data-ui>
      <p className="crop-h">October 2026</p>
      <div className="cal">
        {CAL_WEEKDAYS.map((name) => (
          <span className="cal-wd" key={name}>
            {name}
          </span>
        ))}
        {CAL_DAYS.map((day, index) => (
          <span className={`cal-d${day.dim ? " dim" : ""}${day.today ? " today" : ""}`} key={index}>
            <span className="cal-n">{day.d}</span>
            {day.chips?.map(([text, tone]) => (
              <span className={`cal-chip${tone ? " " + tone : ""}`} key={text}>
                {text}
              </span>
            ))}
          </span>
        ))}
      </div>
    </div>
  );
}
