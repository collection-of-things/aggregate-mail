import { useEffect, useState } from "react";
import type { Mail, MailBodyResponse, RendererMail } from "../shared/types";
import type { Api } from "./api";

export function replySource(messages: RendererMail[], draft: { accountId: string; inReplyTo?: string }): RendererMail | undefined {
  if (!draft.inReplyTo) return undefined;
  const matches = messages.filter(mail => mail.accountId === draft.accountId && mail.messageId === draft.inReplyTo);
  return matches.length === 1 ? matches[0] : undefined;
}

export function mailBodyKey(mail: RendererMail | undefined): string {
  return mail ? JSON.stringify([mail.accountId, mail.id, mail.remoteId, mail.messageId, "contentVersion" in mail ? mail.contentVersion : mail]) : "";
}

// One opening owns one body. Closing, replacing or changing its version drops it.
export function useMailBody(mail: RendererMail | undefined, api: Api) {
  const key = mailBodyKey(mail);
  const [loaded, setLoaded] = useState<{ key: string; mail?: Mail; error?: string }>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setLoaded(undefined);
    if (!mail || "body" in mail) return;
    const controller = new AbortController();
    void api<MailBodyResponse>(`/messages/${encodeURIComponent(mail.id)}/body?accountId=${encodeURIComponent(mail.accountId)}&contentVersion=${encodeURIComponent(mail.contentVersion)}`,
      "GET", undefined, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      if (result.contentVersion !== mail.contentVersion || result.mail.id !== mail.id || result.mail.accountId !== mail.accountId ||
        result.mail.remoteId !== mail.remoteId || result.mail.messageId !== mail.messageId || typeof result.mail.body !== "string") throw Error("Email identity changed");
      setLoaded({ key, mail: result.mail });
    }).catch(() => {
      if (!controller.signal.aborted) setLoaded({ key, error: "Cached email content is unavailable. Reload or try again." });
    });
    return () => controller.abort();
  }, [key, api, attempt]);
  return {
    mail: mail && "body" in mail ? mail : loaded?.key === key ? loaded.mail : undefined,
    error: loaded?.key === key ? loaded.error : undefined,
    retry: () => setAttempt(value => value + 1),
  };
}
