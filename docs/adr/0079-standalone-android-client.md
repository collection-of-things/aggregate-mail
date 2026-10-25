# ADR 0079: Standalone Android client

Date: 2026-10-25
Status: Implementation candidate. Standalone operation is owner-requested;
installed and live-provider acceptance remain separate.

## Decision

Implement Android independently under `android/`, using native Java views and
the Android JavaMail distribution for direct TLS IMAP and SMTP. The desktop
renderer requires a Node service that is unavailable as a standard Android
runtime. A WebView alone cannot provide standalone mail. Do not expose the
desktop loopback service or change its origin/authentication rules.

Use Android Keystore-backed AES-GCM for an atomic versioned snapshot containing
accounts, bounded cached Inbox mail, the current draft and send-pending state.
Disable backup and screen capture. Stop on key loss or decryption failure without
replacing existing data. No plaintext key fallback is permitted on Android.
One application-scoped worker serializes writes and mail operations across
Activity recreation. Publish in-memory state only after persistence succeeds.

Use read-only IMAP access with PEEK, explicit manual sync and bounded raw MIME
reads. Render text in native views without WebView or remote image loading.
Sending requires confirmation and a durable marker bound to the exact account
and draft before SMTP begins. Failed or interrupted transmission, or failed
completion persistence, retains the locked draft. No automatic retry or Sent
copy is attempted. Explicit discard cannot undo an already-delivered message.

## Consequences

Android data does not share desktop encryption, profiles or migrations. The
first slice supports app-password IMAP/SMTP only. OAuth, categories, mail-state
mutations, attachments, calendar, AI sorting and background sync remain absent.
The snapshot and download bounds are described in [Android](../android.md).
Desktop package, updater, provider and release contracts remain unchanged.

Debug builds have a separate application ID. Unit tests, Android Keystore
instrumentation tests, installed emulator smoke, live provider acceptance and
store submission are distinct proof layers. No store or release authority is
created by this record.
