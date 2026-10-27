import type { DraftContent, Mail } from "../shared/types.js";
import { get } from "./store.js";
import { attachmentSchema } from "./providers.js";

// Cached text only. Sender HTML and threading metadata never enter a forward.
export function forwardContent(mail: Mail): DraftContent {
  const attachments: NonNullable<DraftContent["attachments"]> = [];
  const omitted: string[] = [];
  let total = 0;
  for (const file of mail.attachments || []) {
    const saved = !file.unavailable && get("attachment", `${mail.id}:${file.id}`);
    const parsed = saved && saved.accountId === mail.accountId && attachmentSchema.safeParse({ filename: file.filename, contentType: file.contentType, content: saved.content });
    const size = saved ? Buffer.from(saved.content, "base64").length : Infinity;
    if (parsed && parsed.success && attachments.length < 10 && total + size <= 1048576) {
      attachments.push(parsed.data); total += size;
    } else omitted.push(file.filename);
  }
  const header = `---------- Forwarded message ----------\nFrom: ${mail.sender} <${mail.address}>\nDate: ${(Number.isFinite(new Date(mail.date).getTime()) ? new Date(mail.date).toISOString() : "Unknown")}\nSubject: ${mail.subject}\nTo: ${mail.to}\n${mail.cc ? `Cc: ${mail.cc}\n` : ""}`;
  const missing = omitted.length ? `\n\nAttachments not included:\n${omitted.map(name => `- ${name}`).join("\n")}` : "";
  const body = `\n\n${header}\n${mail.body || mail.preview}${missing}`;
  if (body.length > 1000000) throw new Error("Forward exceeds the compose text limit.");
  return { to: [], subject: (/^fwd:/i.test(mail.subject) ? mail.subject : `Fwd: ${mail.subject}`).replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 998), body, attachments };
}
