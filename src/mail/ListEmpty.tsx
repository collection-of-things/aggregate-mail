import { ArrowRight } from "../ui/icons";

/** What an empty mail list says: loading, no accounts, no matches or nothing in this view. */
export function ListEmpty({ loaded, hasAccounts, filtered, title, viewName, syncing, searchPending = false, includesDrafts = false, onConnect, onReset, onSync }: {
  loaded: boolean;
  hasAccounts: boolean;
  filtered: boolean;
  title: string;
  viewName: string;
  syncing: boolean;
  searchPending?: boolean;
  includesDrafts?: boolean;
  onConnect: () => void;
  onReset: () => void;
  onSync: () => void;
}) {
  return (
    <div className="empty" role={searchPending ? "status" : undefined}>
      <p className="empty-title">
        {!loaded ? "Loading" : !hasAccounts ? "No accounts connected" : searchPending ? "Searching cached mail" : filtered ? includesDrafts ? "No matching mail or saved drafts" : "No matching mail" : title}
      </p>
      {loaded &&
        (!hasAccounts ? (
          <button className="link" onClick={onConnect}>
            Connect an account <ArrowRight color="currentColor" size={11} />
          </button>
        ) : searchPending ? (
          <p>Searching message bodies. Header matches appear as soon as they are available.</p>
        ) : filtered ? (
          <>
            <p>No cached mail{includesDrafts ? " or saved drafts" : ""} matches these controls in {viewName}.</p>
            <button type="button" className="link" onClick={onReset}>Reset filters and sort</button>
          </>
        ) : (
          <button className="link" disabled={syncing} onClick={onSync}>
            {syncing ? "Syncing" : "Sync now"}
          </button>
        ))}
    </div>
  );
}
