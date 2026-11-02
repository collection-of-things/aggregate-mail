import { Notice, useFeedbackState } from "../ui/Toasts";
import { useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { composeLink, composeMarkup, plainComposeHtml } from "../../shared/compose-content";
import { PrivacyContext } from "../ui/Privacy";
import type { Compose } from "./draft-session";

type Command = "bold" | "italic" | "underline" | "createLink" | "insertUnorderedList" | "insertOrderedList" | "formatBlock";
// A selection endpoint as a child-index chain from the editor root to the
// range container, plus the range offset inside it.
type Bookmark = { path: number[]; offset: number };
// A node position as a child-index chain from a root element.
const pathOf = (container: Node, root: Node): number[] => {
  const path: number[] = [];
  for (let item = container; item !== root; item = item.parentNode!)
    path.unshift(Array.from(item.parentNode!.childNodes).indexOf(item as ChildNode));
  return path;
};
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
  const editor = useRef<HTMLDivElement>(null), plain = useRef<HTMLTextAreaElement>(null), scope = useRef<HTMLDivElement>(null), veil = useRef<HTMLDivElement>(null);
  const { on: privacy } = useContext(PrivacyContext);
  const [revealed, setRevealed] = useState(false);
  // Under privacy an unfocused non-empty body is a veil: no draft text or
  // markup stays in the DOM. Focus anywhere inside the editor scope — the
  // format tools, link controls or the editor itself — reveals it; focus
  // leaving the whole scope hides it again. An empty draft keeps its normal
  // placeholder.
  const hidden = Boolean(privacy && !revealed && (draft.body || draft.html));
  // Caret/selection saved while the editor is still mounted so a later reveal
  // can restore it after repaint. A plain draft stores textarea offsets; a
  // rich draft stores a DOM path of child indices from the editor root plus
  // the offset in that container, so paragraph and inline-format boundaries
  // stay distinct across the repaint.
  const veiledSelection = useRef<{ start: number; end: number } | { start: Bookmark; end: Bookmark } | undefined>(undefined);
  // Whether the current reveal came through the veil itself; the new editor
  // may already hold focus by the time the reveal effect runs.
  const veilFocus = useRef(false);
  const emitted = useRef<string | undefined>(undefined);
  const pending = useRef<{ command: Command; value?: string; start: number; end: number } | undefined>(undefined);
  const selection = useRef<Range | undefined>(undefined);
  const [error, setError] = useFeedbackState();
  const [link, setLink] = useState<string | null>(null);
  // An entered address is private regardless of the body: it veils whenever
  // privacy is on and focus left the scope, so even an empty draft hides it.
  const linkHidden = Boolean(privacy && !revealed && link);
  // A privacy-on re-veil moves focus to the new veil so it does not drop to
  // the page; suppressReveal keeps that programmatic focus from re-revealing.
  const refocusVeil = useRef(false), suppressReveal = useRef(false);
  const linkSelection = useRef({ start: 0, end: 0 });
  const cancelLink = () => { setLink(null); setError(""); (editor.current || plain.current)?.focus(); };
  const remember = () => {
    const range = window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0) : undefined;
    if (range && editor.current?.contains(range.commonAncestorContainer)) selection.current = range.cloneRange();
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
    // The reveal repaints draft.html, not the live structure: publish leaves
    // live nodes alone, so adjacent text nodes, newlines and stripped spans
    // can shift child indices. Marker characters moved through the same
    // publish pipeline locate the selection inside the canonical structure
    // the repaint rebuilds; when the canonical structure no longer matches
    // draft.html, or a marker was stripped, the live path is the fallback.
    const bookmark = (container: Node, offset: number): Bookmark => ({ path: pathOf(container, node), offset });
    veiledSelection.current = canonicalBookmark(node, range) || {
      start: bookmark(range.startContainer, range.startOffset), end: bookmark(range.endContainer, range.endOffset),
    };
  };
  // Private-use markers placed at the live selection endpoints inside a clone,
  // carried through publish's sanitizer and located in the canonical result.
  // The markers never reach the live editor or the draft.
  const canonicalBookmark = (node: HTMLElement, range: Range): { start: Bookmark; end: Bookmark } | undefined => {
    const START = "\uE000", END = "\uE001";
    try {
      const clone = node.cloneNode(true) as HTMLElement;
      const clonePoint = (container: Node, offset: number): [Node, number] => {
        let item: Node = clone;
        for (const index of pathOf(container, node)) item = item.childNodes[index];
        return [item, offset];
      };
      const start = clonePoint(range.startContainer, range.startOffset);
      const end = clonePoint(range.endContainer, range.endOffset);
      const insert = ([container, offset]: [Node, number], mark: string) => {
        const at = document.createRange(); at.setStart(container, offset); at.collapse(true);
        at.insertNode(document.createTextNode(mark));
      };
      if (!range.collapsed) insert(end, END);
      insert(start, START);
      const reparsed = document.createElement("div");
      reparsed.innerHTML = composeMarkup(clone.innerHTML).html;
      let startMark: { node: Text; index: number } | undefined, endMark: { node: Text; index: number } | undefined;
      const walker = document.createTreeWalker(reparsed, 4);
      let item: Node | null;
      while ((item = walker.nextNode()) && !(startMark && endMark)) {
        const data = item.textContent || "";
        const atStart = data.indexOf(START), atEnd = data.indexOf(END);
        if (!startMark && atStart !== -1) startMark = { node: item as Text, index: atStart };
        if (!endMark && atEnd !== -1) endMark = { node: item as Text, index: atEnd };
      }
      if (!startMark || (!range.collapsed && !endMark)) return undefined;
      // Resolve each marker to its position after stripping; a marker earlier
      // in the same text node shifts a later offset left.
      const position = (mark: { node: Text; index: number }, earlier?: { node: Text; index: number }) => {
        let offset = mark.index;
        if (earlier && earlier.node === mark.node && earlier.index < mark.index) offset--;
        return { node: mark.node, offset };
      };
      const startPoint = position(startMark);
      const endPoint = range.collapsed ? startPoint : position(endMark!, startMark);
      for (const mark of [startMark, endMark]) if (mark) mark.node.data = mark.node.data.replace(/[\uE000\uE001]/g, "");
      const place = ({ node: target, offset }: { node: Text; offset: number }): Bookmark | undefined => {
        if (target.data === "") {
          const parent = target.parentNode;
          if (!parent) return undefined;
          const index = Array.from(parent.childNodes).indexOf(target as ChildNode);
          parent.removeChild(target);
          return { path: pathOf(parent, reparsed), offset: index };
        }
        return { path: pathOf(target, reparsed), offset };
      };
      const startBookmark = place(startPoint);
      if (!startBookmark) return undefined;
      const endBookmark = place(endPoint) || startBookmark;
      // The canonical structure must match what the reveal repaints; a draft
      // that drifted since publish (publish had not run yet) keeps the
      // live-path bookmark.
      const reference = document.createElement("div");
      reference.innerHTML = composeMarkup(draft.html || "").html;
      if (reparsed.innerHTML !== reference.innerHTML) return undefined;
      return { start: startBookmark, end: endBookmark };
    } catch { return undefined; }
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
        if (saved && plain.current && typeof saved.start === "number" && typeof saved.end === "number")
          plain.current.setSelectionRange(saved.start, saved.end);
      }
      // A rich caret restores in the repaint effect below once it runs.
      if (!fromVeil || plain.current) veiledSelection.current = undefined;
    }
    if (hidden && refocusVeil.current) {
      refocusVeil.current = false;
      suppressReveal.current = true;
      veil.current?.focus();
      suppressReveal.current = false;
    }
  }, [hidden, privacy, revealed]);
  // Turning privacy on re-veils even while the scope is focused; the live
  // selection is saved first so a later reveal restores the real caret.
  useEffect(() => {
    if (privacy) {
      refocusVeil.current = Boolean((draft.body || draft.html) && scope.current?.contains(document.activeElement));
      saveSelection(); setRevealed(false);
    }
  }, [privacy]);
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
    // A veil reveal puts the saved caret back once the repaint has run. If the
    // draft drifted while veiled and a path no longer resolves, the caret
    // falls back to the end of the editor rather than throwing.
    const saved = veiledSelection.current;
    if (saved) {
      veiledSelection.current = undefined;
      const walk = ({ path, offset }: Bookmark): [Node, number] | undefined => {
        let item: Node = node;
        for (const index of path) {
          const child = item.childNodes[index];
          if (!child) return undefined;
          item = child;
        }
        const limit = item.nodeType === 3 || item.nodeType === 4 ? (item.textContent?.length || 0) : item.childNodes.length;
        if (offset > limit) return undefined;
        return [item, offset];
      };
      const start = typeof saved.start === "number" ? point(saved.start) : walk(saved.start);
      const end = typeof saved.end === "number" ? point(saved.end) : walk(saved.end);
      const range = document.createRange();
      if (start && end) { range.setStart(...start); range.setEnd(...end); }
      else { range.selectNodeContents(node); range.collapse(false); }
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
      onFocus={() => { if (!disabled && !suppressReveal.current) setRevealed(true); else suppressReveal.current = false; }}
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
        <input autoFocus type="url" aria-label="Link address" placeholder={linkHidden ? "Hidden. Focus to edit." : "https://example.com"} value={linkHidden ? "" : link} data-private-field={privacy || undefined} disabled={disabled}
          onChange={event => setLink(event.target.value)} onKeyDown={event => {
            if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); format("createLink", link); }
          }} />
        <button type="button" disabled={disabled} onClick={() => format("createLink", link)}>Add link</button>
        <button type="button" onClick={cancelLink}>Cancel link</button>
      </div>}
      {hidden ? <div ref={veil} className="compose-body compose-veiled-body" role="textbox" aria-label="Message body" aria-multiline="true"
          aria-readonly="true" data-private-field tabIndex={disabled ? -1 : 0}
          onFocus={() => { if (!disabled && !suppressReveal.current) { veilFocus.current = true; setRevealed(true); } }}
          onClick={() => { if (!disabled) { veilFocus.current = true; setRevealed(true); } }}
          onKeyDown={event => { if (!disabled && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); veilFocus.current = true; setRevealed(true); } }}>Hidden. Focus to edit.</div> :
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
