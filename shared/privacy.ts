import { personalMailDomains } from "./types.js";

export type PrivacyAccount = { email: string; name?: string };
// Owner-chosen lists. Hidden names join every matcher; visible names leave the
// name matchers only, so addresses and postal lines stay hidden.
export type PrivacyWords = { hidden: string[]; visible: string[] };
export const emptyPrivacyWords: PrivacyWords = { hidden: [], visible: [] };
// Hidden entries share the 100-name matcher budget with learned and per-message names.
export const PRIVACY_WORDS_HIDDEN_MAX = 12, PRIVACY_WORDS_VISIBLE_MAX = 64, PRIVACY_WORD_LENGTH_MAX = 100, PRIVACY_WORD_WORDS_MAX = 6;
type RecipientHeaders = { to?: string; cc?: string };
export type MailPrivacyInput = { sender?: string; address?: string; to?: string; cc?: string; replyTo?: string; direction?: string };
export type PrivacyRange = {
  start: number;
  end: number;
  // "hidden" covers text the matcher could not check; it is never revealable.
  kind: "address" | "name" | "hidden";
  value: string;
};
export type PrivacySegment = {
  start: number;
  end: number;
  text: string;
  kind: "text" | PrivacyRange["kind"];
  value?: string;
};

export const PRIVACY_MASK = "••••••••";

const addressToken = /[^\s<>()"',;:]+/g;
const wordCharacter = /[\p{L}\p{M}\p{N}_]/u;
const cleanName = (name: string) => name.trim().replace(/\s+/gu, " ");

// Headers are already mailparser-formatted. Quotes protect commas and escapes.
// Without emails, collect the display name of every address in the header.
function recipientNames(header: string, emails?: ReadonlySet<string>): string[] {
  return recipientEntries(header).filter((entry) => !emails || emails.has(entry.email)).map((entry) => entry.name);
}
function recipientEntries(header: string): { name: string; email: string }[] {
  const names: { name: string; email: string }[] = [];
  let start = 0;
  let angle = -1;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < header.length; index++) {
    const character = header[index];
    if (escaped) { escaped = false; continue; }
    if (quoted && character === "\\") { escaped = true; continue; }
    if (character === '"' && angle < 0) { quoted = !quoted; continue; }
    if (quoted) continue;
    if (character === "<") angle = index;
    else if (character === ">" && angle >= 0) {
      let name = header.slice(start, angle).trim();
      if (name.startsWith('"') && name.endsWith('"'))
        name = name.slice(1, -1).replace(/\\(.)/g, "$1");
      if (name) names.push({ name, email: header.slice(angle + 1, index).trim().toLowerCase() });
      start = index + 1;
      angle = -1;
    } else if (angle < 0 && (character === ":" || character === ";")) {
      start = index + 1;
    } else if (angle < 0 && character === ",") {
      const preceding = header.slice(start, index).trim();
      // A comma inside an unquoted surname stays in the phrase.
      if (!preceding || preceding.includes("@")) start = index + 1;
    }
  }
  return names;
}

function privateNames(candidates: readonly string[]): string[] {
  const names = new Map<string, string>();
  for (const candidate of candidates) {
    const name = cleanName(candidate);
    if (name && /\p{L}/u.test(name)) names.set(name.toLowerCase(), name);
  }
  // Greetings often use only the first name or surname from the same recipient.
  for (const name of [...names.values()]) {
    for (const part of name.split(/[\s,]+/u)) {
      if (/^\p{L}[\p{L}\p{M}’'-]*$/u.test(part) && !/^(mr|mrs|ms|mx|dr)$/i.test(part))
        names.set(part.toLowerCase(), part);
    }
  }
  return [...names.values()];
}

// Use one message's headers, not a mailbox-wide alias dictionary.
export function collectPrivateNames(
  accounts: readonly PrivacyAccount[],
  recipients: RecipientHeaders = {},
): string[] {
  const emails = new Set(accounts.map((account) => account.email.trim().toLowerCase()));
  return privateNames([
    ...accounts.map((account) => account.name || ""),
    ...recipientNames(recipients.to || "", emails),
    ...recipientNames(recipients.cc || "", emails),
  ]);
}

function unquotedSender(sender: string) {
  return sender.startsWith('"') && sender.endsWith('"')
    ? sender.slice(1, -1).replace(/\\(.)/g, "$1")
    : sender;
}

// Use the permitted accounts and every message in the output being redacted.
export function collectMailPrivateNames(
  accounts: readonly PrivacyAccount[],
  mails: MailPrivacyInput | readonly MailPrivacyInput[],
): string[] {
  const candidates = accounts.map((account) => account.name || "");
  for (const mail of Array.isArray(mails) ? mails : [mails]) {
    const sender = mail.sender || "";
    if (sender && sender !== "Unknown sender") {
      if (sender.includes("<")) candidates.push(...recipientNames(sender));
      else if (!sender.includes("@")) candidates.push(unquotedSender(sender));
    }
    candidates.push(
      ...recipientNames(mail.to || ""),
      ...recipientNames(mail.cc || ""),
      ...recipientNames(mail.replyTo || ""),
    );
  }
  return privateNames(candidates);
}

// Automated and departmental mailboxes send for an organization. Addresses
// people often use personally (hello@, team@, contact@) are not listed.
// Only a +tag or a number may follow, so info.jane@ stays a person.
const roleMailbox = /^(?:no-?reply|do-?not-?reply|donotreply|info|support|news|newsletters?|notifications?|notify|alerts?|updates?|marketing|billing|accounts?|customer-?service|mailer|orders?|receipts?|security|digest)(?:\+[^@]*|[-_.]?\d+)?$/i;
// A sender is a business when its display name matches a whole label of its
// own non-personal domain (Kickstarter <…@kickstarter.com>,
// Running Warehouse | Info <…@runningwarehouse.com>). Services relay people's
// names from role mailboxes (Jane Smith <notifications@github.com>), so there a
// name passes only when it matches the domain as a whole or, without
// organization and role words, it is empty or starts a domain label
// (The Varo Bank Team <alerts@varomoney.com>).
// Otherwise a mailbox containing one of the name's words (sean.ford@ford.com) is a person.
// A person whose name is their domain is a known gap; Always hide covers it.
export function businessSender(name: string, email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at < 1) return false;
  const local = email.slice(0, at).trim().toLowerCase(), domain = email.slice(at + 1).trim().toLowerCase();
  if (!domain || personalMailDomains.has(domain)) return false;
  // Every label but the top-level one.
  const labels = domain.split(".").slice(0, -1).map((label) => label.replace(/[^a-z0-9]/g, ""));
  const tokens = name.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (roleMailbox.test(local)) {
    // The whole name first, since role words can be part of it (Bank of America).
    const whole = tokens.join(""), rest = tokens.filter((word) => !roleNameWord.test(word)).join("");
    if (whole.length >= 3 && (whole === domain.replace(/[^a-z0-9]/g, "") || labels.includes(whole))) return true;
    return !rest || rest.length >= 3 && (rest === domain.replace(/[^a-z0-9]/g, "") || labels.some((label) => label.startsWith(rest)));
  }
  // A name word in the mailbox marks a person, unless that word is the brand label itself.
  if (tokens.some((word) => word.length >= 3 && local.includes(word) && !labels.includes(word))) return false;
  // Every token counts, so "Ed Ford" never reduces to the label "ford".
  const compactName = tokens.join("");
  if (compactName.length < 3) return false;
  // The whole name is a label or the whole domain (Amazon.com), optionally
  // followed by one organization word (Acme Inc).
  if (compactName === domain.replace(/[^a-z0-9]/g, "")) return true;
  return labels.some((label) => label === compactName ||
    label.length >= 3 && compactName.startsWith(label) && organizationSuffix.test(compactName.slice(label.length)));
}
const organizationSuffix = /^(?:inc|llc|ltd|corp|company|group|hq|official|news|mail|bank|support|info|updates?)$/;
const roleNameWord = /^(?:the|of|and|by|team|inc|llc|ltd|corp|company|group|hq|official|news|newsletters?|mail|bank|support|info|updates?|billing|alerts?|notifications?|orders?|receipts?|security|service|customer|care|accounts?|marketing|digest)$/;

// One message often omits the owner's display name (bare To, quoted orders),
// so owner names also come from every cached message that names an account
// address: To/Cc phrases and the sender of mail sent from that address. The
// most frequent full names win, which keeps the matcher list bounded.
export const LEARNED_OWNER_NAMES_MAX = 4, LEARNED_NAMES_BUDGET = 24;
export function learnedOwnerNames(
  accounts: readonly PrivacyAccount[],
  mails: readonly MailPrivacyInput[],
  limit = LEARNED_OWNER_NAMES_MAX,
  minimumMessages = 2,
): string[] {
  const emails = new Set(accounts.map((account) => account.email.trim().toLowerCase()));
  const counts = new Map<string, { name: string; count: number; sent: boolean }>();
  // Recipient display names come from other senders: bound their shape so one
  // crafted header cannot exceed the matcher limits and hide whole texts.
  const add = (candidate: string, sent: boolean, seen: Set<string>) => {
    const name = cleanName(candidate);
    if (!name || name.includes("@") || !/\p{L}/u.test(name)) return;
    // Words are counted the way the matcher splits them (spaces and +).
    const words = name.split(/[\s+]+/u).filter(Boolean).length;
    if (sent ? name.length > 100 || words > 8 : name.length > 60 || words > 4) return;
    // Received phrases made only of common words ("Valued Customer") are not names.
    if (!sent && name.split(/[\s,]+/u).every((part) => commonWords.has(part.toLowerCase()))) return;
    const key = name.toLowerCase();
    // Each message counts once, even when To and Cc repeat a phrase.
    if (seen.has(key)) return;
    seen.add(key);
    const entry = counts.get(key);
    if (entry) { entry.count++; entry.sent ||= sent; }
    else counts.set(key, { name, count: 1, sent });
  };
  for (const mail of mails) {
    const seen = new Set<string>();
    for (const name of recipientNames(mail.to || "", emails)) add(name, false, seen);
    for (const name of recipientNames(mail.cc || "", emails)) add(name, false, seen);
    // From can be forged, so only mail the provider filed as sent counts as the owner's.
    const owner = mail.direction === "sent" ? ownerSender(mail, emails) : "";
    if (owner) add(owner, true, new Set());
  }
  // A name on too few received messages is not yet trusted as the owner's.
  const ranked = [...counts.values()].filter((entry) => entry.sent || entry.count >= minimumMessages)
    .sort((left, right) => Number(right.sent) - Number(left.sent) || right.count - left.count).slice(0, limit);
  // Learned names with their parts stay inside a fixed share of the matcher budget.
  const top: typeof ranked = [];
  for (const entry of ranked) {
    if (privateNames([...top, entry].map((item) => item.name)).length > LEARNED_NAMES_BUDGET) continue;
    top.push(entry);
  }
  // Single Latin letters (middle initials) would hide that letter everywhere,
  // and common words from received phrases would hide ordinary text. The
  // owner's own sent name keeps every part.
  const sentParts = new Set(privateNames(top.filter((entry) => entry.sent).map((entry) => entry.name)).map((name) => name.toLowerCase()));
  return privateNames(top.map((entry) => entry.name)).filter((name) => !/^[a-z]$/i.test(name) &&
    (sentParts.has(name.toLowerCase()) || !commonWords.has(name.toLowerCase())));
}
// Work surfaces cover owner aliases seen on any single cached message, bounded
// so that with Always hide and account names they stay inside the matcher limit.
export const WORK_OWNER_NAMES_MAX = 6;
export const workOwnerNames = (accounts: readonly PrivacyAccount[], mails: readonly MailPrivacyInput[]) =>
  learnedOwnerNames(accounts, mails, WORK_OWNER_NAMES_MAX, 1);
function ownerSender(mail: MailPrivacyInput, emails: ReadonlySet<string>) {
  const sender = mail.sender || "";
  if (!sender || sender === "Unknown sender" || !emails.has((mail.address || "").trim().toLowerCase())) return "";
  return sender.includes("<") ? recipientNames(sender)[0] || "" : sender.includes("@") ? "" : unquotedSender(sender);
}

const commonWords = new Set(("the and of to a an in on at by for from with or my your our dear " +
  "customer member user subscriber valued team").split(" "));

// Owner-chosen hidden names join; visible names leave. When a kept-visible
// full name was in the list, its single words leave too, unless the owner
// hid that word or another listed full name still contains it (Never hide
// "Morgan Stanley" must not reveal the owner "Morgan Lee"). Comparison ignores case.
export function applyPrivacyWords(names: readonly string[], words?: Partial<PrivacyWords>): string[] {
  const result = new Map<string, string>();
  for (const name of [...names, ...words?.hidden ?? []]) {
    const clean = cleanName(name);
    if (clean) result.set(clean.toLowerCase(), clean);
  }
  const hidden = new Set((words?.hidden ?? []).map((name) => cleanName(name).toLowerCase()));
  const parts: string[] = [];
  for (const name of words?.visible ?? []) {
    const clean = cleanName(name).toLowerCase();
    if (result.delete(clean)) parts.push(...clean.split(/[\s,]+/u).filter(Boolean));
  }
  const stillNamed = new Set([...result.keys()].filter((name) => /[\s,]/u.test(name)).flatMap((name) => name.split(/[\s,]+/u)));
  for (const part of parts) if (!hidden.has(part) && !stillNamed.has(part)) result.delete(part);
  return [...result.values()];
}

// Names for one surface: the inherited list (with Always hide) stays whole.
// Never hide applies separately to the message's owner names and to its other
// added names, so a kept-visible business phrase, absent from the owner list,
// can never drop an owner or Always hide word, while the owner's own
// Keep visible choices still apply.
export function scopedMessageNames(
  inherited: readonly string[],
  accounts: readonly PrivacyAccount[],
  mails: readonly MailPrivacyInput[],
  visible: readonly string[] = [],
): string[] {
  const added = mails.flatMap((mail) => messagePrivateNames(accounts, mail));
  const owner = mails.flatMap((mail) => messageOwnerNames(accounts, mail));
  const result = new Map<string, string>();
  const lists = { visible: [...visible] };
  for (const name of [...inherited, ...applyPrivacyWords(owner, lists), ...applyPrivacyWords(added, lists)]) {
    const clean = cleanName(name);
    if (clean) result.set(clean.toLowerCase(), clean);
  }
  return [...result.values()];
}
function messageOwnerNames(accounts: readonly PrivacyAccount[], mail: MailPrivacyInput): string[] {
  const emails = new Set(accounts.map((account) => account.email.trim().toLowerCase()));
  const owner = ownerSender(mail, emails);
  return [...collectPrivateNames(accounts, mail), ...owner ? privateNames([owner]) : []];
}

// Per-message surfaces need every correspondent name, not only the owner's:
// sender and To/Cc display names join as whole phrases, because a third-party
// first name or common surname would mask ordinary words across the surface.
// Owner names keep collectPrivateNames's first-name/surname parts.
export function messagePrivateNames(
  accounts: readonly PrivacyAccount[],
  mail: MailPrivacyInput,
): string[] {
  const names = new Map<string, string>();
  for (const name of collectPrivateNames(accounts, mail)) names.set(name.toLowerCase(), name);
  const add = (candidate: string) => {
    const name = cleanName(candidate);
    if (name && !name.includes("@") && /\p{L}/u.test(name)) names.set(name.toLowerCase(), name);
  };
  const emails = new Set(accounts.map((account) => account.email.trim().toLowerCase()));
  // Mail sent from an owner address names the owner: split it like account names.
  const owner = ownerSender(mail, emails);
  if (owner) for (const name of privateNames([owner])) names.set(name.toLowerCase(), name);
  const sender = mail.sender || "";
  if (!owner && sender && sender !== "Unknown sender") {
    if (sender.includes("<")) {
      for (const entry of recipientEntries(sender)) if (!businessSender(entry.name, entry.email)) add(entry.name);
    } else if (!sender.includes("@") && !businessSender(unquotedSender(sender), mail.address || "")) add(unquotedSender(sender));
  }
  for (const entry of [
    ...recipientEntries(mail.to || ""),
    ...recipientEntries(mail.cc || ""),
    ...recipientEntries(mail.replyTo || ""),
  ]) if (emails.has(entry.email) || !businessSender(entry.name, entry.email)) add(entry.name);
  return [...names.values()];
}

// Map decoded URL bytes back to source offsets, including malformed UTF-8.
function decodedText(text: string) {
  let decoded = "";
  const offsets: [number, number][] = [];
  let last = 0;
  const append = (start: number, end: number) => {
    for (let index = start; index < end; index++) {
      decoded += text[index];
      offsets.push([index, index + 1]);
    }
  };
  for (const match of text.matchAll(/(?:%[\da-f]{2})+/gi)) {
    append(last, match.index);
    for (let position = 0; position < match[0].length;) {
      const byte = parseInt(match[0].slice(position + 1, position + 3), 16);
      let width = byte >= 0xc2 && byte <= 0xdf ? 2 :
        byte >= 0xe0 && byte <= 0xef ? 3 : byte >= 0xf0 && byte <= 0xf4 ? 4 : 1;
      let value: string;
      try { value = decodeURIComponent(match[0].slice(position, position + width * 3)); }
      catch { value = "\ufffd"; width = 1; }
      const start = match.index + position;
      const end = start + width * 3;
      decoded += value;
      for (let index = 0; index < value.length; index++) offsets.push([start, end]);
      position += width * 3;
    }
    last = match.index + match[0].length;
  }
  append(last, text.length);
  return { decoded, offsets };
}

// US-style postal lines: "422 Southeast 17th Place" and "Ocala, FL 32712".
// Words start with a capital or digit, which keeps prose such as "10 people
// on the way" visible. Each repetition is bounded and unambiguous.
const streetSuffixes = new Set(("street st avenue ave road rd boulevard blvd drive dr lane ln way place pl " +
  "court ct terrace ter circle cir parkway pkwy highway hwy trail trl square sq loop plaza plz crescent").split(" "));
const streetLine = /(?<![\p{L}\p{N}_.\/#$-])\d{1,6}[A-Za-z]?(?:[ \t]+[\p{Lu}\p{N}][\p{L}\p{N}'.-]{0,40}){2,5}/gu;
// A city line cannot start inside a word or after its punctuation, and each
// word is bounded, so a long hyphenated run cannot rescan quadratically.
const cityLine = /(?<![\p{L}\p{N}_'.-])(?:\p{Lu}[\p{L}'.-]{0,30}[ \t]+){0,2}\p{Lu}[\p{L}'.-]{0,30},[ \t]*\p{Lu}{2}[ \t]+\d{5}(?:-\d{4})?(?!\p{N})/gu;
function postalRanges(text: string): [number, number][] {
  const ranges: [number, number][] = [];
  for (const match of text.matchAll(streetLine)) {
    // Keep the longest prefix that ends in a street suffix after a name word.
    const tokens = [...match[0].matchAll(/\S+/g)];
    for (let index = tokens.length - 1; index >= 2; index--) {
      if (streetSuffixes.has(tokens[index][0].replace(/\.$/, "").toLowerCase())) {
        ranges.push([match.index, match.index + tokens[index].index + tokens[index][0].length]);
        break;
      }
    }
  }
  for (const match of text.matchAll(cityLine)) ranges.push([match.index, match.index + match[0].length]);
  return ranges;
}

// 64 names per message plus room for the app-wide learned (24) and Always
// hide (12) names. Matching scans once per name, so cost stays linear.
const PRIVATE_NAMES_MAX = 100, PRIVATE_NAME_LENGTH_MAX = 160, PRIVATE_NAME_WORDS_MAX = 16;
// Names the bounded matcher can check, deduplicated case-insensitively because
// matching ignores case. Returns null when any name exceeds the limits.
function matchableNames(names: readonly string[]): string[] | null {
  const unique = new Map<string, string>();
  for (const name of names.map(cleanName)) {
    const words = name.split(/[\s+]+/u).filter(Boolean);
    if (!words.length) continue;
    if (name.length > PRIVATE_NAME_LENGTH_MAX || words.length > PRIVATE_NAME_WORDS_MAX) return null;
    unique.set(folded(name), name);
  }
  return unique.size > PRIVATE_NAMES_MAX ? null : [...unique.values()];
}
// Lowercase with both sigma forms folded together, as /iu matching does.
// Same-length replacement keeps offsets aligned.
function folded(text: string) { return text.toLowerCase().replace(/ς/g, "σ"); }

// Offsets use UTF-16, like String.slice. Values are sensitive and never for attrs.
export function privateRanges(text: string, names: readonly string[] = []): PrivacyRange[] {
  const candidates = matchableNames(names);
  // Candidate size is bounded so matching cannot grow with crafted input. When
  // a name falls outside what the matcher covers, hide the whole text without a
  // reveal control, since one click would otherwise expose every private value.
  if (!candidates) return text ? [{ start: 0, end: text.length, kind: "hidden", value: "" }] : [];
  const { decoded, offsets } = text.includes("%") ? decodedText(text) : { decoded: text, offsets: null };
  const ranges: PrivacyRange[] = [];
  const add = (start: number, end: number, kind: PrivacyRange["kind"], value: string) => {
    ranges.push({ start: offsets ? offsets[start][0] : start,
      end: offsets ? offsets[end - 1][1] : end, kind, value });
  };
  // Scan delimiter-separated tokens once; an unanchored email regex is quadratic on long words.
  for (const match of decoded.matchAll(addressToken)) {
    const at = match[0].lastIndexOf("@");
    if (at < 1) continue;
    const suffix = [...match[0].slice(at + 1).matchAll(/\.[a-z]{2,}/gi)].at(-1);
    if (!suffix) continue;
    const length = at + 1 + suffix.index + suffix[0].length;
    add(match.index, match.index + length, "address", match[0].slice(0, length));
  }
  for (const [start, end] of postalRanges(decoded)) add(start, end, "address", decoded.slice(start, end));
  const lower = folded(decoded);
  // toLowerCase keeps offsets only when no character expands; otherwise the
  // bounded expression preserves the Unicode case-folded match positions.
  const aligned = lower.length === decoded.length;
  const withinBounds = (start: number, end: number) => {
    const before = Array.from(decoded.slice(Math.max(0, start - 2), start)).at(-1) || "";
    const after = String.fromCodePoint(decoded.codePointAt(end) || 0);
    return !wordCharacter.test(before) && !wordCharacter.test(after);
  };
  for (const name of candidates) {
    // Words never contain a separator character, so matching stays linear.
    const words = name.split(/[\s+]+/u).filter(Boolean);
    const lowered = words.map(folded);
    if (aligned) {
      const first = lowered[0];
      let at = 0;
      while (at <= lower.length - first.length) {
        const start = lower.indexOf(first, at);
        if (start < 0) break;
        at = start + 1;
        let end = start + first.length, matched = true;
        for (let index = 1; index < lowered.length; index++) {
          const gap = end;
          while (end < lower.length && /[\s+]/.test(lower[end])) end++;
          if (end === gap || !lower.startsWith(lowered[index], end)) { matched = false; break; }
          end += lowered[index].length;
        }
        if (matched && withinBounds(start, end)) add(start, end, "name", name);
      }
      continue;
    }
    const pattern = words
      .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s+]+");
    for (const match of decoded.matchAll(new RegExp(pattern, "giu"))) {
      const start = match.index;
      const end = start + match[0].length;
      if (withinBounds(start, end)) add(start, end, "name", name);
    }
  }
  ranges.sort((left, right) => left.start - right.start || right.end - left.end);
  const merged: PrivacyRange[] = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.start < previous.end) {
      previous.end = Math.max(previous.end, range.end);
      // A name overlap must not become an address-only click-to-reveal token.
      if (range.kind === "name") { previous.kind = "name"; previous.value = range.value; }
    } else merged.push({ ...range });
  }
  return merged;
}

export function segmentPrivateText(text: string, names: readonly string[] = []): PrivacySegment[] {
  const segments: PrivacySegment[] = [];
  let last = 0;
  for (const range of privateRanges(text, names)) {
    if (range.start > last)
      segments.push({ start: last, end: range.start, text: text.slice(last, range.start), kind: "text" });
    segments.push({ ...range, text: text.slice(range.start, range.end) });
    last = range.end;
  }
  if (last < text.length)
    segments.push({ start: last, end: text.length, text: text.slice(last), kind: "text" });
  return segments;
}

export function redactPrivateText(text: string, names: readonly string[] = []): string {
  return segmentPrivateText(text, names)
    .map((segment) => segment.kind === "text" ? segment.text : PRIVACY_MASK).join("");
}

// A non-letter sender label or malformed address still must not reach the output.
export function redactSenderName(sender: string, names: readonly string[] = []): string {
  if (!sender || sender === "Unknown sender") return sender;
  const masked = redactPrivateText(sender, names);
  return masked === sender ? PRIVACY_MASK : masked;
}

export function redactAddress(value: string, names: readonly string[] = []): string {
  if (!value.trim()) return value;
  const masked = redactPrivateText(value, names);
  return masked === value ? PRIVACY_MASK : masked;
}

// Pass decoded visible text leaves in order, with explicit block separators.
// Returned offsets are local to each leaf; reveal keys keep the whole source token.
export function segmentPrivateParts(parts: readonly string[], names: readonly string[] = []): PrivacySegment[][] {
  const segments = segmentPrivateText(parts.join(""), names)
    .map((segment) => segment.kind === "text" || segment.kind === "hidden" ? segment : { ...segment, value: segment.text });
  let offset = 0;
  let cursor = 0;
  return parts.map((part) => {
    const end = offset + part.length;
    const result: PrivacySegment[] = [];
    while (cursor < segments.length && segments[cursor].end <= offset) cursor++;
    for (let index = cursor; index < segments.length && segments[index].start < end; index++) {
      const segment = segments[index];
      const start = Math.max(segment.start, offset) - offset;
      const stop = Math.min(segment.end, end) - offset;
      if (start < stop)
        result.push({ ...segment, start, end: stop, text: part.slice(start, stop) });
    }
    offset = end;
    return result;
  });
}
