# ADR 0120: Business senders, learned owner names, postal lines and privacy word lists

Date: 2026-11-02
Status: Accepted by the maintainer for the local candidate.
Amends [ADR 0117](0117-privacy-hides-correspondent-names-and-account-labels.md)
for business senders and owner-name sources. ADR 0117 is unchanged otherwise.

## Context

After ADR 0117, privacy mode hid every sender display name. Brands such as
Kickstarter disappeared from the list, and a brand name matched its own image
and link URLs (`Anthropic` in `cdn.anthropic.com`), so privacy mode blocked
every image in that brand's mail even after Show images. The owner's own name
stayed visible in bodies whose headers did not carry it (bare To addresses,
quoted order confirmations, signatures). Postal addresses were never covered.

## Decision

- A sender is a business, and its display name stays visible, when it writes
  from a role mailbox (`no-reply`, `info`, `support`, `billing` and similar) or
  its name matches its own non-personal domain. The same test applies to
  third-party To/Cc/Reply-To names. Names tied to an owner address are never
  treated as businesses. Personal mail domains (`personalMailDomains`) never
  count as business domains. Because business names leave the dictionary, their
  image and link URLs load again; addresses in URLs are still checked.
- Mail sent from an owner address names the owner, so its sender splits into
  first name and surname like an account name.
- `learnedOwnerNames` collects owner display names from every cached message:
  To/Cc phrases tied to an owner address and the sender of mail sent from one.
  The four most frequent full names, with their parts, join the app-wide
  dictionary.
- Numbered US-style street lines (`422 Southeast 17th Place`) and
  `City, ST 12345` lines are hidden as revealable address tokens. Words must
  start with a capital or digit and the street line must end in a known
  suffix, which keeps prose and order numbers visible.
- Settings > Privacy keeps two owner-chosen lists in the encrypted store
  (`privacyWords` record, authenticated CSRF-checked `PUT /api/privacy-words`,
  delivered in state): Always hide (up to 20 names) and Never hide (up to 64).
  Never hide removes a name from the name matchers only; addresses and postal
  lines stay hidden. The section lists learned names with a Keep visible
  action. Hidden and learned names are masked on that page while privacy is on.

## Limits

A person writing from a vanity domain that matches their name, or from a role
mailbox, stays visible; Always hide covers that. Non-US postal formats are not
detected. Spelling variants of the owner's name are hidden only once learned
or added. CLI and MCP redaction (ADR 0115) keep their existing name rules but
gain postal-line detection through the shared matcher.

## Verification

`src/privacy-words.test.tsx` covers the business test, brand images and links
in privacy mode, owner-sender splitting, learned names, list application and
postal detection including visible look-alikes. `src/privacy-settings.test.tsx`
mounts the section with masking and saving. `server/mail-features.test.ts`
covers validation, encryption at rest and state delivery. The existing privacy
sweep still passes.
