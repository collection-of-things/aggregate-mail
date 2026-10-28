import type { DraftAttachment } from "./types.js";
export const ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const ATTACHMENT_COUNT = 20;
export const MIME_BYTES = 35 * 1024 * 1024;
export function attachmentSize(file: DraftAttachment): number {
  if (file.id) return file.size!;
  const content = file.content || "";
  return content.length / 4 * 3 - (content.endsWith("==") ? 2 : content.endsWith("=") ? 1 : 0);
}
