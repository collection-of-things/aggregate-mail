# ADR 0084: Local contacts and recent recipients

Date: 2026-10-26
Status: Accepted

## Context

Issue #57 adds recipient suggestions without an address book sync. Contacts and
sent-to addresses are personal data, so their sources, scope and retention need
fixed rules.

## Decision

- Suggestions come from two local sources only: contacts the user saves in
  Settings, then recent recipients. There is no remote lookup, no import from
  received mail and no inferred names.
- A recent recipient is an address from To or Cc of a send the provider
  accepted, including a send that returns the Sent-copy warning. Rejected and
  uncertain sends record nothing. Addresses of connected accounts are skipped.
  Only the address and last-sent time are kept.
- Both kinds are stored as encrypted records in the existing store, each tied
  to one connected account. Disconnecting an account removes its contacts and
  recent recipients in the same transaction.
- Each account keeps at most 1000 saved contacts and its 200 newest recent
  recipients. Older recipients are dropped on the next successful send. The
  user can delete any entry in Settings.
- Suggestions rank the sending account first and saved contacts before recent
  recipients, show the source account, and list each address once. Other
  accounts' entries can appear, labelled with their account.
- Routes live under `/api/contacts` and inherit the desktop-session, origin and
  CSRF checks. Errors never echo a submitted name or address, and contacts are
  never logged.
- The picker inserts an address only when the user picks it. Privacy mode hides
  names and addresses in suggestions and Settings until revealed.

## Consequences

Bcc and multi-address To (#51) reuse the same per-token picker. CardDAV or
Google Contacts sync needs its own decision.
