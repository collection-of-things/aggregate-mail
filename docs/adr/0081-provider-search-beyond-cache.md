# ADR 0081: Provider search beyond the cache

Date: 2026-10-26
Status: Implementation decision for the requested feature; installed-app and real-provider acceptance remain separate.
Extends: ADR 0077. Cached search scope, privacy and navigation rules remain in force.

## Decision

A cached search keeps its existing coverage. When a query is active and exactly
one account is selected, the search line offers "Search older mail" for that
account only. The action is explicit and never automatic; it runs once per
click, is reachable by keyboard and can be cancelled. With All accounts
selected the line explains that one account is needed. Cancellation aborts the
request, closes the IMAP connection and imports nothing.

One run examines at most 100 matches (`providerSearchLimit`). Gmail pages
`users.messages.list` until it holds 100 message ids or results run out, then
reads each uncached id with `messages.get` format `raw`. IMAP keeps the newest
100 matching UIDs across the searched mailboxes in declaration order; once the
cap is reached later mailboxes go unsearched. Matches already in the cache, by
cache id or Message-ID, count toward `examined` but are not downloaded again.

Imported mail enters the encrypted cache through the same record shape as
sync, including provider identity, direction, labels or mailbox and local
sorting. Records a sync cached meanwhile are never overwritten. Reading never
changes mailbox state: Gmail uses raw message reads only, and IMAP holds a
read-only lock (EXAMINE) and uses UID SEARCH, ENVELOPE and BODY.PEEK source
fetches, so no flags change. The same body, MIME and response limits as sync
apply, and imports run inside the existing serialized mail work so the updater
drain still covers them. There is no plaintext or vector index; results appear
through the existing in-memory cached search, which re-applies every term to
imported mail, so provider widening never shows non-matching mail.

IMAP searches the server-declared archive mailbox and Sent, or All Mail for a
Gmail IMAP account, because INBOX is already cached completely by sync. Gmail
search covers the mailbox itself.

Coverage text reports what the provider actually searched; cached results are
always labelled Cached and never presented as the complete mailbox:

- `Gmail search: no matches.` / `IMAP search of Archive and Sent: no matches.`
- `Gmail search: all 5 matches, 5 new.` for a complete result
- `Gmail search, first 100 matches, 12 new. More remain on the server.` when
  the cap cut the result short
- ` Applied after import: account:, is:pinned.` is appended when device-only
  or dropped terms still apply locally

Query mapping from cached-search syntax to provider terms:

| Cached term | Gmail | IMAP |
| --- | --- | --- |
| words and phrases | quoted text | TEXT |
| `-` exclusion | `-` | NOT |
| `from:` | `from:` | FROM |
| `to:` | `{to: cc:}` | TO or CC |
| `subject:` | `subject:` | SUBJECT |
| `body:` | whole message; an excluded `body:` is dropped and applied after import | BODY |
| `is:read` / `is:unread` | `is:read` / `is:unread` | SEEN / UNSEEN |
| `before:` / `after:` | epoch seconds, `after:` widened one second | BEFORE / SINCE, each widened one day |
| `account:`, `is:pinned` | not sent; named under "Applied after import" | not sent; named under "Applied after import" |

Providers match terms exactly, so the one-typo fuzzy matching of unquoted
words in the cached search does not reach them and a provider may return fewer
results than the cache would. Dates widen as above because providers use
coarser boundaries; the cached search then applies the exact UTC day bounds to
imported mail.

## Verification

Require synthetic plan mapping, Gmail paging to the cap with cached-skip and
cancellation, IMAP read-only mailbox coverage with cap ordering and
cancellation, coverage-label wording, explicit-activation, cancel and
account-change abort checks. Run the serial full suite and strict build.
Native interaction, installed-app and real-provider behavior need separate
proof. No release or installed-app replacement is part of this decision.
