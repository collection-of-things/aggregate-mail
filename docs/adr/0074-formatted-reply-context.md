# ADR 0074: Formatted original messages in reply composers

Date: 2026-10-25
Status: Requested correction, pending validation.
Amends: Reply context in ADRs 0069 and 0073.

Use the existing safe reader content component for original messages beside
reply editors, including reopened drafts. Retain sender formatting through
the shared allowlist and display link labels rather than a raw plaintext URL
transcript when valid HTML exists. Rejected or unavailable HTML retains the
plain-text fallback. Do not change or rewrite the saved source message.

Content recovery uses the existing authenticated single-message endpoint.
Remote assets remain blocked until explicit Show images activation. Keep
opening-specific consent, reset it when privacy is enabled or the source
changes, and apply connected-person redaction to text and attributes.
Preserve independent scrolling, the shared footer, draft recovery and settings.

Verify synthetic formatted and legacy sources, image/privacy transitions,
source identity replacement, unsafe markup rejection and unchanged draft text.
Rebuild and launch the exact Mac candidate before committing this correction.
