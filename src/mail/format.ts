import type { MailSummary } from "../../shared/types";

/** The letter for a mail's avatar: the sender, or the recipient for sent mail. */
export const initial = (mail: MailSummary) => (mail.direction === "sent" ? mail.to : mail.sender || mail.address).trim().charAt(0).toUpperCase() || "?";
