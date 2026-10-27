# ADR 0090: Inline cached conversation reader

Date: 2026-10-27
Status: Source candidate; independent review pending.

Reuse account-scoped conversation membership and the existing bounded Gmail
expansion. Show cached messages oldest first without grouping the Inbox list or
claiming complete provider history. Only the opened message starts expanded.

Each expanded entry uses the existing allowlisted reader and privacy controls.
Collapse unmounts content and clears opening-specific image consent. Enabling
privacy revokes consent across the stack. Malformed or stale conversation
responses never replace the current opened mail.

Keep the opened message as the explicit toolbar and shortcut target. Select for
actions uses the existing opening and mark-read operation; focus movement and
expansion alone do not. Each entry has its own context menu. Preserve current
snooze, reply, labels, follow-up and Today/Projects return behavior. No thread-wide
action, new service contract or dependency is required.

Synthetic tests and strict builds can establish source compatibility. Native,
installed and real-provider behavior require separate acceptance.
