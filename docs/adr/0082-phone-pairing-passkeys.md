# ADR 0082: Host-approved phone passkeys and protected browser keys

Status: Accepted

Supersedes ADR 0080's single-session and external-key-only browser launcher
requirements and ADR 0081's phone password requirement. Preserve their profile,
route, encryption and mail security boundaries.

## Decision

Pair a phone using a two-minute one-use QR invitation, a shared comparison code
and explicit approval from authenticated localhost Settings. Invitation tokens
stay in fragments and volatile memory. The public client removes fragments
before requests. A Secure HttpOnly claim cookie binds registration to that
approved phone browser. No session exists before successful user-verified
WebAuthn registration. Store only public credentials in encrypted SQLite.

Use SimpleWebAuthn to verify exact origin, RP ID, challenge, presence and user
verification. Bind login challenges to Secure ceremony cookies. Consume them
before asynchronous verification and recheck approval, credential existence,
expiry and route lifetime before saving or issuing a session. Cancel/revoke
wins against in-flight verification. Revoked or expired route proof invalidates
pending ceremonies and remote sessions, even if the same origin returns.

Keep bounded independent passkey sessions so a phone does not evict localhost
approval. A new login rotates only that credential's session. Explicit Lock ends
its session; removing a credential ends all its sessions. Passkeys may sync and
therefore identify a credential, not necessarily one physical phone. Cap stored
credentials at eight. Restart clears sessions and volatile ceremonies.

Keep the host recovery passphrase, with password-manager autofill, restricted to
exact localhost Host and Origin. Do not accept it from phone routes. Passkeys
require the private HTTPS route; unsupported browsers must reconnect using a
supported passkey-capable browser rather than bypass verification.

The browser launcher provisions a fresh data key through the persistent OS
credential store. Use a bounded child, private pipes and a canonical-profile
bootstrap lock. Bind the OS entry to the profile identity, preserve existing
keys, require successful readback, and record only non-secret identity metadata.
Pin Linux to Secret Service, never the keyring library's memory-only fallback.
Missing or unreadable existing keys, mismatched profiles and unavailable OS
protection stop before SQLite opens. Existing external-key profiles keep their
original configuration; no migration or desktop key changes occur.

## Consequences and proof

Users never type the encryption key and do not enter a password on their phone.
The host recovery passphrase still requires secure provisioning and retention.
A headless host without persistent credential storage needs its existing secure
external-key deployment. No plaintext key fallback is introduced.

QR, codes and private URLs disappear from the Settings DOM in Privacy mode.
Rate and memory bounds limit unauthenticated ceremony work, but compromised host
accounts and denial of service by tailnet peers remain outside this gate.

Synthetic tests use actual signed WebAuthn fixtures and injected OS entries.
They cover replay, wrong origins/RP/challenge/UV, route revocation, concurrency,
cancellation and key preservation. They do not prove native phone prompts,
platform credential-store persistence or real-provider phone OAuth.
