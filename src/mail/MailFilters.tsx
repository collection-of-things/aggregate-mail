import { useContext, useEffect, useRef } from "react";
import type { Account, GmailLabel } from "../../shared/types";
import type { MailLocation } from "../navigation";
import { Dropdown } from "../ui/Dropdown";
import { accountLabel } from "../mail-ui";
import { PrivacyContext } from "../ui/Privacy";
import { Filter } from "../ui/icons";

export type PinnedScope = "view" | "all";

/**
 * The Filters button and its popover: read status, relevance, sort, Gmail
 * label and a shortcut to pinned mail for the cached mail list. The popover
 * stays open while choices change and closes on Escape or a click elsewhere.
 * The button stays lit while any choice differs from its default, so a
 * filtered list is never a surprise.
 */
export function MailFilters({ open, active, location, labels, accounts, blocked, showReset, labelName, onOpen, onChange, onFindPinned, onReset }: {
  open: boolean;
  active: boolean;
  location: Pick<MailLocation, "readFilter" | "relevanceFilter" | "sort" | "labelFilter" | "accountFilter">;
  labels: GmailLabel[];
  accounts: Account[];
  blocked: boolean;
  showReset: boolean;
  labelName: (name: string) => string;
  onOpen: (open: boolean) => void;
  onChange: (patch: Partial<MailLocation>) => void;
  onFindPinned: (scope: PinnedScope) => void;
  onReset: () => void;
}) {
  const { on: privacy } = useContext(PrivacyContext);
  const { readFilter, relevanceFilter, sort, labelFilter, accountFilter } = location;
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) onOpen(false);
    };
    // Escape closes the popover before it can close an open email; an open
    // dropdown inside it handles its own Escape first.
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || (event.target as Element | null)?.closest?.('[aria-expanded="true"][role="combobox"]')) return;
      event.preventDefault();
      event.stopPropagation();
      onOpen(false);
    };
    window.addEventListener("mousedown", away);
    window.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", escape, true);
    };
  }, [open, onOpen]);
  return (
    <div className="filter-menu" ref={root}>
      <button data-compose-access
        className={active || open ? "icon on" : "icon"}
        aria-label="Filters"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Filters and sort"
        onClick={() => onOpen(!open)}
      >
        <Filter color="currentColor" size={15} />
        {active && <i className="filter-dot" aria-hidden="true" />}
      </button>
      {open && (
        <div className="popover filter-popover" role="dialog" aria-label="Mail filters and sort">
          <span>Show</span>
          <Dropdown label="Read status" value={readFilter} disabled={blocked}
            options={[{ value: "all", label: "All mail" }, { value: "unread", label: "Unread" }]}
            onChange={(readFilter) => onChange({ readFilter })} />
          <span>Relevance</span>
          <Dropdown label="Relevance filter" value={relevanceFilter} disabled={blocked}
            options={[{ value: "all", label: "All relevance" }, { value: "3", label: "High relevance" },
              { value: "2", label: "Medium relevance" }, { value: "1", label: "Low relevance" }]}
            onChange={(relevanceFilter) => onChange({ relevanceFilter })} />
          <span>Sort by</span>
          <Dropdown label="Sort mail" value={sort} disabled={blocked}
            options={[{ value: "newest", label: "Newest" }, { value: "oldest", label: "Oldest" }, { value: "relevance", label: "Relevance" }]}
            onChange={(sort) => onChange({ sort })} />
          {labels.length > 0 && (
            <>
              <span>Gmail label</span>
              <div className="label-filter">
                <Dropdown
                  label="Filter by Gmail label"
                  disabled={blocked}
                  value={labelFilter}
                  options={[
                    { value: "all", label: "All labels" },
                    ...labels.map((label) => {
                      const index = accounts.findIndex(account => account.id === label.accountId);
                      const owner = index < 0 ? "Gmail" : accountLabel(accounts[index], index, privacy, accounts);
                      const name = accountFilter === "all" ? `${labelName(label.name)} (${owner})` : labelName(label.name);
                      return { value: `${label.accountId}:${label.id}`, label: name };
                    }),
                  ]}
                  onChange={(labelFilter) => onChange({ labelFilter })}
                />
              </div>
            </>
          )}
          <span>Pinned</span>
          <div className="pinned-filter">
            <button type="button" className="link" disabled={blocked} aria-label="Find pinned mail in this view"
              onClick={() => onFindPinned("view")}>In this view</button>
            <button type="button" className="link" disabled={blocked} aria-label="Find pinned mail in All cached"
              onClick={() => onFindPinned("all")}>All cached</button>
          </div>
          <p className="pinned-help">Pin keeps mail for reference. Snooze brings it back later. Track records work.</p>
          {showReset && <button type="button" className="link filter-reset" disabled={blocked}
            onClick={onReset}>Reset filters and sort</button>}
        </div>
      )}
    </div>
  );
}
