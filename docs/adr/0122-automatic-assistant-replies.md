# ADR 0122: Automatic reply proposals for assistants with a provider key

Date: 2026-11-03
Status: Proposed for the local candidate by explicit user direction; pending
maintainer review.
Amends [ADR 0045](0045-agent-review-byok.md), which allowed provider requests
only after an explicit Prepare draft click. ADR 0045 is unchanged otherwise.

## Context

An assistant was a permission grant only. After adding one, nothing ran
until the user clicked Prepare draft or connected an outside agent over MCP.
Users expected an assistant they set up to work on new mail by itself.

## Decision

Each assistant with `read_email` and `propose_draft` and a saved provider key
has a user-controlled switch, "Prepare replies automatically", on its card.
The settings live in a separate encrypted `agentAutomation` record keyed by
grant ID: enabled, scope (`important` or `all`), an optional instruction, a
daily limit of 1 to 200 (default 20) and an opaque revision. The record also
holds status: today's count, last run time and a sanitized last result.
Status updates do not change the revision.

Saving a provider key for the first time turns the switch on once with the
defaults when no automation record exists. The key form says so before Save.
Keys saved before this change stay off. The user can turn the switch off or on
at any time; the switch saves only on/off and keeps unsaved option edits. The
server refuses to turn it on without a key or without both permissions.
Removing either permission turns it off. Removing the assistant removes the
record. Removing the key stops runs and reports it.

When a sync reports new unread mail (the existing `new-mail` event, which
fires only after an account's first sync), the service runs each enabled
assistant over that mail, one batch at a time. It reuses the Prepare draft
path, so the prompt, limits, destination checks, fingerprint and permission
rechecks, per-grant in-flight guard and pending-proposal outcome are the same
as for a click. It skips mail outside the grant's accounts, sent, read or
archived mail, mail outside the chosen scope, automated senders such as
no-reply addresses, and mail that already has a proposal from that
assistant, checked just before each email. The settings are read again
before each email, so switching off stops the rest of a batch. An automatic
run waits up to 60 seconds for a manual Prepare draft on the same assistant
instead of dropping the email. Every provider attempt counts toward the daily
limit, including failures, so the limit bounds how much mail reaches the
provider. A rejected key, lost permission, rate limit or timeout stops the
batch.

Proposals still need review. Approval still creates a local draft and still
requires MCP on. Nothing is sent, and no mailbox state changes.

## Consequences

With the switch on, the subject, sender, recipient and plain text of each
matching new email go to the chosen provider without a click. The card says
so and names the destination. Read and organize assistants have no
in-app model and still need an outside agent over MCP.
