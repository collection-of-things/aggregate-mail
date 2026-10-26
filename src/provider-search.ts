import type { ProviderSearchResult } from "../shared/types";

// One line naming what the provider actually searched and what it found.
// Cached results stay labelled "Cached"; this describes only the provider run.
export function providerSearchCoverage(result: ProviderSearchResult): string {
  const mailboxes = { archive: "Archive", all: "All Mail", sent: "Sent" } as const;
  const label = result.source === "gmail" ? "Gmail search"
    : result.mailboxes?.length ? `IMAP search of ${result.mailboxes.map((mailbox) => mailboxes[mailbox]).join(" and ")}`
    : "IMAP search";
  const coverage = result.examined === 0 && result.complete ? `${label}: no matches.`
    : result.complete ? `${label}: all ${result.examined} ${result.examined === 1 ? "match" : "matches"}, ${result.imported} new.`
    : `${label}, first ${result.examined} matches, ${result.imported} new. More remain on the server.`;
  return result.narrowed.length ? `${coverage} Applied after import: ${result.narrowed.join(", ")}.` : coverage;
}
