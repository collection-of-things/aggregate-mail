import type { Account } from "../shared/types";

// Only fixed product text crosses into account status UI. Provider errors stay private.
export function accountStatus(account: Account) {
  return [
    account.syncStatus === "queued" ? "Connection retry queued." : account.syncStatus === "running" ? "Mail sync running." : (account.error || account.syncFailure) ? "Connection needs attention. Retry connection in Settings." : "Connected. Cached mail may be incomplete.",
    account.syncWarning ? "Mail result retained; connection cleanup failed." : "",
  ].filter(Boolean).join(" ");
}

// Accounts whose connection needs attention drive the sidebar footer's summary.
export function accountsNeedingAttention(accounts: Account[]) {
  return accounts.filter((account) => account.error || account.syncFailure).length;
}
