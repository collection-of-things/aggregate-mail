# Standalone Android client

Implement an independent Android IMAP/SMTP client. Acceptance requires an APK,
executed unit checks, and synthetic Device Hub proof. Desktop parity and live
provider acceptance are separate claims.

## Approach

Use Java and Android platform views, with the Android JavaMail distribution for
TLS IMAP and SMTP. The desktop renderer depends on a bundled Node service, so a
WebView wrapper cannot provide standalone mail. Keep the new client under
`android/`; do not change the Electron service or weaken loopback security.

Use Android Keystore AES-GCM to seal one versioned, atomic local snapshot containing
accounts, a bounded cache and the current draft. Disable backup, cleartext traffic,
screenshots and automatic text linking. Missing keys or authentication failures
stop startup without replacing data. Never store a plaintext fallback.

## Implementation and checks

1. Add a reproducible Gradle wrapper and native application for Android 8 or newer.
   Verify a debug build through the bounded runner. No release signing or publishing.
2. Add validated multi-account TLS configuration and explicit manual sync. Fetch
   at most 100 inbox messages per account with bounded text, nesting and socket
   timeouts. Replace a cache only after a complete successful fetch. Opening mail
   must not mark it read. Unit-check validation, TLS settings and MIME limits.
3. Add an encrypted offline inbox, reader, account management and plain-text
   composer. Save drafts before navigation and before network sends. Persist a
   send-pending marker before SMTP transmission. Uncertain delivery survives restart
   and blocks another send until the draft is explicitly discarded. Do not retry
   automatically. Do not claim a Sent copy. Unit-check send state transitions.
4. Instrument synthetic storage, key-loss, tamper and restart cases. Through Device
   Hub install the exact APK, exercise onboarding, validation, cached text and draft
   recovery. No real accounts or real mail. Record unavailable proof explicitly.
5. Update `docs/android.md`, PRODUCT, CONTRIBUTING, KB, CHANGELOG and a new ADR.
   Review the complete diff against the base and check that desktop code is unchanged.
   Run required bounded repository checks and obtain independent review before delivery.

## Limits and rollback

This first slice has no OAuth, attachments, background sync, archive/delete,
calendar, AI sorting, categories or desktop data migration. Accounts using
password authentication must support IMAP and SMTP with TLS; providers may require
app passwords. Android data is independent of desktop profiles. Remove the new
module to roll back source; uninstalling deletes its local data. Existing encrypted
Android data must never be reset to recover from a key or decryption failure.

## Sources

- [Android Keystore](https://developer.android.com/privacy-and-security/keystore)
- [Android Gradle plugin 8.13](https://developer.android.com/build/releases/past-releases/agp-8-13-0-release-notes)
- [JavaMail Android](https://javaee.github.io/javamail/Android)
- [JavaMail IMAP properties](https://javaee.github.io/javamail/docs/api/com/sun/mail/imap/package-summary.html)
- [JavaMail SMTP properties](https://javaee.github.io/javamail/docs/api/com/sun/mail/smtp/package-summary.html)

No architecture decision remains user-blocked within this slice. Store submission,
release signing, provider credentials and wider feature parity require separate scope.

## Review corrections

Require certificate-chain and hostname verification for IMAPS and SMTP. STARTTLS
is mandatory on the explicit upgrade mode, before authentication. Use one app-scoped
serialized worker and transactional snapshot writes. Freeze the exact account and
draft in the durable pending marker; reject all draft replacement while pending.
A failed send or failed completion write leaves that marker intact.

Enforce at most 8 accounts, 100 messages per account, 256 KiB raw per message,
64 KiB displayed text, MIME depth 12, 128 parts and an 8 MiB serialized snapshot.
Read raw messages through a capped stream before MIME parsing; reject oversized
mail and retain the previous successful account cache. Sync has a 90-second
per-account deadline plus 15-second socket timeouts. Draft inputs have explicit
length limits. Autosave after 500 ms idle and on background; only durable writes
show Saved. Process death can lose keystrokes whose save has not completed.
