// Saved contacts are explicit user entries. Recent recipients come only from
// successful sends. Both belong to one connected account.
export type SavedContact = { kind: "saved"; id: string; accountId: string; name: string; email: string; updatedAt: number };
export type RecentRecipient = { kind: "recent"; id: string; accountId: string; email: string; lastSentAt: number };
export type ContactSuggestion = SavedContact | RecentRecipient;
export type ContactList = { saved: SavedContact[]; recent: RecentRecipient[] };
export type ContactImport = { accountId: string; format: "csv" | "vcf"; content: string };
export type ContactImportPreview = { added: number; skipped: number; duplicates: number; sample: Pick<SavedContact, "name" | "email">[] };
