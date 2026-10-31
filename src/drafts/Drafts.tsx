import { useCallback, useEffect, useRef, useState } from "react";
import type { Account, Draft, DraftSummary } from "../../shared/types";
import draftsIcon from "../assets/drafts.png";
import { request } from "../api";
import { Empty, MaskIcon, Page } from "../ui/Page";
import { Tabs } from "../ui/Tabs";
import { useListKeys } from "../ui/listKeys";
import { relative } from "../ui/time";
import { DraftEditor } from "./DraftEditor";

export const accountName = (account: Account) => account.name || account.email;

/**
 * Saved drafts across accounts: breadcrumb, one tab per account, the list and
 * the editor. `newRequest` changes when New Message is pressed; `openRequest`
 * opens a draft made elsewhere, such as a reply.
 */
export function Drafts({ accounts, accountFilter, csrf, signatures, newRequest, openRequest, onChanged }: {
  accounts: Account[];
  accountFilter: string;
  csrf: string;
  signatures: Record<string, string>;
  newRequest: number;
  openRequest: { id: string } | null;
  onChanged: () => void;
}) {
  const [drafts, setDrafts] = useState<DraftSummary[] | null>(null);
  const [tab, setTab] = useState(accountFilter);
  const [openId, setOpenId] = useState<string | null>(openRequest?.id ?? null);
  const [notice, setNotice] = useState<string | null>(null);
  const accountKey = accounts.map((account) => account.id).join(",");

  useEffect(() => setTab(accountFilter), [accountFilter]);
  useEffect(() => { if (openRequest) setOpenId(openRequest.id); }, [openRequest]);

  const load = useCallback(async () => {
    const lists = await Promise.all(accounts.map((account) =>
      request<DraftSummary[]>(`/api/accounts/${encodeURIComponent(account.id)}/drafts`).catch(() => [])));
    setDrafts(lists.flat().sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)));
  }, [accountKey]);
  useEffect(() => { void load(); }, [load, openRequest]);

  // New Message: a new draft in the selected tab's account, or the first account.
  const handled = useRef(newRequest);
  useEffect(() => {
    if (newRequest === handled.current || !accounts.length || !csrf) return;
    handled.current = newRequest;
    const accountId = accounts.some((account) => account.id === tab) ? tab : accounts[0].id;
    request<Draft>(`/api/accounts/${encodeURIComponent(accountId)}/drafts`, { method: "POST", csrf, body: { to: "", subject: "", body: "" } })
      .then(async (draft) => { await load(); onChanged(); setOpenId(draft.id); })
      .catch((error: Error) => setNotice(error.message));
  }, [newRequest, accountKey, csrf]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const all = drafts ?? [];
  const tabs = [
    { id: "all", label: "All", count: all.length },
    ...accounts.map((account) => ({ id: account.id, label: accountName(account), count: all.filter((draft) => draft.accountId === account.id).length })),
  ];
  const shown = tab === "all" ? all : all.filter((draft) => draft.accountId === tab);
  const names = new Map(accounts.map((account) => [account.id, accountName(account)]));
  const open = all.find((draft) => draft.id === openId) ?? null;
  const openAccount = open && accounts.find((account) => account.id === open.accountId);
  useListKeys({ ids: shown.map((draft) => draft.id), openId, onOpen: setOpenId, onClose: () => setOpenId(null) });

  return (
    <Page section="Mail" icon={<MaskIcon src={draftsIcon} className="breadcrumb-icon" />} title="Drafts" notice={notice}>
      <Tabs tabs={tabs} value={tab} onChange={setTab} label="Draft accounts" />
      <div className={open ? "split-body split" : "split-body"}>
        <section className="item-list" aria-label="Drafts">
          {drafts && !shown.length && <Empty title="No drafts">New Message starts one.</Empty>}
          {shown.map((draft) => (
            <button key={draft.id} data-row={draft.id} type="button" className={draft.id === openId ? "item-row selected" : "item-row"} onClick={() => setOpenId(draft.id)}>
              <span className="avatar square" aria-hidden="true">{(draft.to || "?").trim().charAt(0).toUpperCase()}</span>
              <span className="item-text">
                <span className="item-line">{draft.to || "No recipient"}</span>
                <span className="item-title">{draft.subject || "(no subject)"}</span>
                <span className="item-preview">{draft.preview || "No text"}</span>
              </span>
              <span className="item-meta">
                {!open && <span className="tag">{names.get(draft.accountId)}</span>}
                {!!draft.attachmentCount && !open && <span>{draft.attachmentCount} attachment{draft.attachmentCount === 1 ? "" : "s"}</span>}
                {draft.sendUnknown && <span className="warning">Send status unknown</span>}
                <time dateTime={new Date(draft.updatedAt).toISOString()}>{relative(draft.updatedAt)}</time>
              </span>
            </button>
          ))}
        </section>
        {open && openAccount && <>
          <div role="separator" aria-orientation="vertical" className="groove-vertical" />
          <DraftEditor key={open.id} id={open.id} account={openAccount} csrf={csrf} signature={signatures[openAccount.id]?.trim() || undefined}
            onSaved={() => void load()}
            onClose={(message) => { setOpenId(null); if (message) setNotice(message); void load(); onChanged(); }} />
        </>}
      </div>
    </Page>
  );
}
