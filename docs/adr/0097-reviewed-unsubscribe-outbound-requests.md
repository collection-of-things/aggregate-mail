# ADR 0097: Reviewed unsubscribe and outbound requests

Date: 2026-10-28
Status: Implemented for review for issue #58; installed acceptance pending.

## Context

List headers are untrusted mail content. Fetching them during sync or rendering
could unsubscribe someone or reach a private service without consent. The
requested reader action must expose what it will do before making a request.

## Decision

Parse a single List-Unsubscribe header and at most one List-Unsubscribe-Post
header. Reject duplicates, values over 8 KiB, more than ten destinations and
unsupported targets. Retain at most 2 KiB per URL. Choose the single supported
HTTPS URL for POST only with the exact List-Unsubscribe=One-Click marker;
otherwise preserve supported header preference order for manual HTTPS or mailto.
Store metadata only in the existing encrypted full mail record. No sync, render,
preview, agent tool or background job initiates an unsubscribe request.

The reader shows the destination host or mailto address and asks for explicit
confirmation. It labels the destination as unauthenticated sender data. Privacy
requires destination reveal before confirmation. The authenticated service
compares the confirmed metadata with the current cached message, checks that
the receiving account still exists, and rejects concurrent actions on one mail.
Service work participates in the existing update/quit drain.

HTTPS targets require port 443, no credentials or fragment, and no local or
reserved literal address or hostname suffix. Resolve all DNS answers once and
reject the entire result if any address is private, loopback, link-local,
multicast, reserved or unsupported. IPv6 is conservatively restricted to global
unicast, excluding known transition and documentation ranges. Keep the original
hostname for TLS/SNI but pin the connection to one validated IP address. Use a
fresh agent, a five-second total deadline and an 8 KiB response-header limit.
Send only the fixed RFC 8058 form body and its content headers. Do not attach
cookies, authorization, referrers or provider credentials. Follow zero redirects
and discard the response body. A 2xx response means request accepted, not proof
that the sender stopped all mail. Errors and timeouts never trigger retries.

Mailto supports one recipient plus subject and body, with bounded lengths and
header-injection checks. Extra envelope fields, duplicate parameters and unsafe
controls are rejected. Confirmation creates a normal draft on the receiving
account. Ordinary review and Send remain separate actions.

For manual HTTPS, confirmation checks the initial public destination without
fetching it. An explicit Open in browser link uses the existing target=_blank
path, noopener/noreferrer and no referrer. Desktop navigation restrictions stay
unchanged. The system browser owns later DNS resolution, cookies and redirects;
the service's pinning and redirect policy cannot constrain external browsing.

## Limits and verification

[RFC 8058](https://www.rfc-editor.org/rfc/rfc8058.txt) recommends authenticated
DKIM coverage of both list headers. This client does not verify DKIM and does
not infer trust from sender-supplied Authentication-Results. It offers an
explicitly reviewed sender action using the RFC's POST format, with an
unauthenticated-destination notice, rather than claiming authenticated one-click
support. Full DKIM verification is separate work.

Previously cached messages gain metadata when their source is parsed again;
opening a message does not fetch provider headers just to offer Unsubscribe.
The action does not archive, delete, reclassify, create sender rules or record
a subscription inventory. A successful request can have lasting effects at the
sender; reverting this feature cannot resubscribe someone. Unknown outcomes
need inspection with the sender before an intentional new attempt.

Synthetic tests cover the three action paths, malformed and oversized headers,
public/private mixed DNS, fixed target review, no requests before confirmation,
privacy, encrypted draft creation and redirect refusal. They do not prove live
sender behavior or the installed system-browser handoff.
