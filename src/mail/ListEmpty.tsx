import { ArrowRight } from "../ui/icons";

const skeletonRows = Array.from({ length: 8 }, (_, index) => index);

/** What an empty mail list says: loading, no accounts, no matches or nothing in this view. */
export function ListEmpty({ loaded, hasAccounts, filtered, title, viewName, syncing, searchPending = false, includesDrafts = false, loadError, clearName, onRetry, onConnect, onReset, onSync, onWiden, widenLabel }: {
  onWiden?: () => void;
  widenLabel?: string;
  loaded: boolean;
  hasAccounts: boolean;
  filtered: boolean;
  title: string;
  viewName: string;
  syncing: boolean;
  searchPending?: boolean;
  includesDrafts?: boolean;
  loadError?: string;
  /** Set when this pane is the default inbox empty state, which gets the designed clear moment. */
  clearName?: string;
  onRetry?: () => void;
  onConnect: () => void;
  onReset: () => void;
  onSync: () => void;
}) {
  if (!loaded) {
    if (loadError) {
      return (
        <div className="empty empty-clear empty-error">
          <div className="empty-mark empty-mark-muted" aria-hidden="true"><img src="/brand/mark-lumen.svg" alt="" /></div>
          <h2 className="empty-heading">{loadError}</h2>
          <button type="button" className="link" onClick={onRetry}>Retry loading mail</button>
        </div>
      );
    }
    return (
      <div className="empty empty-loading">
        <div className="empty-skeleton" aria-hidden="true">
          <div className="empty-skeleton-group" />
          {skeletonRows.map((row) => (
            <div className="empty-skeleton-card" key={row}>
              <i /><i /><i /><i />
            </div>
          ))}
        </div>
        <p className="empty-title visually-hidden" role="status">Loading</p>
      </div>
    );
  }
  if (hasAccounts && !searchPending && !filtered && clearName) {
    return (
      <div className="empty empty-clear">
        <div className="empty-mark" aria-hidden="true"><img src="/brand/mark-lumen.svg" alt="" /></div>
        <h2 className="empty-heading">{clearName} is <em>clear</em></h2>
        <button className="link" disabled={syncing} onClick={onSync}>
          {syncing ? "Syncing" : "Sync now"}
        </button>
      </div>
    );
  }
  return (
    <div className="empty" role={searchPending ? "status" : undefined}>
      <p className="empty-title">
        {!hasAccounts ? "No accounts connected" : searchPending ? "Searching cached mail" : filtered ? includesDrafts ? "No matching mail or saved drafts" : "No matching mail" : title}
      </p>
      {hasAccounts ? null : (
        <button className="link" onClick={onConnect}>
          Connect an account <ArrowRight color="currentColor" size={11} />
        </button>
      )}
      {hasAccounts && !searchPending && filtered && (
        <>
          {onWiden && <button type="button" className="link" onClick={onWiden}>{widenLabel}</button>}
          <button type="button" className="link" onClick={onReset}>Reset filters and sort</button>
        </>
      )}
      {hasAccounts && !searchPending && !filtered && !clearName && (
        <button className="link" disabled={syncing} onClick={onSync}>
          {syncing ? "Syncing" : "Sync now"}
        </button>
      )}
    </div>
  );
}
