import type { Account, GmailLabel } from "../shared/types";
import type { MailLocation } from "./navigation";
import { accountLabel } from "./mail-ui";
import { viewNames } from "./mail/format";
import { collectPrivateNames, redactPrivateText } from "./privacy";

export function mailSearchScope(location: MailLocation, accounts: Account[], label: GmailLabel | undefined, privacy: boolean, includesDrafts: boolean) {
  const index = accounts.findIndex(account => account.id === location.accountFilter);
  return [
    `Cached ${viewNames[location.view]}`,
    location.accountFilter === "all" ? "All accounts" : index < 0 ? "Unavailable account" : accountLabel(accounts[index], index, privacy, accounts),
    location.readFilter === "unread" ? "Unread" : "All read states",
    location.relevanceFilter === "all" ? "All relevance" : `${({ "1": "Low", "2": "Medium", "3": "High" })[location.relevanceFilter]} relevance`,
    location.labelFilter === "all" ? "All labels" : label ? `Label: ${privacy ? redactPrivateText(label.name, collectPrivateNames(accounts)) : label.name}` : "Unavailable label",
    ({ newest: "Newest first", oldest: "Oldest first", relevance: "Highest relevance first" })[location.sort],
    includesDrafts ? "Includes saved drafts" : "Mail only",
  ].join(" · ");
}

export function widenMailSearch(): Partial<MailLocation> {
  return { page: "mail", view: "all", labelFilter: "all", readFilter: "all", relevanceFilter: "all", selectedId: null, opened: false };
}
