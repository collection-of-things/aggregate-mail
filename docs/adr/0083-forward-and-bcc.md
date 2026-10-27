# ADR 0083: Forward and provider-specific Bcc submission

Date: 2026-10-25
Status: Implementation decision. Synthetic verification is separate from delivery.

Store To as an array, with optional Cc and Bcc arrays, in encrypted drafts and
send requests. Normalize legacy single-To encrypted records on read, preserving
the original record until an explicit save. MCP proposal inputs also accept a
single To address. Drafts retain incomplete text; sends require valid addresses.
Keep revision checks, frozen send snapshots and unknown-send confirmation.

Prepare Forward from cached plain text and existing local attachments only.
List every excluded attachment in the body. Never copy received HTML, image
consent, original threading or Bcc. Use the existing composer and draft lifecycle.
The existing safe reader remains responsible for formatted reply context under
ADR 0074. Forward adds no HTML quoting or remote-content retrieval.

SMTP sends Bcc only through the envelope and excludes it from MIME, including
the exact Sent copy. Gmail API uses MIME recipient headers and has no separate
envelope, so preserve its Bcc header in raw submission. Gmail must strip that
header from recipient-visible copies. Synthetic MIME checks prove the submitted
bytes and SMTP envelope, not Gmail's stripping or real recipient delivery.

Send fields and focused verification files are documented in
[the repository knowledge](../KB.md#forward-and-send-recipient-contract).
