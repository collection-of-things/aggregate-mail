// Only encrypted bytes cross the file bridge. Paths remain in the main process.
export const BACKUP_MAX_BYTES = 32 * 1024 * 1024;
export type BackupPreview = {
  manifest: { formatVersion: 1; appVersion: string; createdAt: string; counts: Record<string, number> };
  added: Record<string, number>;
  skipped: Record<string, number>;
  missingAccounts: number;
};
export type WorkspaceBackupBridge = {
  save: (encrypted: string) => Promise<boolean>;
  open: () => Promise<string | null>;
};
