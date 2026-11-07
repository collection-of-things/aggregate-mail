import { useRef, useState } from "react";
import type { MailIdentity } from "../../shared/bulk-mail";
import { selectionKey } from "./bulk-selection";

// Provider waits belong to their message, not the foreground editor or page.
export function useMailMutations() {
  const active = useRef(new Map<string, string>());
  const [, changed] = useState(0);
  const has = (mail: MailIdentity) => active.current.has(selectionKey(mail));
  const hasAccount = (accountId: string) => [...active.current.values()].includes(accountId);
  const run = async (mail: MailIdentity, task: () => Promise<void>) => {
    const key = selectionKey(mail);
    if (active.current.has(key)) return;
    active.current.set(key, mail.accountId); changed(value => value + 1);
    try { await task(); }
    finally { active.current.delete(key); changed(value => value + 1); }
  };
  return { pending: active.current.size > 0, has, hasAccount, run };
}
