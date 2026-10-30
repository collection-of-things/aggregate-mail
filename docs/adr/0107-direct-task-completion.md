# ADR 0107: Direct task completion

Date: 2026-10-30
Status: User-requested implementation; delivery and installed acceptance pending.
Supersedes: The completion interaction in ADR 0042 only. Cancellation and
reopening retain their existing explicit edit flow.

An explicit checkbox in a Today or Projects task row and a Mark complete button
in task details complete an open task in one action. Calendar uses the same task
details button. Use the existing revision-checked commitment update and history;
do not alter the reason, evidence, mail or work sessions. Stale or uncertain
workspace state blocks another write until the existing recovery flow completes.
The control does not reopen completed or cancelled tasks.

Synthetic mounted checks cover Today and Calendar completion and an unconfirmed
write. Browser layout, installed interaction and real-account behavior require
separate verification.
