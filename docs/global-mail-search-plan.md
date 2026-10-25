# Global cached-mail search

## Goal

Use the persistent search field to find cached mail and saved local drafts across all connected accounts, including Sent, Archive and Snoozed. Keep account and label controls understandable and private. Extend the existing typo matcher without duplicating it or adding dependencies.

Task: [#42](https://github.com/collection-of-things/aggregate-mail/issues/42). Base: `fix/app-responsiveness-compose` at `41fff270d35cca4f04cb30c8899eac84823493f9`. One delivery owner: @pekth. Parent PR #38 remains independently owned.

## Approach

1. Trace the existing shared query compiler, authenticated cache-search endpoint, renderer hook, navigation, draft summaries and account-label helpers. Reproduce scoped search and confusing label behavior with synthetic fixtures before changing them.
2. The first transition from an empty or whitespace query to non-whitespace enters All cached across all accounts and resets label/read/relevance filters in one history visit. Continued typing preserves deliberate narrowing. Account and mailbox choices during search narrow the existing query; mail-only views exclude drafts. Clear and Escape remove the query while retaining the current view and filters; the next nonempty query starts globally again. Back/Forward restores the complete prior query and scope. Do not make search open or mutate mail.
3. Reuse one compiled query and the existing cancellation/version guards. Search must run independently of mail presence. Include saved drafts through the authenticated local service, searching full draft text without transferring attachment bytes or loading each draft into the renderer. Return explicitly distinguished mail and draft summary identities: kind, account, ID and version/revision. Keep draft content and attachments behind the existing open route. A draft change token must cover create, save, delete and account removal, participate in cache/request identity, and trigger the existing change notification on successful writes. Avoid per-account search requests and repeated scans for unchanged query inputs.
4. Keep the existing bounded one-typo matching for unquoted plain words. Preserve exact phrases, email addresses, field terms, negation, account boundaries, dates and Unicode behavior. Keep retained search data bounded and in memory.
5. Improve search labeling, visible scope, loading/error/empty feedback and keyboard focus. Distinguish account entries and Gmail labels through the existing account-label helper and privacy rules. Do not expose hidden addresses in titles or accessible names.
6. Cover the complete user path with synthetic regressions: cross-account Inbox/Sent/Archive/Snoozed results, draft body matching and opening, filters, clearing/history, malformed queries, rapid typing and stale replies, cache changes, labels and privacy. Measure or count requests/work using deterministic probes. Run the required serial full suite and strict build through the approved bounded runner.
7. Update current facts in KB, product/design documentation and CHANGELOG. Record any changed navigation/search decision in a new ADR. Review the complete candidate independently before commit and PR.

## Draft and request contracts

Draft text fields map as follows: from uses the connected account name/address, to includes To/Cc, subject/body use the complete saved text, account uses the existing account aliases, and before/after use updatedAt with the existing UTC boundaries. Plain words, phrases and exclusions reuse the shared compiler. Read/pin predicates, including their negations, do not match drafts. Non-default read, relevance or Gmail-label filters exclude drafts; Sent, Archive, Snoozed and Inbox views contain mail only. Drafts has its own result section and never receives mail actions.

One debounced service request searches both kinds. Cancellation must cover each scan, and a response is accepted only for its current query, connected-account identity, mail versions and draft change token. Saving a draft with unchanged count must invalidate cached results. Use a yielding, cancellable encrypted-record snapshot scan that decrypts one draft at a time and retains summaries only, not all bodies or attachments. Cover more than 256 documents and verify cancellation and unchanged-input request/scan reuse deterministically.

Draft activation uses a request generation bound to current query, account and result ID/revision. Navigation, account removal, newer opening requests and unmount invalidate it. Recheck modal/compose guards before replacing any compose session. A changed revision requires refresh rather than silently replacing the selected result. Preserve uncertain-send warnings and recovery.

## Ownership and gates

Implementation worker owns shared/server/renderer search, directly affected account/label controls and meaningful tests. Controller owns scope, task record, documentation, verification scheduling, independent review and delivery. Preserve other contributors' work; one writer per path. No provider, compose-editor, updater, credential, packaging or release changes.

All Linux installs, tests and builds use Fleet containment, one job at a time. Exit 125 stops work without an unbounded fallback. A bug needs red proof, one diagnosed fix and the affected recheck. Stop if that recheck still fails. No live browser tests or real-account access. Source, synthetic, installed and provider evidence remain separate.

## Risks and rollback

Global results must clearly state that only imported mail and local drafts are searched. Incomplete imports are not complete provider history. Mixed results must retain account identity, draft send-status warnings and existing mail-action guards. Query changes must never accept stale result sets. Rollback is a source revert; no persistent schema, account or provider state change is planned.

The parent PR is unmerged. This change can be filed against that branch, but must not merge or publish the parent. Native and installed acceptance remain unverified unless separately executed on the exact candidate.
