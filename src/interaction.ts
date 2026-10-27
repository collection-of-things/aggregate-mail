export const interactionActions = [
  { id: "next", label: "Next email", key: "j" },
  { id: "previous", label: "Previous email", key: "k" },
  { id: "open", label: "Open email", key: "o" },
  // Ids stay stable so saved shortcuts keep working after Important/Other became Inbox tabs.
  { id: "important", label: "Inbox", key: "i" },
  { id: "other", label: "Next Inbox category", key: "o", shift: true },
  { id: "search", label: "Search", key: "/" },
  { id: "compose", label: "Compose", key: "c" },
  { id: "forwardMail", label: "Forward message", key: "f" },
  { id: "reply", label: "Reply", key: "r" },
  { id: "done", label: "Archive", key: "e" },
  { id: "snooze", label: "Snooze", key: "b" },
  { id: "selectMail", label: "Toggle bulk selection", key: "x" },
  { id: "pin", label: "Pin / unpin email", key: "s" },
  { id: "replyAll", label: "Reply all", key: "a" },
  { id: "unread", label: "Mark as unread", key: "u", shift: true },
  { id: "inbox", label: "Move to Inbox", key: "v" },
  { id: "read", label: "Mark as read", key: "i", shift: true },
  { id: "teach", label: "Teach sorting", key: "m" },
  { id: "density", label: "Comfortable / Compact", key: "d" },
  { id: "privacy", label: "Hide personal information on / off", key: "p" },
  { id: "settings", label: "Settings", key: "," },
  { id: "help", label: "Keyboard shortcuts", key: "?" },
  { id: "back", label: "Back", key: "ArrowLeft", alt: true },
  { id: "forward", label: "Forward", key: "ArrowRight", alt: true },
  { id: "goInbox", label: "Go to Inbox", key: "i", prefix: "g" },
  { id: "goSent", label: "Go to Sent", key: "t", prefix: "g" },
  { id: "goDrafts", label: "Go to Drafts", key: "d", prefix: "g" },
  { id: "goAll", label: "Go to All cached", key: "a", prefix: "g" },
  { id: "goPinned", label: "Go to Pinned", key: "s", prefix: "g" },
  { id: "goSnoozed", label: "Go to Snoozed", key: "b", prefix: "g" },
  { id: "returnToList", label: "Return to email list", key: "u" },
] as const;

export type InteractionAction = (typeof interactionActions)[number]["id"];
export type Shortcut = { key: string; prefix?: string; ctrl?: boolean; meta?: boolean; alt?: boolean; shift?: boolean };
export type InteractionPreferences = {
  opening: "double" | "single";
  mouseHistory: boolean;
  shortcuts: Record<InteractionAction, Shortcut>;
};
export const defaults: InteractionPreferences = {
  opening: "double",
  mouseHistory: true,
  shortcuts: Object.fromEntries(interactionActions.map((action) =>
    [action.id, { key: action.key, alt: "alt" in action && action.alt, shift: "shift" in action && action.shift, ...("prefix" in action ? { prefix: action.prefix } : {}) }])) as InteractionPreferences["shortcuts"],
};
const storageKey = "emc2.interaction.v1";

function canonical(shortcut: Shortcut): Shortcut {
  return { ...(shortcut.prefix ? { prefix: shortcut.prefix.toLowerCase() } : {}), key: shortcut.key.length === 1 ? shortcut.key.toLowerCase() : shortcut.key,
    ctrl: !!shortcut.ctrl, meta: !!shortcut.meta, alt: !!shortcut.alt,
    // Printable symbols already encode Shift in KeyboardEvent.key.
    shift: !!shortcut.shift && (/^[a-z]$/i.test(shortcut.key) || ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter"].includes(shortcut.key)) };
}
function same(a: Shortcut, b: Shortcut) {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
export function shortcutFromEvent(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): Shortcut {
  return canonical({ key: event.key, ctrl: event.ctrlKey, meta: event.metaKey, alt: event.altKey, shift: event.shiftKey });
}
export function shortcutLabel(shortcut: Shortcut): string {
  const binding = canonical(shortcut);
  const key = ({ ArrowLeft: "Left", ArrowRight: "Right", ArrowUp: "Up", ArrowDown: "Down" } as Record<string, string>)[binding.key] ||
    (binding.key.length === 1 ? binding.key.toUpperCase() : binding.key);
  return (binding.prefix ? `${binding.prefix.toUpperCase()} then ` : "") + [binding.ctrl && "Ctrl", binding.meta && "Cmd", binding.alt && "Alt", binding.shift && "Shift", key].filter(Boolean).join("+");
}

export const interactionPlatform = () => typeof window === "undefined" ? "" :
  window.desktop?.platform ?? (/Mac/i.test(window.navigator?.platform ?? "") ? "darwin" : "");

// The platform's primary modifier: the ⌘ symbol on macOS, Ctrl elsewhere.
export const commandModifier = () =>
  interactionPlatform() === "darwin" ? "⌘" : "Ctrl";
export const commandsChord = () => (commandModifier() === "⌘" ? "⌘K" : "Ctrl+K");

export function validateShortcut(action: InteractionAction, shortcut: Shortcut, value: InteractionPreferences): string | null {
  const binding = canonical(shortcut);
  if (binding.prefix && (!/^[a-z]$/.test(binding.prefix) || !/^[a-z]$/.test(binding.key) || binding.ctrl || binding.meta || binding.alt || binding.shift))
    return "Sequences need two letters without modifiers.";
  if (binding.prefix === "t") return "T is reserved as the Teach sorting alias.";
  const navigation = binding.alt && !binding.ctrl && !binding.meta && !binding.shift &&
    ["ArrowLeft", "ArrowRight"].includes(binding.key);
  if (!(/^[a-z0-9,./;\[\]'\\?]$/.test(binding.key) || ["Enter", "ArrowUp", "ArrowDown"].includes(binding.key) || navigation))
    return "Choose a letter, punctuation key, Enter, or an arrow shortcut. Escape and editing keys are reserved.";
  if (binding.ctrl || binding.meta || (binding.alt && !navigation && !binding.shift))
    return "Command, Control, and Alt shortcuts are reserved for the system. Use a single key, Shift combination, or Alt+Left/Right.";
  if (/^[0-9]$/.test(binding.key) && !binding.shift && !binding.alt)
    return "Number keys are reserved for account filters.";
  if (!binding.prefix && binding.key === "t" && !binding.shift && !binding.alt && action !== "teach")
    return "T is reserved as the Teach sorting alias.";
  const conflict = interactionActions.find((other) => other.id !== action && (same(binding, value.shortcuts[other.id]) ||
    !binding.prefix && value.shortcuts[other.id].prefix === binding.key && !binding.shift && !binding.alt ||
    binding.prefix === value.shortcuts[other.id].key && !value.shortcuts[other.id].prefix && !value.shortcuts[other.id].shift && !value.shortcuts[other.id].alt));
  return conflict ? `Already used for ${conflict.label}.` : null;
}

export function read(): InteractionPreferences {
  const fallback = (): InteractionPreferences => structuredClone(defaults);
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(storageKey) || "null");
    if (!stored || typeof stored !== "object") return fallback();
    const input = stored as Record<string, unknown>;
    const value = fallback();
    if (typeof input.mouseHistory === "boolean") value.mouseHistory = input.mouseHistory;
    if (input.opening === "single") value.opening = "single";
    if (!input.shortcuts || typeof input.shortcuts !== "object") return value;
    const bindings = input.shortcuts as Record<string, unknown>;
    for (const { id } of interactionActions) {
      const candidate = bindings[id];
      if (candidate === undefined && ["selectMail", "unread", "inbox", "forwardMail", "pin", "replyAll", "read", "returnToList", "goInbox", "goSent", "goDrafts", "goAll", "goPinned", "goSnoozed"].includes(id)) continue;
      if (!candidate || typeof candidate !== "object") { value.shortcuts = fallback().shortcuts; return value; }
      const fields = candidate as Record<string, unknown>;
      if (typeof fields.key !== "string" || fields.prefix !== undefined && typeof fields.prefix !== "string" || ["ctrl", "meta", "alt", "shift"].some((key) => fields[key] !== undefined && typeof fields[key] !== "boolean")) { value.shortcuts = fallback().shortcuts; return value; }
      value.shortcuts[id] = canonical(candidate as Shortcut);
    }
    // Preserve old bindings, assigning unused keys only to newly introduced actions.
    for (const { id } of interactionActions) {
      if (bindings[id] !== undefined) continue;
      const candidates = [value.shortcuts[id], ..."abcdefghijklmnopqrstuvwxyz".split("").map(key => ({ key, shift: true }))];
      value.shortcuts[id] = candidates.find(candidate => validateShortcut(id, candidate, value) === null)!;
    }
    if (interactionActions.some(({ id }) => validateShortcut(id, value.shortcuts[id], value)))
      value.shortcuts = fallback().shortcuts;
    return value;
  } catch { return fallback(); }
}
export function save(value: InteractionPreferences): boolean {
  if (!["double", "single"].includes(value.opening) || interactionActions.some(({ id }) => validateShortcut(id, value.shortcuts[id], value))) return false;
  try {
    // Serialize only the preference contract, never unrelated object fields.
    localStorage.setItem(storageKey, JSON.stringify({ opening: value.opening, mouseHistory: value.mouseHistory,
      shortcuts: Object.fromEntries(interactionActions.map(({ id }) => [id, canonical(value.shortcuts[id])])) }));
    return true;
  } catch { return false; }
}

export function matches(event: KeyboardEvent, action: InteractionAction, value: InteractionPreferences, platform = "", allowCompose = false, prefix = ""): boolean {
  if (event.defaultPrevented || event.isComposing || event.repeat || event.getModifierState?.("AltGraph")) return false;
  const target = event.target;
  if (target && "closest" in target && typeof target.closest === "function" &&
    (target.closest('input, textarea, select, [role="combobox"], [contenteditable]:not([contenteditable="false"]), [data-interaction-settings]') ||
      target.closest('dialog, [role="dialog"]') && !(allowCompose && target.closest('.compose-dialog')) &&
      !(target.closest('dialog, [role="dialog"]')?.matches('.settings-dialog') && ["search", "privacy", "back", "forward", "settings"].includes(action)))) return false;
  const binding = { ...shortcutFromEvent(event), ...(prefix ? { prefix } : {}) };
  if (same(binding, value.shortcuts[action])) return true;
  if (prefix) return false;
  if (action === "open" && same(value.shortcuts.open, defaults.shortcuts.open) && same(binding, { key: "Enter" }) &&
    !interactionActions.some(other => other.id !== "open" && same(binding, value.shortcuts[other.id]))) return true;
  if (action === "teach" && same(value.shortcuts.teach, defaults.shortcuts.teach) && same(binding, { key: "t" })) return true;
  return platform === "darwin" && (action === "back" || action === "forward") &&
    same(binding, { key: action === "back" ? "[" : "]", meta: true });
}
