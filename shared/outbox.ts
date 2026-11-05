import type { OutboxStatus } from "./types";

/** Identifies overdue held schedules, excluding future holds and uncertain delivery outcomes. */
export function missedSchedule(entry: OutboxStatus, now: number): boolean {
  return entry.state === "pending" && entry.review && entry.scheduledFor !== undefined && entry.scheduledFor <= now;
}
