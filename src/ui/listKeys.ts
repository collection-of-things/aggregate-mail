import { useEffect } from "react";

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/**
 * List keys while no field has focus: ↓/j and ↑/k open the next or previous
 * item, Esc closes it, and / focuses the search box.
 */
export function useListKeys({ ids, openId, onOpen, onClose, search }: {
  ids: string[];
  openId: string | null;
  onOpen: (id: string) => void;
  onClose: () => void;
  search?: () => void;
}) {
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) return;
      // Inside an open email or draft, arrows scroll and Esc belongs to its own menus.
      if (event.target instanceof HTMLElement && event.target.closest(".reader, .editor") && event.key !== "Escape") return;
      const step = event.key === "ArrowDown" || event.key === "j" ? 1 : event.key === "ArrowUp" || event.key === "k" ? -1 : 0;
      if (step && ids.length) {
        event.preventDefault();
        const index = openId ? ids.indexOf(openId) : -1;
        const next = ids[Math.min(ids.length - 1, Math.max(0, index === -1 ? 0 : index + step))];
        onOpen(next);
        requestAnimationFrame(() => document.querySelector(`[data-row="${CSS.escape(next)}"]`)?.scrollIntoView({ block: "nearest" }));
      } else if (event.key === "Escape" && openId) {
        onClose();
      } else if (event.key === "/" && search) {
        event.preventDefault();
        search();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [ids.join("|"), openId]);
}
