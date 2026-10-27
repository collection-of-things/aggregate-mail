# ADR 0088: Display embedded raster images after image consent

Date: 2026-10-27
Status: implemented for the requested email-context repair; runtime acceptance pending.

## Context

The formatted reader rejects CID image references and data URLs. MIME parsing can replace CID references with base64 data URLs, while larger images retain CID references. Neither representation was displayed. This removes image-based message context even after Show images.

## Decision

Preserve CID references during MIME parsing and retain each attachment's bounded Content-ID in its encrypted mail metadata. Decode CID URL escapes and resolve an image reference only when exactly one attachment in the opened message matches. Reuse the authenticated attachment download route and existing import limits: ten eligible files, 512 KiB per file and 1 MiB total. Permit PNG, JPEG, GIF, WebP, BMP and AVIF. SVG and other active formats remain unsupported.

Fetch attachment bytes only after Show images. Render them through a locally created blob URL with the attachment's permitted image type. Share one fetch and blob URL per unique referenced attachment, then revoke blob URLs on unmount. Hide images, privacy activation, message changes and reader closure remove images and reject late responses. Privacy continues to mask descriptions and block known-private CID destinations; a new consent can show pixels that may contain personal information.

Recover older imports with missing CID metadata through the existing single-message content route when their HTML references embedded images, or when HTML is missing and raster attachments exist. Preserve current mail state and identity checks. Record null Content-ID when a parsed attachment has none so recovery does not repeat. Failed recovery keeps the existing manual retry and cached fallback. No inbox-wide refetch or database migration is needed.

Formatted content uses `overflow-wrap: break-word` so table intrinsic sizing retains whole words. Oversized tables scroll inside the existing content boundary. Bounded sender `min-width` joins the existing width validators. Sender stylesheets remain unsupported and colors still follow the app theme.

## Verification boundary

Synthetic tests cover MIME storage, old-cache recovery, consent, message isolation, privacy resets, late responses and rejection of ambiguous or unsupported references. DOM checks verify wrapping policy, not browser geometry. Native rendering, live provider retrieval and installed-app acceptance require separate proof.
