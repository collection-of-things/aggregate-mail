import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Account, DraftSummary, MailSearchResult, RendererMail } from "../shared/types";
import { compileMailSearch } from "./mail-search";
import type { Api } from "./api";

export const MailSearchApiContext = createContext<Api | undefined>(undefined);
const noDrafts: DraftSummary[] = [];

export function useMailSearch(query: string, accounts: Account[], messages: RendererMail[], explicitApi?: Api, draftToken?: string) {
  const contextApi = useContext(MailSearchApiContext);
  const api = explicitApi ?? contextApi;
  const accountKey = JSON.stringify(accounts.map(a => [a.id, a.email, a.name]));
  // Polls and unrelated component renders can supply equivalent array objects.
  const exact = useMemo(() => compileMailSearch(query, accounts), [query, accountKey]);
  const typo = useMemo(() => compileMailSearch(query, accounts, { typos: true }), [query, accountKey]);
  const remote = Boolean(query.trim()) && Boolean(api);
  const identity = useMemo(() => JSON.stringify(messages.map(mail =>
    [mail.id, mail.accountId, "contentVersion" in mail ? mail.contentVersion : mail, mail.unread, mail.pinned])), [messages]);
  // Keep the large source identity out of per-keystroke serialization.
  const key = useMemo(() => ({ query, accountKey, identity, draftToken }), [query, accountKey, identity, draftToken]);
  const [result, setResult] = useState<{ key: typeof key; matches: Set<string>; drafts: DraftSummary[]; error?: string; typos?: boolean }>();
  const current = result?.key === key ? result : undefined;
  // The service falls back to close spellings only when no exact match exists.
  // Flag, version or draft changes refetch; keep the last decision for the same
  // query meanwhile so fallback rows do not vanish while a message is opened.
  const typos = result?.key.query === query && result.key.accountKey === accountKey && result.typos === true;
  const compiled = typos ? typo : exact;
  const summaryMatches = useMemo(() => new Map(messages.flatMap(mail => "body" in mail || !query.trim() ? [] :
    [[JSON.stringify([mail.accountId, mail.id, mail.contentVersion]), compiled.matchesSummary(mail)] as const])), [identity, query, compiled]);
  const [attempt, setAttempt] = useState(0);
  const refresh = useCallback(() => setAttempt(value => value + 1), []);
  useEffect(() => {
    if (!remote || exact.error || !api) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void api<MailSearchResult>(`/messages/search?query=${encodeURIComponent(query)}`, "GET", undefined, controller.signal).then(value => {
        if (controller.signal.aborted) return;
        if (draftToken !== undefined && value.draftToken !== draftToken) {
          setResult({ key, matches: new Set(), drafts: noDrafts, error: "Saved drafts changed. Refresh the cache to search again." });
          return;
        }
        setResult({ key, error: value.error, typos: value.typos === true,
          matches: new Set(value.matches.filter(mail => mail.kind === "mail").map(mail => JSON.stringify([mail.accountId, mail.id, mail.contentVersion]))),
          drafts: value.matches.filter(draft => draft.kind === "draft").filter(draft => accounts.some(account => account.id === draft.accountId))
            .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)),
        });
      }).catch(() => {
        if (!controller.signal.aborted) setResult({ key, error: "Cached mail and draft search is unavailable. Refresh or change the search to try again.", matches: new Set(), drafts: noDrafts });
      });
    }, 120);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [key, remote, exact.error, api, attempt]);
  const matches = useCallback((mail: RendererMail) => {
    if (!query.trim()) return true;
    if (compiled.error) return false;
    if ("body" in mail) return compiled.matches(mail);
    const identity = JSON.stringify([mail.accountId, mail.id, mail.contentVersion]);
    const known = summaryMatches.get(identity);
    if (known !== undefined) return known;
    return result?.key === key && result.matches.has(identity);
  }, [query, compiled, result, key, summaryMatches]);
  const error = compiled.error || (remote ? current?.error : undefined);
  const pending = remote && !compiled.error && !current;
  const drafts = current?.drafts ?? noDrafts;
  return useMemo(() => ({ error, pending, matches, drafts, refresh, typos }), [error, pending, matches, drafts, refresh, typos]);
}
