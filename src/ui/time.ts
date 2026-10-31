const day = 86400000;

/** "now", then minutes, hours and days since `date`. */
export function relative(date: number) {
  const minutes = Math.max(0, Math.floor((Date.now() - date) / 60000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 1440)}d`;
}

/** Date group headings for lists, newest first. */
export function dateGroup(date: number, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (date >= today + day) return "Upcoming";
  if (date >= today) return "Today";
  if (date >= today - day) return "Yesterday";
  if (date >= today - 6 * day) return "This week";
  if (date >= today - 30 * day) return "This month";
  return "Earlier";
}

/** Splits a sorted list into consecutive named groups. */
export function groupBy<T>(items: T[], name: (item: T) => string) {
  const groups: { name: string; items: T[] }[] = [];
  for (const item of items) {
    const key = name(item);
    if (groups.at(-1)?.name !== key) groups.push({ name: key, items: [] });
    groups.at(-1)!.items.push(item);
  }
  return groups;
}

export const fullDate = (date: number) => new Date(date).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
