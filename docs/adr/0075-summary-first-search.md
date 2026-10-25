# ADR 0075: Summary-first cached search

Date: 2026-10-25
Status: Requested responsiveness correction, pending validation.

Search may use metadata only when it proves a match or rejection. A positive
plain term found in headers is proven; its exclusion is rejected. Missing
plain terms and body terms remain unknown. Conjunctions reject on any proven
false term and match only when every term is proven true. Preserve quoted
phrases, typo rules, explicit operators, exclusions, account matching and
fail-closed invalid syntax.

Use that same compiler on server and renderer. The server retains captured
metadata/version ordering and scans unresolved bodies through the existing WAL
reader, cancellation and external-invalidation checks. No plaintext index or
storage migration is added. The renderer shows proven metadata hits immediately;
unresolved hits require exact account/message/content-version responses.
Pending body searches show progress instead of a false no-matches state.

Verify summary/full equivalence, exact result ordering, zero header-only body
reads, selective body reads, cancellation, late-response/account/version guards,
and pending results through refreshes. Compare matched synthetic workloads.
Large uncached body-only searches remain asynchronous, not an instant-search
claim. Preserve settings, privacy and existing mail operations.
