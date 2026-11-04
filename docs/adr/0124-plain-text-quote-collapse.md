# ADR 0124: Parse and collapse plain-text quoted history in the reader

Date: 2026-11-03
Status: Proposed for the local candidate; pending maintainer review.

## Context

Plain-text replies rendered `>` quote markers literally: the reader showed raw
quote lines and the full expanded history, and collapsed conversation rows
previewed signatures and "On … wrote:" attribution lines instead of the reply
([issue 211](https://github.com/collection-of-things/aggregate-mail/issues/211)).

## Decision

- `parsePlainTextQuotes` (shared/mail-content.ts) splits a plain-text body into
  text blocks and nested quote blocks in one linear pass. A run of lines whose
  effective quote depth exceeds the current level becomes a nested quote, up to
  eight levels. Blank lines — including bare `>` markers — take the depth of
  the surrounding non-blank lines, so they separate paragraphs without creating
  empty blocks. Lines ending in `wrote:` directly above deeper content become
  attribution blocks, joining a wrapped `On … <` lead-in line. Inside quotes,
  wrapped lines rejoin when the previous line ends with a space or reaches the
  60-character wrap column, unless the next line opens a list.
- The plain-text reader renders these blocks as `blockquote` elements with the
  same inset and bar as formatted quotes. A trailing top-level quote — history
  the sender replied above — plus its attribution collapse behind a "Show
  quoted text" button; a message that is only a quote stays expanded.
- `replyPreview` trims collapsed conversation rows at display time: reply text
  only, cut at `--`/`Sent from my` signatures, `On … wrote:` attributions,
  ` > ` markers and trailing valedictions. Stored bodies, stored previews,
  provider preview generation and search matching are unchanged.

## Consequences

Plain-text replies read like formatted ones: the new text first, older history
on demand, and cleaner row previews. Privacy redaction and link handling apply
at every quote depth because blocks render through the existing MessageBody and
Redact components. Unquoted bodies render byte-identical paragraphs to the
previous splitter. Sender-written quote structure is interpreted heuristically,
so unusual wrapping can keep its line breaks; nothing is lost because Show
quoted text reveals the full history.
