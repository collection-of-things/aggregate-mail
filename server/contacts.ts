import { randomUUID } from "node:crypto";
import express from "express";
import { z } from "zod";
import type { ContactList, ContactSuggestion, RecentRecipient, SavedContact } from "../shared/contacts.js";
import { all, get, put, remove, transaction } from "./store.js";

export const MAX_SAVED_CONTACTS_PER_ACCOUNT = 1000;
export const MAX_RECENT_RECIPIENTS_PER_ACCOUNT = 200;
const MAX_SUGGESTIONS = 8;
const contactSchema = z.object({
  name: z.string()
    .refine((value) => !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value), "Use a single-line name without control characters.")
    .trim().max(200),
  email: z.email().max(320),
}).strict();
const createSchema = contactSchema.extend({ accountId: z.string().min(1).max(200) }).strict();
const suggestionSchema = z.object({ query: z.string().max(320), accountId: z.string().max(200) }).strict();

class ContactError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const connectedAccounts = () => new Set(all("account").map((a) => a.id));
const byName = (a: SavedContact, b: SavedContact) => (a.name || a.email).localeCompare(b.name || b.email) || a.id.localeCompare(b.id);
const newestFirst = (a: RecentRecipient, b: RecentRecipient) => b.lastSentAt - a.lastSentAt || a.id.localeCompare(b.id);

function requireAccount(accountId: string) {
  if (!get("account", accountId)) throw new ContactError(404, "Account not found.");
}
function rejectDuplicate(contact: Pick<SavedContact, "accountId" | "email">, id?: string) {
  if (all("contact").some((other) => other.id !== id && other.accountId === contact.accountId && sameAddress(other.email, contact.email)))
    throw new ContactError(409, "This account already has a contact with that address.");
}

export function listContacts(): ContactList {
  const accounts = connectedAccounts();
  return {
    saved: all("contact").filter((contact) => accounts.has(contact.accountId)).sort(byName),
    recent: all("recentRecipient").filter((recipient) => accounts.has(recipient.accountId)).sort(newestFirst),
  };
}

export function createContact(value: unknown): SavedContact {
  const input = createSchema.parse(value);
  return transaction(() => {
    requireAccount(input.accountId);
    rejectDuplicate(input);
    if (all("contact").filter((contact) => contact.accountId === input.accountId).length >= MAX_SAVED_CONTACTS_PER_ACCOUNT)
      throw new ContactError(409, "Contact limit reached for this account. Delete a contact before adding another.");
    const contact: SavedContact = { kind: "saved", id: randomUUID(), ...input, updatedAt: Date.now() };
    put("contact", contact.id, contact);
    return contact;
  });
}

export function updateContact(id: string, value: unknown): SavedContact {
  const input = contactSchema.parse(value);
  return transaction(() => {
    const current = get("contact", id);
    if (!current) throw new ContactError(404, "Contact not found.");
    rejectDuplicate({ accountId: current.accountId, email: input.email }, id);
    const contact: SavedContact = { ...current, ...input, updatedAt: Date.now() };
    put("contact", id, contact);
    return contact;
  });
}

function deleteRecord(kind: "contact" | "recentRecipient", id: string) {
  transaction(() => {
    if (!get(kind, id)) throw new ContactError(404, "Contact not found.");
    remove(kind, id);
  });
}

// Called only after the provider accepted a message. Connected account
// addresses are skipped, and each account keeps its newest recipients.
export function recordRecentRecipients(accountId: string, addresses: readonly string[]) {
  transaction(() => {
    if (!get("account", accountId)) return;
    const own = all("account").map((a) => a.email);
    const recent = all("recentRecipient").filter((recipient) => recipient.accountId === accountId);
    for (const address of addresses.map((value) => value.trim()).filter(Boolean)) {
      if (own.some((email) => sameAddress(email, address))) continue;
      // Strictly increasing times keep the send order when several land in one millisecond.
      const lastSentAt = Math.max(Date.now(), ...recent.map((recipient) => recipient.lastSentAt + 1));
      const existing = recent.find((recipient) => sameAddress(recipient.email, address));
      const entry: RecentRecipient = existing ? { ...existing, lastSentAt } : { kind: "recent", id: randomUUID(), accountId, email: address, lastSentAt };
      if (existing) recent.splice(recent.indexOf(existing), 1, entry);
      else recent.push(entry);
      put("recentRecipient", entry.id, entry);
    }
    for (const stale of recent.sort(newestFirst).slice(MAX_RECENT_RECIPIENTS_PER_ACCOUNT)) remove("recentRecipient", stale.id);
  });
}

// Saved contacts come before sent recipients, and the sending account before
// other accounts. Each address appears once, from its best-ranked source.
export function suggestContacts(query: string, accountId: string): ContactSuggestion[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const { saved, recent } = listContacts();
  const startsWith = (suggestion: ContactSuggestion) => suggestion.email.toLowerCase().startsWith(needle) ||
    (suggestion.kind === "saved" && suggestion.name.toLowerCase().split(/\s+/).some((word) => word.startsWith(needle)));
  const rank = (suggestion: ContactSuggestion) => [suggestion.accountId === accountId ? 0 : 1, suggestion.kind === "saved" ? 0 : 1, startsWith(suggestion) ? 0 : 1];
  const matches = [...saved, ...recent].filter((suggestion) => suggestion.email.toLowerCase().includes(needle) ||
    (suggestion.kind === "saved" && suggestion.name.toLowerCase().includes(needle)));
  // The stable sort keeps names alphabetical and recipients newest first within a rank.
  const ranked = matches.sort((a, b) => {
    const [left, right] = [rank(a), rank(b)];
    return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
  });
  const seen = new Set<string>();
  return ranked.filter((suggestion) => {
    const key = suggestion.email.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, MAX_SUGGESTIONS);
}

// Runs inside the account-removal transaction.
export function removeAccountContacts(accountId: string) {
  for (const contact of all("contact")) if (contact.accountId === accountId) remove("contact", contact.id);
  for (const recipient of all("recentRecipient")) if (recipient.accountId === accountId) remove("recentRecipient", recipient.id);
}

export function mountContacts(app: express.Express) {
  const router = express.Router();
  // These routes inherit /api session, origin, CSRF and update guards.
  router.get("/", (_req, res) => { res.json(listContacts()); });
  router.get("/suggestions", (req, res) => {
    const { query, accountId } = suggestionSchema.parse(req.query);
    res.json(suggestContacts(query, accountId));
  });
  router.post("/", (req, res) => { res.status(201).json(createContact(req.body)); });
  router.put<{ id: string }>("/:id", (req, res) => { res.json(updateContact(req.params.id, req.body)); });
  router.delete<{ id: string }>("/:id", (req, res) => { deleteRecord("contact", req.params.id); res.json({ ok: true }); });
  router.delete<{ id: string }>("/recent/:id", (req, res) => { deleteRecord("recentRecipient", req.params.id); res.json({ ok: true }); });
  // Messages never echo the submitted name or address.
  router.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (error instanceof ContactError) res.status(error.status).json({ error: error.message });
    else if (error instanceof z.ZodError) res.status(400).json({ error: "Enter a valid address and a single-line name." });
    else next(error);
  });
  app.use("/api/contacts", router);
}
