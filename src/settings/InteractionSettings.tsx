import { Segmented } from "../ui/Segmented";
import { useId, useState } from "react";
import { defaults, interactionActions, shortcutFromEvent, shortcutLabel, validateShortcut, type InteractionPreferences } from "../interaction";

const shortcutGroupNames = ["Navigation", "Mail actions", "App"] as const;
function shortcutGroup(id: string) {
  if (id.startsWith("go") || ["next", "previous", "open", "important", "other", "search", "back", "forward", "returnToList"].includes(id)) return "Navigation";
  if (["compose", "reply", "done", "snooze", "teach", "pin", "read", "unread", "inbox", "replyAll"].includes(id)) return "Mail actions";
  return "App";
}

export function InteractionSettings({ value, onChange }: {
  value: InteractionPreferences;
  onChange: (value: InteractionPreferences) => void;
}) {
  const prefix = useId();
  const [error, setError] = useState("");
  const [sequence, setSequence] = useState<{ id: string; first?: string } | null>(null);
  return <section data-interaction-settings aria-label="Interaction settings">
    <div className="settings-row interaction-opening">
      <div>
        <span id={`${prefix}-opening`}>Open email</span>
        <p className="note">{value.opening === "double"
          ? "Select with one click. Open with two."
          : "One click opens email and marks it read."}</p>
      </div>
      <Segmented labelledBy={`${prefix}-opening`} value={value.opening}
        choices={[{ id: "double", label: "Double click" }, { id: "single", label: "Single click" }]}
        onChange={(opening) => onChange({ ...value, opening })} />
    </div>
    <label className="settings-row"><span>Mouse side buttons navigate Back / Forward</span>
      <input type="checkbox" role="switch" checked={value.mouseHistory} onChange={event => onChange({ ...value, mouseHistory: event.target.checked })} />
    </label>
    <p className="note">Right-click an email for actions. When enabled, mouse side buttons go Back and Forward.</p>
    <div className="interaction-shortcuts-heading">
      <h2>Keyboard shortcuts</h2>
      <button type="button" className="link" onClick={() => { setError(""); onChange(structuredClone(defaults)); }}>Reset interaction defaults</button>
    </div>
    <p className="note" id={`${prefix}-hint`}>Focus a shortcut and press a key combination. Escape closes settings. Tab moves focus. Editing and system shortcuts stay reserved.</p>
    <p className="attention" role="status" aria-live="polite">{error}</p>
    <div className="interaction-shortcut-groups">
      {shortcutGroupNames.map((group) => <section className="interaction-shortcut-group" key={group} aria-label={group}>
        <h3>{group}</h3>
        {interactionActions.filter(({ id }) => shortcutGroup(id) === group).map(({ id, label }) => <div className="settings-row" key={id}>
          <label htmlFor={`${prefix}-${id}`}>{label}</label>
          <div className="shortcut-capture"><input id={`${prefix}-${id}`} type="text" readOnly value={sequence?.id === id ? sequence.first ? `${sequence.first.toUpperCase()} then …` : "Press two letters…" : shortcutLabel(value.shortcuts[id])}
            style={{ width: `calc(${sequence?.id === id ? 14 : shortcutLabel(value.shortcuts[id]).length}ch + 20px)` }}
          aria-describedby={`${prefix}-hint`} onKeyDown={(event) => {
            if (event.key === "Escape") { setSequence(null); return; }
            event.stopPropagation();
            if (event.key === "Tab") { setSequence(null); return; }
            if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
            if (event.ctrlKey || event.metaKey || event.nativeEvent.isComposing || event.repeat) return;
            event.preventDefault();
            let shortcut = shortcutFromEvent(event.nativeEvent);
            if (sequence?.id === id) {
              if (!/^[a-z]$/i.test(event.key) || event.shiftKey || event.altKey) { setError("Sequences need two letters without modifiers."); return; }
              if (!sequence.first) { setSequence({ id, first: event.key.toLowerCase() }); return; }
              shortcut = { ...shortcut, prefix: sequence.first };
              setSequence(null);
            }
            const problem = validateShortcut(id, shortcut, value);
            setError(problem || "");
            if (!problem) onChange({ ...value, shortcuts: { ...value.shortcuts, [id]: shortcut } });
          }} onBlur={() => setSequence(null)} />
        <button type="button" className="button" aria-label={`Record sequence for ${label}`} onClick={() => {
          setError(""); setSequence({ id }); document.getElementById(`${prefix}-${id}`)?.focus();
        }}>Sequence</button></div>
        </div>)}
      </section>)}
    </div>
    <p className="note">Gmail defaults: G then I/T/D/A/S/B opens Inbox/Sent/Drafts/All cached/Pinned/Snoozed. U returns to the list. Choose Sequence and press two letters to customize a sequence. Sequences must finish within 1.5 seconds during use.</p>
    <details className="interaction-fixed-shortcuts">
      <summary>System and fixed shortcuts</summary>
      <p className="note">Fixed shortcuts: Ctrl/Cmd +, − and 0 resize or reset text. Page Up/Down selects the previous/next email. Enter also opens with the default O binding. Escape closes email or dialogs; Tab moves focus (on the page body, the next Inbox category); 0-9 filters accounts. On Mac, Cmd+[ and Cmd+] go Back and Forward.</p>
    </details>
  </section>;
}
