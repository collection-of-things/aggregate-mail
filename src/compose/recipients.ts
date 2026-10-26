import addressparser from "nodemailer/lib/addressparser/index.js";
import type { Mail } from "../../shared/types";

export function replyRecipients(mail: Pick<Mail, "address" | "to" | "cc" | "replyTo" | "direction">, ownEmails: string[], replyAll = false) {
  const addresses = (value: string) => addressparser(value, { flatten: true }).map((item) => item.address).filter(Boolean);
  const own = new Set(ownEmails.map((address) => address.toLowerCase()));
  const primary = addresses(mail.direction === "sent" ? mail.to : mail.replyTo || mail.address);
  const to = (mail.direction === "sent" ? primary.filter((address) => !own.has(address.toLowerCase())) : primary)[0] || "";
  const seen = new Set([...own, to.toLowerCase()]);
  const cc = replyAll ? addresses([mail.to, mail.cc || ""].join(", ")).filter((address) => {
    const key = address.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }) : [];
  return { to, cc };
}

// The picker completes the address after the last comma, so the same helpers
// serve a single-address field and a comma-separated list.
export function activeRecipient(value: string) {
  return value.slice(value.lastIndexOf(",") + 1).trim();
}
export function replaceActiveRecipient(value: string, address: string) {
  const head = value.slice(0, value.lastIndexOf(",") + 1);
  return head ? `${head} ${address}` : address;
}
export function listedRecipients(value: string) {
  return new Set(value.split(",").slice(0, -1).map((address) => address.trim().toLowerCase()).filter(Boolean));
}
