import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { isDeepStrictEqual } from "node:util";
import express from "express";
import { z } from "zod";
import { publicUnsubscribeAddress, unsubscribeSchema, unsubscribeUrl, type UnsubscribeAction } from "../shared/unsubscribe.js";
import { get } from "./store.js";
import { createDraft } from "./drafts.js";
import { trackMailWork } from "./mail-actions.js";

type Address = { address: string; family: number };
type Dependencies = {
  resolve: (host: string) => Promise<Address[]>;
  post: (url: URL, address: Address, signal: AbortSignal) => Promise<number>;
};
const body = "List-Unsubscribe=One-Click";
export const unsubscribePost: Dependencies["post"] = (url, address, signal) => new Promise((resolve, reject) => {
  // The hostname stays intact for TLS certificate verification and SNI. No DNS
  // resolution is repeated between the public-address check and the connection.
  const outgoing = request(url, {
    method: "POST", agent: false, family: address.family, signal, timeout: 5000, maxHeaderSize: 8192,
    lookup: (_host, _options, callback) => callback(null, address.address, address.family),
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(body) },
  }, response => {
    const status = response.statusCode || 0;
    // Response bodies and Set-Cookie are unused; redirects are never followed.
    response.destroy();
    resolve(status);
  });
  outgoing.on("error", reject);
  outgoing.on("timeout", () => outgoing.destroy(new Error("Unsubscribe timeout")));
  outgoing.end(body);
});

export class UnsubscribeError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export function unsubscribeService(dependencies: Dependencies = {
  resolve: host => lookup(host, { all: true, verbatim: true }), post: unsubscribePost,
}) {
  return async (action: UnsubscribeAction) => {
    if (action.kind === "mailto") return;
    const url = unsubscribeUrl(action.url);
    if (!url) throw new UnsubscribeError(400, "Unsubscribe requires a public HTTPS destination on port 443 without credentials or a fragment.");
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const signal = AbortSignal.timeout(5000);
    let onAbort: (() => void) | undefined;
    try {
      const addresses = await Promise.race([
        isIP(host) ? Promise.resolve([{ address: host, family: isIP(host) }]) : dependencies.resolve(host),
        new Promise<never>((_resolve, reject) => {
          onAbort = () => reject(new Error("Unsubscribe timeout"));
          signal.addEventListener("abort", onAbort, { once: true });
        }),
      ]);
      if (!addresses.length || addresses.some(address => !isIP(address.address) || !publicUnsubscribeAddress(address.address)))
        throw new UnsubscribeError(400, "Unsubscribe refused: this destination resolves to a private, local or reserved network.");
      if (action.kind === "post") {
        const status = await dependencies.post(url, addresses[0], signal);
        if (status < 200 || status >= 300)
          throw new UnsubscribeError(502, "The unsubscribe service did not confirm success. Redirects are refused. Check with the sender before trying again.");
      }
    } catch (error) {
      if (error instanceof UnsubscribeError) throw error;
      throw new UnsubscribeError(502, "The unsubscribe result could not be confirmed. Check with the sender before trying again; the request may have arrived.");
    } finally { if (onAbort) signal.removeEventListener("abort", onAbort); }
  };
}

const confirmedSchema = z.object({ confirmed: z.literal(true), expected: unsubscribeSchema }).strict();
export function mountUnsubscribe(app: express.Express, perform = unsubscribeService()) {
  const pending = new Set<string>();
  app.post<{ id: string }>("/api/messages/:id/unsubscribe", async (req, res) => {
    const parsed = confirmedSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Review and confirm the unsubscribe destination first." });
    const mail = get("mail", req.params.id);
    if (!mail || !get("account", mail.accountId)) return res.status(404).json({ error: "Email or account no longer available." });
    const saved = unsubscribeSchema.safeParse(mail.unsubscribe);
    if (!saved.success || saved.data.kind === "blocked" || !isDeepStrictEqual(saved.data, parsed.data.expected))
      return res.status(409).json({ error: "The unsubscribe details changed or are unavailable. Reopen the email to review them." });
    if (pending.has(mail.id)) return res.status(409).json({ error: "An unsubscribe action is already in progress for this email." });
    const action = saved.data;
    pending.add(mail.id);
    try {
      const result = await trackMailWork(async () => {
        await perform(action);
        // Account removal or sync must not change the reviewed target mid-flight.
        if (!get("account", mail.accountId) || !isDeepStrictEqual(get("mail", mail.id)?.unsubscribe, action))
          throw new UnsubscribeError(409, "The email changed during this action. Check the result before trying again.");
        if (action.kind === "mailto") return { kind: "draft", draft: createDraft(mail.accountId, {
          to: [action.address], subject: action.subject, body: action.body,
        }) };
        return action.kind === "link" ? { kind: "link", url: action.url } : { kind: "sent" };
      });
      res.json(result);
    } catch (error) {
      res.status(error instanceof UnsubscribeError ? error.status : 400).json({ error: error instanceof UnsubscribeError ? error.message : "Unsubscribe could not be completed. Reopen the email and review before trying again." });
    } finally { pending.delete(mail.id); }
  });
}
