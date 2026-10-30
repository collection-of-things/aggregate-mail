import { z } from "zod";

export const MAX_CONTACT_FILE_BYTES = 512 * 1024;
const MAX_ENTRIES = 5000;
const contactName = z.string().refine(value => !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value), "Use a single-line name without control characters.").trim().max(200);
const contactEmail = z.email().max(320);
export const contactSchema = z.object({
  name: contactName,
  email: contactEmail,
}).strict();

export const contactImportSchema = z.object({
  accountId: z.string().min(1).max(200),
  format: z.enum(["csv", "vcf"]),
  content: z.string().max(MAX_CONTACT_FILE_BYTES).refine(value => Buffer.byteLength(value, "utf8") <= MAX_CONTACT_FILE_BYTES),
}).strict();

// Parse data only. No formulas, links, vCard resources or attachments are executed.
function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false, endedQuote = false;
  const field = () => { row.push(cell); cell = ""; endedQuote = false; if (row.length > 128) throw new Error("Too many CSV columns."); };
  const line = () => { field(); if (row.some(value => value.trim())) rows.push(row); row = []; if (rows.length > MAX_ENTRIES + 1) throw new Error("Too many contacts."); };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') { quoted = false; endedQuote = true; }
      else cell += char;
    } else if (char === '"' && !cell && !endedQuote) quoted = true;
    else if (char === ",") field();
    else if (char === "\r" || char === "\n") { line(); if (char === "\r" && text[i + 1] === "\n") i++; }
    else if (endedQuote || char === '"') throw new Error("Malformed CSV quoting.");
    else cell += char;
  }
  if (quoted) throw new Error("Incomplete CSV field.");
  if (cell || row.length || endedQuote) line();
  return rows;
}

type Entry = { name: string; email: string };
function csvEntries(text: string): Entry[] {
  const [header, ...rows] = csvRows(text);
  if (!header) throw new Error("The file is empty.");
  const keys = header.map(value => value.trim().toLowerCase().replace(/[^a-z0-9]/g, ""));
  const emails = keys.flatMap((key, index) => /^(email\d*(address|value)?|emailaddress\d*|secondaryemail|otheremail|alternateemail\d*)$/.test(key) ? [index] : []);
  if (!emails.length) throw new Error("No email column found. Export a Google, Yahoo or Outlook CSV file.");
  const entries: Entry[] = [];
  for (const row of rows) {
    const value = (...names: string[]) => row[keys.findIndex(key => names.includes(key))]?.trim() || "";
    const name = value("name", "fullname", "displayname") || [value("firstname", "givenname", "first"), value("middlename", "additionalname", "middle"), value("lastname", "familyname", "last")].filter(Boolean).join(" ");
    const addresses = emails.map(index => row[index]?.trim()).filter((value): value is string => !!value);
    // A person without an email is counted as skipped, never saved as an empty contact.
    for (const email of addresses.length ? addresses : [""]) entries.push({ name, email });
    if (entries.length > MAX_ENTRIES) throw new Error("Too many email addresses. Export at most 5000 at a time.");
  }
  return entries;
}

const unescapeCard = (value: string) => value.replace(/\\([nN,;\\])/g, (_, char: string) => /n/i.test(char) ? "\n" : char);
function cardEntries(text: string): Entry[] {
  const entries: Entry[] = [];
  let card: { name: string; fallback: string; emails: string[] } | undefined;
  let cards = 0;
  for (const line of text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split(/\r|\n/)) {
    if (!line.trim()) continue;
    if (/^BEGIN:VCARD$/i.test(line)) {
      if (card) throw new Error("Nested vCard.");
      card = { name: "", fallback: "", emails: [] }; continue;
    }
    if (/^END:VCARD$/i.test(line)) {
      if (!card) throw new Error("Unexpected vCard ending.");
      for (const email of card.emails.length ? card.emails : [""]) entries.push({ name: card.name || card.fallback, email });
      if (++cards > MAX_ENTRIES || entries.length > MAX_ENTRIES) throw new Error("Too many contacts.");
      card = undefined; continue;
    }
    if (!card) throw new Error("Expected a vCard file.");
    const colon = line.indexOf(":");
    if (colon < 0) throw new Error("Malformed vCard field.");
    const [property, ...params] = line.slice(0, colon).split(";");
    const key = property.replace(/^.*\./, "").toUpperCase();
    if (!["FN", "N", "EMAIL"].includes(key)) continue;
    if (params.some(param => /^(ENCODING|CHARSET)=/i.test(param) && !/^CHARSET=UTF-8$/i.test(param)))
      throw new Error("Export contacts as UTF-8 vCard or CSV; encoded vCard fields are unsupported.");
    const value = line.slice(colon + 1);
    if (key === "FN") card.name = unescapeCard(value);
    if (key === "N") card.fallback = [1, 2, 0].map(index => unescapeCard(value.split(/(?<!\\);/)[index] || "")).filter(Boolean).join(" ");
    if (key === "EMAIL") card.emails.push(unescapeCard(value).replace(/^mailto:/i, "").trim());
  }
  if (card || !cards) throw new Error("Incomplete or empty vCard file.");
  return entries;
}

export function parseContactImport(content: string, format: "csv" | "vcf") {
  if (Buffer.byteLength(content, "utf8") > MAX_CONTACT_FILE_BYTES || content.includes("\0")) throw new Error("Unsupported contact file.");
  const text = content.replace(/^\uFEFF/, "");
  const raw = format === "csv" ? csvEntries(text) : cardEntries(text);
  const contacts: Entry[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  // A vCard reuses one name across every address. Validate each distinct name
  // once, with a length check before the control-character scan.
  const names = new Map<string, string | null>();
  for (const entry of raw) {
    let name = names.get(entry.name);
    if (name === undefined) {
      const parsed = entry.name.trim().length <= 200 ? contactName.safeParse(entry.name) : { success: false as const };
      name = parsed.success ? parsed.data : null;
      names.set(entry.name, name);
    }
    const key = entry.email.toLowerCase();
    if (name === null || seen.has(key)) { skipped++; continue; }
    const email = contactEmail.safeParse(entry.email);
    if (!email.success) { skipped++; continue; }
    seen.add(key); contacts.push({ name, email: email.data });
  }
  return { contacts, skipped };
}
