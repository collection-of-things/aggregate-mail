import type { AvailabilitySettings, BusyPeriod } from "./availability.js";
import type { CalendarEvent } from "./calendar.js";

export type BusySelection = { accountId: string; calendarIds: string[] };
export type CalendarOffer = {
  id: string; accountId: string; sourceMailId: string; sourceFingerprint: string; recipient: string;
  settings: AvailabilitySettings; from: string; to: string; google: BusySelection[]; slots: BusyPeriod[];
  input: string; createdAt: number; selected?: number[]; draftId?: string;
  booking?: { slot: number; eventId: string };
};
export type OfferContext = {
  fingerprint: string; settings?: AvailabilitySettings;
  google: { accountId: string; ready: boolean; calendars: { id: string; name: string }[] }[];
  offers: { offer: CalendarOffer; event?: CalendarEvent }[];
};
export function offeredTime(slot: BusyPeriod, timeZone: string) {
  const date = new Intl.DateTimeFormat(undefined, { timeZone, weekday: "short", year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "longOffset" });
  const endpoint = (instant: string) => date.formatToParts(new Date(instant)).map(({ type, value }) => type === "timeZoneName" ? value === "GMT" ? "UTC+00:00" : value.replace("GMT", "UTC") : value).join("");
  return `${endpoint(slot.start)} to ${endpoint(slot.end)} (${timeZone})`;
}
