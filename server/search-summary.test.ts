import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Mail } from "../shared/types.js";

process.env.MAIL_DATA_DIR = mkdtempSync(join(tmpdir(), 'emc2-search-summary-'));
process.env.MAIL_DATA_KEY = Buffer.alloc(32, 74).toString('base64');

test("summary-first search decrypts only unresolved bodies and preserves exact ordering", async () => {
  const store = await import('./store.js');
  const accounts = [{ id: 'a', email: 'reader@example.test', provider: 'imap' as const }];
  const mails: Mail[] = [0, 1, 2].map(i => ({ id: 'm'+i, accountId: 'a', remoteId: String(i), sender: i === 1 ? 'Other' : 'Team', address: 'sender@example.test', to: 'reader@example.test', subject: i === 2 ? 'Target' : 'Unrelated', preview: '', body: i === 1 ? 'Target needle' : 'needle', date: i, unread: false, archived: false, snoozedUntil: null, category: 'important', relevance: 2, reason: '', html: '<p>Large unrelated markup</p>', attachments: [] }));
  const parse = JSON.parse;
  let decoded = 0;
  try {
    for (const m of mails) store.put('mail', m.id, m);
    await store.mailSummaryChanges();
    JSON.parse = ((value: string, ...args: unknown[]) => { if (value.includes('"body":')) decoded++; return Reflect.apply(parse, JSON, [value, ...args]); }) as typeof JSON.parse;
    const headers = await store.searchMail('subject:Target', accounts);
    assert.deepEqual(headers.matches.map(m => m.id), ['m2']);
    assert.equal(decoded, 0);
    const combined = await store.searchMail('from:Team body:needle', accounts);
    assert.deepEqual(combined.matches.map(m => m.id), ['m0', 'm2']);
    assert.equal(decoded, 2, 'known false sender rows need no body');
    decoded = 0;
    const plain = await store.searchMail('Target', accounts);
    assert.deepEqual(plain.matches.map(m => m.id), ['m1', 'm2']);
    assert.equal(decoded, 2, 'known positive header rows need no body');
    const cancelled = new AbortController(); cancelled.abort();
    await assert.rejects(store.searchMail('subject:Target', accounts, cancelled.signal));
  } finally { JSON.parse = parse; store.closeStore(); rmSync(process.env.MAIL_DATA_DIR!, { recursive: true, force: true }); }
});
