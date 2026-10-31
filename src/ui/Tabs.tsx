import { useLayoutEffect, useRef, useState } from "react";

export type Tab = { id: string; label: string; count?: number };

/** Underlined tabs below the top line; one indicator slides to the selected tab. */
export function Tabs({ tabs, value, onChange, label }: { tabs: Tab[]; value: string; onChange: (id: string) => void; label: string }) {
  const list = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);
  const tabKey = tabs.map((tab) => `${tab.id}:${tab.label}:${tab.count}`).join("|");
  useLayoutEffect(() => {
    const measure = () => {
      const active = list.current?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(value)}"]`);
      setIndicator(active ? { left: active.offsetLeft, width: active.offsetWidth } : null);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (list.current) observer.observe(list.current);
    return () => observer.disconnect();
  }, [value, tabKey]);
  return (
    <>
      <div ref={list} className="tabs" role="tablist" aria-label={label}>
        {tabs.map(({ id, label, count }) => (
          <button key={id} data-tab={id} type="button" role="tab" aria-selected={value === id} className={value === id ? "tab active" : "tab"} onClick={() => onChange(id)}>
            {label}
            {count !== undefined && <span className="tab-count">{count}</span>}
          </button>
        ))}
        {indicator && <span className="tab-indicator" aria-hidden="true" style={{ width: indicator.width, transform: `translateX(${indicator.left}px)` }} />}
      </div>
      <div role="separator" className="groove-horizontal" />
    </>
  );
}
