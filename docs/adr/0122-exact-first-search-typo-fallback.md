# ADR 0122: Exact-first search with a typo fallback

Date: 2026-11-03
Status: Accepted for the owner-reported search defect; installed-app proof pending.
Amends: The typo tolerance described in ADR 0077 and the KB search notes. Scope,
navigation, privacy and provider-search rules in ADR 0077 and ADR 0081 remain.

## Context

Cached search allowed one typo in every plain unquoted word of 4 or more
letters on every query. One deletion turns a 4-letter word into a common
3-letter word, so "ando" matched "and" and returned most of the cache. "skip"
matched "ship" and "slip". The intended message was present but buried among
thousands of unrelated rows sorted by date.

## Decision

- Plain words match exact case-insensitive substrings across sender, address,
  To, Cc, subject, preview and body.
- The service retries with one typo per eligible word only when the exact
  query returns no mail and no saved drafts. Both passes read one SQLite
  snapshot. The response carries `typos: true` when the fallback produced the
  results.
- A typo match must hit a word of at least 4 letters.
- The renderer matches locally with the exact compiler and switches to the typo
  compiler only after the service reports the fallback. It keeps that decision
  for the same query while flag or version changes refetch. The All cached and
  Sent headers and the search live status say that close spellings are shown.
- CLI and MCP `--syntax app` apply the same exact-first rule over all granted
  mail, before view and page filters, and return `typos: true`.

## Consequences

A misspelled query costs a second scan only when the first scan found nothing.
Phrases, field terms, exclusions, addresses and operators stay exact. Results
are still limited to imported mail and saved drafts; provider search beyond the
cache stays per account and explicit (ADR 0081).
