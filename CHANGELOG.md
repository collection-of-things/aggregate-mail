# Changelog

Entries describe user-visible changes. Published versions are newest first.
[Legacy development notes](docs/changelog-legacy.md) preserve the earlier
unversioned history without treating it as a release record.

## Unreleased

No changes recorded yet.

## 0.2.16 - 2026-10-27

### Added

- Open Emc² on a phone through private Tailscale HTTPS. Pair with a one-use QR invitation, approve the matching code on the host, and unlock with a passkey. Revoke phone access from Settings. [#84](https://github.com/collection-of-things/aggregate-mail/pull/84)
- Customize single-key shortcuts and two-key Gmail-style sequences in Settings. New defaults include O to open, S to pin, B to snooze, A to reply all and G sequences for mail views. Existing saved bindings are preserved. [#112](https://github.com/collection-of-things/aggregate-mail/pull/112)
- Control mouse side-button history and choose single-click or double-click opening in Settings. [#112](https://github.com/collection-of-things/aggregate-mail/pull/112)

### Changed

- Show account status before the full cached mailbox finishes loading. Mail counts remain unknown until the snapshot is complete, and a failed read offers Retry loading mail. [#108](https://github.com/collection-of-things/aggregate-mail/pull/108)
- Reduce repeated cached-mail copying and skip unnecessary database rewrites while preserving mail, attachments and drafts. [#107](https://github.com/collection-of-things/aggregate-mail/pull/107)
- Distinguish the receiving account from sorting status in All accounts, including compact rows. Hide redundant account labels when one account is selected and retain privacy-safe labels. [#104](https://github.com/collection-of-things/aggregate-mail/pull/104)
- Use a navigation drawer, compact Settings picker, larger touch controls and stacked reply context on narrow screens. Keep the saved side-by-side mail layout visible when no message is open. [#84](https://github.com/collection-of-things/aggregate-mail/pull/84)
- Refresh visible browser inbox state on return to the tab and every 15 seconds. [#84](https://github.com/collection-of-things/aggregate-mail/pull/84)

### Fixed

- Wait for a complete cached-mail snapshot before starting automatic browser sync, including after an initial read failure. [#108](https://github.com/collection-of-things/aggregate-mail/pull/108)
- Skip the empty reader when cycling keyboard focus with F6. [#84](https://github.com/collection-of-things/aggregate-mail/pull/84)

### Security

- Protect browser access with expiring sessions, host-approved phone pairing and origin/CSRF checks. Keep browser data separate from desktop profiles and protect browser encryption keys in the OS credential store without a weaker fallback. [#84](https://github.com/collection-of-things/aggregate-mail/pull/84)

### Documentation

- Require explanations when closing issues or pull requests, with links to merged fixes or ongoing work. [#113](https://github.com/collection-of-things/aggregate-mail/pull/113), [#114](https://github.com/collection-of-things/aggregate-mail/pull/114)
- Separate this release from legacy unversioned notes and require clear, source-linked changelog entries and matching published release notes for future releases.

## 0.1.5

- Ship the background tray, native new-mail notifications, shortcut bar, context menus, brand logos and UI refresh with Windows, macOS and Linux installers.
- Release every merged main push automatically as a patch version with published installers; minor and major releases stay manual.

## 0.1.4

- Show total GitHub installer downloads across Windows, macOS and Linux on the showcase website, with a ten-minute cache and the last successful count retained during GitHub outages.
- Rename the application to Emc². Installers are published as `Emc²-0.1.4-win-x64.exe`, `Emc²-0.1.4-mac-arm64.dmg`, `Emc²-0.1.4-mac-x64.dmg` and `Emc²-0.1.4-linux-x64.AppImage`.
- Carry an existing installation across the rename in one automatic step: the first launch under the new name moves `mail`, `settings.env` and `Local State` from the old app-data folder into the new one and marks the migration so it runs once. The old folder is left in place.
- Rename the local MCP server to `emc2`, so existing `claude mcp add --transport http` registrations must use the new name.
- Keep the Windows application id and the installer identity unchanged, so an installed copy is upgraded rather than installed alongside the old one.

## 0.1.3

- Add cross-platform CI and version-tag releases for Windows x64, macOS Apple silicon and Intel, and Linux x64 installers. Retain CI artifacts for one day and attach installer checksums to releases.
- Give each CI run and rerun a distinct application version and installer filename. Replace rebuilt platform artifacts on reruns. Keep tagged releases at the matching release version.
- Make HTTP and HTTPS URLs in email bodies clickable and keyboard accessible.
- Keep surrounding curly quotes outside email link destinations.
- Open HTTP links through the existing desktop browser handoff. Keep local API routes and unsupported protocols blocked.
- Keep message HTML escaped. In address privacy mode, mask URLs containing email addresses and omit their link targets.
- Record the inbox and Settings review in [repository knowledge](docs/KB.md).
- Document the synthetic browser checks and the untested native Windows handoff.
- Add project agent instructions and contributor guidelines with repository links, verification commands and mail privacy safeguards.
- Add unsigned macOS DMG and ZIP packaging with a macOS icon derived from the existing artwork. The Windows installer command is unchanged.
- Add native macOS menus and spacing for window controls. Keep the mail service running when a user cancels quitting with an unsent draft.
- Use platform-neutral encryption errors and document macOS app-data storage.
- Exclude local environment files, private keys, mail databases and session records from packages, and expand Git ignore rules.

## 0.1.2

- Existing Windows release with sender logos, address privacy controls and MCP settings.
