# Changelog

Entries describe user-visible changes. Published versions are newest first.
[Legacy development notes](docs/changelog-legacy.md) preserve the earlier
unversioned history without treating it as a release record.

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:10a62c2f2d2afe77c5bf0f5fc94b37678824483358a7fec6cf871a95dbeb33d9 -->

## Unreleased

### Fixed

- Formatted mail now accounts for translucent reader backgrounds when choosing readable text colors, including dark themes. ([#223](https://github.com/collection-of-things/aggregate-mail/issues/223))

<!-- /coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:4b7469c3f8b60f3dfe3e5396aa98d6ec88fb17e764b7e74b3d0529899fc3b17d -->

- Sidebar section headings now pin beneath the brand header, and account status markers stay on their account rows with full status in their tooltips. The footer reports connections needing attention and announces status updates politely. In the phone drawer, account status buttons have wider touch targets. ([#225](https://github.com/collection-of-things/aggregate-mail/issues/225))

<!-- /coderabbit-ai-generated:v1 -->

- With mail open beside the list, Inbox categories stay on one row across the full rail instead of stacking into two rows inside the list column, so the reader keeps its space and the toolbar's view title lines up with the rows below it. When the named tabs cannot fit — a larger text scale or a narrow side-by-side window — inactive categories return to icon and count instead of wrapping, clipping or scrolling. ([#221](https://github.com/collection-of-things/aggregate-mail/issues/221))
- Mail list cards stop reserving a wide empty gutter and stop parking markers in it: the unread accent dot now badges the sender avatar's lower-right corner with a ring that follows the row's hover and selected fills, the account color dot sits centered before the account name on the metadata line, the selection gutter shrinks to the checkbox column plus a consistent gap, and narrow list columns beside the reader take the compact 24px avatar so sender names keep their room. ([#222](https://github.com/collection-of-things/aggregate-mail/issues/222))
- Newsletters no longer open with an empty band: the invisible padding senders pack after preview text collapses to one space, hidden preview text now shows as a single readable line, and any sender text written in its own background's color is re-inked to a readable dark or light. ([#223](https://github.com/collection-of-things/aggregate-mail/issues/223))
- After Show images, spacer and divider images keep the size the sender gave them instead of stretching to their natural size, so the message text no longer disappears below a large empty block. ([#224](https://github.com/collection-of-things/aggregate-mail/issues/224))

## 0.2.30 - 2026-11-06

### Added

- Assistants with a provider key now prepare reply proposals for new mail by themselves. With the switch on, the subject, sender, recipient and plain text of matching new mail go to the selected provider without a click. A switch on each assistant card turns this on or off, with options for Important only or all new mail, an instruction and a daily limit. Saving a key for the first time turns it on. Proposals still wait in the Review queue, and nothing is sent. ([#213](https://github.com/collection-of-things/aggregate-mail/pull/213))
- Emc² now tells you when a scheduled email missed its send time because the app was closed, asleep or offline. One alert gives the count and stays until you dismiss it or resolve the messages, with a matching desktop notification when those are on. Scheduled marks each one Missed with its original time. Neither alert shows a subject, address or body, and missed mail still waits for Send now, Edit, Reschedule or Discard. ([#217](https://github.com/collection-of-things/aggregate-mail/pull/217))

### Changed

- Apply the Emc² brand palette, type and shapes across the interface: the default theme becomes Mass (dark) and Lumen (light) surfaces with an Energy accent and pinned brand primary fill; Host Grotesk replaces the system UI font with Geist Mono labels and a 500 maximum weight; cards, menus and dialogs take the mark's asymmetric corner radius; New Message and Send share one flat primary control; and the mail list shows skeleton cards while loading and a designed empty state when an inbox category is clear. ([#218](https://github.com/collection-of-things/aggregate-mail/pull/218))
- Selection is now a filled state, never an outline: sidebar, settings, segmented and theme choices use the soft accent fill with its own ink; unread mail marks in the left gutter beside the pin; sorting chevrons and account dots use calmer brand-derived hues; row timestamps drop the label casing; conversation action links reveal on hover or focus; load failures get a designed error state; and the reader's empty header band and gray envelope give way to the quiet brand mark. ([#218](https://github.com/collection-of-things/aggregate-mail/pull/218))
- Mail cards are three lines: account and status lead the preview line inline and keep their own line only when no preview shows. The selected card takes a soft accent fill without a side bar, account dots use four distinct brand hues, collapsed conversation messages compress to a single line with actions on hover, secondary buttons are filled rather than outlined, and toasts drop their borders. ([#218](https://github.com/collection-of-things/aggregate-mail/pull/218))
- Card meta reads "Account · Status · preview" on one shared baseline, and the unread dot and pin track the sender line at every text size. The compose body shows only its left focus bar, the format bar uses small buttons with hairline dividers, provider glyphs render monochrome, the Commands button shows its shortcut hint, and the stray hairline under the settings dialog's history arrows is gone. ([#218](https://github.com/collection-of-things/aggregate-mail/pull/218))
- Color now carries meaning: letter avatars take one of four brand-derived tints per sender, attention reasons render as an accent pill, Gmail labels are neutral chips, and mail bodies style quotes, code and links in brand tones. The toolbar search keeps a usable width while shortcut hints yield first, search results sit under a single bar, empty statuses leave no stray separator, zero counts recede, and the Attachments heading uses the shared label style. ([#218](https://github.com/collection-of-things/aggregate-mail/pull/218))
- Post-review polish: a conversation reads its subject once at the top, the reader footer is one row of uniform links, the compose action row stays on the shared footer track, the pin moves onto the sender line beside the timestamp, and the search field caps at 480px. ([#218](https://github.com/collection-of-things/aggregate-mail/pull/218))
- Review fixes: card meta keeps the full account and status names so the preview line reads whole, row and select-all checkboxes use a stronger outline that holds 3:1 contrast in every theme, the load-failure mark carries the error colour, skeleton bars stay visible in dark themes, Offer times matches the other reader footer links, and attachment actions are quiet compact buttons. ([#218](https://github.com/collection-of-things/aggregate-mail/pull/218))
- Second review pass: the side-by-side list widens to 31vw (up to 448px), formatted-mail prose caps at 70ch while sender tables stay full width, collapsed conversation rows tighten to 30px, skeleton bars read in light themes too, the opened-mail toolbar gives Read, Track and Meeting distinct icons and divides the scheduling pair off, search results keep the select-all on one 44px header row with a quiet Fetch Sent, compose fields share one label column with Send on the form's edge, and selected cards take the small mark radius. ([#218](https://github.com/collection-of-things/aggregate-mail/pull/218))
- Third review pass: the reader shows one designed placeholder whenever no email is open while a clear or failed list centres across the whole workspace, dark read cards recede to softened inks while unread stays at full weight, label chips share a 22px pill in the small mark radius, the reader toolbar settles into 32px cells, conversation subject and rows share the 24px inset and collapsed dividers fade, every header puts the select-all on one shared selection gutter, custom themes keep a visible checkbox edge, isolated formatted mail gets the same 70ch prose measure, the Settings rail widens to 232px with 32px segmented controls and muted disabled options, error toasts take the danger tint, and the list widens with larger text up to 560px. ([#218](https://github.com/collection-of-things/aggregate-mail/pull/218))
- Fourth review pass: the list width actually follows the text-scale preference, the list header keeps a stable select-all cell and unread-dot column when mail opens, the keyboard cursor reads as an accent outline instead of a fill while the reader is empty, loading skeletons draw on the real row grid with a date stub and the reader hint reserves its line, the Settings dialog takes the large mark radius with a fading scroll edge and 32px theme buttons, the account scope pill recedes beside a selected mailbox, reader toolbar glyphs render larger in their cells, the compose envelope gets a 12px label inset on 36px rows, dark sidebar labels step down to `--nav-ink`, collapsed conversation and attachment rows tighten to 26px and 36px, and sticky date headers stay opaque over scrolling cards. ([#218](https://github.com/collection-of-things/aggregate-mail/pull/218))
- Fifth review pass: an expanded conversation header keeps only its chevron, selection note and time with the unread dot in the left gutter, card meta reads in secondary text with an 8px space before the preview, inbox tabs wrap to two named rows beside the reader with a plain muted count style, settings group headings share the rail's mono label and theme cards share one hairline frame, the connected-accounts line can wrap, card avatars scale with text, dark avatar tints gain a rose step and a lighter photon fill, the dark skeleton reads at about 1.7:1, the reader hint uses the UI font with small key chips, Reply all stands out in the quiet footer, the view title holds a fixed slot so search stays put, and File limits is 12px muted. ([#218](https://github.com/collection-of-things/aggregate-mail/pull/218))
- Sixth review pass: every card's sender shares a fixed importance-marker slot so names start at one x, the expanded conversation header folds into the sender block as a gutter chevron with the selection note beside the date, category tabs wrap only when the reader takes space with the select-all on the first row's line, empty and error states share one flat mark tile, dark dividers lose the doubled highlight, the error body loosens to 34ch at body weight, the cursor outline works at every width, the account scope reads as an accent tick, the sidebar scrolls clear of its footer, the compose From row joins the other 36px envelope rows with the saved status beside Keep draft, and the quiet disclosures use the shared chevron glyph. ([#218](https://github.com/collection-of-things/aggregate-mail/pull/218))
- Seventh review pass: the compose send bar keeps its divider and height inside the compose column so the list runs to the window bottom, the clear-inbox tile uses the shared masked glyph, the saved status is 12px muted text 20px past Keep draft, the composer's attach, format, body and Undo delay rows join the envelope's 12px inset with a divider before Delete draft, inbox tabs break three per row beside the reader, the error body widens to 40ch, reader labels render as plain muted text, gutter unread dots clear the cursor outline, and the small glyphs — provider marks, importance marker and pin, search glass and row checkboxes — follow the text scale like the nav icons. ([#218](https://github.com/collection-of-things/aggregate-mail/pull/218))
- Eighth review pass: inbox tabs shrink their names instead of crossing the list edge beside the reader, the collapsed conversation chevron rides the same gutter x and its names the same sender x as the expanded message with the unread dot centred in the avatar slot, the selection note is accent text, the load error stays on one balanced line, card avatars and the remaining dots scale with text, the sidebar scroll region clears its footer, the compose envelope and body take the small mark radius, zero counts hide in the sidebar, the category picker sizes to its content, and the sticky date header covers the row band under it. ([#218](https://github.com/collection-of-things/aggregate-mail/pull/218))
- Sender colors can no longer hide code text: isolated and inline code blocks always paint the veil-safe code ink, descendant foregrounds and backgrounds are cleared inside code, and links and quotes inside code take the code ink with links keeping their underline, so custom palettes cannot render code invisible on its own surface. ([#218](https://github.com/collection-of-things/aggregate-mail/pull/218))
- Compact density now compresses the list beside the reader: cards become two 48px lines (sender and subject, with the account and status trailing the subject inline) instead of staying at comfortable height. Switching density keeps keyboard focus on a focused private-subject reveal control beside the reader, and on its message row at full width. ([#218](https://github.com/collection-of-things/aggregate-mail/pull/218))

### Fixed

- Report when saving the first provider key cannot turn on automatic replies, so setup does not silently leave reply proposals disabled. ([#215](https://github.com/collection-of-things/aggregate-mail/pull/215))

- Search finds what you type. A short word such as a sender name no longer matches almost every email: one-typo matching made "ando" match "and" and "skip" match "ship" and "slip". Words now match exactly first; close spellings are used only when nothing matches exactly, and the list says so. CLI and MCP `--syntax app` follow the same rule. ([#212](https://github.com/collection-of-things/aggregate-mail/pull/212))
- Plain-text replies no longer show raw `>` quote lines: quoted history renders as nested blocks collapsed behind a Show quoted text button, wrapped quote lines rejoin, and collapsed conversation rows preview only the reply text without signatures or "On … wrote:" lines. ([#211](https://github.com/collection-of-things/aggregate-mail/issues/211))

## 0.2.29 - 2026-11-03

### Fixed

- Show images now loads images whose host refuses to display them on other sites, such as the Claude Duet welcome email, by retrying them once through the mail service instead of leaving grey placeholders. ([#209](https://github.com/collection-of-things/aggregate-mail/pull/209))

## 0.2.28 - 2026-11-03

### Added

- Settings > Privacy lists names to always hide and names to keep visible, and shows the names Emc² learned from your mail with a Keep visible action. The lists stay in encrypted storage. ([#207](https://github.com/collection-of-things/aggregate-mail/pull/207))

### Fixed

- Align Offer times with the other reader actions, matching their text size and removing its surrounding borders and extra spacing while preserving the keyboard focus ring. ([#199](https://github.com/collection-of-things/aggregate-mail/issues/199))
- Keep business sender names such as Kickstarter visible while personal information is hidden, and load their images and links after Show images instead of grey placeholders. ([#207](https://github.com/collection-of-things/aggregate-mail/pull/207))
- Hide your own name in mail whose headers omit it, using names learned from all cached mail and your Sent From name, and hide US-style postal addresses. ([#207](https://github.com/collection-of-things/aggregate-mail/pull/207))

## 0.2.27 - 2026-11-02

### Fixed

- Hide correspondent names and custom account labels while personal information is hidden: the sender and every To/Cc display name of the shown message are masked on per-message surfaces, accounts show neutral `Account N · Provider` labels, avatars drop provider logos whose URLs expose sender domains, compose To/Cc/Bcc, Subject and body values hide until focused, a masked invalid recipient still fails send validation, and a selected work item's detail adopts its source message's privacy context. ([#191](https://github.com/collection-of-things/aggregate-mail/issues/191))
- Keep website brand masks visible in forced-colors mode and check generated icons before release builds. The check compares decoded pixels, so encoder differences between platforms do not block a release. Clarify reply-draft approval, token privacy, browser setup, sender-logo lookups and platform storage in the guides. ([#197](https://github.com/collection-of-things/aggregate-mail/pull/197))
- Render desktop and browser icons from vector artwork at each size, smoothing jagged logo edges and keeping Windows installer icons sharp across display sizes. ([#197](https://github.com/collection-of-things/aggregate-mail/pull/197))

### Changed

- Introduce Emc² with coloured brand artwork, a short product overview and a compact installation guide in the README. Detailed instructions now live in topic guides for accounts, daily mail, browser access, AI, backups and development. ([#197](https://github.com/collection-of-things/aggregate-mail/pull/197))
- Use the brand logo across the website header, footer and inbox demo, with matching website icons. ([#197](https://github.com/collection-of-things/aggregate-mail/pull/197))
- Open the Commands dialog instantly, collapse the sidebar on the documented spring curve, and remove unused entrance animations. ([#197](https://github.com/collection-of-things/aggregate-mail/pull/197))

## 0.2.26 - 2026-11-02

### Added

- Mask account emails, participant names, email addresses, Message-IDs and thread gap references in CLI and MCP mail output with `--redact` and `redact: true`, guarded by version 1 `capabilities.redaction` so older apps fail closed instead of ignoring redaction. ([#193](https://github.com/collection-of-things/aggregate-mail/issues/193))
- Repeating a contact import now previews new, changed-name, unchanged and missing-from-the-file counts, and can update changed saved names through an explicit per-import choice. Import still never removes contacts. ([#192](https://github.com/collection-of-things/aggregate-mail/issues/192))

### Changed

- Remove the sidebar toggle from the sidebar header. Hide or show the sidebar with the `[` shortcut (customizable in Keyboard and mouse) or the Show / hide sidebar command; the toolbar keeps a Show sidebar button while the sidebar is hidden. ([#196](https://github.com/collection-of-things/aggregate-mail/issues/196))

## 0.2.25 - 2026-11-01

### Changed

- Add the Emc² brand mark as `public/favicon.png`. ([#195](https://github.com/collection-of-things/aggregate-mail/pull/195))

## 0.2.24 - 2026-11-01

### Security

- Bound mail formatting and IMAP search processing, reuse conversation work during agent review, and keep notification refreshes independent of message body size. ([#181](https://github.com/collection-of-things/aggregate-mail/pull/181))
- Require confirmed IMAP identities for archived-message changes, encrypted remote sorting connections, and safe provider/credential pairing. ([#181](https://github.com/collection-of-things/aggregate-mail/pull/181))
- Review unverified calendar changes against the existing event. Restored drafts must be prepared again before sending calendar data. PDFs remain available to download; in-app PDF preview is disabled until it has a memory bound. ([#181](https://github.com/collection-of-things/aggregate-mail/pull/181))
- Keep Android mail parsing and TLS checks bounded and fail closed, and protect Send confirmation from screen capture. Isolate bootstrap benchmark authentication and provider settings. ([#181](https://github.com/collection-of-things/aggregate-mail/pull/181))
- Validate decision-model keys as one pair with the effective provider, resolve backup account prefixes in a single bounded pass, and keep inbox classification linear on hostile subjects. Android now rejects mailbox counts and literal announcements before JavaMail allocates for them. ([#189](https://github.com/collection-of-things/aggregate-mail/pull/189))

### Added

- On phones, swipe a mail row left to archive, right to toggle read/unread, or hold to select. Mail gestures have their own switch in Keyboard and mouse settings; swipe actions pause during bulk selection. ([#187](https://github.com/collection-of-things/aggregate-mail/pull/187))

- Connect a phone to a headless host with `npm run phone:link`: open the private one-time link and save a passkey without a second host-screen approval. Existing QR pairing still requires matching-code approval. ([#187](https://github.com/collection-of-things/aggregate-mail/pull/187))

### Changed

- Use the closing brand image for website link previews, replacing the old inbox screenshot with the Emc² logo and “Email at the speed of light. Inbox, weightless.” ([#190](https://github.com/collection-of-things/aggregate-mail/pull/190))
- On phones, swipe right for Back and left for Forward, or swipe a notification to dismiss it. Turn navigation swipes off in Keyboard and mouse settings. Scrolling, zoom, form controls and browser edge gestures retain their normal behavior. ([#187](https://github.com/collection-of-things/aggregate-mail/pull/187))

- Remove repeated page descriptions and form coaching. Search options opens help and older-mail search on demand; operation errors and results use the notification stack. Browser notifications can chime after interaction and respect Sound off. Approval and recovery controls remain available. ([#187](https://github.com/collection-of-things/aggregate-mail/pull/187))

- Choose a full-width reader toolbar in Appearance: combine categories and action icons, show actions only, or keep two rows. The choice is saved and works in narrow windows too. Inactive Inbox tabs show their icon and unread count; the active tab keeps its full name. ([#187](https://github.com/collection-of-things/aggregate-mail/pull/187))

- Use the full Emc² logo, including its symbol, in the sidebar and sign-in pages, with matching app icons for browser shortcuts and desktop icon formats. Light and dark logos follow the interface appearance. ([#187](https://github.com/collection-of-things/aggregate-mail/pull/187))

- Fit mail cards and notifications to their visible details, tighten Today, Projects, drafts and Settings spacing, and keep short confirmation messages and Undo together. ([#187](https://github.com/collection-of-things/aggregate-mail/pull/187))

- Keep the view name and search together in a compact toolbar, align sync status and Settings in the sidebar footer, and give calendar events more room beside a smaller month navigator. Dates show the full scheduled count and title-only previews; times and every entry remain available in the larger day list. ([#187](https://github.com/collection-of-things/aggregate-mail/pull/187))

- Bring the frontend rebuild layout to the current app: Workspace-first navigation with an account footer, source icons, a compact breadcrumb band, inset mail and draft previews, and document surfaces across reading, work, Calendar, Contacts and Settings. Comfortable mail cards keep their measured scrolling at every width; compact density remains available. Keep dark selection and scrolling date headings readable, preserve compact selection spacing, and open Accounts from the footer. The empty-account footer announces Connect an account. Keep current mail actions, rich drafts, attachments, scheduled sending and protected browser access. ([#187](https://github.com/collection-of-things/aggregate-mail/pull/187))

- Rebuild the marketing site as a static Astro page, replacing the Lakebed capsule. It leads with a working demo inbox over a public-domain painting, then a keyboard command demo, interface crops, privacy cards, a comparison with Thunderbird, Mailspring and Spark, per-platform downloads and an FAQ. Download buttons link the exact installer for the visitor's system with its size and SHA-256 checksum from the latest release. Star and download counts load in the browser from the public GitHub API and stay hidden when unavailable. The header and footer link both GitHub and git.cafe. Any static host can serve the build. ([#184](https://github.com/collection-of-things/aggregate-mail/pull/184))
- Count marketing-site page views with Vercel Web Analytics, which sets no cookies and reports only from a Vercel deployment with Analytics enabled. The desktop app still sends no telemetry. ([#184](https://github.com/collection-of-things/aggregate-mail/pull/184))
- Give the marketing site light and dark themes. It follows the system setting until the visitor picks one with the header toggle, which is remembered. The dark theme is neutral black with white text, the demo inbox switches to the app's dark scheme, and each painting swaps to a public-domain night counterpart. ([#184](https://github.com/collection-of-things/aggregate-mail/pull/184))

### Fixed

- Keep phone Contacts navigation compact, preserve horizontal Settings switches and round accent choices, and separate Agent review controls so they do not overlap. Move review guidance, connection setup, file limits and undo explanations into optional help; omit attachment counts on empty drafts. ([#187](https://github.com/collection-of-things/aggregate-mail/pull/187))

- Center selection checkboxes within mail cards and wrap bulk counts, sync waits and actions to keep every control reachable. Sent-only selections show only Pin, Unpin and Move to Trash. ([#187](https://github.com/collection-of-things/aggregate-mail/pull/187))

- Give phone and tablet mail the available reading width, keep every Inbox category reachable through a compact picker, and use readable cards in both density settings. Phone cards use smaller outer gaps without shifting text during selection. ([#187](https://github.com/collection-of-things/aggregate-mail/pull/187))

- Accept fresh phone setup links in an already open pairing tab, resume approval after browser history restores the page, and keep late responses from disabling the current invitation. Connection errors no longer claim that another setup is waiting. ([#187](https://github.com/collection-of-things/aggregate-mail/pull/187))

- Preserve mail-list scroll during background content updates, keep bulk controls reachable with larger text, and prevent unread dots from covering timestamps. Headless setup accepts trailing-slash host URLs, avoids loading profile data and explains sync/update waits. ([#187](https://github.com/collection-of-things/aggregate-mail/pull/187))

- Keep mail text aligned when selection checkboxes disappear, avoid scanning the mailbox again on each selection, show sync waits beside the selected count, and inset the Projects empty message. ([#187](https://github.com/collection-of-things/aggregate-mail/pull/187))

- Load the phone sign-in and pairing controls when the browser app is installed beneath a hidden directory. ([#187](https://github.com/collection-of-things/aggregate-mail/pull/187))

- Delete saved drafts without waiting for a full mail-cache scan. Unused attachments still count toward storage limits until cleanup, normally during the daily idle inventory; compact storage to reclaim them sooner. ([#180](https://github.com/collection-of-things/aggregate-mail/issues/180))
- Keep the marketing site's feature demo windows inside their panel on phones instead of cutting off the left edge, and lighten the site's rendering: paintings render at no more than one device pixel, stay still on touch screens and narrow windows, and the canvases no longer keep a copy of each frame. ([#190](https://github.com/collection-of-things/aggregate-mail/pull/190))

## 0.2.23 - 2026-10-30

### Added

- Search cached mail from the CLI and MCP with the app's field, phrase, exclusion,
  read-state and date syntax. Filter local pins and inspect snooze return times;
  the CLI rejects unsupported options on older apps to prevent silently widened results. ([#175](https://github.com/collection-of-things/aggregate-mail/issues/175))
- Prepare reviewed CLI draft proposals with multiple To recipients and Bcc.
  Approval preserves the recipients in editable Drafts and never sends mail. ([#175](https://github.com/collection-of-things/aggregate-mail/issues/175))

### Changed

- Read mail full width like Gmail: the subject, sender, labels and formatted body span the reader instead of a centered 820px column, so sender-centered tables stay centered on wide panes.
- Replace Size rows by importance with a small filled importance marker before the sender on high-relevance mail, in the sorting-reason color. Every row keeps one height in each density.
- The sidebar lists Mail views before Workspace views.
- Category tabs and bulk selection share one rail with a select-all checkbox.
- The conversation reader hides its coverage notes behind a disclosure and shows single emails without thread chrome, apart from Gmail's Load full conversation link.

### Fixed

- Keep mail selection checkboxes and Select all usable while mail syncs; bulk actions wait for sync and say so. ([#178](https://github.com/collection-of-things/aggregate-mail/pull/178))

- Show only applicable mail-row hover actions, in the reader toolbar's order: Archive or Move to Inbox, Snooze, Trash, Reply, read state and Pin. ([#178](https://github.com/collection-of-things/aggregate-mail/pull/178))

- Identify malformed MCP app queries with a stable validation code and guidance
  to check quotes, fields and dates. ([#175](https://github.com/collection-of-things/aggregate-mail/issues/175))

- Bound PDF preview parsing and page rendering with a worker budget so a stalled or malicious file cannot pin the renderer. ([#167](https://github.com/collection-of-things/aggregate-mail/pull/167))

- Make reply-prefix stripping, notification tag removal, message preview markers, inline style checks, inbox code detection, sorting phrases, privacy name hiding, contact import validation, compose list conversion and workspace backup account matching linear or bounded on untrusted input. ([#167](https://github.com/collection-of-things/aggregate-mail/pull/167))

- Resolve agent provider hosts once and pin the connection to a validated public address so DNS changes cannot redirect API keys to private addresses. Never send a saved decision-provider key to a different provider; the key is cleared when the provider changes. ([#167](https://github.com/collection-of-things/aggregate-mail/pull/167))

- Answer IMAP flag and label questions from summary metadata instead of reopening encrypted records, cap IMAP search result counts, reuse the confirmed archive-move binding for archived actions, require an independent date and subject match for recovered archived mail before a destructive move, and refuse Archive when the server cannot confirm a MOVE. ([#167](https://github.com/collection-of-things/aggregate-mail/pull/167))

- Verify the live MCP endpoint the app reports before copying an OpenCode configuration, and keep provider credentials out of isolated test and benchmark processes. ([#167](https://github.com/collection-of-things/aggregate-mail/pull/167))

- On Android, verify TLS certificate hostnames with the platform's strict single-label wildcard rules before credentials are sent, reject oversized IMAP literal announcements (without misreading message content as one) and MIME boundary declarations before allocation, and keep the send-confirmation recipient off screenshots. ([#167](https://github.com/collection-of-things/aggregate-mail/pull/167))

- Preserve bounded partial IMAP search results and allow recovery of an unbound archived message when its subject matches and its envelope date is absent; a present date must match. Privacy mode hides the whole text when there are more names, or longer names, than its bounded matcher covers, instead of leaving them visible. ([#167](https://github.com/collection-of-things/aggregate-mail/pull/167))
- Pin and unpin a message without waiting for an ongoing mail sync to finish ([#171](https://github.com/collection-of-things/aggregate-mail/issues/171)).
- Complete a task from its Today or Projects checkbox, or from its details in Calendar and the other work views, preserving unfinished project decisions, save recovery and focus when returning from tasks or source emails ([#172](https://github.com/collection-of-things/aggregate-mail/issues/172)).
- Align the bulk-select checkbox with the row contents and keep the unread dot clear beside it, on both wide rows and side-by-side cards.
- Keep the toolbar update control clear of the privacy button beside drawn right-side window controls.

## 0.2.22 - 2026-10-30

### Fixed

- Fix "Unexpected end of JSON input" when loading large cached-mail snapshots in clients that decode only the first gzip member of a compressed response ([#168](https://github.com/collection-of-things/aggregate-mail/pull/168)).

## 0.2.21 - 2026-10-29

### Changed

- Pull requests now get typecheck and test CI automatically, without a `ci` label. Documentation-only changes are skipped, and the monthly run cap applies again only if the repository becomes private ([ADR 0105](docs/adr/0105-automatic-public-pr-ci.md)).

### Fixed

- Open cached conversations without decoding unrelated message bodies, and compress large cached-mail snapshots to reduce startup transfer time in the browser and desktop ([#164](https://github.com/collection-of-things/aggregate-mail/issues/164)).

- Avoid overlapping browser session checks and allow slow private connections more time to verify access. Origin failures now return readable API errors instead of JSON parsing errors ([#160](https://github.com/collection-of-things/aggregate-mail/issues/160)).

## 0.2.20 - 2026-10-28

### Fixed

- Keep isolated formatted email at the full available message width after mounting, instead of applying the narrower plain-text line limit ([#157](https://github.com/collection-of-things/aggregate-mail/pull/157)).

### Documentation

- Update the MIT license attribution.

## 0.2.19 - 2026-10-28

### Added

- Support 20 outgoing attachments and 25 MiB total through raw local uploads and encrypted attachment references. Keep small legacy drafts readable, stream referenced messages with provider size preflight, and preserve bytes for drafts and uncertain sends.
- Offer cancellable, bounded Gmail and IMAP part downloads for large received attachments. Keep automatic imports small and distinguish unparsed bodies from files not downloaded yet. IMAP accounts still save the exact sent message to Sent, without Bcc.
- Include uploaded draft attachments in encrypted workspace backups and restore new account-bound references atomically. The encrypted backup limit is 128 MiB ([#86](https://github.com/collection-of-things/aggregate-mail/issues/86), [#87](https://github.com/collection-of-things/aggregate-mail/issues/87)).
- Back up local workspace data in a passphrase-encrypted file and preview a merge before restoring. Existing records are preserved; credentials and cached mail bodies are excluded ([#86](https://github.com/collection-of-things/aggregate-mail/issues/86)).
- About and storage shows the running version and update status. Browser sessions show a short build ID and can check whether they match the host; desktop sessions use the existing stable-release checker ([#143](https://github.com/collection-of-things/aggregate-mail/issues/143)).
- Linux web hosting can stage and verify published stable releases, drain before switching, and restore the previous compatible build after failed startup. Failed releases require an explicit retry. Service and timer templates are provided; operators enable deployments explicitly ([#109](https://github.com/collection-of-things/aggregate-mail/issues/109)).

### Fixed

- Treat attachment admission refusal as a known pre-submission failure and release scheduled attachment holds.
- Reject workspace exports with unrecoverable removed-account references and enforce destination draft/template limits before backup previews and imports.
- Restore visible shared-button styling for custom-theme actions, including Create theme and Import theme.
- Give Projects, Agent review and All cached distinct sidebar icons so they are easier to distinguish from Contacts, Inbox and Drafts.
- Allow macOS updates from a read-only launch copy when exactly one canonical, writable Applications installation matches the running bundle. Recheck its digest before replacement without changing quarantine or Gatekeeper.
- Preserve sender foreground contrast, live text-size preference changes and configured Enter shortcuts inside isolated email content.
- Preserve supported sender colors, class-based columns and responsive width rules in an isolated email document. Scripts, remote styles and fonts remain blocked; privacy and per-opening image consent still apply ([#135](https://github.com/collection-of-things/aggregate-mail/issues/135)).

### Documentation

- Clarify canonical contribution targets, stack dependencies, latest-target rebases,
  verification and review identities, and completion comments with reciprocal fix
  links across GitHub and git.cafe. Repository contribution procedures take
  precedence over generic personal skill defaults.
- Add README instructions for saved search views, Contacts imports and reviewed unsubscribe actions, and update the product capability summary.

## 0.2.18 - 2026-10-28

### Added

- Save cached-mail searches and filters as encrypted named views. Open, rename or delete them from Commands; reopening restores the account, mailbox, query, filters and sort. Names and unfocused search text stay hidden in privacy mode ([#57](https://git.cafe/collection-of-devs/aggregate-mail/issues/57)).
- Review sender-provided unsubscribe destinations in the reader. Confirm a direct HTTPS request, prepare a normal mailto draft, or check and open a manual link in the system browser. Unsafe destinations are refused, and nothing unsubscribes automatically ([#58](https://git.cafe/collection-of-devs/aggregate-mail/issues/58)).

- Open Contacts from the sidebar, find saved people or recent recipients, and import Google, Yahoo, Outlook-compatible CSV or UTF-8 vCard exports. Preview before saving; existing contacts stay intact and imported addresses appear in recipient suggestions. No developer account or paid service is required ([#138](https://github.com/collection-of-things/aggregate-mail/issues/138)).

### Changed

- A single email opens without a duplicate conversation heading; message actions and errors remain available ([#138](https://github.com/collection-of-things/aggregate-mail/issues/138)).

### Fixed

- Keep conversation history diagnostics in collapsed details, space message headers into readable rows, and show one applicable read-state action in each mail row ([#138](https://github.com/collection-of-things/aggregate-mail/issues/138)).
- Remember paired browsers across idle time, tab closes and host restarts. Retry temporary outages without discarding drafts or requiring another unlock. Keep explicit Lock and Remove device controls.
- Guide phone setup with styled sign-in and pairing pages, phone-initiated requests, QR or direct setup links, reload-safe approval and clear recovery instructions. Keep unopened invitations limited to two minutes and allow ten minutes to finish a claimed setup.

## 0.2.17 - 2026-10-27

### Added

- Schedule sends for tomorrow morning, Monday morning or a custom local time. Review, edit, cancel or reschedule them in Scheduled; missed or uncertain sends are never retried automatically ([#60](https://github.com/collection-of-things/aggregate-mail/issues/60)).

- Add Undo send with an encrypted outbox and a composer delay control. Recover pending mail for review after restart or sleep; never retry an uncertain submission automatically ([#55](https://github.com/collection-of-things/aggregate-mail/issues/55)).
- Forward cached mail as plain text, address multiple To recipients and add Bcc, with encrypted draft recovery and explicit attachment omissions ([#51](https://github.com/collection-of-things/aggregate-mail/issues/51)).
- Read cached conversations inline, expand individual messages and choose an explicit message for actions. Keep history gaps visible and remote images blocked until activated for each opening. [#54](https://github.com/collection-of-things/aggregate-mail/issues/54)

- Undo single-message Pin/Unpin and Snooze/Return from the confirmation or Commands. Changed mail is protected from stale Undo. [#69](https://github.com/collection-of-things/aggregate-mail/issues/69)

- Select messages across accounts and triage up to 200 at once, with per-message outcomes and confirmed Trash. Ctrl/Cmd+A selects the current filtered list. [#52](https://github.com/collection-of-things/aggregate-mail/issues/52)

- Mark mail unread or move archived mail back to Inbox from message actions, Commands or customizable shortcuts. [#53](https://github.com/collection-of-things/aggregate-mail/issues/53)

### Changed

- Choose Comfortable or Compact spacing in Appearance. Settings, Commands and the density shortcut share a saved value; changing spacing or text size keeps the selected row visible. [#64](https://github.com/collection-of-things/aggregate-mail/issues/64)

- Open account Settings from readable keyboard-accessible warnings. Account status uses fixed safe messages and keeps Retry connection explicit. [#63](https://github.com/collection-of-things/aggregate-mail/issues/63)

- Show exact cached-search filters and sort order. Empty results can widen the search without losing the query or account; Back restores the previous scope. [#61](https://github.com/collection-of-things/aggregate-mail/issues/61)

- Notify browser users when the host has a new web build. Update when idle or choose Update now or Later; active editors and pending or uncertain writes prevent refresh. Restore the mail view and selected message afterward. Related to [#109](https://github.com/collection-of-things/aggregate-mail/issues/109).

### Fixed

- Keep inline conversation Forward actions bound to the selected message ([#124](https://github.com/collection-of-things/aggregate-mail/pull/124)).

- Keep browser update refresh paused when bulk mail actions report an unknown outcome.

- Keep formatted email tables readable and show supported embedded images in their original position after Show images, including recovery of older cached imports ([#133](https://github.com/collection-of-things/aggregate-mail/issues/133)).

- Keep midnight labels clear of the shaded outside-day notice in Calendar weeks that cross daylight-saving changes. [#130](https://github.com/collection-of-things/aggregate-mail/issues/130)
- Keep a newer composer open when delayed Forward preparation completes, and prevent duplicate Forward requests ([#51](https://github.com/collection-of-things/aggregate-mail/issues/51)).
- Keep draft dates clear of the Delete draft button and show the inbox's account labels and colour dots, including privacy-safe names when personal text is hidden. [#115](https://github.com/collection-of-things/aggregate-mail/issues/115)

### Documentation

- Give issue reports explicit scope, acceptance criteria and verification plans so contributors and agents can work from observable requirements. Separate planned checks from evidence, add missing bug-report environments and add privacy confirmations to feature requests.

- Make pull requests easier to scan with explicit problem and result fields, before/after evidence, rollback and affected scope. Keep verification, ownership and review in collapsed blocks, and document stack merging with verification and review for each layer. Related proposal: [#128](https://github.com/collection-of-things/aggregate-mail/pull/128)

## 0.2.16 - 2026-10-27

### Added

- Open Emc² on a phone through private Tailscale HTTPS. Pair with a one-use QR invitation, approve the matching code on the host, and unlock with a passkey. Revoke phone access from Settings. [#84](https://github.com/collection-of-things/aggregate-mail/pull/84)
- Add customizable two-key Gmail-style sequences and new shortcut defaults, including O to open, S to pin, B to snooze, A to reply all and G sequences for mail views. Retain single-key customization and existing saved bindings. [#112](https://github.com/collection-of-things/aggregate-mail/pull/112)
- Enable or disable mouse side-button history in Settings. Existing single-click and double-click opening preferences remain available. [#112](https://github.com/collection-of-things/aggregate-mail/pull/112)

### Changed

- Show account status before the full cached mailbox finishes loading. Mail counts remain unknown until the snapshot is complete, and a failed read offers Retry loading mail. [#108](https://github.com/collection-of-things/aggregate-mail/pull/108)
- Reduce repeated cached-mail copying and skip unnecessary database rewrites while preserving mail, attachments and drafts. [#107](https://github.com/collection-of-things/aggregate-mail/pull/107)
- Distinguish the receiving account from sorting status in All accounts, including compact rows. Hide redundant account labels when one account is selected and retain privacy-safe labels. [#104](https://github.com/collection-of-things/aggregate-mail/pull/104)
- Use a navigation drawer, compact Settings picker, larger touch controls and stacked reply context on narrow screens. Keep the saved side-by-side mail layout visible when no message is open. [#84](https://github.com/collection-of-things/aggregate-mail/pull/84)
- Refresh visible browser inbox state on return to the tab and every 15 seconds. [#84](https://github.com/collection-of-things/aggregate-mail/pull/84)

### Fixed

- Wait for a complete cached-mail snapshot before starting automatic browser sync, including after an initial read failure. [#108](https://github.com/collection-of-things/aggregate-mail/pull/108)
- Skip the empty reader when cycling keyboard focus with F6. [#84](https://github.com/collection-of-things/aggregate-mail/pull/84)

### Security

- Protect browser access with expiring sessions, host-approved phone pairing and origin/CSRF checks. Keep browser data separate from desktop profiles and protect browser encryption keys in the OS credential store without a weaker fallback. [#84](https://github.com/collection-of-things/aggregate-mail/pull/84)

### Documentation

- Require explanations when closing issues or pull requests, with links to merged fixes or ongoing work. [#113](https://github.com/collection-of-things/aggregate-mail/pull/113), [#114](https://github.com/collection-of-things/aggregate-mail/pull/114)
- Separate this release from legacy unversioned notes and require clear, source-linked changelog entries and matching published release notes for future releases.

## 0.1.5

- Ship the background tray, native new-mail notifications, shortcut bar, context menus, brand logos and UI refresh with Windows, macOS and Linux installers.
- Release every merged main push automatically as a patch version with published installers; minor and major releases stay manual.

## 0.1.4

- Show total GitHub installer downloads across Windows, macOS and Linux on the showcase website, with a ten-minute cache and the last successful count retained during GitHub outages.
- Rename the application to Emc². Installers are published as `Emc²-0.1.4-win-x64.exe`, `Emc²-0.1.4-mac-arm64.dmg`, `Emc²-0.1.4-mac-x64.dmg` and `Emc²-0.1.4-linux-x64.AppImage`.
- Carry an existing installation across the rename in one automatic step: the first launch under the new name moves `mail`, `settings.env` and `Local State` from the old app-data folder into the new one and marks the migration so it runs once. The old folder is left in place.
- Rename the local MCP server to `emc2`, so existing `claude mcp add --transport http` registrations must use the new name.
- Keep the Windows application id and the installer identity unchanged, so an installed copy is upgraded rather than installed alongside the old one.

## 0.1.3

- Add cross-platform CI and version-tag releases for Windows x64, macOS Apple silicon and Intel, and Linux x64 installers. Retain CI artifacts for one day and attach installer checksums to releases.
- Give each CI run and rerun a distinct application version and installer filename. Replace rebuilt platform artifacts on reruns. Keep tagged releases at the matching release version.
- Make HTTP and HTTPS URLs in email bodies clickable and keyboard accessible.
- Keep surrounding curly quotes outside email link destinations.
- Open HTTP links through the existing desktop browser handoff. Keep local API routes and unsupported protocols blocked.
- Keep message HTML escaped. In address privacy mode, mask URLs containing email addresses and omit their link targets.
- Record the inbox and Settings review in [repository knowledge](docs/KB.md).
- Document the synthetic browser checks and the untested native Windows handoff.
- Add project agent instructions and contributor guidelines with repository links, verification commands and mail privacy safeguards.
- Add unsigned macOS DMG and ZIP packaging with a macOS icon derived from the existing artwork. The Windows installer command is unchanged.
- Add native macOS menus and spacing for window controls. Keep the mail service running when a user cancels quitting with an unsent draft.
- Use platform-neutral encryption errors and document macOS app-data storage.
- Exclude local environment files, private keys, mail databases and session records from packages, and expand Git ignore rules.

## 0.1.2

- Existing Windows release with sender logos, address privacy controls and MCP settings.
