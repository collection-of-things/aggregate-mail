import { changeComposeText } from "../../shared/compose-content";
import { useContext, useState } from "react";
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
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const template = preferences.templates.find((item) => item.id === selected);
  if (!preferences.templates.length) return null;
  return <div className="compose-preference-controls">
    <label>Template
      <select value={template ? selected : ""} disabled={busy} onChange={(event) => setSelected(event.target.value)}>
        <option value="">Choose template</option>
        {preferences.templates.map((item, index) => <option key={item.id} value={item.id}>
          {privacy ? `Template ${index + 1}` : item.name}
        </option>)}
      </select>
    </label>
    <button className="button" type="button" disabled={busy || !template}
      onClick={() => {
        if (!template) return;
        try { onChange(insertComposeTemplate(draft, template, preferences)); setError(""); }
        catch { setError("Unable to insert this template without changing your message. Your current text is unchanged."); }
      }}>Insert template</button>
    <p className="note">Adds text to your message. The subject is filled only when empty.</p>
    {error && <p role="alert">{error}</p>}
  </div>;
}
