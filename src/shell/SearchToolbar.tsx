import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { Close, Search } from "../ui/icons";

export function SearchToolbar({ inputRef, query, label, invalid, disabled, commandsDisabled = disabled, shortcut, onFocus, onChange, onClear, onCommands, scopeKey = "" }: {
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  scopeKey?: string;
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
  const [text, setText] = useState(query);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(onChange);
  useLayoutEffect(() => { latest.current = onChange; });
  const cancel = () => { clearTimeout(timer.current); timer.current = undefined; };
  useLayoutEffect(() => { cancel(); setText(query); }, [query, disabled, scopeKey]);
  useLayoutEffect(() => () => cancel(), []);
  const change = (value: string) => {
    setText(value);
    cancel();
    // Keep expensive application filtering out of the controlled input update.
    timer.current = setTimeout(() => latest.current(value), 120);
  };
  const clear = () => { cancel(); setText(""); onClear(); };
  return <div className="app-search-toolbar">
    <div className="search" role="search">
      <Search color="currentColor" size={15} />
      <input data-compose-access ref={inputRef} aria-label={label} aria-describedby="mail-search-help" aria-invalid={invalid || undefined} placeholder="Search mail and drafts" value={text} disabled={disabled}
        onFocus={onFocus} onChange={(event) => change(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.stopPropagation(); clear(); event.currentTarget.blur(); }
        }} />
      {text ? <button data-compose-access type="button" aria-label="Clear search" disabled={disabled} onClick={() => { clear(); inputRef.current?.focus(); }}>
        <Close color="currentColor" size={13} />
      </button> : <kbd aria-hidden="true">{shortcut}</kbd>}
    </div>
    <button data-compose-access type="button" className="commands-button" disabled={commandsDisabled} onClick={onCommands}
      aria-haspopup="dialog" title="Commands (Cmd/Ctrl+K)">Commands <kbd>⌘/Ctrl K</kbd></button>
  </div>;
}
