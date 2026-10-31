# ADR 0110: Review unverified calendar changes against the current event

Status: Implemented for security remediation; native acceptance is separate.

Email From, organizer and attendee fields are sender-controlled. Agreement
between them establishes consistency, not participant authentication.

Before a received calendar message can change an existing local event, show
that event and the proposed details with an explicit unverified-sender warning.
Require a separate confirmation bound to the exact source fingerprint and full
current event. Recompute the token inside the transaction before preparing a
replacement RSVP or applying cancellation/attendee response. A target or source
change requires another review. Existing fresh Google-event checks remain.

Workspace backups carry data but cannot prove calendar preparation. Restore
calendar drafts as ordinary text/attachment drafts, stripping invitation and
calendar-context metadata. Re-prepare from the current event or source to send
calendar data. Preserve uncertain-send state and never resume imported actions.

This supersedes only the implicit participant-identity trust and imported
calendar authority described by ADR 0054. It does not authenticate senders,
send mail automatically or change provider calendars.
