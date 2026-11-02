# Browser and phone access

[Back to the README](../README.md#guides)

Run the optional browser target, protect its profile and pair a phone over a
private Tailscale route.

## Local browser access

The optional browser target uses the same mail interface without Electron. It
requires Node 24.x and installed dependencies. Build once with `npm run
build:web`, then run `npm run start:web` and open the configured `APP_URL`.
The default is `http://127.0.0.1:3001`; `MAIL_WEB_PORT` changes the listener port.
For direct `start:web` access, `APP_URL` must use the same port. A separate
frontend or proxy can use another port.

This build does not package or compile Electron. The local service must remain
running.

### Refresh an installed web build

After the host installs a new web build, an open browser checks for it every ten
seconds and on returning to the tab. An **Update ready** notice offers **Update
now** and **Later**. The client refreshes after 30 seconds without interaction
when a mail view is ready and no editor, pending request or uncertain write blocks
it.

Attachment downloads and open previews also pause updates. Later pauses automatic
refresh for that build. Finish editors and return to a mail view to update.

The current mail view and selected message are restored within the same tab.
Unknown write outcomes require checking their result before manually refreshing;
the client never retries them to update.

For Linux host updates from published stable releases, see [stable-release web
updates](web-updates.md). Deployment templates are provided; live activation
requires the deployment owner to clear its hold.

This refresh loads a build already installed on the host. It does not download
releases or change the existing browser sign-in lifetime. Older clients need one
manual reload to adopt update detection.

### Host settings

Before starting, supply these environment variables through your local secret
manager or protected launch environment. Do not put secrets in shell history,
URLs, source files or shared launch scripts:

| Variable | Requirement |
| --- | --- |
| `MAIL_WEB_PASSWORD` | A host recovery passphrase of 16 to 256 characters, supplied by a password manager; phones use passkeys |
| `MAIL_DATA_KEY` | Optional with `npm run start:web`: the launcher generates and protects the key in the OS credential store. Existing externally managed profiles must supply their original 32-byte base64 key |
| `MAIL_DATA_DIR` | Optional separate browser profile; defaults to the user app-data directory, outside the source and frontend |
| `MAIL_WEB_PORT` | Optional loopback backend port, 1024 to 65535; default 3001 |
| `APP_URL` | Loopback frontend origin; defaults to `http://127.0.0.1:<MAIL_WEB_PORT>` |

### Protect the browser profile

`npm run start:web` automatically provisions a data key in macOS Keychain, Windows
Credential Manager or an unlocked persistent Linux Secret Service. It never asks
users to type or remember that key. Linux memory-only keyutils and plaintext key
files are not used.

Missing, locked, unreadable or inconsistent existing credentials stop startup
before SQLite opens. Unlock the original credential store to recover access. Do
not delete keys or reset profiles.

Browser and desktop profiles remain separate. Existing external-key profiles
continue to require their original `MAIL_DATA_KEY`; they are not automatically
migrated into the OS store. Losing that key prevents recovery.

Direct backend and development startup still require explicit key and profile
provisioning.

### Unlock and pair browsers

Open `/auth` locally to unlock with the recovery passphrase; password managers can
fill it. It is accepted only at the configured localhost Host and Origin. Five
attempts per minute are allowed.

Phones use paired passkeys instead. Pair each browser once. Paired browsers stay
trusted across idle time, tab closes and host restarts.

Temporary network or route outages hide the inbox and retry without removing
trust. **Lock inbox** forgets the current browser; removing a paired device
revokes every browser using that passkey. Clearing site cookies also requires
another passkey unlock, but not host pairing while the passkey remains registered.
Browser cookie limits may eventually require another unlock; normal use renews the
cookie.

No AI agent is needed for pairing or approval.

Local recovery-password sessions still lock after 30 minutes without a request or
eight hours total, and restart ends those local sessions. Paired-device trust
never exposes the localhost recovery password or bypasses the private route.

### Browser development

For development, export `APP_URL=http://127.0.0.1:5173` with the same required
variables and run `npm run dev:web`. Open `http://127.0.0.1:5173/auth` first. The
development server proxies access and API routes to the loopback service.

Use built assets for normal use. Google OAuth callback registration must match
`APP_URL` plus `/api/oauth/google/callback`.

### Phone access over Tailscale

For a headless host with Phone access already enabled, run `npm run phone:link`
in the host installation with the same secure launch environment. It uses
`MAIL_WEB_PASSWORD` and `APP_URL` (or `MAIL_WEB_PORT`). To pipe the recovery
passphrase from a password manager instead, use `npm run phone:link -- --password-stdin`.
Never pass a password as a command argument.

Open the printed one-time link on your phone within two minutes, then choose
**Save passkey and open inbox**. Complete the screen-lock prompt within ten
minutes. The link grants its first recipient permission to register, so share
it privately. No second approval on a host screen is needed. The command ends
its temporary host recovery session. Logging in replaces other localhost
recovery sessions and uses one of the shared five login attempts per minute;
existing paired phones stay connected. If sync or an application update is
running, wait for it to finish before running the command again.

From the phone, open the private address and choose **Connect this device**.
Compare its code with **Settings > Phone access** in the authenticated localhost
browser on the host. Approve there, then save the passkey on the phone.

Starting from the host with a QR or direct invitation also works.

In the signed-in localhost browser, open **Settings > Phone access**, enable
access and choose **Connect phone**. Scan the QR from another screen, or use
**Copy setup link** to open the same invitation on your phone. Compare the code,
approve on the host and save the passkey on your phone.

Open invitations within two minutes; once opened, finish approval and passkey
setup within ten minutes. Reloading the pairing page resumes the claimed setup.
For an expired invitation, choose Connect phone on the host again.

Future visits use **Unlock with passkey** in the browser or password manager where
you saved it.

Install and connect Tailscale on the host and phone. Start the built browser app,
unlock it locally, then open **Settings → Phone access → Enable phone access**.
Confirm to let Emc² create one private HTTPS Serve route on an unused port from
8444 to 8454.

The host user must have permission to manage Serve. Emc² does not sign in to
Tailscale or change its permissions.

Settings shows the URL only after checking the live host, private route, TLS
certificate and Emc² gate. Choose **Connect phone**, scan its QR code and compare
the code shown on the phone with the host. Click **Approve matching phone** on the
host.

On the phone choose **Save passkey and open inbox**, using Face ID, fingerprint or
the screen lock supported by that phone. Future visits offer **Unlock with
passkey**. No password or encryption key needs typing on the phone.

An invitation expires after two minutes and works once. QR and ordinary setup
links require matching-code host approval. Terminal-generated headless links
carry that approval for their first claim. All paths require a verified passkey
before inbox access. Its token is a URL fragment, immediately removed from browser
history. Registration and login challenges are cookie-bound and consumed once.

Up to eight passkeys may be paired. Settings lists phones with Remove controls; a
synced passkey may represent more than one physical device. Removing it revokes
every session using that passkey.

Privacy removes the URL, QR and comparison code from the Settings DOM and hides
the approval action. Web-initiated host route management and pairing require the
signed-in localhost browser, exact Origin and CSRF. The separate headless
`phone:link` flow carries approval for the invitation's first claim and still
requires a verified passkey before inbox access. The desktop target does not
configure browser hosting.

Keep Emc² and Tailscale running on the host.

The backend stays on loopback. Existing Serve routes are preserved and public
Funnel is refused for the Emc² endpoint. Checks renew every 30 seconds with a
60-second admission lease.

Failed verification suspends phone access; an expired lease invalidates its
browser session. Refresh checks the route again. Disable revokes admission first
and removes only the matching owned route.

Changed or unverifiable routes remain untouched, with an error in Settings. Avoid
changing Serve configuration concurrently with setup or removal.

For Google OAuth, register the verified HTTPS origin plus
`/api/oauth/google/callback` with your Google client as well as the localhost
callback. Google may impose its own authorized-domain restrictions; phone OAuth
requires separate provider verification. Existing IMAP setup stays available.

Do not expose the service through a public proxy or bind it to a network
interface. The gate cannot protect a compromised host account or hostile local
processes. Browser and desktop profiles stay separate; MCP still requires its own
loopback-only opt-in and bearer permissions.

Interactive browser, phone, installed-app and real-provider acceptance remain
separate checks.

## Browser session checks

Browser rendering also checks access before mounting private content and every 10
seconds afterward. A revoked session or failed access check removes mounted mail
and drafts. Hidden tabs conceal content and recheck access on return. The access
page broadcasts explicit locking to other tabs on the same origin.

Checks of session status do not renew request-idle expiry. Browser-session loss
can discard unsaved edits; it never sends mail or retries an uncertain send.
