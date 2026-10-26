import { useId, useState } from "react";
import { commandModifier } from "../interaction";
import { Dialog } from "../ui/Dialog";

export type PaletteGroup = "mail" | "navigation";

// Quiet section labels: actions on the selected email versus navigation.
export const paletteGroups: readonly { id: PaletteGroup; label: string }[] = [
  { id: "mail", label: "Selected email" },
  { id: "navigation", label: "Navigation" },
];

export type PaletteCommand = {
  id: string;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  // Why the command is unavailable; shown beside a disabled entry and announced.
  disabledReason?: string;
  // Extra words that find the command, e.g. "done" for Archive.
  aliases?: string[];
  group: PaletteGroup;
  run: () => void;
};

export function CommandPalette({ commands, onClose }: { commands: PaletteCommand[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const id = useId();
  const modifier = commandModifier();
  const shortcutText = (label: string) => modifier === "⌘" ? label.replace(/^Cmd\+?/, "⌘") : label;
  const term = query.trim().toLocaleLowerCase();
  // Exact label matches rank first, then alias matches, then substrings.
  const rank = (command: PaletteCommand) => {
    if (!term) return 0;
    const label = command.label.toLocaleLowerCase();
    if (label === term) return 0;
    if (command.aliases?.some((alias) => alias.toLocaleLowerCase().includes(term))) return 1;
    if (label.includes(term)) return 2;
    return -1;
  };
  const ranked = commands
    .map((command) => ({ command, rank: rank(command) }))
    .filter((entry) => entry.rank >= 0)
    .sort((a, b) => a.rank - b.rank);
  const groups = paletteGroups
    .map((group) => ({ ...group, entries: ranked.filter((entry) => entry.command.group === group.id) }))
    .filter((group) => group.entries.length);
  const visible = groups.flatMap((group) => group.entries.map((entry) => entry.command));
  const enabled = visible.filter((command) => !command.disabled);
  const active = enabled.find((command) => command.id === selected) ?? enabled[0];
  const optionId = (command: PaletteCommand) => `${id}-${commands.indexOf(command)}`;
  const execute = (command: PaletteCommand) => {
    if (command.disabled) return;
    onClose();
    command.run();
  };
  return <Dialog title="Commands" onClose={onClose}>
    <div className="command-palette">
      <input role="combobox" aria-label="Search commands" aria-autocomplete="list" aria-expanded="true"
        aria-controls={`${id}-list`} aria-activedescendant={active ? optionId(active) : undefined}
        placeholder="Search commands…" value={query}
        onChange={(event) => { setQuery(event.target.value); setSelected(null); }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!enabled.length) return;
            const index = active ? enabled.indexOf(active) : 0;
            const next = enabled[(index + (event.key === "ArrowDown" ? 1 : -1) + enabled.length) % enabled.length];
            setSelected(next.id);
            document.getElementById(optionId(next))?.scrollIntoView?.({ block: "nearest" });
          } else if (event.key === "Enter") {
            event.preventDefault();
            if (active) execute(active);
          }
        }} />
      <div id={`${id}-list`} role="listbox" aria-label="Commands" className="command-options">
        {groups.map((group) => (
          <div key={group.id} role="group" aria-label={group.label} className="command-group">
            <div className="command-group-label">{group.label}</div>
            {group.entries.map(({ command }) => <div key={command.id} id={optionId(command)} role="option"
              aria-selected={active?.id === command.id} aria-disabled={command.disabled || undefined}
              aria-description={command.disabled ? command.disabledReason : undefined}
              className="command-option" onMouseDown={(event) => event.preventDefault()}
              onMouseMove={() => { if (!command.disabled) setSelected(command.id); }}
              onClick={() => execute(command)}>
              <span>{command.label}</span>
              <span className="command-side">
                {command.disabled && command.disabledReason && <span className="command-reason">{command.disabledReason}</span>}
                {command.shortcut && <kbd>{shortcutText(command.shortcut)}</kbd>}
              </span>
            </div>)}
          </div>
        ))}
      </div>
      {!visible.length && <p className="command-empty" role="status">No matching commands</p>}
    </div>
  </Dialog>;
}
