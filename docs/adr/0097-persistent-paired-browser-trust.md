# ADR 0097: Remember paired browsers until explicit lock or device removal

Status: Owner-requested change to stop automatic paired-device locking.

Supersedes ADR 0082's volatile phone sessions and automatic idle/total lock for
paired browsers. Keep localhost recovery sessions and their timeouts unchanged.

After verified passkey registration or authentication, issue a random 256-bit
browser cookie. Store only its SHA256 hash in the existing encrypted credential
record. Bind trust to that credential and its exact verified private HTTPS
origin. Keep at most eight browser hashes per credential; refuse an additional
browser rather than silently locking another one. Return only public device
metadata from Settings APIs.

A trusted browser survives idle time, browser close and host restart. Route
proof remains required on each request; temporary loss suspends admission but
does not erase trust. Pending pairing and passkey challenges still expire and
are invalidated by route lifetime changes. No unverified request can create
trust. Credentials, encryption and remote-image consent are unchanged.

Explicit Lock removes only the current browser hash. Removing a credential
revokes all its browsers. A saved cookie fails after either action. Browsers
cap persistent cookies at 400 days; normal authenticated requests renew that
cookie. Clearing site data or exhausting the browser lifetime requires an
existing-passkey unlock. Old volatile sessions adopt persistence after one
passkey unlock, without another host pairing.

The renderer conceals private content during network or non-success HTTP
responses and retries automatically. It preserves mounted editors while hidden.
Confirmed unauthenticated status or explicit lock still unmounts private content
and stops automatic readmission. This separates a temporary host outage from
revocation without displaying content before admission is confirmed.

Synthetic checks cover idle beyond eight hours, fresh gate instances sharing
saved credentials, route suspension/recovery, explicit Lock, removal and offline
draft retention. Real browser storage retention and installed/native acceptance
remain separate proof.
