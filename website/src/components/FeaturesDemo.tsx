import type { ComponentChildren, JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { startPaintShader, type PaintShaderOptions } from "../lib/paint-shader";
import { currentTheme, onThemeChange, type Theme } from "../lib/theme";
import { Icon, type IconName } from "../lib/icons";
import {
  ArchiveFragment,
  ComposeFragment,
  DensityFragment,
  PrivacyFragment,
  SearchFragment,
  Swap,
  TeachFragment,
} from "./app/fragments";

// The feature list, set like a spec sheet: six commands, each with its icon,
// its key as a quiet keycap and a two-line note, separated by hairlines. The
// active item reads at full white while the others sit back, and the
// hairline under it fills pink over the 4.5s dwell before the next item
// takes over. A click or arrow key picks and restarts the timer; under
// reduced motion nothing moves by itself.
const COMMANDS: { name: string; key: string; icon: IconName; note: string; fragment: () => JSX.Element }[] = [
  {
    name: "Search all mail",
    key: "/",
    icon: "search",
    note: "One query across every account and folder, Sent, Archive and Snoozed included. It forgives a typo",
    fragment: SearchFragment,
  },
  {
    name: "Archive",
    key: "e",
    icon: "archive",
    note: "Done archives, never deletes. The row leaves your inbox and stays searchable",
    fragment: ArchiveFragment,
  },
  {
    name: "Teach sorting",
    key: "m",
    icon: "tag",
    note: "Correct one sender and preview the rule before it applies. Your rules win over the AI sorter",
    fragment: TeachFragment,
  },
  {
    name: "Hide personal information",
    key: "p",
    icon: "eye",
    note: "Before you share your screen: names, subjects and previews are hidden, and accounts show by number",
    fragment: PrivacyFragment,
  },
  {
    name: "Comfortable / Compact",
    key: "d",
    icon: "rows",
    note: "Two densities. Mail that may need you keeps its taller two-line row",
    fragment: DensityFragment,
  },
  {
    name: "Compose",
    key: "c",
    icon: "compose",
    note: "Plain-text mail with a signature for each account. Templates add text without replacing your draft",
    fragment: ComposeFragment,
  },
];

/* The night painting goes near-monochrome and dim so the black theme
   carries no hue. The CSS fallback in global.css carries the same grade. */
const DARK_GRADE: PaintShaderOptions = {
  grade: { saturation: 0.25, contrast: 1.1, brightness: 0.55 },
};

const reducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function FeaturesDemo({ art }: { art?: ComponentChildren }) {
  const [selected, setSelected] = useState(0);
  // bumped on every visitor pick so the progress line restarts even when
  // the item stays the same
  const [cycle, setCycle] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const lightShader = useRef<HTMLCanvasElement>(null);
  const darkShader = useRef<HTMLCanvasElement>(null);

  /* The shader canvases live in this tree so hydration keeps them; each
     starts on its theme's painting the first time that theme shows, so a
     visitor who never switches never fetches the other painting. */
  useEffect(() => {
    const started = new Set<Theme>();
    const start = (theme: Theme) => {
      if (started.has(theme)) return;
      const canvas = (theme === "dark" ? darkShader : lightShader).current;
      const panel = canvas?.closest<HTMLElement>(".feat-panel");
      const img =
        panel?.querySelector<HTMLImageElement>(`[data-art="${theme}"] img.art-i`) ??
        (theme === "light" ? panel?.querySelector<HTMLImageElement>("img.art-i") : null);
      if (!canvas || !panel || !img) return;
      started.add(theme);
      startPaintShader(panel, canvas, img, theme === "dark" ? DARK_GRADE : undefined);
    };
    start(currentTheme());
    onThemeChange(start);
  }, []);

  const active = selected;
  const pick = (index: number) => {
    setSelected(index);
    setCycle((current) => current + 1);
  };

  /* The cycle is the progress bar's own life: `animationend` advances the
     list, and a ~25% visibility gate pauses the bar with it, so the bar and
     the switch can never drift apart. Hidden tabs pause CSS themselves.
     The bar renders only after hydration: the island mounts `client:visible`,
     so an SSR-rendered bar could finish its animation before the listener
     exists and sit full forever — hydration drops it and mounts a fresh one. */
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    setReady(true);
    const node = root.current;
    if (!node || reducedMotion() || typeof IntersectionObserver !== "function") return;
    const observer = new IntersectionObserver(
      ([entry]) => setPaused(entry.intersectionRatio < 0.25),
      { threshold: [0, 0.25, 0.5, 0.75, 1] }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const advance = () => {
    if (paused || reducedMotion()) return;
    setSelected((current) => (current + 1) % COMMANDS.length);
    setCycle((current) => current + 1);
  };
  const onProgEnd = (event: JSX.TargetedAnimationEvent<HTMLElement>) => {
    if (event.animationName === "cmd-prog") advance();
  };

  /* listbox pattern: roving tabindex, arrows move the selection */
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const next = Math.min(COMMANDS.length - 1, Math.max(0, active + (event.key === "ArrowDown" ? 1 : -1)));
    pick(next);
    root.current?.querySelector<HTMLElement>(`#cmd-${next}`)?.focus();
  };

  return (
    <div className="feat-grid" ref={root}>
      <ul aria-label="Commands" className="feat-list" onAnimationEnd={onProgEnd} onKeyDown={onKey} role="listbox">
        {COMMANDS.map((command, index) => (
          <li
            aria-selected={index === active}
            className={`feat-item${index === active ? " on" : ""}`}
            data-cmd={index}
            id={`cmd-${index}`}
            key={command.key}
            onClick={() => pick(index)}
            role="option"
            tabIndex={index === active ? 0 : -1}
          >
            <span className="feat-item-h">
              <Icon name={command.icon} size={18} />
              <span className="feat-item-t">{command.name}</span>
              <kbd className="keycap">{command.key}</kbd>
            </span>
            <span className="feat-item-dwrap">
              <span className="feat-item-d">{command.note}</span>
            </span>
            {index === active && !reducedMotion() && !paused && ready && (
              <span aria-hidden="true" className="feat-item-prog" key={`${active}-${cycle}`} />
            )}
          </li>
        ))}
      </ul>
      <div className="feat-panel">
        {art}
        <canvas aria-hidden="true" className="art-gl" data-art="light" ref={lightShader} />
        <canvas aria-hidden="true" className="art-gl" data-art="dark" ref={darkShader} />
        <Swap active={active} items={COMMANDS.map((command) => command.fragment)} />
      </div>
    </div>
  );
}
