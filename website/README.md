# Emc² landing page

The marketing site for the Emc² desktop mail client: a single static page built
with [Astro](https://astro.build), light mode, with real product fragments
drawn in HTML at true size over public-domain paintings.

```sh
npm install
npm run dev      # http://localhost:4321 (or the next free port)
npm run build    # static output in dist/
npm run preview  # serve the built site
```

The build is fully static. There is no server: the GitHub star and download
counts are read in the browser from the public GitHub API (with a shields.io
fallback for stars) and stay hidden until they load. A failed read keeps the
last complete count for ten minutes, exactly like the capsule before it.
The latest release - installer URLs, sizes and SHA-256 checksums - is read
once at build time and again in the browser, so a newer release rewrites the
links on an older page.

## What is on the page

- The hero: "One inbox for every account." over a rounded panel filled with
  a Constable cloud study (Van Gogh's *The Starry Night* in the dark theme). Inside it, the app's real three-pane inbox window at
  true size, where three new messages arrive and sort themselves. While the
  window is on screen it answers the app's own keys: arrows move through
  mail, 0-3 switch accounts, p hides personal information, / searches; an
  eye button in the pane head does the same masking. A segmented control
  restyles the window's chrome per desktop OS. The primary download button
  names the visitor's OS and links its installer; the meta line under it
  carries version, release date, download size and links.
- "Built for the keyboard.": six commands - search, archive, teach sorting,
  hide personal information, density, compose - with their keys; selecting
  one shows its live app fragment in a framed window on the painted panel
  beside it, auto-advancing until the visitor takes over. Rows select on
  click, keys and a short hover rest, so a still pointer never cycles them.
- "Everything in its place.": a bento of seven cards. Each card shows a
  contained well at the top - tabs and rows, the account rail, search, the
  teach sheet, compose, privacy masking and the calendar - trimmed to fit,
  with the title and text below.
- "Private by design.": two columns; the left stacks "encrypted on disk"
  and "no server in between", the right is the AI card, which shows the
  exact payload the sorter sends. Each card keeps its small live vignette;
  the AI/MCP switches work.
- "Why switch.": a comparison table against Thunderbird, Mailspring and
  Spark, with sources.
- "Free on every desktop.": one card per OS; the visitor's own gets the
  dark pill and the border. Each button links the exact installer from the
  latest release with a size and SHA-256 line and a copy button; Windows
  and macOS cards fold open first-launch warning help (SmartScreen,
  notarization). The note under the cards names the two repositories and
  appends the live star and download counts once both load.
- "Questions": the seven FAQ rows.
- A painted footer: a Boudin beach (Whistler's Chelsea nocturne in the dark
  theme) whose top edge fades into the field, breathing like the hero. The
  call to action is a tab joined to the full-width links bar, with GitHub
  and git.cafe links and the credits as its bottom row under a hairline.

## Structure

The default page joins the header, side rails and footer with
rounded openings and a shared inset shadow. The top opening stays below the
sticky header; the lower opening moves with the footer links. Both use the
same rail width and corner radius, reduced at phone widths.
The 3D treatment also gives the hero, header and download buttons the
footer's raised pink or pale finish. The OS selector and checksum Copy buttons
use matching depth and pressed states; feature, privacy and download cards
share the footer's top lighting. Embedded app demos retain their own styling.
Only the selected OS has a raised pill; the other logos carry their own
gradient and contour shadow on the shared selector track.
The frame and 3D styling are present in the initial HTML and need no query flags.

The header is 52px tall on desktop and 48px at tablet and phone widths, with
white text and matching 32px controls on the frame's blue; Download uses the
footer's pink finish. The desktop navigation stays centered between the
"Emc²" word and the action group: a theme toggle, an outline star with the
live GitHub star count, an outline coffee cup for git.cafe, and Download.
Unavailable counts stay hidden. Below 1025px, a native Menu disclosure keeps
section links available and closes after navigation, Escape or an outside
click.

The background canvas and its static fallback use the `--field-sky` token,
a calmer blue than the frame so the frame stands out. The fluted field
repaints at about 20fps; between paints a per-frame transform on the
overhanging canvas carries the scroll parallax, so it tracks the page
smoothly. In the light theme the feature, privacy and download cards are
near-white with dark text.

Two themes share the layout. The head script picks light or dark before
first paint from the visitor's saved choice or the system setting, and the
header toggle saves a new choice. The dark theme is neutral black with grey
surfaces and white text; the pink stays, the app fragments switch to the
app's dark scheme, and each painting swaps to a near-monochrome night
counterpart that loads only once the dark theme shows.

- `src/pages/index.astro` - the page, its meta (canonical, Open Graph,
  JSON-LD), and its behaviour script: OS and architecture detection, the
  release application, copy buttons, live counts, reveals, the paint
  shader and the hero scroll drive.
- `src/components/` - one Astro component per section. `Painting.astro`
  renders each panel's responsive artwork over its inline placeholder,
  and `Compare.astro` is the switch table. The Preact islands are
  `InboxWindow.tsx` (the hero's live inbox) and `FeaturesDemo.tsx` (the
  command demo, which takes its painting as the `art` slot).
- `src/components/app/` - the shared app fragments and bento crops in
  `fragments.tsx` and the fragment building blocks (window bar, mail rows,
  avatars, privacy masking) in `ui.tsx`.
- `src/lib/` - demo mail, provider and OS marks, the app icon, the release
  reader (`release.ts`, build-time and browser), the count readers
  (`downloads.ts` is covered by `node --test scripts/website-downloads.test.mjs`
  from the repository root; `scripts/website-release.test.mjs` covers
  release.ts), the WebGL paint shader, and `art.ts` with the inline
  painting placeholders.
- `src/styles/global.css` - the whole design: tokens for both themes, the
  type steps, the motion layer, and the app fragments (`data-ui`) in the
  product's own light and dark schemes.
- `src/lib/theme.ts` - reading, saving and announcing the page theme.
- `src/assets/art/` - the three paintings and their night counterparts.
- `SITE_URL` in the environment sets the canonical origin at build time
  (canonical link and og:url; without it, social cards point at the
  committed og.jpg on the main branch).

## Artwork

The panels fill with public-domain paintings, served by Astro's image
pipeline as responsive AVIF and WebP with a JPEG fallback and a tiny inline
WebP placeholder under each:

| Panel | Light theme | Dark theme |
| --- | --- | --- |
| Hero | [Zirruswolken](https://commons.wikimedia.org/wiki/File:John_Constable_-_Zirruswolken_(Federwolkenstudie).jpg), John Constable (1821-22), public domain | [The Starry Night](https://commons.wikimedia.org/wiki/File:Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg), Vincent van Gogh (1889), public domain |
| Features | [Stacks of Wheat (End of Summer)](https://www.artic.edu/artworks/64818), Claude Monet (1890-91), CC0, Art Institute of Chicago | [Wheatfield with Crows](https://commons.wikimedia.org/wiki/File:Korenveld_met_kraaien_-_s0149V1962_-_Van_Gogh_Museum.jpg), Vincent van Gogh (1890), public domain |
| Footer | [Beach Scene at Trouville](https://www.nga.gov/collection/art-object-page.61364.html), Eugène Boudin (1863), CC0, National Gallery of Art | [Nocturne: Blue and Silver – Chelsea](https://commons.wikimedia.org/wiki/File:James_Abbott_McNeill_Whistler_-_Nocturne-_Blue_and_Silver_-_Chelsea_-_Google_Art_Project.jpg), James McNeill Whistler (1871), public domain |

Keep the credits in the footer when changing them.

## Social image and icons

`public/og.jpg` (3200x1800) is the approved closing brand image, with the
Emc² logo and “Email at the speed of light. Inbox, weightless.” on a pink
and purple background. Open Graph, Twitter cards and structured data share
its URL; both card formats include descriptive alt text. When `SITE_URL` is
set, the URL points to that site's `/og.jpg`; otherwise it uses the committed
image on the main branch.

`public/brand/emc2-lockup.svg` is the brand kit's original vector lockup.
The header, footer and interactive inbox demo use it as a CSS mask so it
follows each surface's foreground color without changing its proportions.
The footer shows the complete logo with space around it. At phone widths,
the header uses the kit's standalone mark to leave room for its controls.

The favicon set (`favicon.svg`, `favicon.ico`, `apple-touch-icon.png`,
`icon-192.png`, `icon-512.png`) uses the kit's default dark app icon: the
Lumen mark on Mass. PNG and ICO sizes are rendered from the original vector paths by
`npm run icons` from the repository root; `npm run check:icons` verifies them.
The SVG preserves the supplied mark paths. `site.webmanifest` points
at the 192px and 512px PNGs. These website assets are independent copies;
the site imports no root application code.

## Provider marks

`src/lib/providers.ts` holds the marks for Gmail, iCloud Mail, Fastmail and
Yahoo Mail - the four the app actually connects to - from Simple Icons and
theSVG (both CC0). They render in brand colours inside the app fragments
(avatars, the account rail, the Connect fragment).

## Screenshots

`assets/` holds the demo-mail captures shared in chat. Nothing imports them;
they do not affect the built bundle.

## Deployment

Any static host serves `dist/`. The previous Lakebed capsule deployment is
retired; wiring a host is a follow-up.

The page includes Vercel Web Analytics. On a Vercel deployment with
Analytics enabled in the project dashboard it records cookieless page views
through `/_vercel/insights/script.js`. It sends nothing in `npm run dev`,
and on any other host that script request returns 404 and the page is
unaffected.
