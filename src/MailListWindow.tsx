import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import type { RendererMail as Mail } from "../shared/types";
import type { MailLocation } from "./navigation";
import { dayGroup } from "./mail/format";

export function MailListWindow<T extends Mail>({ messages, selectedId, focusSelection, density, sort, listRef, narrow = false, cardContent, children }: {
  messages: T[];
  selectedId: string | undefined;
  focusSelection: boolean;
  density: "comfortable" | "compact";
  sort: MailLocation["sort"];
  listRef: RefObject<HTMLElement | null>;
  narrow?: boolean;
  // Memoize this callback by layout preferences, independent of message refreshes.
  cardContent?: (mail: T) => { metadata: boolean; preview: boolean };
  children: (mail: T, index: number) => ReactNode;
}) {
  const windowRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 600, offset: 0 });
  const [sizes, setSizes] = useState({ medium: 34, compact: 24, group: 30, cardBase: 54, cardCompact: 48, metadata: 18, preview: 20 });
  const [measured, setMeasured] = useState(false);
  const geometry = useMemo(() => {
    let height = 0;
    const groups: { label: string; top: number; height: number }[] = [];
    const rows = messages.map((mail, index) => {
      const label = dayGroup(mail.date);
      if (sort !== "relevance" && (index === 0 || label !== dayGroup(messages[index - 1].date))) {
        if (groups.length) groups[groups.length - 1].height = height - groups[groups.length - 1].top;
        groups.push({ label, top: height, height: 0 });
        height += sizes.group;
      }
      const top = height;
      const content = narrow && cardContent?.(mail);
      height += content ? density === "compact" ? sizes.cardCompact
        : sizes.cardBase + (content.metadata ? sizes.metadata : 0) + (content.preview ? sizes.preview : 0)
        : density === "compact" ? sizes.compact : sizes.medium;
      return { top, bottom: height };
    });
    if (groups.length) groups[groups.length - 1].height = height - groups[groups.length - 1].top;
    return { rows, groups, height };
  }, [messages, density, sort, sizes, narrow, cardContent]);
  const windowOffset = useCallback(() => {
    let offset = 0;
    let element: HTMLElement | null = windowRef.current;
    while (element && element !== listRef.current) {
      offset += element.offsetTop;
      element = element.offsetParent as HTMLElement | null;
    }
    return offset;
  }, [listRef]);
  const measure = useCallback(() => {
    const list = listRef.current;
    const element = windowRef.current;
    if (!list || !element) return;
    const style = window.getComputedStyle(list);
    const scale = parseFloat(style.getPropertyValue("--text-scale")) || 1;
    const token = (name: string, fallback: number) => (parseFloat(style.getPropertyValue(`--mail-row-${narrow ? "card-" : ""}${name}`)) || fallback) * scale;
    const nextSizes = {
      medium: token("medium", narrow ? 100 : 34),
      compact: token("compact", narrow ? 48 : 24),
      cardBase: (parseFloat(style.getPropertyValue("--mail-card-base")) || 54) * scale,
      cardCompact: (parseFloat(style.getPropertyValue("--mail-card-compact")) || 48) * scale,
      metadata: (parseFloat(style.getPropertyValue("--mail-card-meta")) || 18) * scale,
      preview: (parseFloat(style.getPropertyValue("--mail-card-preview")) || 20) * scale,
      group: (parseFloat(style.getPropertyValue("--mail-group-height")) || 30) * scale,
    };
    setSizes(current => Object.keys(current).every(key => current[key as keyof typeof current] === nextSizes[key as keyof typeof nextSizes]) ? current : nextSizes);
    const next = { top: list.scrollTop, height: list.clientHeight || 600, offset: windowOffset() };
    setViewport(current => current.top === next.top && current.height === next.height && current.offset === next.offset ? current : next);
    setMeasured(true);
  }, [listRef, narrow, windowOffset]);
  useLayoutEffect(measure);
  useEffect(() => {
    listRef.current?.scrollTo({ top: 0, behavior: "instant" });
  }, [listRef]);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    measure();
    list.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(list);
    return () => {
      list.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [listRef, measure]);
  const selectedIndex = useMemo(() => messages.findIndex(mail => mail.id === selectedId), [messages, selectedId]);
  const lastSelection = useRef<string | undefined>(undefined);
  const lastLayout = useRef("");
  const lastCardContent = useRef(cardContent);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || !measured) return;
    if (selectedIndex < 0) { lastSelection.current = undefined; return; }
    const layout = JSON.stringify([density, narrow, sizes]);
    const selectionChanged = lastSelection.current !== selectedId;
    const layoutChanged = lastLayout.current !== layout || lastCardContent.current !== cardContent;
    // Density and text sizing keep selection visible; refresh and passive scroll do not snap it back.
    if (!selectionChanged && !layoutChanged) return;
    const behavior = lastSelection.current === undefined || layoutChanged ? "instant" : "auto";
    lastSelection.current = selectedId;
    lastLayout.current = layout;
    lastCardContent.current = cardContent;
    const row = geometry.rows[selectedIndex];
    const top = windowOffset() + row.top;
    const bottom = windowOffset() + row.bottom;
    const sticky = sort === "relevance" ? 0 : sizes.group;
    if (top < list.scrollTop + sticky) list.scrollTo({ top: Math.max(0, top - sticky), behavior });
    else if (bottom > list.scrollTop + (list.clientHeight || 600))
      list.scrollTo({ top: bottom - (list.clientHeight || 600), behavior });
    const active = document.activeElement;
    if (selectionChanged && focusSelection && (active === document.body ||
      (active instanceof HTMLElement && !!active.closest(".mail-row, .row, .message") &&
        !active.closest("input, textarea, select, [contenteditable], [role=menu], [role=dialog]"))))
      document.getElementById(`mail-${selectedId}`)?.focus({ preventScroll: true });
    measure();
  }, [selectedId, selectedIndex, geometry, focusSelection, measured, measure, sizes, sort, windowOffset, density, narrow, cardContent]);
  const top = Math.max(0, viewport.top - viewport.offset - 300);
  const bottom = viewport.top - viewport.offset + viewport.height + 300;
  const firstAfter = (position: number) => {
    let low = 0, high = geometry.rows.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (geometry.rows[middle].bottom < position) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  const start = firstAfter(top);
  const end = Math.min(messages.length, firstAfter(bottom) + 1);
  const indices = Array.from({ length: Math.max(0, end - start) }, (_, index) => start + index);
  if (selectedIndex >= 0 && (selectedIndex < start || selectedIndex >= end)) indices.push(selectedIndex);
  const activeRow = typeof document === "undefined" ? null : document.activeElement?.closest(".mail-window-row");
  const focusedId = activeRow && windowRef.current?.contains(activeRow) ? activeRow.getAttribute("data-mail-id") : null;
  const focusedIndex = useMemo(() => focusedId ? messages.findIndex(mail => mail.id === focusedId) : -1, [messages, focusedId]);
  if (focusedIndex >= 0 && !indices.includes(focusedIndex)) indices.push(focusedIndex);
  indices.sort((a, b) => a - b);
  return <div ref={windowRef} className="mail-window" style={{ height: geometry.height }}>
    {geometry.groups.map((group, index) => <div key={index} className="mail-window-date"
      style={{ top: group.top, height: group.height }}><h3 className="group">{group.label}</h3></div>)}
    {indices.map(index => <div className="mail-window-row" key={messages[index].id} data-mail-id={messages[index].id}
      style={{ top: geometry.rows[index].top, height: geometry.rows[index].bottom - geometry.rows[index].top }}>{children(messages[index], index)}</div>)}
  </div>;
}
