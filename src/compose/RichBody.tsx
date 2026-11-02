import { Notice, useFeedbackState } from "../ui/Toasts";
import { useContext, useLayoutEffect, useRef, useState } from "react";
import { composeLink, composeMarkup, plainComposeHtml } from "../../shared/compose-content";
import { PrivacyContext } from "../ui/Privacy";
import type { Compose } from "./draft-session";

type Command = "bold" | "italic" | "underline" | "createLink" | "insertUnorderedList" | "insertOrderedList" | "formatBlock";
const commands: { label: string; text: string; command: Command }[] = [
  { label: "Bold", text: "B", command: "bold" },
  { label: "Italic", text: "I", command: "italic" },
  { label: "Underline", text: "U", command: "underline" },
  { label: "Insert link", text: "Link", command: "createLink" },
  { label: "Bullet list", text: "• List", command: "insertUnorderedList" },
  { label: "Numbered list", text: "1. List", command: "insertOrderedList" },
  { label: "Quote", text: "Quote", command: "formatBlock" },
];
export function RichBody({ draft, disabled, onChange }: { draft: Compose; disabled: boolean; onChange: (draft: Compose) => void }) {
  const editor = useRef<HTMLDivElement>(null), plain = useRef<HTMLTextAreaElement>(null), scope = useRef<HTMLDivElement>(null);
  const { on: privacy } = useContext(PrivacyContext);
  const [revealed, setRevealed] = useState(false);
  // Under privacy an unfocused non-empty body is a veil: no draft text or
  // markup stays in the DOM. Focus anywhere inside the editor scope — the
  // format tools, link controls or the editor itself — reveals it; focus
  // leaving the whole scope hides it again. An empty draft keeps its normal
  // placeholder.
  const hidden = Boolean(privacy && !revealed && (draft.body || draft.html));
  // Caret/selection in the shared text-node+BR offset scheme, saved while the
  // editor is still mounted so a later reveal can restore it after repaint.
  const veiledSelection = useRef<{ start: number; end: number } | undefined>(undefined);
  // Whether the current reveal came through the veil itself; the new editor
  // may already hold focus by the time the reveal effect runs.
  const veilFocus = useRef(false);
  const emitted = useRef<string | undefined>(undefined);
  const pending = useRef<{ command: Command; value?: string; start: number; end: number } | undefined>(undefined);
  const selection = useRef<Range | undefined>(undefined);
  const [error, setError] = useFeedbackState();
  const [link, setLink] = useState<string | null>(null);
  const linkSelection = useRef({ start: 0, end: 0 });
  const cancelLink = () => { setLink(null); setError(""); (editor.current || plain.current)?.focus(); };
  const remember = () => {
    const range = window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0) : undefined;
    if (range && editor.current?.contains(range.commonAncestorContainer)) selection.current = range.cloneRange();
  };
  // Inverse of `point` in the repaint effect: a logical offset counts every
  // text-node character and each BR inside the editor. `index` is a text
  // offset for CharacterData or a child index for element containers.
  const offsetAt = (container: Node, index: number): number => {
    const root = editor.current;
    if (!root || !root.contains(container)) return 0;
    const probe = document.createRange();
    try { probe.setStart(container, index); probe.collapse(true); } catch { return 0; }
    let at = 0;
    const walker = document.createTreeWalker(root, 4 | 1);
    let item: Node | null;
    while ((item = walker.nextNode())) {
      if (item.nodeType === 3) {
        const length = item.textContent?.length || 0;
        if (probe.comparePoint(item, length) === -1) { at += length; continue; }
        let inside = 0;
        while (inside < length && probe.comparePoint(item, inside) === -1) inside++;
        return at + inside;
      }
      if ((item as Element).tagName === "BR") {
        const parent = item.parentNode!;
        if (probe.comparePoint(parent, Array.from(parent.childNodes).indexOf(item as ChildNode)) === -1) { at += 1; continue; }
        return at;
      }
    }
    return at;
  };
  const saveSelection = () => {
    if (plain.current) {
      veiledSelection.current = { start: plain.current.selectionStart || 0, end: plain.current.selectionEnd || 0 };
      return;
    }
    const node = editor.current;
    if (!node) return;
    const live = window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0) : undefined;
    const range = selection.current && node.contains(selection.current.commonAncestorContainer) ? selection.current
      : live && node.contains(live.commonAncestorContainer) ? live : undefined;
    if (!range) return;
    veiledSelection.current = { start: offsetAt(range.startContainer, range.startOffset), end: offsetAt(range.endContainer, range.endOffset) };
  };
  const publish = () => {
    if (!editor.current) return;
    try {
      const content = composeMarkup(editor.current.innerHTML);
      emitted.current = content.html;
      onChange({ ...draft, ...content });
      setError("");
    } catch {
      editor.current.innerHTML = emitted.current || draft.html || "";
      setError("Formatting limit reached. Your last saved text is retained. Shorten the message before continuing.");
    }
  };
  const execute = (command: Command, value?: string) => {
    if (!editor.current) return;
    editor.current.focus();
    if (selection.current && editor.current.contains(selection.current.commonAncestorContainer)) {
      const current = window.getSelection(); current?.removeAllRanges(); current?.addRange(selection.current);
    }
    // Electron's editing commands preserve native undo history. Paste is plain
    // text and persisted HTML is separately validated by the shared serializer.
    try {
      document.execCommand("styleWithCSS", false, "false");
      if (!document.execCommand(command, false, value)) throw new Error();
      remember(); publish();
    } catch { setError("This formatting action is unavailable. Your message is still here."); }
  };
  useLayoutEffect(() => {
    if (hidden) {
      // The editors remount empty after a veil; repaint from the draft then.
      emitted.current = undefined;
      selection.current = undefined;
    } else if (privacy && revealed) {
      const fromVeil = veilFocus.current;
      veilFocus.current = false;
      if (fromVeil) {
        // The veil held focus when it unmounted; the real editor takes it
        // back, with a plain caret put back at its saved offsets.
        (editor.current || plain.current)?.focus();
        const saved = veiledSelection.current;
        if (saved && plain.current) plain.current.setSelectionRange(saved.start, saved.end);
      }
      // A rich caret restores in the repaint effect below once it runs.
      if (!fromVeil || plain.current) veiledSelection.current = undefined;
    }
  }, [hidden, privacy, revealed]);
  useLayoutEffect(() => {
    const node = editor.current;
    if (!node || draft.html === undefined) return;
    if (emitted.current !== draft.html) {
      node.innerHTML = composeMarkup(draft.html).html;
      emitted.current = draft.html;
      selection.current = undefined;
    }
    // Initial plain mode contains only text and br nodes, so offsets map without
    // interpreting HTML or replacing the recipient/body selection on each save.
    const point = (offset: number): [Node, number] => {
      const walker = document.createTreeWalker(node, 4 | 1);
      let item: Node | null;
      while ((item = walker.nextNode())) {
        if (item.nodeType === 3) {
          const length = item.textContent?.length || 0;
          if (offset <= length) return [item, offset];
          offset -= length;
        } else if ((item as Element).tagName === "BR") {
          if (offset === 0) return [item.parentNode!, Array.from(item.parentNode!.childNodes).indexOf(item as ChildNode)];
          offset--;
        }
      }
      return [node, node.childNodes.length];
    };
    const action = pending.current;
    if (action) {
      pending.current = undefined;
      const range = document.createRange(); range.setStart(...point(action.start)); range.setEnd(...point(action.end));
      selection.current = range; execute(action.command, action.value);
      return;
    }
    // A veil reveal puts the saved caret back once the repaint has run.
    const saved = veiledSelection.current;
    if (saved) {
      veiledSelection.current = undefined;
      const range = document.createRange(); range.setStart(...point(saved.start)); range.setEnd(...point(saved.end));
      selection.current = range.cloneRange();
      const current = window.getSelection(); current?.removeAllRanges(); current?.addRange(range);
    }
  }, [draft.html, hidden]);
  const format = (command: Command, linkValue?: string) => {
    if (disabled) return;
    if (typeof document.execCommand !== "function" || typeof document.queryCommandSupported !== "function" || !document.queryCommandSupported(command)) {
      setError("Formatting is unavailable here. Your plain-text message is unchanged."); return;
    }
    let value: string | undefined;
    if (command === "createLink") {
      if (linkValue === undefined) {
        linkSelection.current = { start: plain.current?.selectionStart || 0, end: plain.current?.selectionEnd || 0 };
        remember(); setLink(""); setError(""); return;
      }
      value = composeLink(linkValue.trim());
      if (!value) { setError("Enter a valid web or email link without credentials."); return; }
      setLink(null);
    }
    if (command === "formatBlock") value = "blockquote";
    if (draft.html === undefined) {
      const node = plain.current;
      pending.current = { command, value, ...(command === "createLink" ? linkSelection.current : { start: node?.selectionStart || 0, end: node?.selectionEnd || 0 }) };
      try { onChange({ ...draft, ...composeMarkup(plainComposeHtml(draft.body)) }); }
      catch { pending.current = undefined; setError("This message is too large for formatting. Your plain text is unchanged."); }
    } else execute(command, value);
  };
  const shortcut = (event: React.KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && !event.altKey && ["b", "i", "u"].includes(event.key.toLowerCase())) {
      event.preventDefault(); format(({ b: "bold", i: "italic", u: "underline" } as const)[event.key.toLowerCase() as "b" | "i" | "u"]);
    }
  };
  return <>
    <div ref={scope} className="compose-body-scope"
      onFocus={() => { if (!disabled) setRevealed(true); }}
      onBlur={(event) => {
        // Focus moving to another scope child keeps the body revealed; focus
        // leaving the scope (or going nowhere) hides it again.
        const next = event.relatedTarget;
        if (next && scope.current?.contains(next as Node)) return;
        if (privacy) saveSelection();
        setRevealed(false);
      }}>
      <div className="compose-format-tools" role="group" aria-label="Message formatting">
        {commands.map(({ label, text, command }) => <button key={command} type="button" aria-label={label} title={label}
          disabled={disabled || hidden} onMouseDown={event => { event.preventDefault(); remember(); }} onClick={() => format(command)}>{text}</button>)}
      </div>
      {link !== null && <div className="compose-link-controls" role="group" aria-label="Insert link" data-escape-owner
        onKeyDown={event => {
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancelLink(); }
        }}>
        <input autoFocus type="url" aria-label="Link address" placeholder="https://example.com" value={link} disabled={disabled}
          onChange={event => setLink(event.target.value)} onKeyDown={event => {
            if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); format("createLink", link); }
          }} />
        <button type="button" disabled={disabled} onClick={() => format("createLink", link)}>Add link</button>
        <button type="button" onClick={cancelLink}>Cancel link</button>
      </div>}
      {hidden ? <div className="compose-body compose-veiled-body" role="textbox" aria-label="Message body" aria-multiline="true"
          aria-readonly="true" data-private-field tabIndex={disabled ? -1 : 0}
          onFocus={() => { if (!disabled) { veilFocus.current = true; setRevealed(true); } }}
          onClick={() => { if (!disabled) { veilFocus.current = true; setRevealed(true); } }}>Hidden. Focus to edit.</div> :
        draft.html === undefined ? <textarea ref={plain} className="compose-body" aria-label="Message body" placeholder="Write your message"
        required disabled={disabled} onKeyDown={shortcut} maxLength={1000000} value={draft.body} onChange={event => onChange({ ...draft, body: event.target.value })} /> :
        <div ref={editor} className="compose-body compose-rich-body" role="textbox" aria-label="Message body" aria-multiline="true" aria-required="true"
          aria-disabled={disabled} tabIndex={disabled ? -1 : 0} contentEditable={!disabled} suppressContentEditableWarning
          onInput={publish} onKeyUp={remember} onMouseUp={remember} onBlur={remember}
          onClick={event => { if ((event.target as Element).closest("a")) event.preventDefault(); }}
          onPaste={event => {
            event.preventDefault();
            if (disabled) return;
            try {
              if (!document.execCommand("insertText", false, event.clipboardData.getData("text/plain"))) throw new Error();
              publish();
            } catch { setError("Paste is unavailable. Your message is unchanged."); }
          }}
          onDrop={event => event.preventDefault()}
          onKeyDown={shortcut} />}
    </div>
    {error && <Notice text={error} />}
  </>;
}
