import { test } from "node:test";
import assert from "node:assert/strict";
import { conversationMembers } from "./conversation-members.js";

type Envelope = Parameters<typeof conversationMembers>[0][number];
const item = (id: string, accountId = "a", extra: Partial<Envelope> = {}): Envelope => ({ id, accountId, ...extra });
function legacy(source: Envelope, candidates: Envelope[]): Envelope[] {
  const selected = new Map([[source.id, source]]);
  let changed = true;
  while (changed) {
    changed = false;
    const known = new Set([...selected.values()].flatMap(m => [m.messageId, m.inReplyTo, ...(m.references || [])]).filter(Boolean));
    const threads = new Set([...selected.values()].map(m => m.threadId).filter(Boolean));
    for (const m of candidates.filter(m => m.accountId === source.accountId))
      if (!selected.has(m.id) && ((m.threadId && threads.has(m.threadId)) || [m.messageId, m.inReplyTo, ...(m.references || [])].some(value => value && known.has(value)))) { selected.set(m.id, m); changed = true; }
  }
  return [...selected.values()];
}
test("conversation membership preserves transitive references and separates account and token spaces", () => {
  const source = item("root", "a", { messageId: "root-id", threadId: "thread-only" });
  const messages = [source, item("reply", "a", { messageId: "reply-id", inReplyTo: "root-id" }), item("later", "a", { references: ["reply-id"] }), item("same-thread", "a", { threadId: "thread-only" }), item("wrong-space", "a", { messageId: "thread-only" }), item("other-account", "b", { messageId: "root-id", threadId: "thread-only" })];
  assert.deepEqual(conversationMembers([source], messages).map(m => m.id).sort(), ["later", "reply", "root", "same-thread"]);
});
test("indexed membership equals the original rule across deterministic mixed graphs and multiple sources", () => {
  const messages = Array.from({ length: 240 }, (_, i) => item(`mail-${i}`, `account-${i % 3}`, {
    messageId: i % 7 ? `id-${i % 47}` : undefined,
    inReplyTo: i % 5 ? `id-${(i * 11) % 47}` : undefined,
    references: i % 4 ? [`id-${(i * 7) % 47}`] : [],
    threadId: i % 6 ? `thread-${i % 19}` : undefined,
  }));
  for (let i = 0; i < messages.length; i += 11) {
    const sources = [messages[i], messages[(i + 7) % messages.length]];
    const expected = [...new Set(sources.flatMap(source => legacy(source, messages).map(m => m.id)))].sort();
    assert.deepEqual(conversationMembers(sources, messages).map(m => m.id).sort(), expected);
  }
});
