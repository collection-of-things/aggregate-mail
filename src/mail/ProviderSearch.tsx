import { useEffect, useRef, useState } from "react";
import type { Account, ProviderSearchResult } from "../../shared/types";
import { providerSearchLimit } from "../../shared/types";
import type { Api } from "../api";
import { providerSearchCoverage } from "../provider-search";

type Run = { key: string } & (
  | { phase: "running" }
  | { phase: "done"; result: ProviderSearchResult }
  | { phase: "failed"; message: string });

// One explicit older-mail search for the selected account. It never runs on
// its own: the button starts it, Cancel aborts it, and a query or account
// change cancels and forgets any run.
export function ProviderSearch({ api, query, account, accountName, blocked, visible, reload }: {
  api: Api;
  query: string;
  account?: Account;
  accountName: string;
  blocked: boolean;
  visible: boolean;
  reload: () => Promise<unknown>;
}) {
  const key = `${account?.id ?? ""}\n${query}`;
  const [run, setRun] = useState<Run>();
  const request = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => request.current?.abort(), [key]);
  if (!visible || !query.trim()) return null;
  const state = run?.key === key ? run : undefined;
  const start = () => {
    if (!account) return;
    const controller = new AbortController();
    request.current = controller;
    setRun({ key, phase: "running" });
    void api<ProviderSearchResult>(`/accounts/${encodeURIComponent(account.id)}/search`, "POST", { query }, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setRun({ key, phase: "done", result });
      // Imported mail otherwise arrives through the desktop mail-changed event.
      if (result.imported > 0 && !window.desktop?.onMailChanged) void reload().catch(() => {});
    }, (error: unknown) => {
      if (controller.signal.aborted) return;
      setRun({ key, phase: "failed", message: error instanceof Error && error.message ? error.message : "Older mail search failed. Cached results are unchanged." });
    });
  };
  if (state?.phase === "running") return <>
    {" · "}<span role="status">Searching {accountName}…</span>
    {" "}<button type="button" onClick={() => { request.current?.abort(); setRun(undefined); }}>Cancel</button>
  </>;
  if (state?.phase === "done") return <>{" · "}<span role="status">{providerSearchCoverage(state.result)}</span></>;
  if (state?.phase === "failed") return <>{" · "}<span role="alert">{state.message}</span></>;
  if (!account) return <span> · Choose an account to search older mail.</span>;
  return <>{" · "}<button type="button" disabled={blocked} title={`Search the account provider for up to ${providerSearchLimit} older matches`} onClick={start}>Search older mail in {accountName}</button></>;
}
