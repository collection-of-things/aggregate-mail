// The F6 pane cycle: one documented order across the visible window regions.
export const regionOrder = ["sidebar", "search", "list", "reader"] as const;
export type Region = (typeof regionOrder)[number];

/**
 * The next region in the cycle, or null when no region is available. Focus
 * outside every available region enters at the first or last visible one.
 */
export function nextRegion(available: readonly Region[], current: Region | null, direction: 1 | -1): Region | null {
  if (!available.length) return null;
  const index = current === null ? -1 : available.indexOf(current);
  if (index < 0) return direction === 1 ? available[0] : available[available.length - 1];
  return available[(index + direction + available.length) % available.length];
}

/** Which cycled region contains an element, if any. */
export function regionOf(element: Element | null | undefined): Region | null {
  if (!element) return null;
  if (element.closest(".reader-pane")) return "reader";
  if (element.closest(".list-pane")) return "list";
  if (element.closest("#sidebar")) return "sidebar";
  if (element.closest(".app-toolbar, .search-help")) return "search";
  return null;
}
