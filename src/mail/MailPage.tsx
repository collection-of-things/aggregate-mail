import { useEffect, useMemo, useRef, useState } from "react";
import { inboxTabs } from "../../shared/inbox-tabs";
import type { Account, MailSummary } from "../../shared/types";
import { modules } from "../shell/Sidebar";
import { Empty, Page } from "../ui/Page";
import { Tabs } from "../ui/Tabs";
import { SearchIcon } from "../ui/icons";
import { useListKeys } from "../ui/listKeys";
import { dateGroup, groupBy, relative } from "../ui/time";
import { initial } from "./format";
import { MailReader } from "./MailReader";

export type MailView = "inbox" | "snoozed" | "archive" | "sent" | "all";

const snoozedNow = (mail: MailSummary) => !!mail.snoozedUntil && mail.snoozedUntil > Date.now();
const received = (mail: MailSummary) => mail.direction !== "sent";
const views: Record<MailView, (mail: MailSummary) => boolean> = {
  inbox: (mail) => received(mail) && !mail.archived && !snoozedNow(mail),
  snoozed: (mail) => received(mail) && snoozedNow(mail),
  archive: (mail) => received(mail) && mail.archived,
  sent: (mail) => !received(mail),
  all: () => true,
};
const empty: Record<MailView, [string, string]> = {
  inbox: ["Inbox zero", "Nothing new in this category."],
  snoozed: ["Nothing snoozed", "Snoozed mail waits here until its time."],
  archive: ["Archive is empty", "Archived mail shows up here."],
  sent: ["No sent mail yet", "Mail you send shows up here."],
  all: ["No mail", "Mail from every folder shows up here."],
};

/** Inbox, Snoozed, Archive, Sent and All mail: tabs, the date-grouped list and the reader. */
export function MailPage({ view, messages, accounts, accountFilter, csrf, onChanged, onReply }: {
  view: MailView;
  messages: MailSummary[];
  accounts: Account[];
  accountFilter: string;
  csrf: string;
  onChanged: () => Promise<void> | void;
  onReply: (mail: MailSummary) => Promise<void>;
}) {
  const [tab, setTab] = useState(view === "inbox" ? "primary" : "all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const searchField = useRef<HTMLInputElement>(null);
  // The email to open once the current one leaves the list (archive, trash, snooze).
  const next = useRef<string | null>(null);
  useEffect(() => { setTab(view === "inbox" ? "primary" : "all"); setOpenId(null); setQuery(""); }, [view]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const inView = useMemo(() => messages
    .filter((mail) => views[view](mail) && (accountFilter === "all" || mail.accountId === accountFilter))
    .sort((a, b) => b.date - a.date), [messages, view, accountFilter]);
  const tabs = view === "inbox"
    ? inboxTabs.map(({ id, label }) => ({ id, label, count: inView.filter((mail) => mail.inboxTab === id && mail.unread).length }))
    : [
      { id: "all", label: "All", count: inView.length },
      { id: "unread", label: "Unread", count: inView.filter((mail) => mail.unread).length },
      { id: "pinned", label: "Pinned", count: inView.filter((mail) => mail.pinned).length },
    ];
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (mail: MailSummary) => !words.length || words.every((word) =>
    `${mail.sender} ${mail.address} ${mail.to} ${mail.subject} ${mail.preview}`.toLowerCase().includes(word));
  // A search looks across every tab of the view.
  const shown = inView.filter((mail) => words.length ? matches(mail)
    : view === "inbox" ? mail.inboxTab === tab : tab === "unread" ? mail.unread : tab === "pinned" ? mail.pinned : true);
  const groups = groupBy(shown, (mail) => dateGroup(mail.date));
  const open = messages.find((mail) => mail.id === openId) ?? null;
  const Icon = modules[view].icon;
  const names = new Map(accounts.map((account) => [account.id, account.name || account.email]));
  useListKeys({ ids: shown.map((mail) => mail.id), openId, onOpen: setOpenId, onClose: () => setOpenId(null), search: () => searchField.current?.focus() });

  return (
    <Page section="Mail" icon={<Icon />} title={modules[view].title} notice={notice}
      actions={<label className="search"><SearchIcon />
        <input ref={searchField} value={query} placeholder={`Search ${modules[view].title.toLowerCase()}`} aria-label={`Search ${modules[view].title}`}
          onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { setQuery(""); event.currentTarget.blur(); } }} />
        <kbd>/</kbd></label>}>
      <Tabs tabs={tabs} value={tab} onChange={(id) => { setTab(id); setOpenId(null); }} label={`${modules[view].title} filters`} />
      <div className={open ? "split-body split" : "split-body"}>
        <section className="item-list" aria-label={modules[view].title}>
          {!shown.length && (words.length ? <Empty title="No matches">Nothing in {modules[view].title} matches “{query.trim()}”.</Empty> : <Empty title={empty[view][0]}>{empty[view][1]}</Empty>)}
          {groups.map((group) => (
            <div key={group.name} className="item-group">
              <h2 className="item-group-name">{group.name}</h2>
              {group.items.map((mail) => (
                <button key={mail.id} data-row={mail.id} type="button" className={`item-row mail${mail.unread ? " unread" : ""}${mail.id === openId ? " selected" : ""}`} onClick={() => setOpenId(mail.id)}>
                  <span className="avatar" aria-hidden="true">{initial(mail)}</span>
                  <span className="item-text">
                    <span className="item-line">{mail.direction === "sent" ? `To ${mail.to}` : mail.sender || mail.address}</span>
                    <span className="item-title">{mail.subject || "(no subject)"}</span>
                    <span className="item-preview">{mail.preview}</span>
                  </span>
                  <span className="item-meta">
                    {!open && accountFilter === "all" && accounts.length > 1 && <span className="tag">{names.get(mail.accountId)}</span>}
                    {mail.pinned && <span className="pin-dot" title="Pinned" />}
                    {view === "snoozed" && mail.snoozedUntil
                      ? <span>until {new Date(mail.snoozedUntil).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}</span>
                      : <time dateTime={new Date(mail.date).toISOString()}>{relative(mail.date)}</time>}
                    {mail.unread && <span className="unread-dot" aria-label="Unread" />}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </section>
        {open && <>
          <div role="separator" aria-orientation="vertical" className="groove-vertical" />
          <MailReader key={open.id} mail={open} account={accounts.find((account) => account.id === open.accountId)} csrf={csrf}
            onChanged={onChanged} onReply={onReply}
            onLeaving={() => { const index = shown.findIndex((mail) => mail.id === open.id); next.current = shown[index + 1]?.id ?? shown[index - 1]?.id ?? null; }}
            onClose={(message, left) => { setOpenId(left ? next.current : null); next.current = null; if (message) setNotice(message); }} />
        </>}
      </div>
    </Page>
  );
}
