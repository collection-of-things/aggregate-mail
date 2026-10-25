---
name: Emc²
colors:
  background: "#000"
  surface: "#0e0e10"
  raised: "#1c1c1f"
  hover: "rgba(255,255,255,0.04)"
  selected: "rgba(255,255,255,0.07)"
  line: "rgba(255,255,255,0.08)"
  control-border: "rgba(255,255,255,0.12)"
  text: "#fff"
  text-secondary: "#a0a0a6"
  text-muted: "#88888f"
  text-faint: "#82828a"
  accent: "#6b9cff"
  link: "#8ab0ff"
  reason: "#e3a08b"
  veil: "#1d1d1d"
  veil-hover: "#262626"
typography:
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Inter Variable, Inter, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
rounded:
  control: "8px"
  pane: "14px"
  menu: "12px"
  dialog: "18px"
  avatar: "50%"
---

# Aggregate interface

## Application layout

The app uses a 208px source rail, one view name in the persistent toolbar and
separate working columns. Inbox category and Drafts account tabs sit directly
below that toolbar. Other views show secondary bars only for actions or cache
controls. Work headings remain available to assistive technology, and Settings
retains its distinct section titles. Mail category tabs span the working area
above the list and reader.
The reader keeps the subject and sender above the body, with secondary label,
reply-all and scheduling controls below it. Narrow mail rows include account
context within the same measured virtual row.

Today groups open work into overdue, due today, upcoming, undated and waiting
sections. Open, Waiting and Completed views change only the visible local
list. Every row retains its status. Existing source-opening and explicit
completion or reopening operations remain unchanged.

Today has a workspace context pane before selection. Projects has an overview
above tasks and conversations, with project decisions in its context pane.
Opening a source retains the existing inline reader and return behavior.
Calendar places the selected day agenda beside the month when space permits.
Agent review separates exact proposals from review context and permission
management. Settings keeps all ten sections in its own rail. Dialogs share
the same compact type, grouped forms and footer actions.

## Shared controls

The revised shell shows the current view in the top toolbar beside history
and compact search. Drafts has account tabs and recipient-first rows. Settings
has a separate section rail and content column. The composer starts with From,
with Discard and Close on that line. Attachment selection sits above the body.
Save status remains beside Send. These controls reuse existing operations.

Mail, Drafts, Today, Projects, Calendar, Settings and dialogs share neutral
working surfaces, thin dividers and compact headers. Navigation labels use
sentence case; selected rows use a neutral wash. The app name sits beside the
sidebar toggle, with New Message immediately below. Drafts use small bordered
rows on the navigation surface. Calendar uses a continuous grid with a clear
selected-day outline. Existing theme, transparency and text-size choices stay
available.

New Message and Send share one primary control: a 12px radius, narrow inner
highlight, shallow vertical shading and a small drop shadow. Other controls
stay flat. Blue uses the primary action token; other accents and custom themes
derive the action fill from their selected accent.

New Message and Send are exactly 30px tall. The sidebar, collapsed coverage and compose action row share a 42px footer track, with 6px clearance around Send. Wrapped compose status expands the shared track. Recovery controls stay above it, and original-message content stops above the divider.

Glass and Subtle retain the native material and one shared window tint.
Appearance offers Window opacity from 0 to 100 percent, defaulting to 70.
The tint is painted once on the app; the sidebar and working panes stay clear,
including Settings group backgrounds. Only background color changes, never
element opacity. The saved level persists across themes and restarts; the
control is disabled while transparency is Off or unsupported.
The Settings section rail, Calendar weekday row and flush composer stay
transparent. While composing, underlying work is clipped to the list column
without changing its layout, so text cannot show behind the editor. Controls and draft cards retain
their own fills. Off and unsupported platforms remain opaque.

Compose retains its dialog role, Escape handling and save/send guards below
the window toolbar. It is nonmodal: its keyboard cycle includes the sidebar and available toolbar controls,
while covered mail/work panes remain inert. Navigation, Commands, Filters and
new-message actions first keep the current draft, waiting for saves and
attachments. Failed saves keep the composer open. Search and Privacy work
without closing it. Other dialogs
retain their modal focus traps. New messages keep the list visible when there
is room; replies use the full working area. Narrow windows use the available
width. Replies place the original email and editor in equal side-by-side columns
across the working area. Each column scrolls independently, with readable
14px original-message text and a keyboard-focusable preview. Save status shares
the action row beside Send, with recovery actions
visible on failure. Scrollbar indicators stay hidden in every scrolling
region; wheel, trackpad and keyboard scrolling remain available.

## Direction

A macOS-style working interface across all desktop platforms, in light and dark. A full-height sidebar on the themed window frame sits flush against near-neutral working panes, divided by hairlines. Primary text is white in dark mode and near-black in light mode, with restrained secondary text. A persistent search toolbar spans the working area above each pane’s own title. Grouped Settings controls and consistent curved menus and dialogs. The accent color (blue by default) belongs to current selection, links and switches. Use bordered groups only to distinguish assistant setup, individual proposals and tracked work. Every color comes from the tokens in `src/styles/tokens.css`; the frontmatter lists the dark Black palette.

The confirmed-work experiment opens on Today, with separate Needs
reply, Needs work and Waiting lists. Each row shows its task, account and scheduled
dates. Today keeps a compact task bar above the existing email reader, with the
work list beside it. Reason, evidence and history stay under Details. Projects
groups tasks, email rows and decisions for a job with the same inline reader.
Use one compact project navigation/action row and show the project name once.
Today and Projects use the full list width until work or an email is selected.
Keep empty Today status groups to a heading and count. Proposed actions retain
their exact content and explicit review controls in a compact envelope.
Source and conversation opening stays in the work screen
and uses the existing mark-read operation. The list stays mounted, preserving
selection and scroll; Back or close returns focus to the work row. Narrow and
full-width reading uses one column. Calendar keeps its source/history inspector.
A compact dialog edits one commitment with five recent source emails and
optional search showing up to ten matches plus selections.
Completion and reopening require an explicit confirmation. Clients
and projects and Agent permissions and review use the same pane header and
compact forms. Keep coverage gaps visible beside work, account combinations
explicit and proposed actions reviewable before execution.

Calendar defaults to Month and also offers Day, Monday-based Week and Agenda.
Previous/Next follows the selected view; Today keeps that view. Date-only deadlines
and all-day events use a separate row. Timed spans use elapsed instants clipped to
each local day, with clock and UTC-offset ticks for DST changes. Short events and
zero-duration follow-up/snooze points have full labeled entry buttons below the
timeline. Shorter DST columns end with an outside-day region. The schedule scrolls
within its own bounds, including horizontally in a narrow Week. Overdue and
undated entries retain their existing meanings. Deadline days never shift with
timezone changes.
Timed follow-ups use local time, appear in Today when due, and leave the deadline
and completion status unchanged. Use existing theme tokens and native date
inputs. No operating-system reminders in V2.

Emc² events share the grid, day list and agenda. Month cells show up to two
event chips (time and title; "Event" in privacy mode) and a count of other
entries. New event sits in the calendar toolbar; Schedule meeting sits in the
opened email's toolbar and context menu. Both use one dialog form with start and
end date and time or all-day days, attendees, location, Meet link, notes and
account. Linked events offer Unlink source email; saving applies the unlink and
Cancel keeps the saved source. For an uninvited event after account removal,
unlink before choosing another account or No account. Selecting an event,
commitment or snoozed email opens it in the
right-hand pane beside the calendar, never as a separate view. Escape or Back to
calendar closes the pane and returns focus. See [ADR 0054](docs/adr/0054-emc2-calendar-events.md).

Plan work beside Edit task opens a compact local-session dialog. The default
length is 60 minutes. Native start/end fields use the device zone and reject
missing or repeated local clock times. Busy starts selected; Free explicitly
allows overlap and does not block offered times. The dialog states that conflict
checks exclude Google. Account, source and task title stay bound to the task.
The whole session dialog scrolls when its content exceeds the available height,
including explanatory text and form actions.
Session form actions wrap when they cannot fit on one row.

Today/details lists sessions independently of the visible Calendar month.
Calendar labels each session Planned or Finished and Busy or Free. Edit session,
Finish session and Remove session affect only that session. Finished sessions
remain as history; removed sessions disappear from normal lists. Session details
omit meeting notification, invitation and source-unlink controls.
When Finish or Remove removes its Today trigger, closing the operation dialog
focuses the rendered Local work sessions heading. This applies after direct
success and after explicit recovery review; connected triggers keep normal
dialog focus restoration.

Pending or uncertain session operations freeze their input and revision and
block dismissal/navigation. Check saved session uses GET only, then requires
review. A saved result with an unavailable refresh stays acknowledged and cannot
be submitted again. A genuine remount reloads saved sessions without replaying a
write. Session controls reuse privacy masking, dialog focus trapping, native
fields, theme tokens and the existing narrow layout without new animation.

Optional Google Calendar controls sit above the calendar. Each Gmail OAuth
account shows Not connected, Needs consent, Connected or Calendar API disabled.
Connect and Reconnect open consent only when activated. Sync explicitly refreshes
one exact month. A cross-month Week lists both months
and their coverage separately. Navigation, focus and Refresh read the local cache
only. Partial or conflicting cached coverage stays visible.
Calendar choices use labeled checkboxes. Cached failures stay visible in the
controls and their disclosure summary. Synced events use the same views and
right-hand pane, with the calendar name and read-only event fields. RSVP uses
explicit Accept, Maybe and Decline actions that notify the organizer.

Event details offer Prepare invitation draft and Prepare cancellation draft for
local events. These open the existing composer with fixed calendar details and
recipients; the body remains editable. Only ordinary Send delivers the draft.
Create on Google and notify attendees is a separate explicit action for connected
Gmail accounts. Its saved result has Review created Google event, including when
no month has been synced. Selecting another event shows that event's details and
actions. The local event stays separate and editable.

The email reader shows supported incoming calendar requests with the organizer,
time, location and notes. A unique current Google match offers explicit RSVP
bound to that receiving account, source fingerprint and own attendee. Local
Accept, Maybe and Decline remain separate reviewed draft choices. Unsupported
messages explain the limit without guessing a date or response. Unknown Google
outcomes retain the submitted request; Check submitted Google action reads the
provider and never repeats the write. Privacy and keyboard controls follow the
existing reader, composer and event pane.

Offer times keeps saved duration, weekdays, hours, buffer and IANA zone in a
compact summary. Edit preferences opens native disclosure controls; collapsing
never saves. Busy coverage stays outside the disclosure, with selected account
and calendar labels using the existing privacy controls, or an explicit local-only
exclusion. Slots group by saved-zone date and retain their original indexes.
Each endpoint shows its full date, time and numeric UTC offset. An optional,
manually entered recipient IANA zone adds display text only and resets on source
change. Ten selected slots disable further unchecked choices until one is cleared.
Changing offered dates, busy-source selection or saved availability clears the
active preview and selection. Slot checkboxes preserve the preview. A new check
clears the preceding result before it runs. Unknown requests keep exact source,
fingerprint, offer identity and selected indexes frozen for recovery. Draft
prepared means acknowledged preparation; the panel has no delivery receipt and
never treats a missing draft as confirmed Send. Booking remains explicit.

Offer times expands inside the reader with working days, hours, meeting length,
buffer, an explicit IANA zone, date range and calendar checkboxes. Require an
explicit local-only choice or selected Google calendars. Each included read must
succeed. Results are bounded and scroll within the compact form. Choose up to ten
times for an ordinary reviewed reply; nothing is reserved or sent.

A rejected check offers Change rejected check. An unconfirmed check keeps its
request and inputs for recovery. Resume checked offer restores a persisted check
without creating another one. Unconfirmed draft preparation freezes its selected
times. Saved offers expose Book agreed time; booking rechecks conflicts and opens
the existing detail pane. Escape returns focus to Offer times. Edit and Delete
remain in Calendar. Calendar names use Redact, event attendees use Address, and
existing privacy, narrow-pane and keyboard behavior applies. These controls add
no animation or automatic notification.

Mail lists use the full available width until an email opens. Each row carries
one More actions button at its right end, in place of the time: it appears on
the selected row or while the row holds keyboard focus, and stays visible on
devices without hover. It opens the same context menu as right-click. Source
and recipient text follows existing privacy masking; editable private fields
reveal only while focused.

Track work opens a compact editor from a row or the reader. Choose one explicit
deliverable, an editable title, Needs reply, Needs work or Waiting, and an optional
local reminder. Multiple saved deliverables require a choice. Keep deadlines,
evidence and completion in the full editor. Today shows an account-scoped due
follow-up count in the sidebar; an unavailable workspace shows a question mark
with an accessible explanation. Cached work and unknown save outcomes remain
explicit, with refresh and review before further edits. See [ADR 0046](docs/adr/0046-today-inline-workflow.md).

## Themes and transparency

Settings, Appearance offers a Mode (System, Light or Dark; Dark by default), four themes (Black, shown as White in light mode, Graphite, Midnight and Forest), six accent colors, a Transparency choice (Off, Subtle, Glass), a Reading pane choice (Side by side or Full width) and a Size rows by importance switch (on by default; off gives every mail row the medium layout and height), stored on the device. Themes tint the window frame and sidebar; the mail list, reader and Settings stay close to neutral so the theme never crowds the mail. Text tones are set per mode so contrast holds. Light mode uses deeper accent shades so links and selection read on white; dark-mode links mix the accent with white. See [ADR 0025](docs/adr/0025-light-mode-and-reading-pane.md).

Custom themes appear beside the built-ins with palette previews. The theme picker supports arrow keys, Home and End. Create theme starts from the current theme; Edit, Duplicate, Export and Delete act on the selected custom theme. Each custom theme includes light and dark palettes and its own accent. The editor previews the selected palette across the app without saving it. Background and accent generate matching colors; Advanced exposes individual surface, text, link, border, sorting-reason, error and opaque privacy-bar colors. Editing an existing theme starts in Advanced to preserve its colors. Save commits both palettes and restores the selected appearance mode; Cancel, Escape and closing the editor restore the saved appearance. Import accepts an Emc² JSON file or pasted JSON and creates a separate copy. Delete requires confirmation and returns to Black/White. A failed save keeps the editor and draft available. See [ADR 0036](docs/adr/0036-custom-theme-library.md).

Transparency uses the operating system's own material behind the window. On Windows 11 22H2 and later, Subtle uses Mica, which tints from the wallpaper and stays smooth, and Glass uses Acrylic, which blurs whatever is behind the window and can lag while the window moves. The choice switches the material live. macOS has one vibrancy material, so it offers Off and Glass. The window frame takes a light theme tint and the sidebar a stronger one (stronger again in light mode), so the sidebar reads as the theme rather than grey frost. The native theme follows the mode, so the material takes a light or dark tint to match. With transparency enabled, one shared tint sits on the whole working column — the toolbar and every working pane below it: mail list, reader, work views, Drafts and Settings — at 50% of the surface color in dark mode and 70% in light mode over the window material. The panes themselves stay transparent so nothing stacks two tints and no pane reads darker than another; cards, inputs, popovers, menus, dialogs and notices keep their own fills. Text keeps its full opacity; faint secondary text steps one shade toward primary-adjacent tones to hold contrast, and sticky date headings and the agent review tab strip use a 60% tint with a 12px CSS blur so scrolling text stays out. No CSS blur is added to scrolling panes themselves. Menus, dropdowns and notices use a 12px CSS blur, and dialogs use 16px; these floating layers are drawn only while open. Off keeps the panes opaque. Where no material exists (Linux, older Windows, the browser target) only Off is available. See [ADR 0022](docs/adr/0022-window-materials-and-themes.md) for materials and [ADR 0035](docs/adr/0035-frosted-working-panes.md) for pane transparency.

## Layout

- A persistent 52px toolbar holds mail search and Commands above the working panes, with the Filters and privacy buttons at its right while the mail list shows; only the privacy button stays for Settings, Drafts and work views. Each pane retains a 48px title header, one height under the 52px toolbar so the hairlines line up across panes, and secondary controls such as category tabs, cached-mail notes and work-view controls share the title line. Headers drag the window apart from their controls; double-clicking maximizes it. The sidebar toggle sits first in the top-left header and moves into the toolbar when the sidebar is closed. Drawn window controls belong to the sidebar and toolbar, so they stay in the window corners as the reader pane changes. Windows-style controls reserve 150px at the toolbar’s right edge. macOS-style drawn controls use the configured left or right corner and existing IPC actions. The app-update control follows the pane tools in the toolbar flow, before the window controls, instead of floating over them.
- On macOS, the native traffic lights sit at (20px, 20px). The app draws no dots of its own there. The header of the leftmost pane, the sidebar or the mail or Settings header while the sidebar is closed, reserves 84px for them. Native application, File, Edit and Window menus provide standard Command shortcuts.
- The 208px sidebar runs the full window height. Its header holds the app name, collapse toggle and platform window-control space. New Message and Drafts come first. Workspace and Mail views remain in separate folding groups, followed by account filters and Add account. Settings and sync share a fixed footer. The current view and account use a neutral selection wash. Navigation rows are 34px with outline icons, 8px radii and muted counts. Account labels may truncate within the rail. Keyboard account hints remain in the shortcuts help. Snoozed appears when it has mail or is open.
- The sidebar toggle hides or shows the sidebar and remembers the choice between launches. When the sidebar is closed, the toggle moves into the persistent toolbar at the same spot. The sidebar collapses and expands by width on a spring; its content keeps a fixed width so it clips instead of reflowing. Below 760px window width the sidebar is hidden and its toggle with it.
- Settings floats in a compact modal above the mounted mail or work view. The
  background sidebar and toolbar are inert. Its header keeps Back, Forward and
  Close settings reachable; Escape closes only the foremost dialog and restores
  its opener. Ten existing sections retain their rail and controls. The rail and
  content scroll separately, with the rail above the content in narrow panes.
  Section changes reset content scrolling. Unsaved templates and signatures and
  pending-save locks survive section changes and closing. Search shortcuts leave
  Settings for cached mail; Privacy shortcuts remain available outside editors
  and shortcut-capture fields. Nested dialogs retain keyboard ownership.
- Inbox shows six category tabs in its header beside the title: Primary, Social, Promotions, Newsletters, Transactions and Updates, each with an outline icon and a muted unread count. The tabs fill the header's 48px height in secondary text; the active tab reads in primary text at weight 600, and a 2px accent underline on the header's bottom hairline marks it - exactly as wide as the tab's icon, label and count, sliding between tabs on the spring. Search spans every tab, so the strip hides while searching. See [ADR 0024](docs/adr/0024-inbox-category-tabs.md). Beside the reader the inactive tabs show only their icon and count (only the icon below a 400px column); the name stays in the accessible label and tooltip.
- Sliding lists (sidebar groups, Settings sections and the tabs) draw one hover wash that glides under the pointer on a 320ms spring and fades out when the pointer leaves, instead of a per-item hover background.
- The mail list sits under its header and scrolls on its own. The Filters button, in the persistent toolbar, opens a 300px popover under it with labeled dropdowns for read status (Show), relevance, sort (Sort by) and Gmail label, plus Reset filters and sort. The popover stays open while choices change and closes on Escape (before Escape closes an email) or a click elsewhere. While any choice differs from its default, the button stays accent-colored with a small dot. Rows run edge to edge with no insets, corner radii or vertical margins, so hover and selected washes meet the pane dividers: high relevance 48px on two lines, medium 34px inline, low 28px; compact density uses 24px rows. Appearance's Size rows by importance switch (on by default) can instead give every row the medium layout and height. Sender sits in a 150px column with an 8px gap before the subject; two-line previews align under the subject. Circular avatars (22px, 18px on low rows): the sender's company logo on a light disc when the domain has one, otherwise a gray initial, each with a small provider badge. The sender is context and stays muted while the subject carries the message in near-white; unread is a bold subject plus a white time. The selected row takes a 22% accent tint, keeping its normal text colors, while the list has focus, and a gray wash otherwise; hover is a 3% wash. Unread mail has a 7px accent dot in the row's left gutter. Hairlines inset to the text divide rows and give way around the selected and hovered rows and before date headings. High-relevance reasons use the theme's sorting-reason color before the time: peach in dark mode and rust in light mode.
- Reading pane. Side by side (the default) keeps the list in a column (30% of the window, 320–440px) and opens mail in a reader pane beside it. The reader's header holds the email toolbar and, at its right, an `Esc` close control; before anything is opened the pane says No email open, with the open shortcut when an email is selected. Rows in the column become cards: avatar, sender and time on the first line, then the subject, then a preview for medium and high relevance in comfortable density. Unread cards bold the sender and subject. Full width, and any window narrower than 980px, opens mail in place of the list as before.
- The opened email shows its subject at 22px semibold, then one sender line: a 36px avatar, the name with its address beside it and the recipient beneath, and a short date at the right (time for today, day and time this year, full date before; the full timestamp is the tooltip). Gmail labels follow as one muted line with Edit labels. Image consent is a single quiet strip above the body: the warning text, then Show images. The column is 820px wide with 28px top and 36px side padding.
- Sticky date headers (Today, Yesterday, This week, This month, Earlier) in 12px faint text, pinned to the top of the list with no history-toolbar offset. Their padding is 8px above, 4px below and 18px horizontally, aligned with row avatars.
- No sender panel. The window holds at most the sidebar, the mail list and the reader; sender details stay in the reader header ([ADR 0056](docs/adr/0056-remove-sender-panel.md)).
- Gmail label filter follows account filters and applies within the current view. When all accounts are shown, label names include their account. Opened Gmail mail shows custom labels as plain text and offers Edit labels in a checkbox dialog. System labels are available for filtering but cannot be edited here.
- No shortcut bar. Current shortcuts appear in the help dialog and can be edited in Settings, Keyboard and mouse. Conflict checks preserve editing, Escape, Tab, account-number and system shortcuts.
- Commands sits beside the persistent search field. Command+K on macOS and Control+K elsewhere opens a dialog with a focused command search, keyboard selection, disabled actions and focus restoration on close. It uses the existing mail action handlers.
- Up/Down select the previous or next email in the closed list and prevent page scrolling, including at either end. They do not open mail or mark it read. Inputs, dialogs, sidebar controls and the open reader retain arrow behavior. j/k remain available.
- A new nonempty search opens All cached across all accounts and includes saved local drafts. Continued typing respects deliberate account, mailbox and mail filters. Search accepts field operators, phrases and exclusions; plain unquoted words tolerate one typo. A short syntax hint and safe parse error sit below the pane header. A pin action in the toolbar and context menu marks mail locally, with a small row indicator. Search `is:pinned` finds those messages without changing sort order or category semantics.
- Settings, Templates and signatures edits templates and account signatures. Inserting a template appends its text before an unchanged signature and fills an empty subject. Signature changes on account switch preserve any edited text. Preference text stays out of unfocused editor values in privacy mode; template choices use generic numbered labels.
- Notices show four at a time with a retained queue. Settings, Notifications chooses Bottom right (default), Bottom center or Top right, and a duration of 3, 6 (default) or 10 seconds, or Until dismissed. Hover and keyboard focus pause expiry. Independent switches control new-mail counts and action confirmations; preview and reset are available. Choices stay on this device. Errors, uncertain sends and Sent-copy warnings always require dismissal. All notice text uses the existing privacy masking. Notices stack from the chosen edge with the newest nearest it, under a count line with Dismiss all and the queued count. Each notice has a labeled Dismiss button beside Open email. Arrivals open their slot so the stack slides; dismissed or expired notices fade and scale out while their slot folds shut over 200ms. The stack scrolls within the viewport at bottom and top anchors, keeping multiline text, Dismiss buttons and the count line reachable at larger text sizes. Internal padding leaves room for notice shadows.
- Snooze confirms its local return date and time; Return to inbox, Archive and Trash confirm successful actions. Confirmations appear only after the action succeeds. If refreshing then fails, a separate warning preserves the confirmed outcome and asks for an inbox refresh.
- Settings: a working pane like the mail list, with a Settings header. As in System Settings, controls sit in rounded groups (10px radius, a 4% text tint over the pane, a hairline border) whose 44px rows put the label left and the control right, divided by inset hairlines; 13px semibold headings sit above groups and 12px notes below them. The chosen section sits in a 760px column at its top left, under a 20px title without a number, 52px account and provider rows, plain status text, outlined buttons and small outline switches. Connection fields state what is already on disk: a ticked `Saved · <client ID>` line under the ID field, `Saved · ••••••••••••` under the secret, the Jev key and the OpenAI key, and `Not saved yet` when nothing is stored. A key is only ever shown as dots. Provider and notification-sound choices use visible segmented controls with keyboard navigation. MCP shows one line at rest and folds its endpoint, token and client configs behind a `Show options` disclosure, which opens when MCP is on and closes when it is off.
- Dialogs: 18px radius, hairline border, glass fill and dimmed backdrop.
- Account setup opens directly from the empty inbox and from Settings. Use the same provider choice and connection form in both places. Show known providers with their server settings already filled in; show host and port fields only for custom IMAP. Offer configured Google sign-in first and label the separate app-password option clearly. Keep errors in the form, preserve input on failure and disable duplicate submissions while checking the connection. Developer OAuth settings belong in an advanced disclosure.

## Privacy

Hidden-address bars are 0.9em high and fit within the text line. Each bar stays on one line, is capped at its container width and can wrap as a unit after a label. This leaves space between consecutive sender-detail rows without exposing the hidden text.

`p` or the eye button toggles personal-information hiding, remembered between launches. Email addresses and known connected-recipient names become solid bars. Names come from account display names when available and the current message's To/Cc headers tied to connected addresses. Full names, first names and surnames are hidden with case-insensitive whole-word matching, including previews, subjects, recipient headers, bodies, notices and text attributes. Sender company labels remain readable unless they match a known private name. Names absent from these sources cannot be inferred reliably.

A hidden bar contains no private text in its DOM children or labels. Clicking or using Enter/Space on a bar explicitly reveals that token; re-enabling privacy clears reveals. Each bar fits on one line. Private link destinations are suppressed while privacy is on, including encoded destinations. Show images can explicitly display supported images while private text stays hidden. Alt text and captions stay redacted; image URLs containing detected private information remain blocked. Image pixels cannot be redacted. Enabling privacy clears existing image consent, but the user can select Show images again. Compose's editable From/To fields keep the existing focus-to-reveal exception. Secrets stay dots.

Custom account labels remain visible in privacy mode while addresses inside them are masked. Unnamed accounts use account numbers and provider names. Settings, Accounts offers Rename; an unfocused edit is hidden and focus allows editing. Save confirms the current name through the validated name-only account API.

## Typography

Formatted email uses the app's dark surfaces, readable text, blue links and subtle borders. Sender tables, headings, lists, emphasis, spacing and bounded dimensions remain intact, along with layout modes (block, inline, inline-block, inline-table and table display) and left or right floats. Hiding values such as `display: none` stay rejected so all sender text is visible. A trailing `!important` is ignored rather than rejecting the declaration. Links keep a sender's `text-decoration: none`, so card-style links are not underlined; other links stay underlined. HTML `align` works as browsers apply it: centered tables get auto margins, left or right aligned tables and images float, and other elements use `-webkit-` alignment so nested tables center; `<center>` is a centered block and `margin: 0 auto` is kept. Quoted replies ignore the sender's quote margins, padding and borders and take one 14px inset with a 2px bar (the accent mixed into the hairline) and secondary text per level, so deep threads keep their width. `ex` and `ch` lengths and borders written in any word order are read. Loaded images sit directly in the sender's line, so their vertical alignment and floats apply. An image with a width gets auto height so it keeps its shape when narrowed; one sized only by height keeps that height. Mail nested deeper than 96 levels or with more than 4,000 nodes falls back to plain text. Zero widths and heights are dropped, so hidden preview text reads as one ordinary line. Before Show images, each image is an empty faint box at its own size (24px when unsized), with the reason as its label and tooltip instead of text. Normalize sender colors, including legacy presentation attributes, without changing image pixels or privacy bars. Keep the 15px body default and 1.45 line height; supported sender font sizes still provide hierarchy.

Client action icons use local outline SVGs with a consistent 24px grid, 1.75px stroke and rounded ends. Close uses a plain cross; Settings uses sliders. Gmail uses a multicolor vector mark, and custom IMAP uses an outline envelope without a colored tile. Button labels and keyboard behavior stay unchanged.

Sender provider badges are small rounded squares with opaque backgrounds; Gmail and IMAP use the raised dark surface. Their glyphs remain visible in both comfortable and compact rows, so reduced density never leaves an empty outline over the sender logo.

SF Pro on macOS; bundled Inter Variable everywhere else, so Windows and Linux match instead of falling back to Segoe UI. 14px in comfortable inbox rows, 13px in compact rows, 15px sender name and Settings headings, 22px message heading, 15px message body at 1.45 line height, with 0.85em paragraph spacing in a 65ch column.

The mail list mounts viewport rows with overscan and retains selected/focused rows. All filtered mail stays available to counts, keyboard navigation and scrolling. Geometry includes row margins and sticky dates for both wide rows and side-by-side cards; ordinary scrolling does not focus or snap to selection.

## Behavior

Mail-row actions use small outline icons with tooltips and accessible names.
Snooze opens a compact list of immediate presets. Track work first offers
Needs reply, Needs work and Waiting; selecting one saves without a form.
Details and reminders stay available through an explicit edit action. Several
deliverables require a choice, and closed work still needs the full editor to
reopen. Privacy never automatically focuses a hidden text field.

The composer groups From, To and optional Cc above the subject and body.
Attachments and save/recovery status remain visible above a sticky action
footer. Keep draft, Discard draft and Send retain their existing safeguards.

macOS horizontal navigation gestures use the existing back/forward history.
Vertical gestures retain ordinary scrolling. Dialog, compose and busy guards
apply to gesture navigation too.

An app-update icon follows the toolbar's pane tools, right before the window controls, and opens a small panel with the current check result, download progress or a fixed recovery message. Its accessible label and tooltip include the current state. Opening the panel does not start a check, download or installation. Escape, outside pointer input and Close dismiss it. A compatible release offers Download, install and restart. The app checks once at startup; users can check again explicitly. Download starts only after the command click. Installation waits for mail work, renderer sending and draft saves, then honors the native close prompt. Keep editing cancels installation and resumes mail. No ordinary quit installs an update. Unsupported builds explain the limit without an install button, including the current macOS source-build route. Progress uses the native progress element and status text; it adds no animation. During installation, mail controls stay blocked while the update icon remains available.

Selected mail uses the icon actions on its row. Opened mail has an action group in the reader header (or above the opened email in Full width). Its groups are divided by a hairline: Archive, Move to Trash and Snooze, then Reply, Read, Track and Pin. Text labels appear when space permits; narrow layouts keep the icons, accessible labels and tooltips. Snoozed mail shows Return to inbox in place of Snooze. Move to Trash opens the same confirmation as the row icon. Archive uses the existing archive operation and shortcut. The group wraps at narrow widths and uses the shared focus styles. Read requests show a pending label, coalesce duplicate actions and apply confirmed state immediately; a later refresh failure does not turn a successful read into a failed action. Selection alone still leaves unread state unchanged.

Each mail row exposes flat Read, Pin, Reply, Archive, Snooze and Trash icon buttons only while a fine pointer hovers over that row. Selection and keyboard focus do not keep the strip visible. Narrow and touch layouts reserve no action strip. The row context menu, its keyboard invocation and the reader toolbar retain the existing operations. Snoozed mail replaces Snooze with Return to inbox. Controls remain flat and use the current theme. See [ADR 0067](docs/adr/0067-hover-only-mail-row-actions.md).

Row actions are separate from the message button. Opening the menu selects that row without marking it read or opening it. Read uses the existing confirmed-read queue; Snooze and Pin remain local. Reply uses the row's sending account and reply address. Archiving another row leaves an unrelated reader open. Move to Trash requires a confirmation dialog and remains distinct from Archive. It removes the target email from the local cache only after the provider confirms the move. Failure keeps the email and the dialog available, with a notice to check the provider before retrying. The confirmation contains no subject or address. The app never permanently deletes mail, and recovery uses the provider's Trash. Unsupported IMAP MOVE, missing or ambiguous special-use folders, and unsafe message identities fail without guessing. Archived IMAP mail without a Message-ID disables Trash and provides an accessible explanation. See [ADR 0043](docs/adr/0043-theme-matched-row-actions.md).

Right-click a mail row or opened message - or click a row's More actions button - for Open, Mark as read, Reply, Archive, Snooze, Move to Trash and Teach sorting; snoozed mail also offers Return to inbox. On the desktop this is the operating system's own menu, with separators between groups and shortcuts shown beside items; the browser target keeps the drawn menu described next. Right-click or the More actions button selects the target without marking it read. Shift+F10 or the Menu key opens the same menu at the focused message. Arrow keys, Home and End navigate enabled actions; Escape or Tab dismisses and restores focus. The menu stays within the viewport and closes on outside pointer input, external scrolling, resize, window blur, or a view change. Archive, snooze and sorting writes are disabled while busy or syncing. Mark as read is disabled on already-read mail and shares the queued read-on-open request without opening the message. Explicit reads can wait behind sync; failures show a notice and remain retryable.

The Snooze menu offers In one hour, Tomorrow morning and In one week, plus Return to inbox for snoozed mail, and ends with Pick date and time…, which reveals an inline local date-time field (minimum now, defaulting to tomorrow at 9:00) and a Snooze button. A past or invalid time reports an inline error; Escape closes the menu. The chosen time sends the same snooze `until` as the presets.

Ctrl/Cmd+Plus (including Equals and numpad Plus) increases text size; Ctrl/Cmd+Minus decreases it; Ctrl/Cmd+0 resets it. These shortcuts suppress page zoom outside editable fields and dialogs; `d` still toggles density. Opening unread mail requests provider read status independently of other UI actions. Pending read requests coalesce. This includes reader navigation and cached archived Gmail mail. Merely selecting a row does not mark it read. Failed read requests leave the message unread and show a notice; reopening retries. Archived IMAP mail is located by Message-ID, with exact candidate verification before changing remote flags.

Motion uses short ease-out transitions (cubic-bezier(0.22, 1, 0.36, 1)) and, for movement that should feel physical, a lightly damped spring written as a CSS `linear()` curve with a small overshoot. Nothing loops. List panes settle in 220ms; opened mail rises 8px; the sidebar wash slides and the sidebar collapses on the spring over about 450ms; menus reveal over 180ms; dialogs scale from 0.98 on the spring over 420ms. Rows appear together, without stagger. Native smooth scrolling follows programmatic selection in mail lists, Settings, dialogs and dropdowns. Scrollbar indicators are hidden throughout the interface; scrollable regions keep their existing overflow and keyboard behavior. Wheel and trackpad input stay with the platform; there are no wheel interceptors. New panes reset instantly. Reduced-motion preferences shorten transitions and restore immediate scrolling. Focus shows a 1px accent outline. Message bodies preserve supported sender tables, headings, emphasis, spacing and HTTP(S) links, with colors matched to the app theme through bounded safe rendering. Sender scripts, forms, embedded documents, global stylesheets and remote fonts are discarded. Oversized or unsupported content falls back to readable cached text. Show images appears above the body. Images stay blocked until activation for this opening, appear in formatted-content order or below plain text, fit the reader width and send no referrer. Enabling privacy removes body images and clears consent. Show images remains enabled and can grant new consent while text, captions and alt descriptions stay hidden. The control warns that loading can tell the sender the email was opened. Loading, failure and no-supported-images states use plain status text. Switching messages or closing the reader clears consent. Embedded CID images are not shown.

Compose and reply save locally as the user types. Status text distinguishes saving, acknowledged saves and errors. Close, Escape and Keep draft wait for the latest save and retain the draft. Discard draft is a separate confirmed action. Failed saves keep the text open and block sending; Retry save reconciles an uncertain update before writing again. An unconfirmed first save requires recovery or an explicitly confirmed separate copy. Changing From after a save retains the original and asks before creating a copy. Drafts directly below New message in the sidebar opens saved summaries, with subjects and recipients hidden in privacy mode. Bodies load only when selected; opening a draft never sends it.

Sending freezes editing and waits for the exact snapshot and an uncertainty marker to save. An uncertain send keeps the compose dialog and draft open with "Send status unknown" and a warning that the message may already have been sent. Editing and recovery keep this status. Every subsequent Send submission requires confirmation that another send may create a duplicate. Discard warns about possible delivery. The native application-close prompt explains that saved drafts remain and unacknowledged changes can be lost. Form validation blocks invalid input before submission. Confirmed provider acceptance closes compose. Sent-copy, saved-draft cleanup and inbox-refresh failures appear as warnings without changing the send outcome.

Back and Forward controls stay beside persistent search. Menu history includes Settings sections, views, accounts, category tabs, filters and search. Opening, selecting, closing or traversing mail does not create menu visits. Back from an open reader returns to the list; immediate Forward reopens only the latest message if its account and message still exist. A second Back continues menu traversal. New reader actions clear the transient return, and a new menu visit after Back clears Forward. Drafts and dialogs block traversal. Reopened mail starts with images blocked. Reader previous/next controls and j/k retain the chosen sort order and preserve Unread anchors, input ownership and list focus.

Closing the desktop window hides it while the app, its mail service and its five-minute sync keep running. macOS uses the Dock to reopen and the native application menu to quit, with no status-bar icon. Windows and Linux retain a tray menu to reopen or quit. A second launch restores the window, and the system session end still exits. A sync that finds new unread mail shows native notices for accepted messages, using generic text by default and opening the exact cached email when enabled; the first import of a mailbox never notifies, and a failed sync reports no arrivals. Editable fields and selected text keep a native right-click menu for undo, redo, cut, copy, paste and select all, with items enabled from the platform's edit flags; mail rows keep the app's own menu.

The sidebar's Accounts list filters by account: All accounts, then each account by its custom name or address, then Add account, which opens the existing provider setup dialog. Choosing an account clears the Gmail label filter and closes an open email. Privacy mode labels accounts by number and provider ("Account 2 · Custom IMAP") instead of hiding them behind bars, with a plain Needs attention dot for account errors. Account rows are disabled while a dialog blocks navigation. Account number shortcuts still work.

The Filters popover combines All mail/Unread, relevance, sort and Gmail labels with the current account, view and search. Newest is the default; Oldest reverses date order and Relevance puts higher relevance first, then newest. Message ID breaks ties. Relevance order omits date headings. Explicit control changes close the reader and enter navigation history; automatic read updates keep the opened message visible. Back/Forward restores each control. Empty results show Reset filters and sort, which returns to all accounts, all labels, all read/relevance values, no search and newest order within the current view. Controls remain in memory for this window.

While Emc² runs, each IMAP account watches its inbox for arrival, flag and removal events. Gmail API accounts check their mailbox revision every 15 seconds; a changed revision requests an account sync through the same queue. The interval starts after the previous request and sync finish, and failures back off up to five minutes. A failed sync never advances the revision. Event bursts coalesce. The first complete import and failed syncs do not notify, including recovery after a partial first import. Account removal or replacement stops the old watcher. The five-minute full sync remains a recovery path. Desktop cache-change events refresh visible windows; hidden windows catch up when shown. The renderer's own periodic timers serve only the browser target. Native notification timing depends on the provider and operating system.

Search stays visible in mail, Today, Calendar, Projects, Agent review.
While Settings is open, the background toolbar remains visible and inert.
The first nonempty query opens All cached across all accounts and clears
inherited mail filters. Continued typing preserves deliberate narrowing. Clear
and Escape remove the query while retaining the current view and filters.
Typing updates the input immediately; result work waits for a 120ms pause.
Navigation cancels pending input. Search keystrokes remain one history visit. Draft matches have a separate
section and open through draft recovery. Commands includes work views and drafts.

Agent review has a Review queue with a pending count and Activity. Assistant
setup lives in Settings, AI and agents. Read mail, Organize work and Prepare
replies fill only new permission forms. Creation tools remain off until chosen
explicitly. BYOK uses visible provider choices and the existing encrypted save
and draft-review flow. See [ADR 0048](docs/adr/0048-v2-persistent-navigation.md).

## V2 daily workflow

Keep history arrows beside persistent search, with compact headers below.
Settings owns assistant setup; Agent review owns proposed actions and activity.
Settings section changes start at the top. Unsaved templates and signatures
survive section changes and closing Settings for the current app session.
Use a full mail-style Drafts list and an anchored Snooze menu. Calendar includes
active snoozes. Show no sender panel and avoid duplicate action
bars on the closed mail list. Preserve accessible labels on icon buttons.

Text-size shortcuts scale type and virtual row geometry together. Reply context
stays beside the composer in two independently scrolling columns. Reuse
the same file validation for choosing and dropping attachments.

The sidebar footer and collapsed coverage/status bar share a 42px height.
Today places counts beside its status tabs and keeps Refresh and Add task on
the same toolbar row.


## Optional message formatting

Keep the plain-text textarea until a formatting action is applied. A compact
flat toolbar offers bold, italic, underline, links, lists and quotations.
Formatted editing keeps a plain-text alternative, native editing undo and
keyboard shortcuts. Paste inserts only text. No sender assets or arbitrary
HTML/CSS enter the editor. Privacy blurs the body while it is unfocused.

In Drafts, Delete draft and Close sit at the right of the account-tabs row.
From, To and Subject use compact 34px controls. Preserve the independent
side-by-side original and reply scrolling, single-row Send/save footer and no-drag
controls. Other compose entry points retain actions beside the first field.

New Message and Send give a restrained press/glow response. Animate only
transform and overlay opacity for 140ms; keep resting depth and geometry.
Reduced motion removes movement and transitions. Disabled buttons do not glow.

The 42px coverage footer and divider span the entire working pane, including
Calendar. Its horizontal edges align with the pane and sidebar footer.

Saved drafts use compact recipient/account, subject/preview and time columns.
Refresh shares the account-tabs row. Healthy saved-count text remains available
to assistive technology without a separate visible banner; loading and cached
failures remain visible. Narrow rows reflow, and uncertain-send warnings stay
fully readable. Matching subjects do not merge distinct drafts.

Saved draft rows offer a direct Delete draft action on pointer hover or keyboard
focus, always visible on touch. Confirm before deletion, including the existing
unknown-send warning. Use the exact account, draft ID and saved revision; remove
the row only after confirmed success. Retain failed rows with refresh guidance,
refresh the sidebar count and return focus to the next row or Refresh.

Attachment reads finish before edit freezing; failed reads retain the composer
and error. Inert descendants are excluded from the explicit keyboard cycle.
Insert link uses a compact inline address field with Add link and Cancel link.
Enter applies the validated link without submitting email; Escape cancels only
link entry. Selected text, plain alternatives and safe URL rules are retained.

The composer From selector uses the shared themed dropdown: a 30px trigger, compact account rows, arrow/Home/End selection, Enter to confirm and Escape or Tab to dismiss. Private mode omits account addresses. Account switching retains the existing signature and saved-copy behavior.
