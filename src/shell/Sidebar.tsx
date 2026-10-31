import type { ReactNode } from "react";
import type { Account } from "../../shared/types";
import draftsIcon from "../assets/drafts.png";
import { accountName } from "../drafts/Drafts";
import { MaskIcon } from "../ui/Page";
import { AgentIcon, AllMailIcon, ArchiveIcon, CalendarIcon, GridIcon, InboxIcon, PersonIcon, PlusIcon, ProjectsIcon, SentIcon, SnoozeIcon, TodayIcon } from "../ui/icons";

export type Module = "drafts" | "today" | "calendar" | "projects" | "agents" | "inbox" | "snoozed" | "archive" | "sent" | "all" | "accounts";

/** Every module's place: its sidebar section, name and icon. */
export const modules: Record<Module, { section: string; title: string; icon: () => ReactNode }> = {
  drafts: { section: "Mail", title: "Drafts", icon: () => <MaskIcon src={draftsIcon} className="sidebar-icon" /> },
  today: { section: "Workspace", title: "Today", icon: TodayIcon },
  calendar: { section: "Workspace", title: "Calendar", icon: CalendarIcon },
  projects: { section: "Workspace", title: "Projects", icon: ProjectsIcon },
  agents: { section: "Workspace", title: "Agent review", icon: AgentIcon },
  inbox: { section: "Mail", title: "Inbox", icon: InboxIcon },
  snoozed: { section: "Mail", title: "Snoozed", icon: SnoozeIcon },
  archive: { section: "Mail", title: "Archive", icon: ArchiveIcon },
  sent: { section: "Mail", title: "Sent", icon: SentIcon },
  all: { section: "Mail", title: "All mail", icon: AllMailIcon },
  accounts: { section: "Accounts", title: "Manage accounts", icon: PersonIcon },
};

function Row({ active, icon, label, count, onClick }: { active: boolean; icon: ReactNode; label: string; count?: number; onClick: () => void }) {
  return (
    <button type="button" className={active ? "sidebar-row active" : "sidebar-row"} aria-current={active ? "page" : undefined} onClick={onClick}>
      {icon}
      <span className="sidebar-label">{label}</span>
      {count !== undefined && <span className="sidebar-count">{count}</span>}
    </button>
  );
}

/** Drafts, then the Workspace, Mail and Accounts groups. Account rows filter the mail and drafts views. */
export function Sidebar({ module, accountFilter, accounts, counts, onModule, onAccount }: {
  module: Module;
  accountFilter: string;
  accounts: Account[];
  counts: Partial<Record<Module, number>>;
  onModule: (module: Module) => void;
  onAccount: (accountId: string) => void;
}) {
  const row = (id: Module) => {
    const Icon = modules[id].icon;
    return <Row key={id} active={module === id} icon={<Icon />} label={modules[id].title} count={counts[id]} onClick={() => onModule(id)} />;
  };
  return (
    <nav className="sidebar-nav" aria-label="Sidebar">
      {row("drafts")}
      <section className="sidebar-section" aria-label="Workspace">
        <h2 className="sidebar-heading">Workspace</h2>
        {(["today", "calendar", "projects", "agents"] as const).map(row)}
      </section>
      <section className="sidebar-section" aria-label="Mail">
        <h2 className="sidebar-heading">Mail</h2>
        {(["inbox", "snoozed", "archive", "sent", "all"] as const).map(row)}
      </section>
      <section className="sidebar-section" aria-label="Accounts">
        <h2 className="sidebar-heading">Accounts</h2>
        <button type="button" className={accountFilter === "all" ? "sidebar-account selected" : "sidebar-account"} onClick={() => onAccount("all")}>
          <span className="account-dot all" aria-hidden="true"><GridIcon /></span>
          <span className="sidebar-label">All accounts</span>
        </button>
        {accounts.map((account, index) => (
          <button key={account.id} type="button" className={accountFilter === account.id ? "sidebar-account selected" : "sidebar-account"}
            title={account.email} onClick={() => onAccount(account.id)}>
            <span className="account-dot" aria-hidden="true">{index + 1}</span>
            <span className="sidebar-label">{accountName(account)}</span>
            {account.error && <span className="account-alert" title="Needs attention" />}
          </button>
        ))}
        <Row active={module === "accounts"} icon={<PlusIcon />} label="Manage accounts" onClick={() => onModule("accounts")} />
      </section>
    </nav>
  );
}
