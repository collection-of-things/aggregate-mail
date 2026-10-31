import { useCallback, useEffect, useRef, useState } from "react";
import type { Draft, MailSummary, StateResponse } from "../shared/types";
import { AccountsPage } from "./accounts/AccountsPage";
import { request } from "./api";
import newMessageIcon from "./assets/new-message.png";
import { Drafts } from "./drafts/Drafts";
import { MailPage, type MailView } from "./mail/MailPage";
import { Sidebar, type Module } from "./shell/Sidebar";
import { AccountFilter } from "./ui/filter";
import { CollapseIcon, PersonIcon } from "./ui/icons";
import { AgentsPage } from "./workspace/AgentsPage";
import { CalendarPage } from "./workspace/CalendarPage";
import { ProjectsPage } from "./workspace/ProjectsPage";
import { TodayPage } from "./workspace/TodayPage";

const mailViews: Module[] = ["inbox", "snoozed", "archive", "sent", "all"];

/** "Re: " once, however many times it was already there. */
const replySubject = (subject: string) => /^re:/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim()}`;
const quote = (mail: MailSummary, body: string) =>
  `\n\nOn ${new Date(mail.date).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}, ${mail.sender || mail.address} wrote:\n${body.split("\n").map((line) => `> ${line}`).join("\n")}`;

/** The sidebar, the open module and the separator lines. */
export function App() {
  const [state, setState] = useState<StateResponse | null>(null);
  const [module, setModule] = useState<Module>("inbox");
  const [accountFilter, setAccountFilter] = useState("all");
  // Counts New Message presses; the Drafts page creates one draft per press.
  const [newRequest, setNewRequest] = useState(0);
  const [openRequest, setOpenRequest] = useState<{ id: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Retries every second until the mail service answers, e.g. while it restarts.
  const load = useCallback(() => {
    clearTimeout(timer.current);
    return fetch("/api/state")
      .then((response) => { if (!response.ok) throw new Error(); return response.json(); })
      .then((data: StateResponse) => setState(data))
      .catch(() => { timer.current = setTimeout(load, 1000); });
  }, []);
  useEffect(() => {
    void load();
    return () => clearTimeout(timer.current);
  }, [load]);

  const accounts = state?.accounts ?? [];
  const messages = state?.messages ?? [];
  const csrf = state?.csrf ?? "";
  const filtered = messages.filter((mail) => accountFilter === "all" || mail.accountId === accountFilter);
  const counts = {
    drafts: state?.draftCount ?? 0,
    inbox: filtered.filter((mail) => mail.direction !== "sent" && !mail.archived && !(mail.snoozedUntil && mail.snoozedUntil > Date.now()) && mail.unread).length,
    snoozed: filtered.filter((mail) => mail.direction !== "sent" && !!mail.snoozedUntil && mail.snoozedUntil > Date.now()).length || undefined,
  };

  // Reply: a draft addressed back to the sender, quoting the email, opened in Drafts.
  const reply = async (mail: MailSummary) => {
    const query = new URLSearchParams({ accountId: mail.accountId, contentVersion: mail.contentVersion });
    const body = await request<{ mail: { body: string } }>(`/api/messages/${encodeURIComponent(mail.id)}/body?${query}`).then((data) => data.mail.body).catch(() => mail.preview);
    const draft = await request<Draft>(`/api/accounts/${encodeURIComponent(mail.accountId)}/drafts`, {
      method: "POST", csrf,
      body: { to: mail.replyTo || mail.address, subject: replySubject(mail.subject), body: quote(mail, body),
        ...(mail.messageId ? { inReplyTo: mail.messageId, references: [...(mail.references ?? []), mail.messageId].slice(-100) } : {}),
        ...(mail.threadId ? { threadId: mail.threadId } : {}) },
    });
    await load();
    setOpenRequest({ id: draft.id });
    setModule("drafts");
  };

  const page = (() => {
    if (module === "drafts") return <Drafts accounts={accounts} accountFilter={accountFilter} csrf={csrf} signatures={state?.composePreferences?.signatures ?? {}}
      newRequest={newRequest} openRequest={openRequest} onChanged={() => void load()} />;
    if (mailViews.includes(module)) return <MailPage view={module as MailView} messages={messages} accounts={accounts} accountFilter={accountFilter} csrf={csrf}
      onChanged={load} onReply={reply} />;
    if (module === "today") return <TodayPage messages={messages} accounts={accounts} accountFilter={accountFilter} csrf={csrf} />;
    if (module === "calendar") return <CalendarPage accounts={accounts} accountFilter={accountFilter} csrf={csrf} />;
    if (module === "projects") return <ProjectsPage messages={messages} accounts={accounts} accountFilter={accountFilter} csrf={csrf} />;
    if (module === "agents") return <AgentsPage messages={messages} accounts={accounts} csrf={csrf} />;
    return <AccountsPage accounts={accounts} csrf={csrf} onChanged={load} />;
  })();

  return (
    <>
      {/* Hides the sidebar; not wired up yet. */}
      <button type="button" className="sidebar-toggle" title="Hide sidebar" aria-label="Hide sidebar"><CollapseIcon /></button>
      <button type="button" className="blue-button new-message" onClick={() => { setModule("drafts"); setNewRequest((count) => count + 1); }}>
        <img src={newMessageIcon} alt="" />
        New Message
      </button>
      <Sidebar module={module} accountFilter={accountFilter} accounts={accounts} counts={counts}
        onModule={(next) => { setOpenRequest(null); setModule(next); }} onAccount={setAccountFilter} />
      {/* The signed-in account under the user line; the first connected account until there is a profile. */}
      {accounts[0] && (
        <button type="button" className="user-card" title={accounts[0].email} onClick={() => setModule("accounts")}>
          <span className="user-avatar" aria-hidden="true"><PersonIcon /></span>
          <span className="user-text">
            <span className="user-name">{accounts[0].name || accounts[0].email.split("@")[0]}</span>
            <span className="user-email">{accounts[0].email}</span>
          </span>
        </button>
      )}
      <AccountFilter.Provider value={{ name: accountFilter === "all" ? null : accounts.find((account) => account.id === accountFilter)?.name ?? accounts.find((account) => account.id === accountFilter)?.email ?? null, clear: () => setAccountFilter("all") }}>
        <div key={module} className="page-frame">{page}</div>
      </AccountFilter.Provider>
      <div role="separator" aria-orientation="vertical" className="line line-sidebar" />
      <div role="separator" className="line line-user" />
      <div role="separator" className="line line-top" />
    </>
  );
}
