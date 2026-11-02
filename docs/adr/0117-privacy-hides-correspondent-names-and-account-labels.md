# ADR 0117: Privacy hides correspondent names and account labels

Date: 2026-11-02
Status: Accepted for interface presentation. Device acceptance remains separate.

## Decision

Personal-information hiding covers a message's correspondent names, not only
the mailbox owner's. `messagePrivateNames` extends `collectPrivateNames` with
the full display name of the sender and of every To/Cc recipient phrase on the
message being rendered; `MailPrivacy` and the mail list's accessible labels use
it. Third-party names are collected whole: only the owner's names split into
first-name and surname parts, because a partial word could hide common nouns in
unrelated text.

`accountLabel` always answers `Account N · Provider` while information is
hidden. Custom labels can be personal names, so keeping them visible — with
only embedded addresses masked — left real names on screen. This supersedes
the privacy-visible-label portions of ADR 0033 and ADR 0034; those records stay
unchanged and their other decisions still apply. Privacy off keeps the previous
labels, including duplicate-name numbering.

Avatars show `·` and load no provider logo while hidden, since the logo URL
exposes the sender domain. Editable fields that carry private values — compose
To/Cc/Bcc, Subject and the plain or rich body — keep the existing
focus-to-reveal pattern: an empty value with "Hidden. Focus to edit." until
focused. Masking only blanks what the field shows: the real recipient value
keeps its own validity, so a hidden invalid entry still fails the form.

Work surfaces that show per-message text adopt that message's names through
`MailPrivacy`; the app-wide matcher lists stay capped so a crowded dictionary
cannot lock whole documents.

## Limits

Correspondents are matched by full display name only: first-name-only mentions
of third parties inside bodies stay visible. Names absent from account names
and message headers cannot be inferred. Image pixels are not redacted. Native
notifications and other OS surfaces are outside the DOM sweep's coverage.

## Verification

`src/privacy-sweep.test.tsx` mounts the real App with synthetic identities and
walks the list, reader, composers, drafts, sidebar, settings, contacts, work
views, arrival toasts and the Commands palette at both widths, asserting no
fixture name or `*.example.test` value survives in text, attributes or field
values while information is hidden, that values return when it is shown, and
that re-hiding clears earlier reveals. Focused, targeted test coverage runs per
surface plus the production build.
