export type ComposeTemplate = { id: string; name: string; subject: string; body: string };
export type ComposePreferences = {
  undoSendSeconds?: 0 | 5 | 10 | 30;
  templates: ComposeTemplate[];
  signatures: Record<string, string>;
};
export const emptyComposePreferences: ComposePreferences = { templates: [], signatures: {} };
