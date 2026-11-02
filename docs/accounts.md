# Connect your accounts

[Back to the README](../README.md#guides)

Set up Gmail, iCloud, Fastmail, Yahoo or a custom IMAP account. Use the connection
dialog for credentials.

## Connect an account

Select **Connect an account** in the empty inbox or add an account from Settings.
Choose your provider. Known providers fill in the incoming and outgoing server
settings; custom IMAP keeps those fields available.

### Gmail and Google Workspace

For Gmail and Google Workspace, use **Continue with Google** when Google OAuth is
configured. Otherwise, the connection dialog offers an app-password option with a
link to Google's account settings. Enter your email address and a dedicated
[Google app password](https://support.google.com/accounts/answer/185833), not your
normal Google password.

This option needs no Google Cloud project. It requires 2-Step Verification and may
be unavailable because of Workspace administrator policy, security-key-only
verification or Advanced Protection. Google recommends OAuth when it is available.

### Connection checks and reconnection

The app checks both incoming and outgoing access before saving an IMAP account. If
a check fails, correct the connection form and retry. Account credentials stay in
the encrypted local store.

Gmail saves its own Sent copies; the app-password connection does not append
another copy.

Existing Gmail OAuth accounts keep their connection method and cached mail. The
app does not switch an existing account between OAuth and IMAP during
reconnection, because those methods use different message identifiers.

### Advanced Google OAuth setup

The source build does not include a shared Google OAuth client. A maintainer or
self-hosting user can configure one once, then use Google sign-in for eligible
personal Gmail and Workspace accounts.

1. Create a project in [Google Cloud](https://console.cloud.google.com/apis/credentials) and enable the Gmail API.
2. Configure the consent screen and add your Google accounts as test users.
3. Create an OAuth client of type Web application.
4. Register `http://127.0.0.1:32145/api/oauth/google/callback` as its authorized redirect URI.
5. In Emc², save the client ID and secret under Settings, Google and connections. A ticked `Saved` line under each field shows what is on disk, so an existing client ID never needs re-entering. Use Continue with Google for each account.

Sign-in opens in your default browser. After consent, the desktop app refreshes
and syncs the account. Access includes reading mail, marking it read, archiving
and sending.

Google apps left in external testing may require periodic reconnection. See
[Google's authorization
documentation](https://developers.google.com/workspace/gmail/api/auth/web-server).

## Other providers

Choose iCloud, Fastmail or Yahoo and follow the dialog's app-password link. Custom
IMAP supports a separate incoming username, a TLS IMAP host/port, and SMTP on port
465 with TLS or 587 with required STARTTLS.

iCloud requires an [app-specific
password](https://support.apple.com/en-ie/102525). Enter credentials only in the
connection form, never in source or chat.

### Sync recovery

Use Retry connection beside an account in Settings to sync with its encrypted
saved credentials. It keeps the account ID, cached mail, taught sorting and snooze
state. Duplicate clicks share queued or running work. A failed account can retry
while another account is still syncing.

The account shows Retry queued or Syncing and retains its previous error until its
run finishes.

Retry connection cannot repair rejected credentials. For a Google sign-in
rejection, use Continue with Google. For an IMAP authentication rejection, use
Connect to replace the app password.

Access failures point to provider permissions or administrator policy. Connection
failures can be retried later; unreadable mail has a separate error. Failure
details show only a fixed category, operation, allowlisted code and optional HTTP
status, without raw provider errors or credentials.

A partial listing retains cached mail and batches already fetched. Only a complete
inbox listing archives cached messages absent from the provider. A cleanup warning
preserves the sync result. Fresh Gmail mail appears in groups of up to ten while
later downloads run; cached-only changes share page writes.

Unchanged messages are not rewritten. Renderer notifications share one active read
and one pending refresh, including a refresh requested during a failed read. These
changes add no automatic provider retry.

Real account recovery and native Settings interaction still need separate
verification.
