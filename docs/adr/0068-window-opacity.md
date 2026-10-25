# 0068: Shared glass tint and window opacity

Date: 2026-10-25
Status: Accepted for the requested color and opacity correction.
Amends: ADR 0035, tint placement and level only.

## Decision

Paint one neutral surface tint on the app when native material is available
and transparency is enabled. Keep the sidebar, working panes, Settings rail
and Settings groups transparent so they cannot stack mismatched tint layers.
Keep intentional control, selection, sticky-heading and privacy fills.

Add Window opacity to Appearance as a native range input from 0 to 100 percent,
with a visible percentage. Save the integer in the existing device-local
appearance preference. Missing and invalid stored levels use 70 percent.
Apply the level immediately through a background color token, never element
opacity. Keep foreground text opaque. Retain the level across themes,
material changes and restart. Disable the control with transparency Off or
unsupported, preserving fully opaque platform fallback.

Keep native material selection, desktop IPC, encryption, mail operations,
custom palette preview and storage-failure behavior unchanged.

## Verification

Check endpoint and intermediate persistence, invalid values, live changes,
restart, Off and unsupported fallback. Compare rendered parent and child
backgrounds across routes, schemes and opacity levels. Build and launch the
exact packaged Mac candidate before commit. Native desktop contrast and Windows
material appearance require separate acceptance.
