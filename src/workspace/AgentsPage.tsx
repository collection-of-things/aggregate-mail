import { useCallback, useEffect, useState } from "react";
import type { Account, MailSummary } from "../../shared/types";
import type { AgentGrant, AgentProposal } from "../../shared/workspace";
import { request } from "../api";
import { modules } from "../shell/Sidebar";
import { Empty, Page } from "../ui/Page";
import { Tabs } from "../ui/Tabs";
import { relative } from "../ui/time";
import { useNotice, useWorkspace } from "./useWorkspace";

const actions: Record<AgentProposal["action"], string> = { send: "Send a reply", draft: "Prepare a draft", archive: "Archive an email", read: "Mark an email read" };
const statuses: Record<AgentProposal["status"], string> = { pending: "Waiting for you", executing: "Running", succeeded: "Done", failed: "Failed", unknown: "Outcome unknown", rejected: "Rejected" };

/** Agent review: proposals assistants made, which only run once approved, and the assistants themselves. */
export function AgentsPage({ messages, accounts, csrf }: { messages: MailSummary[]; accounts: Account[]; csrf: string }) {
  const { workspace, error, load } = useWorkspace();
  const [grants, setGrants] = useState<AgentGrant[]>([]);
  const [tab, setTab] = useState("pending");
  const [notice, setNotice] = useNotice();
  const loadGrants = useCallback(() => request<AgentGrant[]>("/api/agent/grants").then(setGrants).catch(() => {}), []);
  useEffect(() => { void loadGrants(); }, [loadGrants]);
  const proposals = [...(workspace?.proposals ?? [])].sort((a, b) => b.createdAt - a.createdAt);
  const pending = proposals.filter((item) => item.status === "pending");
  const history = proposals.filter((item) => item.status !== "pending");
  const mail = new Map(messages.map((item) => [item.id, item]));
  const names = new Map(accounts.map((account) => [account.id, account.name || account.email]));
  const agents = new Map(grants.map((grant) => [grant.id, grant.name]));
  const decide = async (proposal: AgentProposal, verdict: "approve" | "reject") => {
    try {
      await request(`/api/agent/proposals/${encodeURIComponent(proposal.id)}/${verdict}`, { method: "POST", csrf, body: { digest: proposal.digest } });
      await load();
      setNotice(verdict === "approve" ? "Approved." : "Rejected.");
    } catch (reason) {
      setNotice((reason as Error).message);
    }
  };
  const describe = (proposal: AgentProposal) => {
    const payload = proposal.payload;
    if ("mailId" in payload) return mail.get(payload.mailId)?.subject ?? "An email no longer cached";
    return `${payload.subject || "(no subject)"} → ${payload.to || "no recipient"}`;
  };
  const shown = tab === "pending" ? pending : history;
  const Icon = modules.agents.icon;
  return (
    <Page section="Workspace" icon={<Icon />} title="Agent review" notice={notice ?? error}>
      <Tabs tabs={[{ id: "pending", label: "Pending", count: pending.length }, { id: "history", label: "History", count: history.length }, { id: "assistants", label: "Assistants", count: grants.length }]}
        value={tab} onChange={setTab} label="Agent review" />
      {tab === "assistants"
        ? <section className="item-list full" aria-label="Assistants">
          {!grants.length && <Empty title="No assistants connected">Assistants connect over MCP with a grant for chosen accounts and tools.</Empty>}
          {grants.map((grant) => (
            <div key={grant.id} className="item-row">
              <span className="item-text">
                <span className="item-title">{grant.name}</span>
                <span className="item-preview">{grant.tools.length} tool{grant.tools.length === 1 ? "" : "s"} · {grant.accountIds.map((id) => names.get(id)).join(", ")}</span>
              </span>
              <span className="item-meta"><time>{relative(grant.createdAt)}</time></span>
            </div>
          ))}
        </section>
        : <section className="item-list full" aria-label={tab === "pending" ? "Pending proposals" : "History"}>
          {workspace && !shown.length && <Empty title={tab === "pending" ? "Nothing to review" : "No history yet"}>Assistants never act on their own; what they propose waits here for you.</Empty>}
          {shown.map((proposal) => (
            <div key={proposal.id} className="item-row proposal">
              <span className="item-text">
                <span className="item-line">{agents.get(proposal.agentId) ?? "Assistant"} · {names.get(proposal.accountId)}</span>
                <span className="item-title">{actions[proposal.action]}</span>
                <span className="item-preview">{describe(proposal)}{proposal.sourceChanged ? " · the source email changed since" : ""}</span>
              </span>
              <span className="item-meta">
                {proposal.status === "pending"
                  ? <>
                    <button type="button" className="popover-button" onClick={() => void decide(proposal, "reject")}>Reject</button>
                    <button type="button" className="popover-button primary" onClick={() => void decide(proposal, "approve")}>Approve</button>
                  </>
                  : <span className={proposal.status === "succeeded" ? "tag" : "tag warning-tag"}>{statuses[proposal.status]}</span>}
                <time>{relative(proposal.createdAt)}</time>
              </span>
            </div>
          ))}
        </section>}
    </Page>
  );
}
