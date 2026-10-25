import type { RefObject } from "react";
import { Close, Search } from "../ui/icons";

export function SearchToolbar({ inputRef, query, label, invalid, disabled, commandsDisabled = disabled, shortcut, onFocus, onChange, onClear, onCommands }: {
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  label: string;
  invalid: boolean;
  disabled: boolean;
  commandsDisabled?: boolean;
  shortcut: string;
  onFocus: () => void;
  onChange: (query: string) => void;
  onClear: () => void;
  onCommands: () => void;
}) {
  return <div className="app-search-toolbar">
    <div className="search" role="search">
      <Search color="currentColor" size={15} />
      <input data-compose-access ref={inputRef} aria-label={label} aria-describedby="mail-search-help" aria-invalid={invalid || undefined} placeholder="Search mail" value={query} disabled={disabled}
        onFocus={onFocus} onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.stopPropagation(); onClear(); event.currentTarget.blur(); }
        }} />
      {query ? <button data-compose-access type="button" aria-label="Clear search" disabled={disabled} onClick={onClear}>
        <Close color="currentColor" size={13} />
      </button> : <kbd aria-hidden="true">{shortcut}</kbd>}
    </div>
    <button data-compose-access type="button" className="commands-button" disabled={commandsDisabled} onClick={onCommands}
      aria-haspopup="dialog" title="Commands (Cmd/Ctrl+K)">Commands <kbd>⌘/Ctrl K</kbd></button>
  </div>;
}
