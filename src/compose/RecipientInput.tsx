import { useContext, useEffect, useId, useRef, useState } from "react";
import type { ContactSuggestion } from "../../shared/contacts";
import type { Account } from "../../shared/types";
import type { Api } from "../api";
import { accountLabel } from "../mail-ui";
import { PrivacyContext } from "../ui/Privacy";
import { activeRecipient, listedRecipients, replaceActiveRecipient } from "./recipients";

// A suggestion bar reveals on click like other privacy bars, but stays out of
// the Tab order because the list closes when the field loses focus.
function Hidden({ value, kind }: { value: string; kind: "name" | "address" }) {
  const { on, revealed, toggle } = useContext(PrivacyContext);
  if (!on || revealed.has(value.toLowerCase())) return <>{value}</>;
  return <span className="address veiled" style={{ width: "8ch" }} title={`Click to reveal ${kind}`}
    onClick={(event) => { event.stopPropagation(); toggle(value.toLowerCase()); }} />;
}

// One recipient field with suggestions for the address after its last comma.
// Typing filters, arrows move, Enter or a click picks, Escape dismisses.
export function RecipientInput({ label, value, onChange, accountId, accounts, api, multiple = false, required = false, disabled = false, autoFocus = false }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  accountId: string;
  accounts: readonly Account[];
  api?: Api;
  multiple?: boolean;
  required?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const { on: privacy } = useContext(PrivacyContext);
  const id = useId();
  const [suggestions, setSuggestions] = useState<ContactSuggestion[]>([]);
  const [active, setActive] = useState(-1);
  const [dismissed, setDismissed] = useState(false);
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; controller: AbortController }>(undefined);
  const cancel = () => {
    if (!pending.current) return;
    clearTimeout(pending.current.timer);
    pending.current.controller.abort();
    pending.current = undefined;
  };
  const close = () => { cancel(); setSuggestions([]); setActive(-1); };
  useEffect(() => cancel, []);
  useEffect(() => { if (disabled) close(); }, [disabled]);
  const open = !disabled && !dismissed && suggestions.length > 0;
  const lookup = (next: string) => {
    cancel();
    setActive(-1);
    setDismissed(false);
    const query = activeRecipient(next);
    if (!api || !query) { setSuggestions([]); return; }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const listed = listedRecipients(next);
      api<ContactSuggestion[]>(`/contacts/suggestions?${new URLSearchParams({ query, accountId })}`, "GET", undefined, controller.signal)
        .then((result) => { if (!controller.signal.aborted) setSuggestions(result.filter((item) => !listed.has(item.email.toLowerCase()))); })
        .catch(() => { if (!controller.signal.aborted) setSuggestions([]); });
    }, 120);
    pending.current = { timer, controller };
  };
  const pick = (suggestion: ContactSuggestion) => {
    close();
    onChange(replaceActiveRecipient(value, suggestion.email));
  };
  const source = (suggestion: ContactSuggestion) => {
    const index = accounts.findIndex((account) => account.id === suggestion.accountId);
    return index < 0 ? "" : accountLabel(accounts[index], index, privacy, accounts);
  };
  const optionLabel = (suggestion: ContactSuggestion) => privacy
    ? `Hidden ${suggestion.kind === "saved" ? "contact" : "recipient"}, ${source(suggestion)}`
    : `${suggestion.kind === "saved" && suggestion.name ? `${suggestion.name} ` : ""}${suggestion.email}, ${source(suggestion)}`;
  return <div className="recipient-field" data-escape-owner={open || undefined}>
    <label>
      <span>{label}</span>
      <input
        type="email"
        multiple={multiple}
        required={required}
        disabled={disabled}
        autoFocus={autoFocus}
        maxLength={10000}
        value={value}
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-activedescendant={open && active >= 0 ? `${id}-${active}` : undefined}
        onChange={(event) => { onChange(event.target.value); lookup(event.target.value); }}
        onBlur={close}
        onKeyDown={(event) => {
          if (!suggestions.length) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setDismissed(false);
            const step = event.key === "ArrowDown" ? 1 : -1;
            setActive((current) => !open || current < 0 ? (step > 0 ? 0 : suggestions.length - 1) : Math.min(suggestions.length - 1, Math.max(0, current + step)));
          } else if (event.key === "Enter" && open && active >= 0) {
            event.preventDefault();
            pick(suggestions[active]);
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            setDismissed(true);
            setActive(-1);
          }
        }}
      />
    </label>
    {open && <ul className="dropdown-menu recipient-suggestions" id={`${id}-list`} role="listbox" aria-label={`${label} suggestions`}>
      {suggestions.map((suggestion, index) => <li key={suggestion.id} id={`${id}-${index}`} role="option"
        aria-selected={index === active} aria-label={optionLabel(suggestion)} className={index === active ? "active" : undefined}
        onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => pick(suggestion)}>
        <span className="recipient-suggestion-person">
          {suggestion.kind === "saved" && suggestion.name && <strong><Hidden value={suggestion.name} kind="name" /></strong>}
          <Hidden value={suggestion.email} kind="address" />
        </span>
        <span className="recipient-suggestion-account">{source(suggestion)}</span>
      </li>)}
    </ul>}
    <span className="visually-hidden" role="status">{open ? `${suggestions.length} ${suggestions.length === 1 ? "suggestion" : "suggestions"}. Use Up and Down to choose, Enter to add.` : ""}</span>
  </div>;
}
