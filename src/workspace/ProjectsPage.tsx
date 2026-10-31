import { useRef, useState } from "react";
import type { Account, MailSummary } from "../../shared/types";
import { request } from "../api";
import { modules } from "../shell/Sidebar";
import { Empty, Page } from "../ui/Page";
import { Tabs } from "../ui/Tabs";
import { PlusIcon } from "../ui/icons";
import { useOutsidePress, usePresence } from "../ui/presence";
import { relative } from "../ui/time";
import { useNotice, useWorkspace } from "./useWorkspace";

/** Projects: conversations grouped under a name, with the decisions recorded for them. */
export function ProjectsPage({ messages, accounts, accountFilter, csrf }: { messages: MailSummary[]; accounts: Account[]; accountFilter: string; csrf: string }) {
  const { workspace, error, load } = useWorkspace();
  const [tab, setTab] = useState("all");
  const [notice, setNotice] = useNotice();
  const [creating, setCreating] = useState(false);
  const projects = (workspace?.projects ?? [])
    .filter((project) => accountFilter === "all" || project.accountIds.includes(accountFilter))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const decisions = workspace?.decisions ?? [];
  const decided = projects.filter((project) => decisions.some((decision) => decision.projectId === project.id));
  const shown = tab === "decided" ? decided : projects;
  const mail = new Map(messages.map((item) => [item.id, item]));
  const names = new Map(accounts.map((account) => [account.id, account.name || account.email]));
  const addDecision = async (projectId: string, sourceMailId: string, text: string) => {
    try {
      await request(`/api/projects/${encodeURIComponent(projectId)}/decisions`, { method: "POST", csrf, body: { text, sourceMailIds: [sourceMailId] } });
      await load();
      setNotice("Decision recorded.");
    } catch (reason) {
      setNotice((reason as Error).message);
    }
  };
  const Icon = modules.projects.icon;
  return (
    <Page section="Workspace" icon={<Icon />} title="Projects" notice={notice ?? error}
      actions={<NewProject open={creating} onToggle={() => setCreating(!creating)} onClose={() => setCreating(false)} csrf={csrf}
        messages={messages.filter((item) => item.direction !== "sent" && (accountFilter === "all" || item.accountId === accountFilter))}
        onCreated={async (name) => { setCreating(false); await load(); setNotice(`${name} created.`); }} />}>
      <Tabs tabs={[{ id: "all", label: "All", count: projects.length }, { id: "decided", label: "With decisions", count: decided.length }]} value={tab} onChange={setTab} label="Projects" />
      <div className="page-scroll">
        {workspace && !shown.length && <Empty title="No projects yet">New project groups a conversation under a name.</Empty>}
        <div className="card-grid">
          {shown.map((project) => {
            const own = decisions.filter((decision) => decision.projectId === project.id).sort((a, b) => b.createdAt - a.createdAt);
            return (
              <article key={project.id} className="card project-card">
                <div className="card-head">
                  <p className="card-title">{project.name}</p>
                  <time className="muted">{relative(project.updatedAt)}</time>
                </div>
                <p className="muted">{project.sourceMailIds.length} email{project.sourceMailIds.length === 1 ? "" : "s"} · {project.accountIds.map((id) => names.get(id)).join(", ")}</p>
                <ul className="source-list">
                  {project.sourceMailIds.slice(0, 3).map((id) => <li key={id}>{mail.get(id)?.subject ?? "Email no longer cached"}</li>)}
                </ul>
                <p className="card-label">Decisions</p>
                {own.length ? <ul className="decision-list">{own.map((decision) => <li key={decision.id}>{decision.text}</li>)}</ul> : <p className="muted small">None yet.</p>}
                <DecisionInput onAdd={(text) => addDecision(project.id, project.sourceMailIds[0], text)} />
              </article>
            );
          })}
        </div>
      </div>
    </Page>
  );
}

function DecisionInput({ onAdd }: { onAdd: (text: string) => Promise<void> }) {
  const [text, setText] = useState("");
  return (
    <form className="inline-form" onSubmit={(event) => { event.preventDefault(); if (text.trim()) void onAdd(text.trim()).then(() => setText("")); }}>
      <input value={text} placeholder="Record a decision" onChange={(event) => setText(event.target.value)} />
      <button type="submit" className="popover-button primary" disabled={!text.trim()}>Add</button>
    </form>
  );
}

function NewProject({ open, onToggle, onClose, csrf, messages, onCreated }: {
  open: boolean; onToggle: () => void; onClose: () => void; csrf: string; messages: MailSummary[]; onCreated: (name: string) => Promise<void>;
}) {
  const area = useRef<HTMLDivElement>(null);
  const presence = usePresence(open, 140);
  useOutsidePress(open, [area], onClose);
  const recent = [...messages].sort((a, b) => b.date - a.date).slice(0, 40);
  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  const [error, setError] = useState<string | null>(null);
  const chosen = source || recent[0]?.id || "";
  const submit = async () => {
    setError(null);
    try {
      await request("/api/projects", { method: "POST", csrf, body: { name: name.trim(), sourceMailIds: [chosen] } });
      const created = name.trim();
      setName("");
      await onCreated(created);
    } catch (reason) {
      setError((reason as Error).message);
    }
  };
  return (
    <div ref={area} className="popover-anchor">
      <button type="button" className="ghost-button" aria-expanded={open} onClick={onToggle}><PlusIcon />New project</button>
      {presence.mounted && (
        <form className={`popover menu-popover right form-popover${presence.closing ? " closing" : ""}`} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <p className="popover-title">New project</p>
          <label className="popover-field"><span>Name</span><input autoFocus required value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label className="popover-field"><span>From</span>
            <select value={chosen} onChange={(event) => setSource(event.target.value)}>
              {recent.map((item) => <option key={item.id} value={item.id}>{item.subject || "(no subject)"} — {item.sender || item.address}</option>)}
            </select>
          </label>
          {error && <p className="form-error">{error}</p>}
          <div className="popover-actions">
            <button type="button" className="popover-button" onClick={onClose}>Cancel</button>
            <button type="submit" className="popover-button primary" disabled={!name.trim() || !chosen}>Create</button>
          </div>
        </form>
      )}
    </div>
  );
}
