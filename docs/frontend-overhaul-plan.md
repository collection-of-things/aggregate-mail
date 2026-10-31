# Frontend rebuild on the current application

Apply the rebuild design to the current application without replacing its
renderer or service contracts. The existing components own navigation,
operations, recovery and browser authentication.

## Implementation

- Keep the current App, BrowserSession, mail and bulk actions, cached search,
  saved views, Contacts, calendar, rich drafts, attachments, outbox and scheduled
  sending. Keep current About and update status.
- Apply the 200px sidebar, etched pane separators, glossy primary controls and
  compact typography through `src/styles/frontend-rebuild.css`. Import it after
  application styles and before responsive overrides.
- Preserve theme and glass tokens, native caption spacing, measured mail rows,
  keyboard access, visible focus, privacy and reduced motion.
- Update DESIGN.md, design metadata, the KB, journey map and changelog.

## Acceptance and evidence

Run the serial synthetic suite and strict build under CONTRIBUTING.md's bounded
verification procedure. Navigation, row actions, draft recovery, phone access,
Contacts and calendar tests exercise the current handlers. Review the complete
diff independently against its current main base.

Live browser testing remains restricted by PRODUCT.md. Browser geometry,
native installation, provider connections and real delivery require separate
acceptance evidence. Do not infer them from synthetic tests or a successful
build.

## Rollback

Reverting the frontend finish restores the main-branch appearance. There are no
new dependencies, API adapters, migrations or alternate renderer entry points.
Protected local deployments must retain their existing profile, keys,
authentication, drain and rollback lifecycle.
