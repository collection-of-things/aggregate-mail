# ADR 0087: Status-first startup

Status: Implementation candidate.

## Decision

Start authenticated GET `/api/bootstrap` and the existing full `/api/state`
request together. Bootstrap returns accounts without credentials, configuration,
compose preferences, draft count/token and CSRF. It omits mail, mail cursors,
arrival records and arrival counters. It reuses the status builder used at the
full snapshot boundary, behind the existing API authentication/origin checks.
It never initializes the mail index, scans mail or decrypts mail/draft bodies.

The renderer distinguishes status readiness from complete mail loading. Apply
CSRF before enabling account/configuration controls or requesting the workspace.
Preserve the full initial snapshot and subsequent delta/removal cursor protocol.
A late bootstrap cannot overwrite full state, including after a failed full read.
Bootstrap failure or an older service falls back to the existing full request.

Until full mail arrives, keep mail counts unavailable, lists loading and mail
source-dependent work details gated. Workspace reads may prefetch, but missing
sources must not be presented as absent from the cache. Draft count comes from
the independent complete draft inventory. Do not start the existing automatic
sync earlier than the full snapshot. The desktop event path remains unchanged.
Bootstrap does not replace browser focus/visibility refresh.

Full-read failure offers an explicit retry. Authentication failure clears status
readiness, cached renderer state, CSRF and the cursor, without deleting drafts or
changing a compose session. Abort startup reads on unmount and ignore late
completions. Keep reload coalescing. No storage, key, provider, gzip or paging
change is part of this decision. Older clients keep their full-state contract.

## Verification

`server/bootstrap.test.ts` uses an ephemeral synthetic service with corrupt
mail ciphertext and blocks mail-index SQL. It checks authenticated no-store
status, origin rejection, credential omission, no mail/cursor/arrival fields,
draft preservation and unchanged snapshot/delta behavior.

`src/bootstrap.test.tsx` mounts App with deferred responses. Cover both response
orders, status CSRF readiness, unknown counts, no false empty/source results,
older-service fallback, failed full read and retry, authentication reset before
and after status, desktop cursor refresh and unmount cancellation. Existing
App mail, drafts, search, navigation and notification checks remain applicable.

`scripts/benchmark-bootstrap.ts` creates and removes its own synthetic profile
and uses the 34,000-message, four-account fixture. Three serial pairs compare
status availability from full-state-only startup with parallel bootstrap/full
requests, each in a fresh process. Record bootstrap bytes/time and full-mail
bytes/time separately. Module/service startup is reported separately. OS caches
are not flushed. HTTP/JSON availability is not browser paint or installed-app
performance proof. Runtime receipts and integration diffs stay outside the repo.
