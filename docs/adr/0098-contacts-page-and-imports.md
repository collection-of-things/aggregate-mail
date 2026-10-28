# ADR 0098: Main Contacts page and explicit address-book imports

Date: 2026-10-27
Status: Implementation decision; installed and live-provider acceptance remain separate.
Amends: ADR 0084, contact management location and saved-contact sources;
ADR 0090, conversation diagnostic presentation only.

Contacts becomes a main Workspace view with Saved contacts, Recent recipients
and Import contacts sections. Reuse Settings styles, existing contact CRUD,
encrypted account-scoped records and recipient suggestions. Settings no longer
contains Contacts. No data migration or additional contact model is needed.

Use user-selected provider CSV/vCard exports for the registration-free import
path. Direct provider APIs require application registration or provider-specific
credentials and are outside this implementation. Do not borrow another app's
OAuth credentials, scrape signed-in pages or request a provider password.

Preview performs no writes. Confirmation reparses and validates the same input,
checks the current destination account and capacity, and inserts all new
contacts atomically. Keep existing entries and skip case-insensitive duplicate
addresses. File size, entry and account limits bound work. Names and addresses
alone enter the encrypted store; no raw file, filename or external resources
are retained. Imports are one-time copies, never ongoing sync.

Move conversation coverage, missing references and keyboard guidance into
collapsed details below the messages. Keep failures visible and the selected
message as the toolbar target. Omit the redundant heading for a single email;
multiple messages retain independent keyboard, selection and privacy behavior.

Require synthetic parser, route, Contacts, navigation and reader proof plus
the serial full suite and strict build. Such proof does not establish installed
layout, live provider exports, OAuth approval or real-account behavior.
