# ADR 0123: Automatic reply proposals for assistants with a provider key

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

Saving a key while the assistant has no automation record turns the switch on
once with the defaults: a first key, or a key saved again after an old key was
removed. The key form says so before Save. Keys already saved before this
change stay off. The user can turn the switch off or on
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
assistant, checked before the request and again before the proposal is
saved, so a manual or MCP proposal made meanwhile wins. The settings are read
again before each email, so switching off stops the rest of a batch. An
automatic run waits up to 60 seconds for a manual Prepare draft on the same
assistant instead of dropping the email. While a batch runs, a manual Prepare
draft on that assistant reports that it is busy; retry after the batch. Every
request that reaches the provider counts toward the daily limit, including
failures, so the limit bounds how much mail reaches the provider. A rejected
key, lost permission, rate limit, provider failure or timeout stops the batch.
Each batch is admitted as tracked mail work when it is queued, so an
application update's drain waits for an active provider request and its
proposal. Once an update pauses mail, a batch stops before the next email and
new batches are refused. Only mail the assistant would prepare waits for a
manual preparation; state is read again after the wait, and switching off,
changing the key or an update during the wait stops the batch before the
request. A final gate runs right before
each provider request, after DNS resolution: it rechecks the grant and key for
every request, and for automatic ones the switch and the daily limit, and
only then counts the request.
A sync that reports an error emits no `new-mail` event, so its new mail is not
prepared automatically; Prepare draft still works for it.

Proposals still need review. Approval still creates a local draft and still
requires MCP on. Nothing is sent, and no mailbox state changes.

## Consequences

With the switch on, the subject, sender, recipient and plain text of each
matching new email go to the chosen provider without a click. The card says
so and names the destination. Read and organize assistants have no
in-app model and still need an outside agent over MCP.
