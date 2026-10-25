export type StorageStats = { pageCount: number; freePages: number; pageSize: number };
export const maintenanceProbeInterval = 5 * 60_000;
const idleInterval = 60_000;
const inventoryInterval = 24 * 60 * 60_000;
const successCooldown = 6 * 60 * 60_000;
const failureBackoff = 30 * 60_000;

export function storageNeedsVacuum(stats: StorageStats) {
  return stats.freePages * stats.pageSize >= 16 * 1024 * 1024 && stats.freePages * 5 >= stats.pageCount;
}

type Maintenance = {
  activity: () => Readonly<{ queued: number; active: number; lastCompletedAt: number }>;
  unavailable: () => boolean;
  stats: () => StorageStats;
  lastInventoryAt: () => number | undefined;
  maintain: (options: { cleanupOrphans: boolean; vacuum: "if-needed"; inventoryAt: number }) => Promise<unknown | false>;
  report: (code: "maintenance-failed" | "cleanup-skipped" | "unknown-record-kind" | "incomplete-mail-metadata" | "incomplete-attachment-metadata") => void;
};

// The probe reads page counters only. Full attachment inventory requires an idle,
// drained service and is due independently of SQLite's freelist.
export class StorageMaintenance {
  private timer: ReturnType<typeof setInterval>;
  private stopped = false;
  private running = false;
  private nextAttemptAt = 0;
  private failures = 0;

  constructor(private service: Maintenance, private now = () => Date.now()) {
    this.timer = setInterval(() => this.probe(), maintenanceProbeInterval);
    this.timer.unref();
  }

  close() {
    this.stopped = true;
    clearInterval(this.timer);
    // Synchronous SQLite VACUUM cannot be cancelled by this timer lifecycle.
  }

  private report(code: Parameters<Maintenance["report"]>[0]) {
    // Diagnostic failures must not change admission, cooldown or failure backoff.
    try { this.service.report(code); } catch {}
  }

  async probe() {
    if (this.stopped || this.running || this.now() < this.nextAttemptAt || this.service.unavailable()) return;
    this.running = true;
    try {
      const activity = this.service.activity();
      if (activity.active || activity.queued || this.now() - activity.lastCompletedAt < idleInterval) return;
      const stats = this.service.stats();
      const lastInventoryAt = this.service.lastInventoryAt();
      const cleanupOrphans = lastInventoryAt === undefined || this.now() < lastInventoryAt || this.now() - lastInventoryAt >= inventoryInterval;
      if (!cleanupOrphans && !storageNeedsVacuum(stats)) return;
      const result = await this.service.maintain({ cleanupOrphans, vacuum: "if-needed", inventoryAt: this.now() });
      if (result === false) return;
      this.failures = 0;
      this.nextAttemptAt = this.now() + successCooldown;
      if (typeof result === "object" && result !== null && "cleanupSkipped" in result && result.cleanupSkipped !== undefined) {
        const code = result.cleanupSkipped;
        this.report(code === "unknown-record-kind" || code === "incomplete-mail-metadata" || code === "incomplete-attachment-metadata" ? code : "cleanup-skipped");
      }
    } catch {
      this.nextAttemptAt = this.now() + Math.min(failureBackoff * 2 ** this.failures, successCooldown);
      this.failures = Math.min(this.failures + 1, 4);
      this.report("maintenance-failed");
    } finally { this.running = false; }
  }
}
