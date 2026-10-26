import { changeComposeText } from "../../shared/compose-content";
import { useContext, useEffect, useId, useRef, useState } from "react";
import type { ComposePreferences, ComposeTemplate } from "../../shared/mail-features";
import { PrivacyContext } from "../ui/Privacy";
import type { Compose } from "./ComposePanel";

const signatureSuffix = (signature: string) => signature ? `\n\n-- \n${signature}` : "";

export function initialCompose(accountId: string, preferences: ComposePreferences, overrides: Partial<Compose> = {}): Compose {
  const draft = { accountId, to: "", subject: "", body: "", ...overrides };
  const suffix = signatureSuffix(preferences.signatures[draft.accountId] || "");
  return { ...draft, ...changeComposeText(draft, draft.body + (suffix && !draft.body.endsWith(suffix) ? suffix : "")) };
}

export function changeComposeAccount(draft: Compose, accountId: string, preferences: ComposePreferences): Compose {
  if (accountId === draft.accountId) return draft;
  const previous = signatureSuffix(preferences.signatures[draft.accountId] || "");
  const next = signatureSuffix(preferences.signatures[accountId] || "");
  const body = previous
    ? draft.body.endsWith(previous) ? draft.body.slice(0, -previous.length) + next : draft.body
    : draft.body + (next && !draft.body.endsWith(next) ? next : "");
  return { ...draft, accountId, ...changeComposeText(draft, body), threadId: undefined };
}

export function insertComposeTemplate(draft: Compose, template: ComposeTemplate, preferences: ComposePreferences): Compose {
  const suffix = signatureSuffix(preferences.signatures[draft.accountId] || "");
  const hasSignature = !!suffix && draft.body.endsWith(suffix);
  const body = hasSignature ? draft.body.slice(0, -suffix.length) : draft.body;
  return {
    ...draft,
    subject: draft.subject || template.subject,
    ...changeComposeText(draft, body + (body && template.body ? "\n\n" : "") + template.body + (hasSignature ? suffix : "")),
  };
}

export function ComposePreferenceControls({ draft, preferences, busy, onChange }: {
  draft: Compose;
  preferences: ComposePreferences;
  busy: boolean;
  onChange: (draft: Compose) => void;
}) {
  const { on: privacy } = useContext(PrivacyContext);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { if (busy) setOpen(false); }, [busy]);
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", away);
    return () => window.removeEventListener("mousedown", away);
  }, [open]);
  if (!preferences.templates.length) return null;
  const needle = query.trim().toLocaleLowerCase();
  const matches = preferences.templates.filter((item) => !needle
    || `${item.name}\n${item.subject}\n${item.body}`.toLocaleLowerCase().includes(needle));
  const active = matches.find((item) => item.id === selected) ?? matches[0];
  const optionId = (item: ComposeTemplate) => `${id}-${preferences.templates.indexOf(item)}`;
  // The message body is the editing target; Escape and insertion return focus
  // there so the user can keep typing.
  const editor = () => root.current?.closest('[role="dialog"]')?.querySelector<HTMLElement>('[aria-label="Message body"]');
  const insert = (template: ComposeTemplate | undefined) => {
    if (!template) return;
    try {
      onChange(insertComposeTemplate(draft, template, preferences));
      setError(""); setOpen(false); setQuery(""); setSelected("");
      editor()?.focus();
    } catch { setError("Unable to insert this template without changing your message. Your current text is unchanged."); }
  };
  return <div className="compose-preference-controls" ref={root} data-escape-owner={open || undefined}
    onKeyDown={(event) => {
      if (event.key !== "Escape" || !open || event.nativeEvent.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      editor()?.focus();
    }}>
    <div className="compose-template-picker">
      <label>Template
        <input role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded={open}
          aria-controls={open ? `${id}-list` : undefined}
          aria-activedescendant={open && active ? optionId(active) : undefined}
          placeholder="Search templates…" value={query} disabled={busy}
          onFocus={() => setOpen(true)}
          onChange={(event) => { setQuery(event.target.value); setSelected(""); setOpen(true); }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Tab") { setOpen(false); return; }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
              if (!matches.length) return;
              const index = active ? matches.indexOf(active) : 0;
              const next = matches[(index + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length];
              setSelected(next.id);
              document.getElementById(optionId(next))?.scrollIntoView?.({ block: "nearest" });
            } else if (event.key === "Enter") {
              event.preventDefault();
              if (open) insert(active);
            }
          }} />
      </label>
      {open && <div className="compose-template-menu">
        <ul id={`${id}-list`} role="listbox" aria-label="Templates">
          {matches.map((item) => <li key={item.id} id={optionId(item)} role="option" aria-selected={active?.id === item.id}
            onMouseDown={(event) => event.preventDefault()} onMouseMove={() => setSelected(item.id)}
            onClick={() => insert(item)}>
            {privacy ? `Template ${preferences.templates.indexOf(item) + 1}` : item.name}
          </li>)}
        </ul>
        {!matches.length && <p role="status">No matching templates</p>}
      </div>}
    </div>
    <button className="button" type="button" disabled={busy || !active}
      onClick={() => insert(active)}>Insert template</button>
    <p className="note">Adds text to your message. The subject is filled only when empty.</p>
    {error && <p role="alert">{error}</p>}
  </div>;
}
