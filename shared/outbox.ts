import type { OutboxStatus } from "./types";

// Missed means held for review after its own scheduled time passed. Future holds,
// active attempts and unknown outcomes stay distinct; the cause is not inferred.
export function missedSchedule(entry: OutboxStatus, now: number): boolean {
  return entry.state === "pending" && entry.review && entry.scheduledFor !== undefined && entry.scheduledFor <= now;
}
