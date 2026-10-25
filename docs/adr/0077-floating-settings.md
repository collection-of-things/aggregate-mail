# ADR 0077: Floating Settings

Date: 2026-10-25
Status: Implemented; source verification in progress.
Amends: ADR 0048 Settings layout and persistent-toolbar access only.

## Decision

Open Settings in the existing modal Dialog over the current mounted mail or
work pane. Keep its ten sections and existing controls. Use a compact header
with Back, Forward and Close settings. Keep the header reachable while the
section rail and content scroll independently. At narrow widths the rail
moves above the content and can scroll without hiding the content region.

Make the background frame and update control inert. Search shortcuts leave
Settings and focus All cached with cleared mail filters; Privacy shortcuts
remain available from the Settings shell. Inputs, editable content,
shortcut-capture fields and nested dialogs retain ownership. Commands stays
blocked until Settings closes. Focus Close initially to avoid revealing a
hidden private field. Only the foremost dialog handles Escape and Tab;
closing restores its connected, non-inert opener.

Keep mail/work state mounted and preserve reader context across Settings
history, including account and message validation on restore. Keep ordinary
menu and transient reader history behavior. Compose still saves before
navigation opens Settings. Unsaved templates and signatures and pending-save
locks stay in App state across sections and modal closing.

## Limits

This changes renderer composition and keyboard/navigation boundaries only.
It adds no dependency, draggable window, native window, preference migration,
provider operation or storage change. Mounted synthetic checks and production
CSS fixtures do not prove installed native appearance or input. Native
packaging, installed smoke and owner acceptance require separate evidence.
