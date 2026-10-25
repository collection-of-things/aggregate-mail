import { useLayoutEffect, useRef, useState } from "react";
import { composeLink, composeMarkup, plainComposeHtml } from "../../shared/compose-content";
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
  const editor = useRef<HTMLDivElement>(null), plain = useRef<HTMLTextAreaElement>(null);
  const emitted = useRef<string | undefined>(undefined);
  const pending = useRef<{ command: Command; value?: string; start: number; end: number } | undefined>(undefined);
  const selection = useRef<Range | undefined>(undefined);
  const [error, setError] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const linkSelection = useRef({ start: 0, end: 0 });
  const cancelLink = () => { setLink(null); setError(""); (editor.current || plain.current)?.focus(); };
  const remember = () => {
    const range = window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0) : undefined;
    if (range && editor.current?.contains(range.commonAncestorContainer)) selection.current = range.cloneRange();
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
    const node = editor.current;
    if (!node || draft.html === undefined) return;
    if (emitted.current !== draft.html) {
      node.innerHTML = composeMarkup(draft.html).html;
      emitted.current = draft.html;
      selection.current = undefined;
    }
    const action = pending.current;
    if (!action) return;
    pending.current = undefined;
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
    const range = document.createRange(); range.setStart(...point(action.start)); range.setEnd(...point(action.end));
    selection.current = range; execute(action.command, action.value);
  }, [draft.html]);
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
    <div className="compose-format-tools" role="group" aria-label="Message formatting">
      {commands.map(({ label, text, command }) => <button key={command} type="button" aria-label={label} title={label}
        disabled={disabled} onMouseDown={event => { event.preventDefault(); remember(); }} onClick={() => format(command)}>{text}</button>)}
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
    {draft.html === undefined ? <textarea ref={plain} className="compose-body" aria-label="Message body" placeholder="Write your message"
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
    {error && <p className="compose-format-error" role="alert">{error}</p>}
  </>;
}
