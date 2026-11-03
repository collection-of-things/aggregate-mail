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

- A sender is a business, and its display name stays visible, when its whole
  compacted name, short words included, equals a label of its own
  non-personal domain or the whole domain (`Amazon.com`), optionally followed
  by one organization word (`Acme Inc`). Services relay people's names from
  automated or departmental mailboxes (`Jane Smith <notifications@github.com>`),
  so on those mailboxes (`no-reply`, `info`, `support`, `billing`, `alerts` and
  similar, followed only by a `+tag` or a number, so `info.jane@` is not one;
  not `hello`, `team` or `contact`, which people use personally) the name
  stays visible only when, as a whole or without organization and role words
  (`The`, `Team`, `Bank`, `Billing`), it equals the domain or its brand label
  (`Bank of America <alerts@bankofamerica.com>`,
  `The Acme Billing Team <alerts@acme.com>`), or consists only of those words.
  Mail subdomains such as `marketing.` never count, and a prefix of the brand
  never does, so `Dan Support <support@dancecenter.com>` stays hidden.
  Outside role mailboxes, a mailbox containing one of the name's words marks a
  person (`sean.ford@ford.com`), unless that word is the domain label itself
  (`spotify@news.spotify.com`). The same test applies to
  third-party To/Cc/Reply-To names. Names tied to an owner address are never
  treated as businesses. Personal mail domains (`personalMailDomains`) never
  count as business domains. Because business names leave the dictionary, their
  image and link URLs load again; addresses in URLs are still checked.
- Mail sent from an owner address names the owner, so its sender splits into
  first name and surname like an account name.
- `learnedOwnerNames` collects owner display names from every cached message:
  To/Cc phrases tied to an owner address and the sender of mail the provider
  filed as sent (`direction: "sent"`; a forged From does not count).
  Received phrases need two messages (each message counts once), at most four
  words and 60 characters (sent names allow eight words and 100 characters;
  words count as the matcher splits them, on spaces and `+`), and at least one word that is not a common word
  (`Valued Customer` is skipped), because other senders write them; sent names
  lead. The four best full names, with their parts except single Latin letters
  and, for received phrases, common words, join the app-wide dictionary,
  within a budget of 24 learned names including parts; a name that would
  exceed it is skipped, does not use a slot, and lower-ranked names can still
  join. Work
  surfaces use `workOwnerNames`: the same rules with one message and six names,
  which keeps them inside the matcher limit with Always hide and account names.
  The local-only `PUT /api/privacy-words` stays available during sync.
- Numbered US-style street lines (`422 Southeast 17th Place`) and
  `City, ST 12345` lines are hidden as revealable address tokens. Words must
  start with a capital or digit and the street line must end in a known
  suffix, which keeps prose and order numbers visible. Matches cannot start
  inside a word or after its punctuation, and words are bounded, so long
  punctuated runs scan linearly.
- Settings > Privacy keeps two owner-chosen lists in the encrypted store
  (`privacyWords` record, authenticated CSRF-checked `PUT /api/privacy-words`,
  delivered in state): Always hide (up to 12 entries of at most six words) and Never hide (up to
  64). The matcher limit rises from 64 to 100 names, so a message keeps the
  64 account and message names it had room for before alongside 24 learned
  and 12 Always hide names. A name match cannot start inside a word, so the
  matcher skips the rest of that word and long repeated runs scan linearly. Never
  hide removes a listed name from the name matchers; when that full name was
  listed, its single words leave too, except words the owner hid or another
  listed full name contains. On a message surface the app-wide list (with
  Always hide) stays whole, and Never hide applies separately to the message's
  owner names and to its other added names. A kept-visible business phrase is
  never in the owner list, so it cannot reveal an owner or Always hide word,
  and an owner name wins inside a kept phrase; the owner's own Keep visible
  choices still apply. Addresses and postal lines
  stay hidden. The section lists learned names with a Keep visible
  action. Hidden and learned names are masked on that page while privacy is on.

## Limits

A person whose name is their domain (`Jane Doe <jd@janedoe.com>`) stays
visible; Always hide
covers that. Brand names with extra words or a short form on a role mailbox
(`Wells Fargo Online <alerts@notify.wellsfargo.com>`,
`The Varo Bank Team <alerts@varomoney.com>`) stay hidden; Never hide
covers that. Non-US postal formats are not
detected. On work surfaces, owner aliases from uncited mail beyond the six
most frequent, or longer than four words, are no longer collected; cited
mail still contributes all of its names. Spelling variants of the owner's name are hidden only once learned
or added. CLI and MCP redaction (ADR 0115) keep their existing name rules but
gain postal-line detection through the shared matcher.

## Verification

`src/privacy-words.test.tsx` covers the business test (including names relayed from role mailboxes), brand images and links
in privacy mode, owner-sender splitting, learned names, list application and
postal detection including visible look-alikes, and matcher room for 64
account and message names beside full learned and Always hide lists. `src/privacy-settings.test.tsx`
mounts the section with masking and saving. `server/mail-features.test.ts`
covers validation, encryption at rest and state delivery. The existing privacy
sweep still passes.
