# ADR 0094: Safe browser refresh after a host build update

Status: Proposed

## Decision

Stamp built HTML with a deterministic public build identifier. Return it only
to admitted browsers from the existing no-store session-status endpoint. Compare
with the loaded HTML rather than treating the first status response as the
loaded version. Reuse the ten-second and visibility checks.

Show Update ready with Update now and Later. Automatically reload after thirty
seconds without interaction only in loaded mail views. Block both manual and
automatic notice actions during editing, Settings, workspace views, saved-draft
lists, hidden tabs, attachment downloads/previews and pending writes. A write whose outcome is uncertain
permanently suspends notice-triggered reload for that page session. Do not replay
writes. Later suspends automatic refresh for the detected build.

Preserve the mail view, filters and selected message in a one-use, validated,
two-minute sessionStorage record. Never store mail bodies, credentials or drafts
in that record. The current authentication and privacy policy remains in force.

This is client refresh, not host installation. Host release selection, draining,
rollback and persistent browser trust are separate work. Desktop updates and
private network routes are unchanged. Old web clients need a manual refresh
once to acquire this feature. Mounted synthetic tests establish renderer
behavior; native phone and installed browser acceptance remain separate.
