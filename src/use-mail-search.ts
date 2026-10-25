import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Account, MailSearchResult, RendererMail } from "../shared/types";
import { compileMailSearch } from "./mail-search";
import type { Api } from "./api";

export const MailSearchApiContext = createContext<Api | undefined>(undefined);

export function useMailSearch(query: string, accounts: Account[], messages: RendererMail[], explicitApi?: Api) {
  const contextApi = useContext(MailSearchApiContext);
  const api = explicitApi ?? contextApi;
  const compiled = useMemo(() => compileMailSearch(query, accounts), [query, accounts]);
  const summaryMatches = useMemo(() => new Map(messages.flatMap(mail => "body" in mail || !query.trim() ? [] :
    [[JSON.stringify([mail.accountId, mail.id, mail.contentVersion]), compiled.matchesSummary(mail)] as const])), [messages, query, compiled]);
  const remote = [...summaryMatches.values()].some(match => match === undefined);
  const identity = useMemo(() => remote ? JSON.stringify([accounts.map(a => [a.id, a.email, a.name]),
    messages.map(mail => [mail.id, mail.accountId, "contentVersion" in mail ? mail.contentVersion : null, mail.unread, mail.pinned])]) : "", [remote, accounts, messages]);
  const key = useMemo(() => JSON.stringify([query, identity]), [query, identity]);
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
  const matches = useCallback((mail: RendererMail) => {
    if (!query.trim()) return true;
    if (compiled.error) return false;
    if ("body" in mail) return compiled.matches(mail);
    const identity = JSON.stringify([mail.accountId, mail.id, mail.contentVersion]);
    const known = summaryMatches.get(identity);
    if (known !== undefined) return known;
    return result?.key === key && result.matches.has(identity);
  }, [query, compiled, result, key, summaryMatches]);
  return {
    error: compiled.error || (remote && result?.key === key ? result.error : undefined),
    pending: remote && !compiled.error && result?.key !== key,
    matches,
  };
}
