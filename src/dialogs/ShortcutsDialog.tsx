import { interactionActions, interactionPlatform } from "../interaction";
import { Dialog } from "../ui/Dialog";

/** The current keyboard shortcuts, including the fixed ones that cannot be edited. */
export function ShortcutsDialog({ shortcut, onClose }: {
  shortcut: (action: (typeof interactionActions)[number]["id"]) => string;
  onClose: () => void;
}) {
  return (
    <Dialog title="Keyboard shortcuts" onClose={onClose}>
      <div className="shortcut-list">
        {[...interactionActions.map(({ id, label }) => [shortcut(id), label]),
          ["Enter", "Open email (with default opening shortcut)"],
          ["Esc", "Close email or dialog"], ["Tab", "Move focus (body: next Inbox category)"],
          ["F6 / Shift+F6", "Next / previous window region"],
          ["0–9", "Filter by account"],
          ["↑ / ↓", "Select previous / next email in the list"],
          [interactionPlatform() === "darwin" ? "Cmd+K" : "Ctrl+K", "Commands"],
          ["Ctrl/Cmd + / − / 0", "Larger / smaller / reset text"],
          ["Page Up / Page Down", "Previous / next email"],
          ...(interactionPlatform() === "darwin" ? [["Cmd+[ / Cmd+]", "Back / Forward"]] : []),
        ].map(([key, text]) => (
          <div key={key}>
            <span>{text}</span>
            <kbd>{key}</kbd>
          </div>
        ))}
      </div>
      <p className="note">Customize keys, two-letter sequences, opening mode and mouse history in Settings, Keyboard and mouse. Sequences must finish within 1.5 seconds. Editing fields and dialogs keep their own keys.</p>
      <h2>Mouse controls</h2>
      <p className="note">Click selects an email; double-click opens it by default. Settings, Keyboard and mouse can enable single-click opening. Right-click an email for actions. Hover or focus a row to show its action buttons. Mouse side buttons go Back and Forward.</p>
    </Dialog>
  );
}
