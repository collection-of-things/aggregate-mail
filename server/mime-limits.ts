import { simpleParser } from "mailparser";

export const rawMailLimit = 8 * 1024 * 1024;
export const gmailResponseLimit = 12 * 1024 * 1024;
export const imapSourceQuery = { start: 0, maxLength: rawMailLimit + 1 };

export function canonicalBase64Size(value: string): number | null {
  if (value.length % 4 || /[^A-Za-z0-9+/=]/.test(value)) return null;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const end = value.length - padding;
  if (value.slice(0, end).includes("=") || (padding && end < 2)) return null;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  if (padding && (alphabet.indexOf(value[end - 1]) & (padding === 2 ? 15 : 3))) return null;
  return value.length / 4 * 3 - padding;
}

export function decodeGmailSource(raw: unknown): Buffer {
  if (typeof raw !== "string" || !raw.length) throw new Error("Email source is unavailable.");
  if (raw.length > Math.ceil(rawMailLimit / 3) * 4) throw new Error("Raw email byte limit exceeded.");
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(raw) || raw.length % 4 === 1) throw new Error("Invalid email encoding.");
  const normalized = raw.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const size = canonicalBase64Size(padded);
  if (size === null) throw new Error("Invalid email encoding.");
  if (size > rawMailLimit) throw new Error("Raw email byte limit exceeded.");
  return Buffer.from(padded, "base64");
}

// MailParser forwards these bounds to its installed mailsplit parser. Using
// its MIME grammar keeps folded headers and nested delimiters consistent.
export const mimeParserOptions = {
  skipImageLinks: true,
  maxHtmlLengthToParse: 2 * 1024 * 1024,
  maxHeadSize: 65536,
  maxChildNodes: 128,
};

export function checkMimeSource(source: Buffer) {
  if (source.length > rawMailLimit) throw new Error("Raw email byte limit exceeded.");
}

// mailparser >= 3.10 reports a bounded HTML part as textConversionError instead
// of rejecting, so enforce the bound here.
export async function parseMailSource(source: Buffer) {
  const parsed = await simpleParser(source, mimeParserOptions);
  const error = parsed.textConversionError;
  if (error) throw error instanceof Error ? error : new Error(String(error));
  return parsed;
}
