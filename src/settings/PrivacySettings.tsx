import { useContext, useMemo, useState, type FormEvent } from "react";
import type { Api, Perform } from "../api";
import type { RendererState as State } from "../../shared/types";
import {
  PRIVACY_WORDS_HIDDEN_MAX, PRIVACY_WORDS_VISIBLE_MAX, PRIVACY_WORD_LENGTH_MAX,
  emptyPrivacyWords, learnedOwnerNames, type PrivacyWords,
} from "../privacy";
import { Address, PrivacyContext } from "../ui/Privacy";

// Owner-chosen lists for personal-information hiding. Hidden names stay
// masked (click to reveal) while privacy is on; visible names are businesses.
export function PrivacySettings({ state, api, perform, busy }: { state: State; api: Api; perform: Perform; busy: boolean }) {
  const words = state.privacyWords ?? emptyPrivacyWords;
  const { on: privacy } = useContext(PrivacyContext);
  const learned = useMemo(() => learnedOwnerNames(state.accounts, state.messages), [state.accounts, state.messages]);
  const lower = (values: readonly string[]) => new Set(values.map((value) => value.toLowerCase()));
  const hiddenSet = lower(words.hidden), visibleSet = lower(words.visible);
  const save = (next: PrivacyWords) => perform(() => api("/privacy-words", "PUT", next));
  const name = (value: string) => privacy ? <Address value={value} kind="name">{value}</Address> : <>{value}</>;
  return <section className="privacy-words">
    <p className="note">When personal information is hidden, Emc² hides email addresses, US postal addresses,
      your names and the names of people you write with. Business senders whose name matches their own
      domain stay visible. Use these lists to correct either side.</p>

    <h2>Always hide</h2>
    <WordForm label="Name or word to hide" action="Hide" busy={busy || words.hidden.length >= PRIVACY_WORDS_HIDDEN_MAX}
      onAdd={(value) => save({ hidden: [...words.hidden, value], visible: words.visible.filter((item) => item.toLowerCase() !== value.toLowerCase()) })} />
    {words.hidden.length ? <ul className="settings-group privacy-word-list" aria-label="Always hidden">{words.hidden.map((value) =>
      <li className="rule-row" key={value}><div><p>{name(value)}</p></div>
        <button type="button" className="link" disabled={busy} aria-label={privacy ? "Stop hiding this name" : `Stop hiding ${value}`}
          onClick={() => void save({ ...words, hidden: words.hidden.filter((item) => item !== value) })}>Remove</button></li>)}
    </ul> : <p className="note">No names added.</p>}

    <h2>Never hide</h2>
    <WordForm label="Business or word to keep visible" action="Keep visible" busy={busy || words.visible.length >= PRIVACY_WORDS_VISIBLE_MAX}
      onAdd={(value) => save({ hidden: words.hidden.filter((item) => item.toLowerCase() !== value.toLowerCase()), visible: [...words.visible, value] })} />
    {words.visible.length ? <ul className="settings-group privacy-word-list" aria-label="Never hidden">{words.visible.map((value) =>
      <li className="rule-row" key={value}><div><p>{value}</p></div>
        <button type="button" className="link" disabled={busy} aria-label={`Hide ${value} again`}
          onClick={() => void save({ ...words, visible: words.visible.filter((item) => item !== value) })}>Remove</button></li>)}
    </ul> : <p className="note">No names kept visible.</p>}

    <h2>Learned from your mail</h2>
    <p className="note">Your names from To and Cc headers and from mail you sent. They are hidden automatically.</p>
    {learned.length ? <ul className="settings-group privacy-word-list" aria-label="Learned names">{learned.map((value) =>
      <li className="rule-row" key={value}><div><p>{name(value)}</p></div>
        {visibleSet.has(value.toLowerCase()) ? <span>Kept visible</span> :
          <button type="button" className="link" disabled={busy || words.visible.length >= PRIVACY_WORDS_VISIBLE_MAX}
            aria-label={privacy ? "Keep this name visible" : `Keep ${value} visible`}
            onClick={() => void save({ hidden: words.hidden.filter((item) => item.toLowerCase() !== value.toLowerCase()), visible: [...words.visible, value] })}>Keep visible</button>}
      </li>)}
    </ul> : <p className="note">No names learned yet.</p>}
    {hiddenSet.size >= PRIVACY_WORDS_HIDDEN_MAX && <p className="note">The hidden list is full ({PRIVACY_WORDS_HIDDEN_MAX} names).</p>}
  </section>;
}

function WordForm({ label, action, busy, onAdd }: { label: string; action: string; busy: boolean; onAdd: (value: string) => void }) {
  const [value, setValue] = useState("");
  const clean = value.trim().replace(/\s+/g, " ");
  const valid = !!clean && /\p{L}/u.test(clean);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid || busy) return;
    onAdd(clean);
    setValue("");
  };
  return <form className="settings-row privacy-word-form" onSubmit={submit}>
    <label>{label}<input value={value} maxLength={PRIVACY_WORD_LENGTH_MAX} autoComplete="off" spellCheck={false}
      data-private-field onChange={(event) => setValue(event.target.value)} /></label>
    <button type="submit" className="button" disabled={busy || !valid}>{action}</button>
  </form>;
}
