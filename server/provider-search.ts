import type express from "express";
import { z } from "zod";
import { providerSearchPlan } from "../shared/mail-search.js";
import { providerSearchLimit, type Mail, type ProviderSearchResult } from "../shared/types.js";
import { account, all, get, mailSummaryChanges, putBatch } from "./store.js";
import { providers } from "./providers.js";
import { runMailWork, trackMailWork } from "./mail-actions.js";
import { sameImapAccount } from "./imap-watch.js";
import { sortMail } from "./sorting.js";

// Search one account's provider beyond the cache and import uncached matches
// into the encrypted store. Reading never changes mailbox state. Cancelling
// stops further provider requests and imports nothing.
export async function searchProviderMail({ accountId, query, signal }: { accountId: string; query: string; signal: AbortSignal }): Promise<ProviderSearchResult> {
  const plan = providerSearchPlan(query);
  if ("error" in plan) throw new Error(plan.error);
  const a = account(accountId);
  const cached = (await mailSummaryChanges(undefined, undefined, signal)).messages.filter((mail) => mail.accountId === a.id);
  const ids = new Set(cached.map((mail) => mail.id));
  const messageIds = new Set(cached.flatMap((mail) => mail.messageId ? [mail.messageId] : []));
  try {
    const found = await providers[a.provider].search(a, plan, {
      limit: providerSearchLimit, signal,
      known: (id, messageId) => ids.has(id) || (!!messageId && messageIds.has(messageId)),
    });
    const imported = await runMailWork(async () => {
      signal.throwIfAborted();
      if (!all("account").some((current) => sameImapAccount(current, a)))
        throw new Error("Account changed during search. Nothing was imported.");
      const rules = all("rule");
      // A sync that cached the same email meanwhile keeps its own record.
      const fresh: [string, Mail][] = found.messages.filter((mail) => !get("mail", mail.id)).map((mail) => [mail.id, {
        ...mail, ...sortMail(mail, rules), archived: !mail.labelIds?.includes("INBOX"), snoozedUntil: null,
      }]);
      putBatch("mail", fresh);
      return fresh.length;
    });
    return { accountId: a.id, source: a.provider === "gmail" ? "gmail" : "imap", limit: providerSearchLimit, examined: found.examined,
      imported, complete: found.complete, ...(found.mailboxes ? { mailboxes: found.mailboxes } : {}), narrowed: found.narrowed };
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    throw error;
  }
}

export function mountProviderSearch(app: express.Express, onChanged: () => void) {
  // Inherits the /api session, origin, CSRF, update and sync guards.
  app.post("/api/accounts/:id/search", (req, res, next) => {
    const { query } = z.object({ query: z.string().max(8192) }).strict().parse(req.body);
    const controller = new AbortController();
    const cancel = () => controller.abort();
    res.once("close", cancel);
    void trackMailWork(() => searchProviderMail({ accountId: req.params.id, query, signal: controller.signal }))
      .then((result) => {
        if (result.imported) onChanged();
        if (!res.destroyed) res.json(result);
      }, (error) => { if (!controller.signal.aborted) next(error); })
      .finally(() => res.off("close", cancel));
  });
}
