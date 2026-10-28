# ADR 0096: Resumable phone onboarding through QR or a setup link

Status: Implemented for the requested phone-onboarding repair; verification and independent review required.

A phone can also choose Connect this device on the private access page. This
creates a cookie-bound pending request without a QR. Apply the same rate limit,
capacity, ten-minute deadline, route lifetime and matching-code localhost
approval. Never replace another pending request remotely; the host may cancel
or supersede it. The same claim cookie may resume its own request. No session
or credential exists before host approval and verified passkey registration.
This extends ADR 0082's host-initiated-only pairing entry point.

Use the same one-use fragment invitation for a QR code and direct setup link.
Return both only when authenticated localhost explicitly creates an invitation.
Keep the link in component memory, preserve it only for the same pairing and
hide it with the QR in Privacy mode. Do not put invitation tokens in queries,
logs or persistent browser storage.

Keep unclaimed invitations limited to two minutes. Once a browser claims an
invitation, consume its token and grant ten minutes for matching-code host
approval and user-verified passkey registration. Set the Secure HttpOnly claim
cookie to that same deadline. This supersedes ADR 0082's two-minute limit only
for already-claimed setup. Cancellation, route loss and replay checks remain.
No session exists before successful passkey verification.

Reloading a pairing page without a fragment checks the existing claim cookie.
It does not create a new invitation or bypass approval. Expired or invalid
claims show setup help and keep registration disabled. Sign-in and pairing use
one responsive public stylesheet; passwords stay localhost-only.

Synthetic HTTP and DOM checks cover reload, QR/link identity, privacy, expiry,
approval and signed WebAuthn registration. Native passkey UI, installed-app
acceptance and real-provider mail operations remain separate proof.
