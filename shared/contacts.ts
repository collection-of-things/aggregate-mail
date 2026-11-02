// Saved contacts are explicit user entries. Recent recipients come only from
// successful sends. Both belong to one connected account.
export type SavedContact = { kind: "saved"; id: string; accountId: string; name: string; email: string; updatedAt: number };
export type RecentRecipient = { kind: "recent"; id: string; accountId: string; email: string; lastSentAt: number };
export type ContactSuggestion = SavedContact | RecentRecipient;
export type ContactList = { saved: SavedContact[]; recent: RecentRecipient[] };
export type ContactImport = { accountId: string; format: "csv" | "vcf"; content: string; updateNames?: boolean };
export type ContactNameChange = { email: string; name: string; previousName: string };
// Re-import results classify the file against saved contacts before any write:
// new addresses (added), saved addresses with a different non-empty file name
// (changed; rewritten only on an opt-in updateNames import → updated), saved
// addresses with a matching or empty file name (unchanged), saved contacts
// absent from the file (missing; never removed) and invalid or repeated file
// addresses (skipped). sample/changes list the first five of their kind.
export type ContactImportPreview = {
  added: number;
  changed: number;
  updated: number;
  unchanged: number;
  missing: number;
  skipped: number;
  sample: Pick<SavedContact, "name" | "email">[];
  changes: ContactNameChange[];
};
