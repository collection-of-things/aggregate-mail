import { createContext } from "react";
import { MAX_MAIL_BATCH, type MailIdentity } from "../../shared/bulk-mail";

export const selectionKey = (item: MailIdentity) => JSON.stringify([item.accountId, item.id]);
export function selectRange(items: MailIdentity[], anchor: string, target: string): MailIdentity[] {
  const start = items.findIndex(item => selectionKey(item) === anchor);
  const end = items.findIndex(item => selectionKey(item) === target);
  if (end < 0) return [];
  return items.slice(start < 0 ? end : Math.min(start, end), start < 0 ? end + 1 : Math.max(start, end) + 1).slice(0, MAX_MAIL_BATCH);
}
export const BulkSelectionContext = createContext<{
  selected: Set<string>;
  disabled: boolean;
  toggle: (item: MailIdentity, range: boolean) => void;
} | null>(null);

/** The platform select-all chord: Command+A on Apple platforms, Control+A elsewhere. */
export function isSelectAllShortcut(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
  platform = typeof window === "undefined" ? "" : window.desktop?.platform ?? (/Mac|iPhone|iPad/.test(window.navigator.platform) ? "darwin" : window.navigator.platform)) {
  if (event.key.toLowerCase() !== "a" || event.altKey || event.shiftKey) return false;
  return platform === "darwin" ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}
/** Keys typed into fields, menus or another open dialog keep their native meaning. */
export function ownsKeyboard(target: EventTarget | null) {
  const element = target as Element | null;
  if (typeof element?.closest === "function" && element.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [role="menu"], [role="listbox"]')) return true;
  return [...document.querySelectorAll('[role="dialog"]')].some(dialog => !dialog.closest("[inert]"));
}
