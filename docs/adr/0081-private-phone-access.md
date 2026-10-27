# ADR 0081: Private phone browser access through host Tailscale Serve

Status: Accepted

## Context

The password-protected browser target needs phone access while preserving its
loopback listener, encrypted separate profile and existing host services.
The user should configure hosting from Settings on the host.

## Decision

Use the host's installed Tailscale CLI to create one private HTTPS Serve route
on an unused port in 8444 to 8454. Require an authenticated exact localhost
origin, normal CSRF and explicit confirmation for setup and removal. Tailscale
installation, login, permissions and phone enrollment stay outside Emc².

Persist route ownership in encrypted storage before mutation. Derive DNS from
live Tailscale status. Admit one exact HTTPS origin only after private-target,
route-preservation and TLS/gate checks. Refuse Funnel. Renew proof every 30
seconds with a 60-second lease. Failed proof suspends remote admission; expiry
invalidates the remote session. Startup applies the same checks to saved routes.

Use Secure HttpOnly Strict `__Host-` cookies for phone access. Bind the single
browser session to its login origin. Keep loopback management available through
a new local login. Do not trust forwarded identity headers. MCP stays loopback
only. Bind Google consent and callback exchange to the trusted starting origin.

Remove only a still-matching owned route. Revoke admission before removal and
retain ownership with a visible error when safe cleanup cannot be verified.
Hide private URLs from the Settings DOM when Privacy is on.

## Consequences

The host must remain running and connected to Tailscale. Desktop and browser
profiles remain separate. Google may reject a tailnet OAuth callback domain;
provider verification is independent from private route verification.

The CLI does not expose an adapter-level transaction spanning the snapshot and
mutation. Emc² serializes its own operations and checks config before and after;
operators must avoid concurrent external Serve changes. Foreign or changed
routes are not removed. A compromised host account remains outside this gate.

Synthetic route and UI tests do not establish live TLS or phone interaction.
