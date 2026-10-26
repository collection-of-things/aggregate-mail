import { Readable } from "node:stream";
import { ATTACHMENT_BYTES } from "../shared/attachments.js";
import type { DraftAttachment } from "../shared/types.js";
import { workLimit } from "./resource-limits.js";

export class AttachmentPreflightError extends Error {}

// Reject concurrent byte-heavy work rather than retaining queued request bodies.
export const attachmentWork = workLimit(1, 0);
export async function storeAttachmentBytes(accountId: string, filename: string, contentType: string, source: AsyncIterable<Uint8Array>, signal: AbortSignal, limit = ATTACHMENT_BYTES) {
  const { beginUpload, appendUpload, finishUpload, eraseUpload, get, put, transaction } = await import("./store.js");
  signal.throwIfAborted();
  const id = beginUpload(accountId, filename, contentType, limit);
  let size = 0, seq = 0, used = 0, persisted = 0;
  const batch = Buffer.allocUnsafe(1024 * 1024);
  const flush = () => {
    if (!used) return;
    transaction(() => {
      for (let offset = 0; offset < used; offset += 65536) appendUpload(id, seq++, batch.subarray(offset, Math.min(used, offset + 65536)));
      persisted += used;
      put("upload", id, { ...get("upload", id)!, size: persisted });
    });
    used = 0;
  };
  try {
    for await (const value of source) {
      signal.throwIfAborted();
      size += value.byteLength;
      if (size > limit) throw new Error("Attachment byte limit exceeded.");
      const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
      for (let offset = 0; offset < bytes.length;) {
        const count = Math.min(batch.length - used, bytes.length - offset);
        bytes.copy(batch, used, offset, offset + count); used += count; offset += count;
        if (used === batch.length) flush();
      }
    }
    signal.throwIfAborted();
    flush();
    finishUpload(id, size);
    const saved = get("upload", id)!;
    return { id, filename: saved.filename, contentType: saved.contentType, size };
  } catch (error) { eraseUpload(id); throw error; }
}
export async function mimeAttachments(accountId: string, files: DraftAttachment[] = []) {
  const { validateAttachmentRefs, uploadBytes } = await import("./store.js");
  validateAttachmentRefs(accountId, files);
  return files.map(file => ({ filename: file.filename, contentType: file.contentType,
    content: file.id ? Readable.from(uploadBytes(file.id)) : Buffer.from(file.content!, "base64") }));
}
// Base64 transport with only a two-byte carry between MIME chunks.
export async function* gmailJson(source: AsyncIterable<Uint8Array>, threadId?: string) {
  yield '{"raw":"';
  let carry = Buffer.alloc(0);
  for await (const value of source) {
    const bytes = Buffer.concat([carry, value]);
    const length = bytes.length - bytes.length % 3;
    yield bytes.subarray(0, length).toString("base64url");
    carry = bytes.subarray(length);
  }
  if (carry.length) yield carry.toString("base64url");
  yield `"${threadId ? `,"threadId":${JSON.stringify(threadId)}` : ""}}`;
}
