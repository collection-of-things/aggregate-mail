import { Segmented } from "../ui/Segmented";
import { useId, useState } from "react";
import { defaults, interactionActions, shortcutFromEvent, shortcutLabel, validateShortcut, type InteractionPreferences } from "../interaction";

const shortcutGroupNames = ["Navigation", "Mail actions", "App"] as const;
function shortcutGroup(id: string) {
  if (["next", "previous", "open", "important", "other", "search", "back", "forward"].includes(id)) return "Navigation";
  if (["compose", "reply", "done", "snooze", "teach"].includes(id)) return "Mail actions";
  return "App";
}

export function InteractionSettings({ value, onChange }: {
  value: InteractionPreferences;
  onChange: (value: InteractionPreferences) => void;
}) {
  const prefix = useId();
  const [error, setError] = useState("");
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
          <input id={`${prefix}-${id}`} type="text" readOnly value={shortcutLabel(value.shortcuts[id])}
            style={{ width: `calc(${shortcutLabel(value.shortcuts[id]).length}ch + 20px)` }}
            aria-describedby={`${prefix}-hint`} onKeyDown={(event) => {
              if (event.key === "Escape") return;
              event.stopPropagation();
              if (event.key === "Tab") return;
              if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
              if (event.ctrlKey || event.metaKey || event.nativeEvent.isComposing || event.repeat) return;
              event.preventDefault();
              const shortcut = shortcutFromEvent(event.nativeEvent);
              const problem = validateShortcut(id, shortcut, value);
              setError(problem || "");
              if (!problem) onChange({ ...value, shortcuts: { ...value.shortcuts, [id]: shortcut } });
            }} />
        </div>)}
      </section>)}
    </div>
    <details className="interaction-fixed-shortcuts">
      <summary>System and fixed shortcuts</summary>
      <p className="note">Fixed shortcuts: Ctrl/Cmd +, − and 0 resize or reset text. Page Up/Down selects the previous/next email. Escape closes email or dialogs; Tab moves to the next Inbox category; 0-9 filters accounts. On Mac, Cmd+[ and Cmd+] go Back and Forward.</p>
    </details>
  </section>;
}
