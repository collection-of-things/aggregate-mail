import { z } from "zod";

const urlSchema = z.string().max(2048).refine(value => !!unsubscribeUrl(value));
export const unsubscribeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("post"), url: urlSchema }).strict(),
  z.object({ kind: z.literal("link"), url: urlSchema }).strict(),
  z.object({ kind: z.literal("mailto"), address: z.email().max(254), subject: z.string().max(200).refine(value => !/[\p{Cc}\p{Cf}]/u.test(value)), body: z.string().max(2000).refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) }).strict(),
  z.object({ kind: z.literal("blocked"), reason: z.enum(["headers", "destination"]) }).strict(),
]);
export type Unsubscribe = z.infer<typeof unsubscribeSchema>;
export type UnsubscribeAction = Exclude<Unsubscribe, { kind: "blocked" }>;

// Conservative global-unicast policy, also used for every DNS answer on the service.
export function publicUnsubscribeAddress(address: string): boolean {
  if (address.includes(":")) {
    const value = address.toLowerCase();
    if (!/^[23][0-9a-f]{3}:/i.test(value) || !/^[0-9a-f:]+$/.test(value)) return false;
    const prefix = value.split(":").slice(0, 2).map(part => parseInt(part || "0", 16));
    return !(prefix[0] === 0x2001 && (prefix[1] <= 0x1ff || prefix[1] === 0xdb8)) &&
      prefix[0] !== 0x2002 && !(prefix[0] === 0x3fff && prefix[1] <= 0xfff);
  }
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part, index) => !/^\d{1,3}$/.test(address.split(".")[index]) || part > 255)) return false;
  const [a, b, c] = parts;
  return a > 0 && a < 224 && ![10, 127].includes(a) && !(a === 100 && b >= 64 && b <= 127) &&
    !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31) &&
    !(a === 192 && (b === 168 || b === 0 || b === 2 || b === 88 && c === 99)) &&
    !(a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)) && !(a === 203 && b === 0 && c === 113);
}

export function unsubscribeUrl(value: string): URL | undefined {
  try {
    if (value.length > 2048 || /[\s\u0000-\u001f\u007f\\]/.test(value)) return;
    const url = new URL(value);
    if (url.href.length > 2048 || url.protocol !== "https:" || url.username || url.password || url.hash || url.port && url.port !== "443") return;
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (host.includes(":") || /^[\d.]+$/.test(host)) return publicUnsubscribeAddress(host) ? url : undefined;
    if (!host.includes(".") || host.endsWith(".") || /\.(localhost|local|internal|home|lan|test|invalid|example|onion)$/.test(host)) return;
    return url;
  } catch { return; }
}

function mailto(value: string): UnsubscribeAction | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "mailto:" || url.hash || url.host) return;
    const address = decodeURIComponent(url.pathname);
    const subject = url.searchParams.get("subject") ?? "Unsubscribe";
    const body = url.searchParams.get("body") ?? "";
    const keys = [...url.searchParams.keys()];
    if (keys.some(key => !["subject", "body"].includes(key)) || new Set(keys).size !== keys.length || /[\p{Cc}\p{Cf}]/u.test(subject) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body)) return;
    const parsed = unsubscribeSchema.safeParse({ kind: "mailto", address, subject, body });
    return parsed.success && parsed.data.kind === "mailto" ? parsed.data : undefined;
  } catch { return; }
}

// Raw header lines avoid mailparser's structured interpretation of List-* fields.
export function parseUnsubscribe(headers: readonly { key: string; line: string }[]): Unsubscribe | undefined {
  const list = headers.filter(header => header.key.toLowerCase() === "list-unsubscribe");
  if (!list.length) return;
  const post = headers.filter(header => header.key.toLowerCase() === "list-unsubscribe-post");
  if (list.length !== 1 || post.length > 1 || [...list, ...post].some(header => header.line.length > 8192 || new TextEncoder().encode(header.line).length > 8192))
    return { kind: "blocked", reason: "headers" };
  const value = (line: string) => line.slice(line.indexOf(":") + 1).replace(/\r?\n[ \t]+/g, " ").trim();
  const raw = value(list[0].line);
  if (!/^<[^<>\r\n]+>(?:\s*,\s*<[^<>\r\n]+>)*$/.test(raw)) return { kind: "blocked", reason: "headers" };
  const tokens = [...raw.matchAll(/<[^<>\r\n]+>/g)].map(match => match[0]);
  if (tokens.length > 10) return { kind: "blocked", reason: "headers" };
  const targets = tokens.map(token => token.slice(1, -1).trim());
  const https = targets.map(unsubscribeUrl).filter(url => url !== undefined);
  if (post.length && value(post[0].line) === "List-Unsubscribe=One-Click" && https.length === 1 && targets.filter(target => /^https?:/i.test(target)).length === 1)
    return { kind: "post", url: https[0].href };
  for (const target of targets) {
    const url = unsubscribeUrl(target);
    if (url) return { kind: "link", url: url.href };
    const draft = mailto(target);
    if (draft) return draft;
  }
  return { kind: "blocked", reason: "destination" };
}
