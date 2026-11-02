import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { messages, type AccountKey, type Category, type Message } from "../lib/messages";
import { searchMail } from "../lib/search";
import { Icon } from "../lib/icons";
import {
  accountNumber,
  accountOf,
  accounts,
  Avatar,
  maskMessage,
  NumberedAvatar,
  ProviderMark,
  counts,
  MailRow,
  tabs,
} from "./app/ui";

// The hero's working window, laid out like the real app: a 208px sidebar
// (brand, New message, folding Workspace/Mail/Accounts groups, sync footer),
// the Inbox pane with hairline tabs and card rows, and a reader pane with
// the action group. Everything in it works against local state: folders
// switch, reader actions move mail between lists with an undo toast, Reply
// and New message open real (fake-send) composers, Teach files a sender rule,
// and the app's own keys do the same while the window is on screen. Three
// messages arrive live once the hero has been on screen for a beat; any
// interaction, reduced motion or a hidden tab skips to the settled state.

const arrivalB = messages.find((message) => message.arrival === 2)!;
const arrivalC = messages.find((message) => message.arrival === 3)!;

// phase: 0 pending · 1 A in · 2 B shown · 3 B leaving + tick · 4 C shown ·
// 5 C leaving + tick · 6 toast · 7 settled (also the jump-to state)
const SCHEDULE: [number, number][] = [
  [0, 1],
  [900, 2],
  [1500, 3],
  [1900, 4],
  [2500, 5],
  [2800, 6],
  [6800, 7],
];
const FINAL = 7;

type Folder = "inbox" | "drafts" | "snoozed" | "archive" | "sent" | "all" | "today" | "calendar" | "projects" | "review";
type Destination = "archive" | "snoozed" | "trash";

type Mail = { id: string; to: string; subject: string; body: string; from: AccountKey };
type ComposeState = Mail & { draftId?: string };
type Toast = { id: number; text: string; undo?: () => void };

const FOLDERS: { key: Folder; label: string; icon: "inbox" | "clock" | "archive" | "reply" }[] = [
  { key: "inbox", label: "Inbox", icon: "inbox" },
  { key: "snoozed", label: "Snoozed", icon: "clock" },
  { key: "archive", label: "Archive", icon: "archive" },
  { key: "sent", label: "Sent", icon: "reply" },
  { key: "all", label: "All cached", icon: "inbox" },
];

const WORK_VIEWS: { key: Folder; label: string; icon: "check" | "calendar" | "users"; rows: [string, string][] }[] = [
  {
    key: "today",
    label: "Today",
    icon: "check",
    rows: [
      ["Follow up · Priya", "Booked Thursday 15:30"],
      ["Invoice due", "Railway · paid from Gmail"],
      ["Reply to Sam", "Flagged yesterday"],
    ],
  },
  {
    key: "calendar",
    label: "Calendar",
    icon: "calendar",
    rows: [
      ["Design review", "Thursday 15:30 · with Priya"],
      ["Invoice review", "22 Oct · follow-up"],
    ],
  },
  {
    key: "projects",
    label: "Projects",
    icon: "users",
    rows: [
      ["emc2.app launch", "4 open threads"],
      ["Studio North", "Waiting on Priya"],
    ],
  },
  {
    key: "review",
    label: "Agent review",
    icon: "users",
    rows: [["Nothing queued", "Agent access is off in this demo"]],
  },
];

const seedDrafts: Mail[] = [
  {
    id: "d1",
    to: "priya@studio-north.com",
    subject: "Re: Thursday review",
    body: "Friday at 10:00 works on my side. I will bring the new boards.",
    from: "fastmail",
  },
  {
    id: "d2",
    to: "sam@example.com",
    subject: "Launch notes",
    body: "Sending the first draft of the launch notes for review.",
    from: "gmail",
  },
];

const SNOOZE_UNTIL = "until tomorrow 8:00";
const fakeMessage = (mail: Mail, kind: "sent" | "draft"): Message => ({
  id: mail.id,
  sender: `To: ${mail.to}`,
  domain: "",
  address: mail.to,
  subject: mail.subject || "(no subject)",
  preview: mail.body,
  time: "now",
  day: "today",
  category: "primary",
  relevance: 1,
  reason: kind === "draft" ? "Draft" : "Sent",
  account: mail.from,
});

export default function InboxWindow() {
  const [tab, setTab] = useState<Category>("primary");
  const [account, setAccount] = useState<AccountKey | "all">("all");
  const [query, setQuery] = useState("");
  const [folder, setFolder] = useState<Folder>("inbox");
  const [selectedId, setSelectedId] = useState("m2");
  const [read, setRead] = useState<Record<string, boolean>>({});
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [phase, setPhase] = useState(0);
  const [privacy, setPrivacy] = useState(false);
  // mail state: where each real message lives, sender rules, pins, sent/drafts
  const [moved, setMoved] = useState<Record<string, Destination>>({});
  const [rules, setRules] = useState<Record<string, Category>>({});
  const [pinned, setPinned] = useState<Record<string, boolean>>({});
  const [tracked, setTracked] = useState<Record<string, boolean>>({});
  const [sentItems, setSentItems] = useState<Mail[]>([]);
  const [draftItems, setDraftItems] = useState<Mail[]>(seedDrafts);
  // transient UI
  const [toast, setToast] = useState<Toast | null>(null);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [composer, setComposer] = useState<ComposeState | null>(null);
  const [teachOpen, setTeachOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const inView = useRef(false);
  const keyHandler = useRef<(event: KeyboardEvent) => void>(() => {});
  const searchRef = useRef<HTMLInputElement>(null);
  const finalRef = useRef<(() => void) | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setPhase(FINAL);
      return;
    }
    const node = root.current;
    if (!node) return;

    let timers: number[] = [];
    let startAt: number | null = null;
    let elapsed = 0;
    let seen = false;
    let done = false;

    const clear = () => {
      timers.forEach(clearTimeout);
      timers = [];
    };
    const final = () => {
      if (done) return;
      done = true;
      clear();
      setPhase(FINAL);
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
    finalRef.current = final;
    const arm = (from: number) => {
      for (const [at, step] of SCHEDULE) {
        if (at <= from) continue;
        timers.push(window.setTimeout(() => setPhase(step), at - from));
      }
    };
    const begin = () => {
      if (done || startAt !== null || document.hidden) return;
      startAt = Date.now();
      arm(elapsed);
    };
    const tryBegin = () => {
      if (seen && Date.now() - loadedAt >= 1400) begin();
    };
    const loadedAt = Date.now();
    const hero = node.closest(".hero") ?? node;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          seen = true;
          tryBegin();
        }
      },
      { threshold: 0.5 }
    );
    observer.observe(hero);
    timers.push(window.setTimeout(tryBegin, 1400));
    const onVisibility = () => {
      if (document.hidden) {
        if (startAt !== null) {
          elapsed += Date.now() - startAt;
          startAt = null;
          clear();
        }
      } else {
        tryBegin();
        if (startAt === null && seen && !done) begin();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    for (const type of ["pointerdown", "keydown", "focusin"] as const) {
      node.addEventListener(type, final, { once: true });
    }
    return () => {
      done = true;
      finalRef.current = null;
      clear();
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // ------- derived mail state -------------------------------------------------

  const landed = (message: Message) =>
    !message.arrival ||
    (message.arrival === 1 && phase >= 1) ||
    (message.arrival === 2 && phase >= 3) ||
    (message.arrival === 3 && phase >= 5);
  const landedPool = useMemo(() => messages.filter(landed), [phase]);
  const effectiveCategory = (message: Message): Category => rules[message.address] ?? message.category;

  const visible = useMemo((): Message[] => {
    const scoped = account === "all" ? landedPool : landedPool.filter((m) => m.account === account);
    if (query.trim()) return searchMail(scoped, query);
    const inFolder = (message: Message) => {
      const where = moved[message.id];
      if (folder === "inbox") return !where;
      if (folder === "all") return true;
      if (folder === "archive" || folder === "snoozed") return where === folder;
      return false;
    };
    const pool = scoped.filter(inFolder);
    if (folder !== "inbox") return pool;
    const inTab = pool.filter((m) => effectiveCategory(m) === tab);
    const fresh = inTab.filter((m) => m.arrival);
    const rest = inTab.filter((m) => !m.arrival);
    const pinnedFirst = [...rest.filter((m) => pinned[m.id]), ...rest.filter((m) => !pinned[m.id])];
    return [...fresh, ...pinnedFirst];
  }, [tab, account, query, phase, moved, rules, pinned, folder, landedPool]);

  const sentRows = useMemo(() => sentItems.map((mail) => fakeMessage(mail, "sent")), [sentItems]);
  const draftRows = useMemo(() => draftItems.map((mail) => fakeMessage(mail, "draft")), [draftItems]);
  const pseudoRows = folder === "sent" ? sentRows : folder === "drafts" ? draftRows : [];

  const rows: Message[] = folder === "sent" || folder === "drafts" ? pseudoRows : visible;
  const selected = rows.find((message) => message.id === selectedId) ?? rows[0];
  const selectedIsPseudo = selected !== undefined && (folder === "sent" || folder === "drafts");
  /* `read` holds an explicit isRead override: true marks an unread message
     read, false marks a read one unread, absent falls back to the flag */
  const isUnread = (message: Message) =>
    read[message.id] !== undefined ? !read[message.id] : message.unread === true;

  /* sidebar + tab numbers follow the mail as it moves: each base count is
     adjusted by every message whose effective category differs from its
     original tab — moved mail counts nowhere, taught mail counts elsewhere */
  const tabN = (key: Category) =>
    Math.max(
      0,
      counts[account][key] +
        landedPool.reduce((delta, message) => {
          if (account !== "all" && message.account !== account) return delta;
          const effective = moved[message.id] ? null : effectiveCategory(message);
          if (effective === message.category) return delta;
          return delta + (effective === key ? 1 : message.category === key ? -1 : 0);
        }, 0)
    );
  const folderN = (key: Folder) => {
    if (key === "inbox") return tabN("primary");
    if (key === "drafts") return draftItems.length;
    if (key === "sent") return sentItems.length;
    const pool = account === "all" ? landedPool : landedPool.filter((m) => m.account === account);
    return pool.filter((m) => moved[m.id] === key).length;
  };

  // ------- actions ------------------------------------------------------------

  const say = (text: string, undo?: () => void) => {
    window.clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), text, undo });
    toastTimer.current = window.setTimeout(() => setToast(null), 4500);
  };

  const snapshot = () => ({
    moved: { ...moved },
    rules: { ...rules },
    pinned: { ...pinned },
    tracked: { ...tracked },
    sent: [...sentItems],
    drafts: [...draftItems],
  });
  const restore = (snap: ReturnType<typeof snapshot>) => {
    setMoved(snap.moved);
    setRules(snap.rules);
    setPinned(snap.pinned);
    setTracked(snap.tracked);
    setSentItems(snap.sent);
    setDraftItems(snap.drafts);
  };

  const select = (message: Message) => {
    setSelectedId(message.id);
    if (message.unread) setRead((current) => ({ ...current, [message.id]: true }));
  };

  const move = (step: number) => {
    const index = selected ? rows.findIndex((message) => message.id === selected.id) : -1;
    const next = rows[Math.min(rows.length - 1, Math.max(0, index + step))];
    if (next) select(next);
  };

  /* after a removal the app selects whatever slid into the row's place */
  const selectNext = (id: string) => {
    const index = rows.findIndex((message) => message.id === id);
    const rest = rows.filter((message) => message.id !== id);
    const next = rest[Math.min(Math.max(0, index), rest.length - 1)];
    setSelectedId(next?.id ?? "");
  };

  const moveMessage = (message: Message, to: Destination) => {
    const snap = snapshot();
    setMoved((current) => ({ ...current, [message.id]: to }));
    selectNext(message.id);
    setReplyOpen(false);
    setTeachOpen(false);
    const label =
      to === "archive" ? "Archived" : to === "trash" ? "Moved to Trash" : `Snoozed ${SNOOZE_UNTIL}`;
    say(label, () => restore(snap));
  };

  const archive = (message: Message) => moveMessage(message, "archive");
  const trashMessage = (message: Message) => moveMessage(message, "trash");
  const snooze = (message: Message) => moveMessage(message, "snoozed");

  const toggleRead = (message: Message) => {
    setRead((current) => ({ ...current, [message.id]: isUnread(message) }));
  };

  const togglePin = (message: Message) => {
    setPinned((current) => ({ ...current, [message.id]: !current[message.id] }));
  };

  const toggleTrack = (message: Message) => {
    setTracked((current) => ({ ...current, [message.id]: !current[message.id] }));
  };

  const teach = (message: Message, target: Category) => {
    const snap = snapshot();
    setRules((current) => ({ ...current, [message.address]: target }));
    setTeachOpen(false);
    const label = tabs.find((entry) => entry.key === target)?.label ?? target;
    say(`Rule saved: ${message.sender} → ${label}`, () => restore(snap));
  };

  const openComposer = (draft?: Mail) => {
    setComposer(
      draft
        ? { ...draft, draftId: draft.id }
        : { id: `s${Date.now()}`, to: "", subject: "", body: "", from: "gmail" }
    );
    setReplyOpen(false);
    setTeachOpen(false);
  };

  const sendMail = (mail: Mail, draftId?: string) => {
    const snap = snapshot();
    setSentItems((current) => [...current, mail]);
    if (draftId) setDraftItems((current) => current.filter((draft) => draft.id !== draftId));
    setComposer(null);
    setReplyOpen(false);
    say("Sent in the demo. Nothing left your browser.", () => restore(snap));
  };

  const sendReply = (message: Message) => {
    if (!replyText.trim()) return;
    sendMail(
      {
        id: `s${Date.now()}`,
        to: message.address,
        subject: `Re: ${message.subject}`,
        body: replyText.trim(),
        from: message.account,
      }
    );
    setReplyText("");
  };

  const removePseudo = (message: Message, kind: "sent" | "draft") => {
    const snap = snapshot();
    if (kind === "sent") setSentItems((current) => current.filter((mail) => mail.id !== message.id));
    else setDraftItems((current) => current.filter((mail) => mail.id !== message.id));
    selectNext(message.id);
    say(kind === "sent" ? "Sent copy deleted in the demo" : "Draft discarded", () => restore(snap));
  };

  const workView = WORK_VIEWS.find((view) => view.key === folder);
  const isMailFolder = folder === "inbox" || folder === "snoozed" || folder === "archive" || folder === "sent" || folder === "drafts" || folder === "all";

  // ------- keyboard -------------------------------------------------------------

  // The demo window answers the app's own keys while it is on screen: j/k and
  // arrows move, e/#/s file mail, r replies, c composes, u flips read, Esc
  // backs out. Keys with modifiers and keys aimed at an editable field are
  // left alone — Esc is the exception and still closes from inside a field.
  // The observer and listener are made once; the handler ref is refreshed
  // every render so it always sees current state, and visibility lives in a
  // ref so a re-render never resets it and drops held-key repeats.
  keyHandler.current = (event: KeyboardEvent) => {
    if (!inView.current || event.ctrlKey || event.metaKey || event.altKey) return;
    const finish = () => finalRef.current?.();
    if (event.key === "Escape") {
      if (composer) {
        setComposer(null);
      } else if (replyOpen) {
        setReplyOpen(false);
        setReplyText("");
      } else if (teachOpen) {
        setTeachOpen(false);
      } else {
        return;
      }
      event.preventDefault();
      finish();
      return;
    }
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable || target.closest("input, textarea, select"))
    ) {
      return;
    }
    const key = event.key;
    if (key === "0") {
      finish();
      setAccount("all");
    } else if (key === "1" || key === "2" || key === "3") {
      const entry = accounts[Number(key) - 1];
      if (!entry) return;
      finish();
      setAccount(entry.key);
    } else if (key === "p" || key === "P") {
      finish();
      setPrivacy((current) => !current);
    } else if (key === "/") {
      finish();
      event.preventDefault();
      searchRef.current?.focus();
    } else if (!selected || selectedIsPseudo || !isMailFolder) {
      return;
    } else if (key === "e") {
      finish();
      archive(selected);
    } else if (key === "#") {
      finish();
      trashMessage(selected);
    } else if (key === "s") {
      finish();
      snooze(selected);
    } else if (key === "r") {
      finish();
      setReplyOpen(true);
      setTeachOpen(false);
    } else if (key === "c") {
      finish();
      openComposer();
    } else if (key === "u") {
      finish();
      toggleRead(selected);
    } else if (key === "j" || key === "ArrowDown") {
      finish();
      move(1);
    } else if (key === "k" || key === "ArrowUp") {
      finish();
      move(-1);
    } else {
      return;
    }
  };

  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => {
      inView.current = entry.isIntersecting;
    });
    observer.observe(node);
    const onKey = (event: KeyboardEvent) => keyHandler.current(event);
    document.addEventListener("keydown", onKey);
    return () => {
      observer.disconnect();
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  // ------- render -------------------------------------------------------------

  const transient = phase === 2 || phase === 3 ? arrivalB : phase === 4 || phase === 5 ? arrivalC : null;
  const transientOut = phase === 3 || phase === 5;
  const transientTab = transient === arrivalB ? "Newsletters" : "Transactions";
  const showTransient =
    transient !== null && tab === "primary" && account === "all" && !query.trim() && folder === "inbox";
  const paneTitle =
    folder === "inbox" && !query
      ? "Inbox"
      : query
        ? "Search"
        : (FOLDERS.find((entry) => entry.key === folder)?.label ?? workView?.label ?? "Inbox");

  return (
    <div
      aria-label="Emc² demo inbox. Arrow keys move through mail, 0 to 3 switch accounts, e archives, hash trashes, s snoozes, r replies, c composes, u flips read, p hides personal information, slash searches, Escape closes."
      className="appwin appwin-hero"
      data-ui
      onKeyDown={(event) => {
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          move(event.key === "ArrowDown" ? 1 : -1);
        }
      }}
      ref={root}
      role="group"
      tabIndex={0}
    >
      <nav aria-label="Mailboxes" className="side">
        <div className="side-head">
          <button aria-label="Hide sidebar" className="sicon" type="button">
            <Icon name="sidebar" />
          </button>
          <span aria-hidden="true" className="ctl-mac"><i /><i /><i /></span>
          <span className="sbrand brand-lockup" role="img" aria-label="Emc²" />
        </div>
        <div className="side-content">
          <button className="new-msg" onClick={() => openComposer()} type="button">
            <Icon name="plus" size={10} />New message
          </button>
          <button
            className={`srow${folder === "drafts" ? " on" : ""}`}
            onClick={() => setFolder("drafts")}
            type="button"
          >
            <Icon name="mail" />Drafts<span className="snum">{draftItems.length}</span>
          </button>
          <button
            aria-expanded={workspaceOpen}
            className="sg-h sg-fold"
            onClick={() => setWorkspaceOpen((open) => !open)}
            type="button"
          >
            Workspace
            <Icon name="chevronDown" size={11} />
          </button>
          {workspaceOpen &&
            WORK_VIEWS.map((view) => (
              <button
                className={`srow${folder === view.key ? " on" : ""}`}
                key={view.key}
                onClick={() => setFolder(view.key)}
                type="button"
              >
                <Icon name={view.icon} />{view.label}
                {view.key === "today" && <span className="snum">{view.rows.length}</span>}
              </button>
            ))}
          <p className="sg-h">Mail</p>
          {FOLDERS.map((entry) => (
            <button
              className={`srow${folder === entry.key ? " on" : ""}`}
              key={entry.key}
              onClick={() => setFolder(entry.key)}
              type="button"
            >
              <Icon name={entry.icon} />{entry.label}
              {folderN(entry.key) > 0 && <span className="snum">{folderN(entry.key)}</span>}
            </button>
          ))}
          <p className="sg-h">Accounts</p>
          <button
            className={`srow${account === "all" ? " sel" : ""}`}
            onClick={() => setAccount("all")}
            type="button"
          >
            <kbd>0</kbd>All accounts
          </button>
          {accounts.map((entry, index) => (
            <button
              className={`srow${account === entry.key ? " sel" : ""}`}
              key={entry.key}
              onClick={() => setAccount(entry.key)}
              type="button"
            >
              <kbd>{index + 1}</kbd>
              <span className="sacct">
                <ProviderMark mark={entry.mark} />
                {privacy ? `Account ${index + 1}` : entry.label}
              </span>
            </button>
          ))}
          <button className="srow sadd" type="button">
            <Icon name="plus" />Add account
          </button>
        </div>
        <div className="side-foot">
          <span>Synced 12s ago</span>
          <button aria-label="Settings" className="sicon" type="button">
            <Icon name="settings" />
          </button>
        </div>
      </nav>

      <div className="main">
        <div className="appwin-list">
          <header className="pane-head">
            <span className="appwin-view">{paneTitle}</span>
            <span className="pane-tools">
              <span className="appwin-search-wrap">
                <input
                  aria-label="Search mail"
                  className="appwin-search"
                  onInput={(event) => setQuery((event.target as HTMLInputElement).value)}
                  placeholder="Search all mail"
                  ref={searchRef}
                  value={query}
                />
                <kbd aria-hidden="true" className="search-key">/</kbd>
              </span>
              <button
                aria-label="Hide personal information"
                aria-pressed={privacy}
                className={`sicon pkey${privacy ? " on" : ""}`}
                onClick={() => {
                  finalRef.current?.();
                  setPrivacy((current) => !current);
                }}
                type="button"
              >
                <Icon name="eye" />
              </button>
              <kbd aria-hidden="true" className="pkey-hint">p</kbd>
            </span>
          </header>
          {folder === "inbox" && !query.trim() && (
            <nav aria-label="Inbox categories" className="appwin-tabs">
              {tabs.map((entry) => {
                const n = tabN(entry.key);
                const tick =
                  (entry.key === "newsletters" && phase === 3) || (entry.key === "transactions" && phase === 5);
                return (
                  <button
                    className={`appwin-tab${tab === entry.key ? " on" : ""}${tick ? " tick" : ""}`}
                    key={entry.key}
                    onClick={() => {
                      setTab(entry.key);
                      setQuery("");
                    }}
                    type="button"
                  >
                    <Icon name={entry.icon} size={14} />
                    <span className="tab-label">{entry.label}</span>
                    {n > 0 && (
                      <span className="n" key={n}>
                        {n}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          )}

          {workView ? (
            <div className="mlist work-pane">
              {workView.rows.map(([title, note]) => (
                <p className="work-row" key={title}>
                  <b>{title}</b>
                  <small>{note}</small>
                </p>
              ))}
            </div>
          ) : (
            <div className="mlist">
              {rows.length === 0 ? (
                <p className="appwin-empty">
                  {query ? `Nothing in cached mail matches “${query}”.` : "Nothing here."}
                </p>
              ) : (
                rows.map((message, index) => (
                  <div className={message.arrival === 1 && phase === 1 ? "arr arr-in" : undefined} key={message.id}>
                    {folder === "inbox" && message.day !== rows[index - 1]?.day && (
                      <p className="mday">{message.day === "today" ? "Today" : "Yesterday"}</p>
                    )}
                    {index === 0 && showTransient && (
                      <div className={`arr${transientOut ? " arr-out" : ""}`}>
                        <MailRow
                          avatar={privacy ? <NumberedAvatar account={transient.account} /> : undefined}
                          message={privacy ? maskMessage(transient) : transient}
                          unread={!privacy && transient.unread}
                        />
                        <span className="arr-tag">{transientTab}</span>
                      </div>
                    )}
                    <div className="row-wrap">
                      <MailRow
                        active={message.id === selected?.id}
                        avatar={privacy ? <NumberedAvatar account={message.account} /> : undefined}
                        message={privacy ? maskMessage(message) : message}
                        onSelect={() => {
                          if (folder === "drafts") {
                            const draft = draftItems.find((mail) => mail.id === message.id);
                            if (draft) openComposer(draft);
                            return;
                          }
                          select(message);
                        }}
                        unread={!privacy && isUnread(message)}
                      />
                      {!privacy && moved[message.id] === "snoozed" && (
                        <span className="row-tag">{SNOOZE_UNTIL}</span>
                      )}
                      {!privacy && moved[message.id] === "trash" && <span className="row-tag">Trash</span>}
                      {!privacy && folder === "inbox" && pinned[message.id] && (
                        <span className="row-tag pin-tag"><Icon name="pin" size={10} />Pinned</span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {selected && !workView && (
          <article className="appwin-reader">
            <header className="pane-head reader-head">
              {!selectedIsPseudo ? (
                <>
                  <button aria-label="Archive (e)" className="ract" onClick={() => archive(selected)} type="button">
                    <Icon name="archive" />Archive
                  </button>
                  <button aria-label="Trash (#)" className="ract" onClick={() => trashMessage(selected)} type="button">
                    <Icon name="trash" />Trash
                  </button>
                  <button aria-label={`Snooze (${SNOOZE_UNTIL})`} className="ract" onClick={() => snooze(selected)} type="button">
                    <Icon name="clock" />Snooze
                  </button>
                  <i className="rsep" aria-hidden="true" />
                  <button aria-label="Reply (r)" className="ract" onClick={() => { setReplyOpen(true); setTeachOpen(false); }} type="button">
                    <Icon name="reply" />Reply
                  </button>
                  <button
                    aria-label="Toggle read (u)"
                    aria-pressed={!isUnread(selected)}
                    className={`ract${!isUnread(selected) ? " on" : ""}`}
                    onClick={() => toggleRead(selected)}
                    type="button"
                  >
                    <Icon name="mail" />Read
                  </button>
                  <button
                    aria-label="Track conversation"
                    aria-pressed={!!tracked[selected.id]}
                    className={`ract low${tracked[selected.id] ? " on" : ""}`}
                    onClick={() => toggleTrack(selected)}
                    type="button"
                  >
                    <Icon name="eye" />Track
                  </button>
                  <button
                    aria-label="Pin to top"
                    aria-pressed={!!pinned[selected.id]}
                    className={`ract low${pinned[selected.id] ? " on" : ""}`}
                    onClick={() => togglePin(selected)}
                    type="button"
                  >
                    <Icon name="pin" />Pin
                  </button>
                </>
              ) : (
                <button
                  aria-label={folder === "drafts" ? "Discard draft" : "Delete sent copy"}
                  className="ract"
                  onClick={() => removePseudo(selected, folder === "drafts" ? "draft" : "sent")}
                  type="button"
                >
                  <Icon name="trash" />{folder === "drafts" ? "Discard" : "Delete"}
                </button>
              )}
              <span className="resc"><kbd>Esc</kbd></span>
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
            </header>
            <div className="reader-body">
              <h3>{privacy ? "Hidden" : selected.subject}</h3>
              <div className="who">
                {privacy ? <NumberedAvatar account={selected.account} /> : <Avatar large message={selected} />}
                <span>
                  <b>{privacy ? `Account ${accountNumber(selected.account)}` : selected.sender}</b>
                  <small>
                    to {privacy ? `Account ${accountNumber(selected.account)}` : accountOf(selected.account).label}
                  </small>
                </span>
                <span className="when">{selected.time === "now" ? "Just now" : `${selected.time} ago`}</span>
              </div>
              {selected.relevance === 3 && <p className="why">May need you · {selected.reason}</p>}
              <p className="body">{privacy ? "Hidden" : selected.preview}</p>

              {replyOpen && !selectedIsPseudo && (
                <div className="reply-box">
                  <textarea
                    aria-label={`Reply to ${selected.sender}`}
                    autoFocus
                    onInput={(event) => setReplyText((event.target as HTMLTextAreaElement).value)}
                    placeholder={`Reply to ${privacy ? "this sender" : selected.sender}…`}
                    rows={4}
                    value={replyText}
                  />
                  <div className="reply-tools">
                    <button className="frag-btn" onClick={() => sendReply(selected)} type="button">Send</button>
                    <button className="frag-ghost" onClick={() => { setReplyOpen(false); setReplyText(""); }} type="button">Cancel</button>
                  </div>
                </div>
              )}

              {!selectedIsPseudo && (
                <div className="reader-actions">
                  <button onClick={() => { setReplyOpen(true); setTeachOpen(false); }} type="button">Reply</button>
                  <button onClick={() => archive(selected)} type="button">Done</button>
                  <button onClick={() => snooze(selected)} type="button">Snooze</button>
                  <button
                    aria-expanded={teachOpen}
                    onClick={() => setTeachOpen((open) => !open)}
                    type="button"
                  >
                    Teach
                  </button>
                </div>
              )}

              {teachOpen && !selectedIsPseudo && (
                <div className="teach-pop" role="group" aria-label={`Move mail from ${selected.sender} to`}>
                  <p className="teach-pop-h">File {privacy ? "this sender" : selected.sender} under</p>
                  {tabs.map((entry) => (
                    <button
                      className={`teach-opt${effectiveCategory(selected) === entry.key ? " on" : ""}`}
                      key={entry.key}
                      onClick={() => teach(selected, entry.key)}
                      type="button"
                    >
                      <Icon name={entry.icon} size={13} />{entry.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </article>
        )}
      </div>

      {composer && (
        <div className="compose-pane" role="dialog" aria-label="New message">
          <header className="compose-head">
            <b>{composer.draftId ? "Draft" : "New message"}</b>
            <button aria-label="Close composer" className="sicon" onClick={() => setComposer(null)} type="button">
              <Icon name="close" size={12} />
            </button>
          </header>
          <label className="compose-f">
            <span>From</span>
            <select
              onChange={(event) =>
                setComposer((current) => current && { ...current, from: (event.target as HTMLSelectElement).value as AccountKey })
              }
              value={composer.from}
            >
              {accounts.map((entry) => (
                <option key={entry.key} value={entry.key}>{entry.label}</option>
              ))}
            </select>
          </label>
          <label className="compose-f">
            <span>To</span>
            <input
              autoFocus
              onInput={(event) => setComposer((current) => current && { ...current, to: (event.target as HTMLInputElement).value })}
              placeholder="name@example.com"
              value={composer.to}
            />
          </label>
          <label className="compose-f">
            <span>Subject</span>
            <input
              onInput={(event) => setComposer((current) => current && { ...current, subject: (event.target as HTMLInputElement).value })}
              value={composer.subject}
            />
          </label>
          <textarea
            aria-label="Message body"
            className="compose-t"
            onInput={(event) => setComposer((current) => current && { ...current, body: (event.target as HTMLTextAreaElement).value })}
            placeholder="Plain text, signed per account."
            rows={6}
            value={composer.body}
          />
          <div className="reply-tools">
            <button
              className="frag-btn"
              disabled={!composer.to.trim()}
              onClick={() => sendMail({ id: composer.id, to: composer.to, subject: composer.subject, body: composer.body, from: composer.from }, composer.draftId)}
              type="button"
            >
              Send
            </button>
            <button className="frag-ghost" onClick={() => setComposer(null)} type="button">Discard</button>
          </div>
        </div>
      )}

      {phase === 6 && <p className="win-toast">3 new messages · 1 needs you</p>}
      {toast && (
        <p className="win-toast toast-act">
          {toast.text}
          {toast.undo && (
            <button
              onClick={() => {
                toast.undo?.();
                window.clearTimeout(toastTimer.current);
                setToast(null);
              }}
              type="button"
            >
              Undo
            </button>
          )}
        </p>
      )}
    </div>
  );
}
