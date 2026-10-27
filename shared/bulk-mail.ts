export const MAX_MAIL_BATCH = 200;
export type MailIdentity = { id: string; accountId: string };
export type BulkMailAction = "read" | "unread" | "archive" | "inbox" | "snooze" | "pin" | "unpin" | "trash";
export type MailBatchResult = MailIdentity & { status: "done" | "failed" | "unknown" };
export type MailBatchResponse = { results: MailBatchResult[] };
