import type { Message } from "./messages";

// A small copy of the app's cached-mail search grammar for the demo: plain
// words (one typo allowed from four letters), "exact phrases", -exclusions,
// from: and is:unread. Every term must match.

type Term =
  | { kind: "word"; value: string; negate: boolean }
  | { kind: "phrase"; value: string; negate: boolean }
  | { kind: "from"; value: string }
  | { kind: "unread" };

export function parseQuery(query: string): Term[] {
  const terms: Term[] = [];
  const pattern = /(-?)"([^"]*)"?|(\S+)/g;
  for (const match of query.toLowerCase().matchAll(pattern)) {
    const [, minus, phrase, bare] = match;
    if (phrase !== undefined) {
      if (phrase.trim()) terms.push({ kind: "phrase", value: phrase.trim(), negate: minus === "-" });
      continue;
    }
    if (bare.startsWith("from:") && bare.length > 5) terms.push({ kind: "from", value: bare.slice(5) });
    else if (bare === "is:unread") terms.push({ kind: "unread" });
    else if (bare.startsWith("-") && bare.length > 1) terms.push({ kind: "word", value: bare.slice(1), negate: true });
    else if (bare !== "-") terms.push({ kind: "word", value: bare, negate: false });
  }
  return terms;
}

// True when a and b differ by at most one insertion, deletion or substitution.
function withinOne(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

const textOf = (message: Message) =>
  `${message.sender} ${message.address} ${message.subject} ${message.preview}`.toLowerCase();

function wordMatches(text: string, word: string): boolean {
  if (text.includes(word)) return true;
  if (word.length < 4) return false;
  return text.split(/[^\p{L}\p{N}$%.]+/u).some((token) => withinOne(token, word));
}

export function searchMail(all: Message[], query: string): Message[] {
  const terms = parseQuery(query);
  if (terms.length === 0) return [];
  return all.filter((message) => {
    const text = textOf(message);
    return terms.every((term) => {
      switch (term.kind) {
        case "from":
          return `${message.sender} ${message.address}`.toLowerCase().includes(term.value);
        case "unread":
          return message.unread === true;
        case "phrase":
          return text.includes(term.value) !== term.negate;
        case "word":
          return term.negate ? !text.includes(term.value) : wordMatches(text, term.value);
      }
    });
  });
}
