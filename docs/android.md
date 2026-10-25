# Android

Emc² includes an experimental native standalone Android client in `android/`.
It connects directly to TLS IMAP and SMTP servers. It needs no Electron app,
Node service, desktop pairing or hosted backend. Android data is independent
of desktop profiles.

## Supported workflow

- Add up to eight accounts using your provider's server settings. Both servers
  use the same login and password. Use an app password if your provider requires
  one. Saving credentials does not establish a connection.
- Tap Sync to fetch up to 100 recent Inbox messages per account. Sync is explicit;
  there is no background service. The last successful sync time is shown for
  each account. Failed account syncs keep the previous cache.
- Read cached text offline. Opening a message does not mark it read on the
  server. HTML-only bodies are converted to text without a browser, remote
  images or active content. Message text can be selected and copied explicitly.
- Compose a plain-text message to one recipient, or reply to the first Reply-To
  address. Drafts save after 500 ms idle and when the app backgrounds. Saved
  appears only after persistence. Keystrokes whose write has not completed can
  be lost if the process dies. Drafts never enter Android saved-state bundles.
- Confirm Send to submit through SMTP. A durable pending marker is written
  before transmission. Any failed or interrupted send leaves the draft locked;
  check the provider before explicitly discarding it. No automatic retry occurs.
  SMTP acceptance does not prove final recipient delivery. The app does not
  create a Sent copy; the provider might.
- Remove an account to delete its local cache and draft. Server mail is unchanged.
  Discarding a draft cannot undo a message already delivered.

This slice has no OAuth, categories, archive/delete, attachments, calendar,
AI sorting, background sync or desktop migration. Gmail password access may
be unavailable under the account's policy. No provider acceptance is implied.

## Privacy and limits

Accounts, credentials, cached mail, drafts and send state share an atomic
AES-256-GCM encrypted snapshot in Android's no-backup directory. Android
Keystore protects its key. A missing key, authentication failure or unsupported
snapshot version stops startup and preserves existing files. There is no
plaintext fallback or automatic key/profile reset. Android backup and screen
capture are disabled. Explicit selection/copy of message text still uses the
system clipboard.

IMAP uses implicit TLS. SMTP supports implicit TLS or mandatory STARTTLS.
Both verify certificate chains and hostnames; there is no trust-all option.
Socket connect/read/write timeouts are 15 seconds. Account sync checks a
90-second deadline between operations and while streaming; a blocking socket
operation can add its timeout and cleanup time.

Each raw message is capped at 256 KiB before MIME parsing, including headers
and attachments. An oversized message stops that account's sync and preserves
its previous cache. Text is capped at 65,536 characters, MIME traversal at depth
12 and 128 parts, and the serialized encrypted snapshot at 8 MiB. These are
intentional initial limits, not complete mailbox coverage. Failed sync cannot
establish whether server mail has been deleted or moved.

## Build and verify

Install JDK 17 or newer and Android SDK platform 36. Set `ANDROID_HOME` to
your SDK directory. Gradle 8.14.3 is pinned with a distribution SHA-256.

On shared Linux, use the repository's required bounded runner, serially:

```sh
"$FLEET_BIN" verification bounded --memory-mib 3072 --timeout 480 -- \
  env ANDROID_HOME="$ANDROID_HOME" \
  ./android/gradlew -p android --no-daemon --max-workers 1 \
  testDebugUnitTest lintDebug assembleDebug assembleDebugAndroidTest
```

The debug APK is `android/app/build/outputs/apk/debug/app-debug.apk`, using
application ID `dev.emc2.android.debug`. Production uses `dev.emc2.android`;
no release signing, publishing or release workflow is configured here.
Generated APKs, Gradle output, local SDK paths and keystores stay untracked.

Open an emulator with T3 Code Device Hub, then use its returned `agent-device`
launcher and flags to install and open the debug APK. Never use a saved personal
account for testing. The instrumentation APK includes isolated encryption tests.
Run them with Android's instrumentation runner on the same debug candidate.
They verify encrypted readback, transaction aborts, ciphertext tampering and
missing-key preservation in a test-specific directory and Keystore alias.

Synthetic, installed-emulator, live-provider and store proof are separate.
Unit checks and an APK build do not establish installed behavior, SMTP delivery,
provider OAuth compatibility or release readiness. Screen capture intentionally
shows a protected surface; use accessibility snapshots to inspect synthetic UI.
