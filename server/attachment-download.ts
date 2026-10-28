import { canonicalBase64Size } from "./mime-limits.js";
import { isDeepStrictEqual } from "node:util";
import { sameImapAccount } from "./imap-watch.js";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import type { MessageStructureObject } from "imapflow";
import type { gmail_v1 } from "./google-api.js";
import type { Mail, MailAttachment } from "../shared/types.js";
import { ATTACHMENT_BYTES } from "../shared/attachments.js";
import { gmail, gmailMetadataFields, imap, imapOperation } from "./providers.js";
import { type StoredAccount, uploadBytes, eraseUpload, account, get } from "./store.js";
import { storeAttachmentBytes } from "./attachment-bytes.js";

// Gmail attachment responses contain one base64url string. Decode incrementally
// rather than materializing that string and its decoded copy together.
export async function* gmailAttachmentBytes(source: AsyncIterable<Uint8Array>, signal: AbortSignal) {
  let prefix = "", suffix = "", carry = "", state: "prefix" | "data" | "suffix" = "prefix", wire = 0, decoded = 0;
  for await (const chunk of source) {
    signal.throwIfAborted();
    wire += chunk.byteLength;
    if (wire > Math.ceil(ATTACHMENT_BYTES / 3) * 4 + 65536) throw new Error("Attachment response limit exceeded.");
    let text = Buffer.from(chunk).toString("utf8");
    if (state === "prefix") {
      prefix += text;
      const match = /"data"\s*:\s*"/.exec(prefix);
      if (!match) { if (prefix.length > 65536) throw new Error("Invalid attachment response."); continue; }
      text = prefix.slice(match.index + match[0].length);
      prefix = prefix.slice(0, match.index) + '"data":"';
      state = "data";
    }
    if (state === "data") {
      const end = text.indexOf('"');
      const data = end < 0 ? text : text.slice(0, end);
      if (/[^A-Za-z0-9_=-]/.test(data)) throw new Error("Invalid attachment encoding.");
      carry += data;
      const count = end < 0 ? Math.max(0, Math.floor((carry.length - 4) / 4) * 4) : carry.length;
      if (count) {
        const encoded = carry.slice(0, count);
        const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
        const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
        if (canonicalBase64Size(padded) === null || (end < 0 && encoded.includes("="))) throw new Error("Invalid attachment encoding.");
        const bytes = Buffer.from(encoded, "base64url"); decoded += bytes.length;
        if (decoded > ATTACHMENT_BYTES) throw new Error("Attachment byte limit exceeded.");
        yield bytes; carry = carry.slice(count);
      }
      if (end >= 0) { state = "suffix"; text = text.slice(end); } else continue;
    }
    suffix += text;
    if (suffix.length > 65536) throw new Error("Invalid attachment response.");
  }
  signal.throwIfAborted();
  if (state !== "suffix" || carry) throw new Error("Attachment download was interrupted.");
  const metadata = JSON.parse(prefix + suffix) as { size?: unknown; data?: unknown };
  if (metadata.data !== "" || typeof metadata.size !== "number" || metadata.size !== decoded) throw new Error("Invalid attachment response.");
}
export function gmailParts(part: gmail_v1.Schema$MessagePart | undefined): gmail_v1.Schema$MessagePart[] {
  if (!part) return [];
  return [part, ...(part.parts || []).flatMap(child => gmailParts(child))];
}
export function imapParts(part: MessageStructureObject | undefined): MessageStructureObject[] {
  if (!part) return [];
  return [part, ...(part.childNodes || []).flatMap(child => imapParts(child))];
}
function assertDownloadIdentity(a: StoredAccount, mail: Mail) {
  const current = get("mail", mail.id);
  if (!sameImapAccount(account(a.id), a) || !current || current.accountId !== mail.accountId || current.remoteId !== mail.remoteId || current.messageId !== mail.messageId || !isDeepStrictEqual(current.mailbox, mail.mailbox)) throw new Error("Account or email identity changed.");
}
export async function downloadProviderAttachment(a: StoredAccount, mail: Mail, file: MailAttachment, signal: AbortSignal) {
  signal.throwIfAborted();
  assertDownloadIdentity(a, mail);
  if (!file.sizeIsEstimate && file.size > ATTACHMENT_BYTES) throw new Error("Download supports attachments up to 25 MiB.");
  let source: AsyncIterable<Uint8Array>;
  let close = () => {};
  if (a.provider === "gmail") {
    const api = gmail(a);
    const result = await api.users.messages.get({ userId: "me", id: mail.remoteId, format: "full", fields: gmailMetadataFields },
      { timeout: 30000, retry: false, maxContentLength: 2 * 1024 * 1024, signal });
    const messageId = result.data.payload?.headers?.find(h => h.name?.toLowerCase() === "message-id")?.value;
    if (result.data.id !== mail.remoteId || (mail.messageId && messageId !== mail.messageId)) throw new Error("Email identity changed.");
    const matches = gmailParts(result.data.payload).filter(p => p.body?.attachmentId && p.filename?.replace(/[\u0000-\u001f\u007f/\\]/g, "_").slice(0, 255) === file.filename && p.body.size === file.size && (!file.remotePart || p.body.attachmentId === file.remotePart));
    if (matches.length !== 1) throw new Error("Attachment part identity is ambiguous. Sync before downloading.");
    assertDownloadIdentity(a, mail);
    const response = await api.users.messages.attachments.get({ userId: "me", messageId: mail.remoteId, id: matches[0].body!.attachmentId! },
      { responseType: "stream", timeout: 60000, retry: false, signal });
    const body = response.data as unknown as Readable;
    close = () => body.destroy();
    source = gmailAttachmentBytes(body, signal);
  } else {
    const ids = /^(\d+):(\d+)$/.exec(mail.mailbox ? `${mail.mailbox.uidValidity}:${mail.mailbox.uid}` : mail.remoteId);
    if (!ids || (mail.archived && !mail.mailbox)) throw new Error("Mailbox identity unavailable. Sync before downloading.");
    const client = imap(a);
    close = () => client.close();
    const abort = () => client.close();
    signal.addEventListener("abort", abort, { once: true });
    try {
      await imapOperation(client, () => client.connect());
      await imapOperation(client, () => client.mailboxOpen(mail.mailbox?.path || "INBOX", { readOnly: true }));
      if (!client.mailbox || String(client.mailbox.uidValidity) !== ids[1]) throw new Error("Mailbox identifiers changed. Sync before downloading.");
      const result = await imapOperation(client, () => client.fetchOne(ids[2], { uid: true, envelope: true, bodyStructure: true }, { uid: true }));
      if (!result || result.uid !== Number(ids[2]) || (mail.messageId && result.envelope?.messageId !== mail.messageId)) throw new Error("Email identity changed.");
      const parts = imapParts(result.bodyStructure).filter(p => p.part && (p.dispositionParameters?.filename || p.parameters?.name)?.replace(/[\u0000-\u001f\u007f/\\]/g, "_").slice(0, 255) === file.filename && (!file.remotePart || p.part === file.remotePart));
      if (parts.length !== 1) throw new Error("Attachment part identity is ambiguous. Sync before downloading.");
      assertDownloadIdentity(a, mail);
      const download = await imapOperation(client, () => client.download(ids[2], parts[0].part, { uid: true, maxBytes: ATTACHMENT_BYTES + 1, chunkSize: 65536 }));
      source = download.content;
      close = () => { download.content.destroy(); client.close(); signal.removeEventListener("abort", abort); };
    } catch (error) { client.close(); signal.removeEventListener("abort", abort); throw error; }
  }
  const abort = () => close();
  signal.addEventListener("abort", abort, { once: true });
  let saved: Awaited<ReturnType<typeof storeAttachmentBytes>> | undefined;
  try {
    saved = await storeAttachmentBytes(a.id, file.filename, file.contentType, source, signal);
    if (!file.sizeIsEstimate && saved.size !== file.size) throw new Error("Attachment size changed.");
    if (file.sourceIndex !== undefined) {
      const hash = createHash("sha256").update(`${a.id}:${mail.remoteId}:${file.sourceIndex}:`);
      for await (const bytes of uploadBytes(saved.id)) hash.update(bytes);
      if (hash.digest("hex") !== file.id) throw new Error("Attachment identity changed.");
    }
    return saved;
  } catch (error) { if (saved) eraseUpload(saved.id); throw error; }
  finally { signal.removeEventListener("abort", abort); close(); }
}
