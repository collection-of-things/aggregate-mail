# Landing page instructions

This folder is a static Astro site with no server. Treat it as separate from
the Electron app in the repository root: do not import root code, and expect
root tests to touch only `scripts/website-downloads.test.mjs` and
`scripts/website-release.test.mjs`, which import `src/lib/downloads.ts` and
`src/lib/release.ts` from here.

## Commands

Run from this directory:

```sh
npm run dev      # local dev server
npm run build    # static build to dist/
npm run preview  # serve dist/
```

From the repository root, `node --test scripts/website-downloads.test.mjs
scripts/website-release.test.mjs` covers the download-count and release
logic; keep it green when touching `src/lib`.

## Rules

- Keep the page static: counts are read in the browser from the public GitHub
  API and hidden when unavailable. The latest release (installer links,
  sizes, SHA-256) is read once at build time and re-read in the browser via
  `src/lib/release.ts`; everything degrades quietly when the read fails.
  No secrets, no server code. `SITE_URL` optionally sets the canonical
  origin for og:url and the canonical link at build time.
- Vercel Web Analytics (`@vercel/analytics/astro` in `index.astro`) is the
  only analytics: cookieless page views, reported only from a Vercel
  deployment with Analytics enabled in the project dashboard. Do not add
  custom events that carry visitor input, and add no other trackers.
- The design system lives in `src/styles/global.css` as tokens: a sky-blue
  `#047FAC` base (`--sky`) with a calmer `#3D95B9` ground (`--bg`, the
  field) drawn by the fluted fractal field behind every
  section, white `#FCFFFF` text (`--ink`), deep-pink `#E0117F` accents and
  pill CTAs (`--cta`), the header and frame on `--surface`, and near-white
  content cards (bento, privacy, download) with dark ink re-pinned inside
  them in the light theme, plus a `--line` hairline — no glass, no
  backdrop-filter,
  Newsreader headings over a Geist body, and radii 24px panels / 18px cards
  / pills. Reference tokens; do not hardcode colours or sizes.
- Two themes: `:root[data-theme="dark"]` re-points the tokens to a neutral
  black field and grey surfaces with no hue; white text and the pink stay. An inline head script in
  `index.astro` sets `data-theme` before first paint from the saved
  `emc2-theme` choice or the system setting, and `src/lib/theme.ts` owns
  the header toggle, saving and change events. Without script the page is
  light. A new colour or surface needs a value in both themes.
- Every painting has a night counterpart passed to `Painting.astro` as
  `dark`, graded near-monochrome and dim so it carries no hue. Each theme's layer gets its own shader canvas (`data-art`), and
  only the active pair displays; the other layer's image and shader load
  the first time its theme shows.
- App fragments (the hero inbox window, the command fragments, the bento
  crops, the privacy vignettes) carry `data-ui` and use the app's own light
  theme from `src/styles/tokens.css`, or its dark scheme under the dark
  theme. Everything outside `data-ui` follows
  the page rules: no emoji, no eyebrow labels, no glass and no
  backdrop-filter; depth comes from the surface step and the hairline, with
  the single soft shadow reserved for framed windows; the fluted fractal
  field (`src/lib/fluted-field.ts`, the fixed WebGL canvas behind the page)
  is the one deliberate spectacle — it drifts slowly and parallaxes at a
  quarter of scroll speed (the shader repaints at ~20fps; a per-frame
  transform on the overhanging canvas carries the parallax between paints); no monospace outside real code. Keys the
  product answers to are shown as the one small keycap (`.keycap`), in
  prose and in the command list alike. Headlines, subheads, labels, buttons
  and captions end without a period; only multi-sentence paragraphs keep
  them. The sticky bar is 52px, 48px at 1024px and below (`--bar-h`), with 32px controls.
- Motion respects `prefers-reduced-motion`: the hero load rise, the hero
  panel rise, the live mail arrival, the slow painting drift, the fluted
  field's drift and scroll parallax, the card entrances and the
  auto-advancing command demo all settle to their final state under it.
  Content is in the HTML on first paint; never hide content behind
  script.
- Demo mail is synthetic. Never add real mail, credentials, private hostnames
  or personal data to components, fixtures or screenshots.
- The interactive pieces are Preact islands: `InboxWindow.tsx` in the hero
  is a working demo — folders, tabs, reader actions (archive, trash, snooze,
  reply, read, pin, teach) move mail between lists with undo toasts, New
  message and Drafts open a fake-send composer, and it answers the app's
  own keys. `FeaturesDemo.tsx` is the command demo: a hairline-separated
  feature list (icon, title, keycap, always-on note) that auto-advances
  one item every 4.5s while the hairline under the active item fills
  pink; a click or arrow key picks and restarts. `RailCrop` in the bento
  is a clickable account list. The other bento crops are still pictures
  of the app (`.bcrop.still`: inert, aria-hidden, no hover or focus). The
  shared app fragments and bento crops live in
  `src/components/app/fragments.tsx`. The compare table reads as a solid
  white card, not glass. The footer painting (Boudin by day, Whistler by night) has the
  gentle breathe pass; its top edge fades into the fluted field over the
  paint box's first 220px (the box reaches 200px up under the last
  section), and the merged footer card — solid CTA tab on a full-width
  links bar, concave fillets, 1px overlap, one drop shadow — sits on it.
  The rest of the page is static Astro plus one behaviour script. Prefer
  the existing helpers over new dependencies.
- Paintings live in `src/assets/art/` and ship through `Painting.astro` as
  responsive AVIF/WebP (JPEG fallback) with inline placeholders; they are
  public-domain/CC0, keep their credits in the footer when changing them.
