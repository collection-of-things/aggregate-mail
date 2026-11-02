import type { RendererMail as Mail } from "../../shared/types";
import type { Commitment } from "../../shared/workspace";

// Emails a commitment cites: its source (matched by id and account), its
// evidence and every history entry's evidence, which keeps removed evidence.
export function commitmentMails(item: Pick<Commitment, "sourceMailId" | "accountId" | "evidenceMailIds"> & { history?: readonly { evidenceMailIds?: readonly string[] }[] }, messages: readonly Mail[]): Mail[] {
  const source = messages.find((mail) => mail.id === item.sourceMailId && mail.accountId === item.accountId);
  const ids = new Set(item.evidenceMailIds);
  for (const change of item.history || []) for (const id of change.evidenceMailIds ?? []) ids.add(id);
  const evidence = [...ids].filter((id) => id !== item.sourceMailId)
    .map((id) => messages.find((mail) => mail.id === id));
  return [source, ...evidence].filter((mail): mail is Mail => !!mail);
}
