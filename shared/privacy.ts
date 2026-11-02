export type PrivacyAccount = { email: string; name?: string };
type RecipientHeaders = { to?: string; cc?: string };
export type MailPrivacyInput = { sender?: string; to?: string; cc?: string; replyTo?: string };
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
  const names: string[] = [];
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
      if (!emails || emails.has(header.slice(angle + 1, index).trim().toLowerCase())) {
        let name = header.slice(start, angle).trim();
        if (name.startsWith('"') && name.endsWith('"'))
          name = name.slice(1, -1).replace(/\\(.)/g, "$1");
        if (name) names.push(name);
      }
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

const PRIVATE_NAMES_MAX = 64, PRIVATE_NAME_LENGTH_MAX = 160, PRIVATE_NAME_WORDS_MAX = 16;
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
