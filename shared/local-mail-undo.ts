/** Single-message, local-only Undo. Tokens are invalid after a server restart. */
export type LocalMailUndo = { id: string; accountId: string; token: string };
export type LocalMailActionResponse = { ok: true; undo?: LocalMailUndo };
