# ADR 0121: Load refused remote images through the mail service

Date: 2026-11-03
Status: Proposed for the local candidate; pending maintainer review.
Amends [ADR 0009](0009-opt-in-message-images.md), which said never to fetch
image URLs on the server. ADR 0009 and [ADR 0020](0020-explicit-images-with-hidden-text.md)
are unchanged otherwise.

## Context

Some senders serve email images with `Cross-Origin-Resource-Policy: same-origin`
(for example `claude.ai/images/email/...`). The response arrives, but the
browser refuses to show it on another site, so Show images left grey
placeholders where Gmail, which fetches images on its own servers, showed them.
A headless Chromium page on `127.0.0.1` reproduced the refusal while a control
image loaded. Neither the renderer CSP nor the app can override another site's
resource policy, and the web host has no Electron request hooks.

## Decision

- The reader still loads each consented image directly first. Only when that
  load fails does it request `GET /api/messages/:id/remote-image?src=<url>`
  once, show the returned bytes as a blob URL and revoke it on change or close.
  A second failure shows the existing could-not-be-loaded placeholder.
- The route answers only for an image the stored message references (its
  formatted HTML `img` sources or its image metadata), after the same
  `imageSource` validation the renderer uses; a fragment is dropped because it
  never reaches the host. It is behind the existing session, host and origin
  checks. Like a direct image load, it trusts the authenticated renderer to
  ask only after Show images; the renderer remains the consent boundary of
  ADR 0009 and ADR 0020, and the service records no consent state.
- The service fetches over HTTPS on port 443 only, resolves DNS once, refuses
  the request if any answer is private, local or reserved (the unsubscribe
  policy) and pins each connection to a checked address, trying them in order.
  It sends no cookies or referrer and a plain `Mozilla/5.0` user agent, follows
  no redirects, refuses compressed responses and accepts only a 200 response
  whose type is PNG, JPEG, GIF, WebP, BMP or AVIF, up to 5 MiB within 15
  seconds. Six fetches run at once; up to 64 more wait for a slot, because
  image-heavy mail fails many direct loads together. Closing the reader cancels
  its pending and waiting requests.
- Responses carry the validated type, `nosniff`, a sandboxing CSP and
  `Cross-Origin-Resource-Policy: same-origin`. Nothing is cached on disk.

## Consequences

Images refused by the browser now appear after Show images. The sender sees a
second request, from the mail service's address instead of the browser's; on
the desktop app both are the same machine, and on the web host it is the host.
Consent, privacy-mode source suppression and per-opening activation are
unchanged, because the fallback runs only for an image already shown. SVG,
redirecting images and images over 5 MiB still fail when the browser refuses
them. Automated checks use synthetic mail and injected DNS and transport;
installed desktop and web-host rendering need separate proof.
