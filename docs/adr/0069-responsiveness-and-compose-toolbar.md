# 0069: Bounded sync memory and compose toolbar access

Date: 2026-10-25
Status: Implementation for the requested responsiveness and compose corrections.
Amends: ADRs 0038 and 0046, compose layout and Today toolbar only.

## Decision

Load only Gmail and Calendar clients through one shared Google API facade.
Keep account-scoped summary identities for sync and hydrate full bodies per
active batch. Production provider listings stream progress without retaining
all completed bodies; callers that request full results keep that contract.
Archive missing inbox mail only after the complete listing succeeds. Retain
new-mail IDs for later classification and notification rather than full bodies.
Keep encrypted persistence, provider identities and mail-operation guards.

Compose is a nonmodal dialog with Search and Privacy in its keyboard cycle.
The remaining working panes stay inert and the backdrop blocks pointer input
below the toolbar. Keep draft saving, recovery, uncertain-send protection,
Escape closure from the editor and unload/update drain guards. Search Escape
clears search without closing the draft. Replies place the original email and
editor side by side, with independent scrolling and no duplicated reader behind.

Permit one typo in plain unquoted search words of 4 to 32 letters. Keep field
operators, quoted phrases, exclusions, addresses and account matching exact.
The existing parser still rejects malformed recognized operators.

Show Today counts beside status labels, with Refresh/Add task on the same row.
Align the sidebar footer and collapsed coverage/status bar to 30px. Keep all
existing user settings and storage keys, with no migration or reset.

## Verification

Compare matched synthetic import, sync-cache and renderer workloads. Check
streamed provider completion, failures, account isolation and message identity.
Exercise draft recovery, search/privacy, focus/Escape and settings restart.
Check side-by-side geometry and status-bar heights at supported widths and text
scales. Native package/startup and performance evidence remain separate from
synthetic probes; no saved accounts or real mail are used in validation.
