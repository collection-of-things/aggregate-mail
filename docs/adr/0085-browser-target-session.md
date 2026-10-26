# ADR 0085: Per-launch session for the browser target

Date: 2026-10-26
Status: Accepted

## Context

The desktop app authenticates `/api` with the per-launch `MAIL_DESKTOP_TOKEN`
header that Electron injects. The browser target (`npm run dev:web`,
`npm run start:web`) runs without that token, so its `/api` gate relied only on
the loopback Host check, an Origin check that applies only when the header is
present, and a CSRF token readable from `GET /api/state`. Any other local user
or program could read mail and act as the developer.

## Decision

- Every `/api` request needs a secret in every mode. With the desktop token set,
  nothing changes. Without it, the server generates a random per-launch session
  secret and prints `APP_URL/api/session?token=…` at startup.
- Opening that link sets an `HttpOnly`, `SameSite=Strict` cookie scoped to
  `/api` and redirects to `/`. The Vite dev proxy forwards the cookie, so the
  renderer needs no changes, and image and other non-fetch `/api` loads work.
- Secrets are compared in constant time. The Google OAuth exemption is
  unchanged and applies to both modes.
- The Vite proxy does not inject the secret, since any local process could then
  use the proxy instead.

## Consequences

Each launch of the browser target needs its printed link once per browser
session. The link is a credential for that launch; it is printed only to the
developer's terminal and never written to disk. Cookies are not isolated by
port, so another server on the same loopback host visited directly in that
browser could receive the cookie; a hosted or public renderer needs its own
authentication.
