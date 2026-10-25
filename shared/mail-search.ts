import type { Account, Draft, Mail, MailSummary } from "./types.js";

type SearchDocument = { canonical: string[]; folded: string[] };
type CachedDocument = SearchDocument & { raw: string[]; bytes: number };
type SearchMail = Pick<Mail, "id" | "accountId" | "sender" | "address" | "to" | "cc" | "subject" | "preview" | "body" | "date" | "unread" | "pinned">;
type SearchTerm = (mail: SearchMail, document: SearchDocument) => boolean;

const documents = new Map<string, CachedDocument>();
const documentLimit = 256;
const stringByteLimit = 4 * 1024 * 1024;
let documentBytes = 0;
const emptyDocument: SearchDocument = { canonical: [], folded: [] };
const nonAscii = /[^\x00-\x7f]/;

function canonical(value: string): string {
  const lower = value.toLowerCase();
  return (nonAscii.test(lower) ? lower.normalize("NFC") : lower).replace(/\s+/gu, " ").trim();
}

function foldLatin(value: string): string {
  if (!nonAscii.test(value)) return value;
  // Preserve marks in scripts where removing them changes words, such as Thai.
  return value.normalize("NFD").replace(/(\p{Script=Latin})\p{M}+/gu, "$1").normalize("NFC");
}

function indexMail(mail: SearchMail, retain = true): SearchDocument {
  const raw = [mail.sender, mail.address, mail.to, mail.cc ?? "", mail.subject, mail.preview, mail.body];
  const key = JSON.stringify([mail.accountId, mail.id]);
  const cached = retain ? documents.get(key) : undefined;
  if (cached) {
    documents.delete(key);
    if (raw.every((value, index) => value === cached.raw[index])) {
      documents.set(key, cached);
      return cached;
    }
    documentBytes -= cached.bytes;
  }
  const normalized = raw.map(canonical);
  const folded = normalized.map(foldLatin);
  // Charge two bytes per UTF-16 code unit, including identity and all three forms,
  // even when strings share storage. The entry limit bounds container overhead.
  const bytes = 2 * (key.length + [...raw, ...normalized, ...folded].reduce((sum, value) => sum + value.length, 0));
  const document = { raw, canonical: normalized, folded, bytes };
  if (retain && bytes <= stringByteLimit) {
    while (documents.size >= documentLimit || documentBytes + bytes > stringByteLimit) {
      const [oldestKey, oldest] = documents.entries().next().value!;
      documents.delete(oldestKey);
      documentBytes -= oldest.bytes;
    }
    // Retain searchable strings only, never a Mail with HTML or attachments.
    documents.set(key, document);
    documentBytes += bytes;
  }
  return document;
}

const fields = new Set(["from", "to", "subject", "body", "account", "is", "before", "after"]);
const error = "Invalid search. Check quotes, fields, and dates.";

function tokenize(query: string): { text: string; phrase: boolean }[] | null {
  const tokens: { text: string; phrase: boolean }[] = [];
  let token = "";
  let quoted = false;
  let phrase = false;
  let active = false;
  for (const char of query) {
    if (char === '"') {
      quoted = !quoted;
      phrase = true;
      active = true;
    } else if (/\s/u.test(char) && !quoted) {
      if (active) tokens.push({ text: token, phrase });
      token = "";
      phrase = false;
      active = false;
    } else {
      token += char;
      active = true;
    }
  }
  if (quoted) return null;
  if (active) tokens.push({ text: token, phrase });
  return tokens;
}

// One insertion, deletion, substitution or adjacent transposition. No matrix.
function oneTypo(needle: string, word: string): boolean {
  if (Math.abs(needle.length - word.length) > 1) return false;
  let i = 0;
  while (i < needle.length && needle[i] === word[i]) i++;
  if (i === needle.length && i === word.length) return true;
  if (needle.length === word.length) return needle.slice(i + 1) === word.slice(i + 1) ||
    needle[i] === word[i + 1] && needle[i + 1] === word[i] && needle.slice(i + 2) === word.slice(i + 2);
  return needle.length > word.length ? needle.slice(i + 1) === word.slice(i) : needle.slice(i) === word.slice(i + 1);
}

function dateValue(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date.getTime()
    : null;
}

export function compileMailSearch(query: string, accounts: Account[] = []): { matches: (mail: Mail) => boolean; matchesSummary: (mail: MailSummary) => boolean | undefined; matchesDraft: (draft: Draft, account: Account) => boolean; error?: string } {
  const tokens = tokenize(query);
  if (!tokens) return { matches: () => false, matchesSummary: () => false, matchesDraft: () => false, error };
  const terms: SearchTerm[] = [];
  const summaryTerms: ((mail: Mail, document: SearchDocument) => boolean | undefined)[] = [];
  const lower = (value: string) => value.toLowerCase();
  let needsDocument = false;
  let allowsDrafts = true;

  for (const { text: raw, phrase } of tokens) {
    let token = raw;
    let negative = false;
    if (token.startsWith("-")) {
      negative = true;
      token = token.slice(1);
    }
    if (!token) return { matches: () => false, matchesSummary: () => false, matchesDraft: () => false, error };

    const colon = token.indexOf(":");
    const prefix = colon < 0 ? "" : token.slice(0, colon).toLowerCase();
    const value = colon < 0 ? "" : token.slice(colon + 1);
    if (fields.has(prefix) && !value) return { matches: () => false, matchesSummary: () => false, matchesDraft: () => false, error };

    let term: SearchTerm;
    let bodyDependent = false;
    if (prefix === "is") {
      allowsDrafts = false;
      const state = lower(value);
      if (state !== "read" && state !== "unread" && state !== "pinned") return { matches: () => false, matchesSummary: () => false, matchesDraft: () => false, error };
      term = state === "read" ? (mail) => !mail.unread
        : state === "unread" ? (mail) => mail.unread
        : (mail) => mail.pinned === true;
    } else if (prefix === "before" || prefix === "after") {
      const date = dateValue(value);
      if (date === null) return { matches: () => false, matchesSummary: () => false, matchesDraft: () => false, error };
      term = prefix === "before" ? (mail) => mail.date < date : (mail) => mail.date >= date;
    } else if (prefix === "account") {
      const needle = lower(value);
      const normalizeName = value.includes("@") ? canonical : (text: string) => foldLatin(canonical(text));
      const nameNeedle = normalizeName(value);
      const ids = new Set(accounts.filter((account) =>
        [account.id, account.email].some((alias) => lower(alias) === needle) ||
        (!!account.name && normalizeName(account.name) === nameNeedle),
      ).map((account) => account.id));
      term = (mail) => ids.has(mail.accountId);
    } else {
      const text = fields.has(prefix) ? value : token;
      const exact = text.includes("@");
      const needle = exact ? canonical(text) : foldLatin(canonical(text));
      if (!needle) return { matches: () => false, matchesSummary: () => false, matchesDraft: () => false, error };
      const indexes = prefix === "from" ? [0, 1] : prefix === "to" ? [2, 3]
        : prefix === "subject" ? [4] : prefix === "body" ? [6] : [0, 1, 2, 3, 4, 5, 6];
      needsDocument = true;
      bodyDependent = indexes.includes(6);
      const fuzzy = !negative && !phrase && colon < 0 && /^\p{L}{4,32}$/u.test(needle);
      term = (_mail, document) => indexes.some((index) => {
        const text = (exact ? document.canonical : document.folded)[index];
        if (text.includes(needle)) return true;
        if (fuzzy) for (const word of text.matchAll(/[\p{L}\p{M}]+/gu)) if (oneTypo(needle, word[0])) return true;
        return false;
      });
    }
    terms.push(negative ? (mail, document) => !term(mail, document) : term);
    // A header hit proves a positive plain term (or rejects its exclusion).
    // A header miss cannot rule out a body hit, including quoted/body terms.
    summaryTerms.push(bodyDependent
      ? (mail, document) => term(mail, document) ? !negative : undefined
      : negative ? (mail, document) => !term(mail, document) : term);
  }

  return { matches: (mail) => {
    const document = needsDocument ? indexMail(mail) : emptyDocument;
    return terms.every((term) => term(mail, document));
  }, matchesSummary: (mail) => {
    const metadata = { ...mail, body: "" };
    const document = needsDocument ? indexMail(metadata) : emptyDocument;
    let unknown = false;
    for (const term of summaryTerms) {
      const match = term(metadata, document);
      if (match === false) return false;
      if (match === undefined) unknown = true;
    }
    return unknown ? undefined : true;
  }, matchesDraft: (draft, account) => {
    if (!allowsDrafts || draft.accountId !== account.id) return false;
    const mail: SearchMail = { id: draft.id, accountId: draft.accountId, sender: account.name || "", address: account.email,
      to: draft.to, cc: draft.cc?.join(", "), subject: draft.subject, preview: "", body: draft.body,
      date: draft.updatedAt, unread: false };
    // Drafts can be large and contain attachment bytes. Retain summaries only;
    // normalized draft text lives for this one record, outside the mail LRU.
    const document = needsDocument ? indexMail(mail, false) : emptyDocument;
    return terms.every(term => term(mail, document));
  } };
}
