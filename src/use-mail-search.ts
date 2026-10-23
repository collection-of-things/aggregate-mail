import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Account, MailSearchResult, RendererMail } from "../shared/types";
import { compileMailSearch } from "./mail-search";
import type { Api } from "./api";

export const MailSearchApiContext = createContext<Api | undefined>(undefined);

export function useMailSearch(query: string, accounts: Account[], messages: RendererMail[], explicitApi?: Api) {
  const contextApi = useContext(MailSearchApiContext);
  const api = explicitApi ?? contextApi;
  const compiled = useMemo(() => compileMailSearch(query, accounts), [query, accounts]);
  const remote = Boolean(query.trim()) && messages.some(mail => !("body" in mail));
  const key = useMemo(() => JSON.stringify([query, accounts.map(a => [a.id, a.email, a.name]),
    messages.map(mail => [mail.id, mail.accountId, "contentVersion" in mail ? mail.contentVersion : null, mail.unread, mail.pinned])]), [query, accounts, messages]);
  const [result, setResult] = useState<{ key: string; matches: Set<string>; error?: string }>();
  useEffect(() => {
    if (!remote || compiled.error || !api) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void api<MailSearchResult>(`/messages/search?query=${encodeURIComponent(query)}`, "GET", undefined, controller.signal).then(value => {
        if (controller.signal.aborted) return;
        setResult({ key, error: value.error, matches: new Set(value.matches.map(mail => JSON.stringify([mail.accountId, mail.id, mail.contentVersion]))) });
      }).catch(() => {
        if (!controller.signal.aborted) setResult({ key, error: "Cached mail search is unavailable. Change the search to try again.", matches: new Set() });
      });
    }, 120);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [key, remote, compiled.error, api]);
  return {
    error: compiled.error || (remote && result?.key === key ? result.error : undefined),
    pending: remote && !compiled.error && result?.key !== key,
    matches: (mail: RendererMail) => {
      if (!query.trim()) return true;
      if (compiled.error) return false;
      if ("body" in mail) return compiled.matches(mail);
      return result?.key === key && result.matches.has(JSON.stringify([mail.accountId, mail.id, mail.contentVersion]));
    },
  };
}
