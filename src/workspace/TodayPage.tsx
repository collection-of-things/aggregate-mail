import { useState } from "react";
import type { Account, MailSummary } from "../../shared/types";
import type { CommitmentStatus } from "../../shared/workspace";
import { request } from "../api";
import { modules } from "../shell/Sidebar";
import { Empty, Page } from "../ui/Page";
import { Tabs } from "../ui/Tabs";
import { relative } from "../ui/time";
import { useNotice, useWorkspace } from "./useWorkspace";

const lists: { id: CommitmentStatus | "done"; label: string; empty: string }[] = [
  { id: "needs-reply", label: "Needs reply", empty: "Nobody is waiting on you." },
  { id: "needs-work", label: "Needs work", empty: "No open work from your mail." },
  { id: "waiting", label: "Waiting", empty: "You're not waiting on anyone." },
  { id: "done", label: "Done", empty: "Finished items show up here." },
];

/** Today: work tracked from mail, by list. Add items with Add to Today on any email. */
export function TodayPage({ messages, accounts, accountFilter, csrf }: { messages: MailSummary[]; accounts: Account[]; accountFilter: string; csrf: string }) {
  const { workspace, error, load } = useWorkspace();
  const [tab, setTab] = useState<string>("needs-reply");
  const [notice, setNotice] = useNotice();
  const items = (workspace?.commitments ?? []).filter((item) => accountFilter === "all" || item.accountId === accountFilter);
  const inList = (id: string) => items.filter((item) => id === "done" ? item.status === "done" || item.status === "cancelled" : item.status === id);
  const shown = inList(tab).sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity) || b.updatedAt - a.updatedAt);
  const mail = new Map(messages.map((item) => [item.id, item]));
  const names = new Map(accounts.map((account) => [account.id, account.name || account.email]));
  const setStatus = async (id: string, revision: number, status: CommitmentStatus, message: string) => {
    try {
      await request(`/api/commitments/${encodeURIComponent(id)}`, { method: "PATCH", csrf, body: { status, revision } });
      await load();
      setNotice(message);
    } catch (reason) {
      setNotice((reason as Error).message);
    }
  };
  const Icon = modules.today.icon;
  return (
    <Page section="Workspace" icon={<Icon />} title="Today" notice={notice ?? error}>
      <Tabs tabs={lists.map((list) => ({ id: list.id, label: list.label, count: inList(list.id).length }))} value={tab} onChange={setTab} label="Lists" />
      <section className="item-list full" aria-label={lists.find((list) => list.id === tab)!.label}>
        {workspace && !shown.length && <Empty title="All clear">{lists.find((list) => list.id === tab)!.empty} Use Add to Today on an email to track it here.</Empty>}
        {shown.map((item) => {
          const source = mail.get(item.sourceMailId);
          const done = item.status === "done" || item.status === "cancelled";
          return (
            <div key={item.id} className={done ? "item-row task done" : "item-row task"}>
              <button type="button" className={done ? "check checked" : "check"} aria-label={done ? "Mark not done" : "Mark done"}
                onClick={() => {
                  // Un-checking returns the item to the list it was last in.
                  const back = [...item.history].reverse().find((change) => change.status !== "done" && change.status !== "cancelled")?.status ?? "needs-work";
                  void setStatus(item.id, item.revision, done ? back : "done", done ? `Back in ${lists.find((list) => list.id === back)!.label}.` : "Done.");
                }} />
              <span className="item-text">
                <span className="item-title">{item.text}</span>
                <span className="item-preview">{source ? `${source.sender || source.address} · ${source.subject}` : item.sourceUnavailable ? "Source email no longer cached" : item.reason}</span>
              </span>
              <span className="item-meta">
                {item.dueDate && <span className={!done && item.dueAt && item.dueAt < Date.now() ? "tag overdue" : "tag"}>Due {new Date(`${item.dueDate}T12:00:00`).toLocaleDateString([], { month: "short", day: "numeric" })}</span>}
                {accounts.length > 1 && <span className="tag">{names.get(item.accountId)}</span>}
                <time>{relative(item.updatedAt)}</time>
              </span>
            </div>
          );
        })}
      </section>
    </Page>
  );
}
