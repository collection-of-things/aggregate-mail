# ADR 0118: Re-import classification and deferred provider contact sync

Date: 2026-11-02
Status: Accepted. Provider sync is deferred; the owner may reverse that in a later ADR.
Amends: ADR 0098's "keep existing entries / imports are one-time copies" wording,
for opt-in name updates only.

## Decision 1: re-import classification with opt-in name updates

Repeating a file import previously reported only additions and skipped
duplicates, so name corrections in a re-export were invisible. The import
preview and confirmation now classify the file against the destination
account's saved contacts before any write:

- **new** addresses, which an import adds;
- **changed** names, saved addresses whose non-empty file name differs from the
  saved name — rewritten only when the import opts in through the explicit
  "Update N existing names from this file" choice, in the same transaction;
- **unchanged** addresses, matching or empty file names;
- **missing** contacts, saved entries absent from the file — never removed by
  import;
- **skipped** file rows, invalid or repeated addresses.

The confirmation reports added, updated and skipped counts and states that
nothing was removed. File limits, validation, per-account scope, the
1000-contact limit and encrypted storage are unchanged; only new addresses
count toward the limit. Error messages still never echo submitted names or
addresses.

## Decision 2: defer provider contact sync

File import stays the supported path; no provider contact sync is built now.

- **Google People API** — `people.connections.list` requires the
  `contacts.readonly` (or `contacts`) scope
  (<https://developers.google.com/people/api/rest/v1/people.connections/list>).
  Contacts scopes are sensitive and public apps need Google verification
  (<https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification>).
  Emc²'s Google OAuth uses the user's own `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`
  with `gmail.modify` and opt-in calendar scopes, so sync would add a new scope
  and per-account consent. Sync tokens expire after 7 days and deletions arrive
  as `metadata.deleted`, so a full-resync path is required.
- **CardDAV (iCloud, Fastmail, Yahoo)** — iCloud needs an app-specific password
  with two-factor authentication, or Apple's in-app authorization for supported
  apps (<https://support.apple.com/en-us/102654>,
  <https://support.apple.com/en-us/121539>). Reusing a stored IMAP app password
  for contacts would widen what an existing credential is used for, and
  ADR 0098 rules out requesting provider passwords, so CardDAV would need a
  separate credential and explicit consent.
- **Microsoft Graph** — `GET /me/contacts` with delegated `Contacts.Read`
  (<https://learn.microsoft.com/en-us/graph/api/user-list-contacts>) needs a
  Microsoft Entra app registration; Emc² has no Microsoft OAuth integration.

## Conditions for a future sync ADR

One approved provider at a time; pull-only first; opt-in per account; explicit
connect, pause, disconnect and delete; disconnect removes only contacts that
came from that sync, which needs a per-contact origin field; no tokens,
passwords or contact data in logs or `settings.env`; synthetic provider
responses in tests; live OAuth and real-account checks recorded separately.

## Consequences

This change adds no credentials, registrations, network calls or dependencies.
Re-imports give users a reviewable way to refresh names without sync, and the
classification contract is covered by synthetic route and Contacts-page proof.
Installed, live-provider and real-account behavior remain separate checks.
