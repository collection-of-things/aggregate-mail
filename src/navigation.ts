import { useRef, useState, type SetStateAction } from "react";
import { inboxTabs, type InboxTab } from "../shared/inbox-tabs";
import type { SettingsSection } from "./settings/sections";

export type MailLocation = {
  page: "mail" | "settings";
  view: "actions" | "calendar" | "projects" | "agents" | "contacts" | "inbox" | "snoozed" | "archive" | "sent" | "all" | "drafts";
  tab: InboxTab;
  settingsSection: SettingsSection;
  accountFilter: string;
  labelFilter: string;
  query: string;
  readFilter: "all" | "unread";
  relevanceFilter: "all" | "1" | "2" | "3";
  sort: "newest" | "oldest" | "relevance";
  selectedId: string | null;
  opened: boolean;
};

const updateLocationKey = "emc2.browser-update-location";
export function rememberBrowserUpdateLocation(location: MailLocation) {
  // Tab-local, one-use navigation only. Never retain a message body or draft.
  window.sessionStorage.setItem(updateLocationKey, JSON.stringify({ location, at: Date.now() }));
}
export function takeBrowserUpdateLocation(): Partial<MailLocation> {
  if (window.desktop) return {};
  try {
    const saved = window.sessionStorage.getItem(updateLocationKey);
    window.sessionStorage.removeItem(updateLocationKey);
    if (!saved) return {};
    const { location, at } = JSON.parse(saved);
    if (!Number.isFinite(at) || Date.now() - at > 120_000 || Date.now() < at || !location || location.page !== "mail" ||
      !["inbox", "snoozed", "archive", "sent", "all"].includes(location.view) ||
      !inboxTabs.some(tab => tab.id === location.tab) ||
      !["all", "unread"].includes(location.readFilter) || !["all", "1", "2", "3"].includes(location.relevanceFilter) ||
      !["newest", "oldest", "relevance"].includes(location.sort) || typeof location.opened !== "boolean" ||
      !["accountFilter", "labelFilter", "query"].every(key => typeof location[key] === "string" && location[key].length <= 4000) ||
      !(location.selectedId === null || typeof location.selectedId === "string")) return {};
    const { view, tab, accountFilter, labelFilter, query, readFilter, relevanceFilter, sort, selectedId, opened } = location;
    return { view, tab, accountFilter, labelFilter, query, readFilter, relevanceFilter, sort, selectedId, opened };
  } catch { return {}; }
}

export function useMailNavigation() {
  const [location, update] = useState<MailLocation>(() => ({
    page: "mail", view: "actions", tab: "primary", settingsSection: "interaction", accountFilter: "all", labelFilter: "all", query: "", readFilter: "all", relevanceFilter: "all", sort: "newest", selectedId: null, opened: false,
    ...takeBrowserUpdateLocation(),
  }));
  // Menu history stays in memory. Reader selection is not a visit.
  const history = useRef({ entries: [location], index: 0, editingSearch: false, reader: null as MailLocation | null });
  const visit = (patch: Partial<MailLocation>, search = false) => {
    const next = { ...location, ...patch };
    const menuKeys = ["page", "settingsSection", "view", "tab", "accountFilter", "labelFilter", "query", "readFilter", "relevanceFilter", "sort"] as const;
    if (menuKeys.every((key) => next[key] === location[key])) {
      update(next);
      return;
    }
    const current = history.current;
    current.reader = null;
    current.entries[current.index] = location;
    current.entries = current.entries.slice(0, current.index + 1);
    if (search && current.editingSearch) current.entries[current.index] = next;
    else {
      current.entries.push(next);
      current.index++;
    }
    current.editingSearch = search;
    update(next);
  };
  const travel = (direction: -1 | 1, resolve: (location: MailLocation) => MailLocation) => {
    const current = history.current;
    if (direction === -1 && location.opened && location.page !== "settings") {
      current.reader = location;
      update(resolve({ ...location, opened: false }));
      return;
    }
    if (direction === 1 && current.reader && !location.opened && location.page !== "settings") {
      const reader = current.reader;
      current.reader = null;
      update(resolve(reader));
      return;
    }
    const index = current.index + direction;
    if (index < 0 || index >= current.entries.length) return;
    const settingsVisit = location.page === "settings" || current.entries[index].page === "settings";
    current.reader = null;
    current.entries[current.index] = location;
    current.index = index;
    current.editingSearch = false;
    update(resolve({ ...current.entries[index], ...(settingsVisit ? {} : { selectedId: null, opened: false }) }));
  };
  return {
    location, visit, travel,
    update: (next: SetStateAction<MailLocation>) => {
      history.current.reader = null;
      update(next);
    },
    canBack: location.opened || history.current.index > 0,
    canForward: (!location.opened && history.current.reader !== null) || history.current.index < history.current.entries.length - 1,
  };
}
