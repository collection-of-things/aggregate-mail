# Phone pairing and passkeys

Implement scan, host approval and passkey unlock for private Tailscale browser
access. Preserve the local recovery passphrase and existing externally managed
key path. Add automatic OS credential-store provisioning for the browser data
key, without desktop profile migration or weaker key fallback.

## User path

1. Unlock localhost using the host recovery passphrase, with password-manager
   autofill. Recovery-password sign-in accepts only the exact localhost Host
   and Origin; phones cannot use it. Enable the verified private route in Phone access.
2. Choose Connect phone. Show a two-minute, one-use QR invite. Its bearer token
   stays in a URL fragment, never query strings, logs or persistent storage.
3. Scan on the phone. Consume the invite, bind the claim to a Secure HttpOnly
   cookie, and show the same short comparison code on phone and host. The code
   identifies this request; it is not an authentication secret.
4. Approve explicitly on the authenticated host with normal CSRF. The phone
   creates a discoverable, user-verified passkey. Validate challenge, exact
   origin, RP ID and user verification using SimpleWebAuthn before saving its
   public credential in encrypted storage. Grant no session before approval.
5. Later unlock with a user-verified passkey. Keep the host session while phones
   sign in. Limit credentials and sessions, expire challenges, prevent replay,
   bind remote sessions to credentials, and revoke them on credential removal,
   private-route suspension or proof expiry. List and revoke phones on localhost.

## Implementation and security boundary

- Reuse browser gate Host/Origin checks, exact localhost management, CSRF, store
  encryption and route leases. Mount only named pairing/WebAuthn endpoints before
  session authentication. Exact Origin is mandatory for their POST requests.
- Browser gate retains password throttling and legacy password-session rotation.
  Keep independent bounded passkey sessions so phone login does not evict host
  approval. Lock terminates the requesting session; removing a phone terminates
  all its sessions. Route failure terminates all remote sessions.
- Put pairing state, challenges and invitation tokens only in bounded volatile
  memory. Expiry, restart, cancellation and failed verification invalidate them.
  Host approval must match the claimed cookie and pending request. Recheck lease,
  approval, expiry and credential existence after async verification before save.
- Add dedicated server module and small public auth client. Use official
  SimpleWebAuthn server/browser packages rather than custom production WebAuthn
  parsing. Render QR locally with qrcode. Never load third-party scripts.
- Add a Node browser launcher using @napi-rs/keyring with Linux Secret Service
  explicitly selected. Default fresh browser data lives outside source. Generate
  a 32-byte data key internally, persist and read it back through the OS store
  before opening SQLite. Bind its identity to the canonical profile path. Missing
  or unreadable existing keys stop startup; never reset keys or downgrade to
  plaintext or reboot-volatile keyutils. Bound the keyring child process and
  exclude unrelated secrets from its environment. Do not inspect real saved keys
  during development. Preserve explicit external-key startup compatibility.

## Files and checks

- server/browser-access.ts: bounded credential-bound sessions and public auth seam.
- server/phone-passkeys.ts, shared/phone-access.ts, server/store.ts, server/index.ts:
  pairing, verification, encrypted public credentials and exact local management.
- src/settings/PhoneAccessSettings.tsx and focused tests: QR, comparison, approval,
  cancellation, devices, revocation, expiry, privacy and accessible status.
- src/phone-auth.ts, scripts/build-browser.mjs: public pairing/passkey client only.
- server/browser-keyring.ts, scripts/start-browser.mjs and tests: safe key bootstrap.
- package manifests, README, KB, changelog and a new ADR documenting superseded
  parts of ADRs 0080/0081. Do not rewrite accepted decisions.

Verify through serial bounded tests: unapproved and wrong-origin requests,
claim/approve/register, expiry, replay, lease loss, tampering, real signed
assertions, wrong challenges/RP/UV, concurrent verification/revocation, retained
host session, credential revocation, privacy DOM and failed OS key access.
Run strict build and scoped dependency audit, then independent source review.
Keep the prior canonical full-suite hold; no merge or release. Live phone,
platform passkey and OS keyring acceptance remain separate from synthetic proof.
No real accounts, mailbox changes, Tailscale login automation or external
credential access. Rollback keeps prior external-key hosting and password login;
new credentials are additive and sessions are ephemeral.

## Sources

- https://github.com/MasterKale/SimpleWebAuthn (official package declarations and examples)
- https://github.com/Brooooooklyn/keyring-node (persistent Linux backend selection)
- https://github.com/soldair/node-qrcode (local QR generation)

## Plan review resolutions

- Serialize key creation under a canonical-profile lock. Recheck missing keys,
  marker and SQLite existence inside it. Never overwrite an existing OS entry.
- Bind registration to its Secure claim cookie, approval and challenge; bind
  login challenges to a distinct Secure ceremony cookie. Consume challenges
  before asynchronous verification, then recheck expiry, route lifetime and
  approval/credential existence before persisting or issuing a session.
- Restrict recovery-password login to exact localhost Host and Origin. Preserve
  external key provisioning, but remove remote password login.
- Capture and clear invitation fragments immediately with history.replaceState.
  Clear them on failure and page exit. Suspend pairing and login challenges
  across any route revocation, even if the same origin returns.
