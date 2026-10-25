import type { Mail } from "../shared/types.js";

type Envelope = Pick<Mail, "id" | "accountId" | "messageId" | "threadId" | "inReplyTo" | "references">;
const referenceKeys = (mail: Envelope) => new Set([mail.messageId, mail.inReplyTo, ...(mail.references || [])].filter((value): value is string => Boolean(value)));

// Thread IDs and Message-ID references are separate token spaces. Account maps
// prevent even identical provider/reference tokens from joining accounts.
export function conversationMembers<T extends Envelope>(sources: readonly T[], candidates: Iterable<T>): T[] {
  type Index = { threads: Map<string, T[]>; references: Map<string, T[]> };
  const indexes = new Map<string, Index>();
  for (const source of sources) if (!indexes.has(source.accountId)) indexes.set(source.accountId, { threads: new Map(), references: new Map() });
  const add = (index: Map<string, T[]>, key: string | undefined, mail: T) => {
    if (!key) return;
    const values = index.get(key);
    if (values) values.push(mail); else index.set(key, [mail]);
  };
  for (const mail of candidates) {
    const index = indexes.get(mail.accountId);
    if (!index) continue;
    add(index.threads, mail.threadId, mail);
    for (const key of referenceKeys(mail)) add(index.references, key, mail);
  }
  const selected = new Map(sources.map(source => [source.id, source]));
  const queue = [...selected.values()];
  for (let i = 0; i < queue.length; i++) {
    const mail = queue[i], index = indexes.get(mail.accountId)!;
    const groups: [Map<string, T[]>, Iterable<string | undefined>][] = [
      [index.threads, [mail.threadId]], [index.references, referenceKeys(mail)],
    ];
    for (const [tokens, keys] of groups) for (const key of keys) {
      if (!key) continue;
      const matches = tokens.get(key);
      if (!matches) continue;
      tokens.delete(key);
      for (const related of matches) if (!selected.has(related.id)) { selected.set(related.id, related); queue.push(related); }
    }
  }
  return [...selected.values()];
}
