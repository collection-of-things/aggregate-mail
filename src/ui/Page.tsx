import type { ReactNode } from "react";
import { useAccountFilter } from "./filter";
import { CloseIcon } from "./icons";

/** A mask icon from a PNG, so it takes the surrounding colour. */
export function MaskIcon({ src, className = "mask-icon" }: { src: string; className?: string }) {
  return <span className={className} style={{ maskImage: `url(${src})`, WebkitMaskImage: `url(${src})` }} aria-hidden="true" />;
}

/**
 * A module page right of the sidebar line: the breadcrumb (section, then the
 * page's blue icon and name) in the band above the top line, optional actions
 * at its right, then the page's own content.
 */
export function Page({ section, icon, title, actions, notice, children }: {
  section: string;
  icon: ReactNode;
  title: string;
  actions?: ReactNode;
  notice?: string | null;
  children: ReactNode;
}) {
  const filter = useAccountFilter();
  return (
    <div className="page">
      <header className="page-head">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span className="breadcrumb-parent">{section}</span>
          <svg className="breadcrumb-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3.5 4.5 4.5L6 12.5" /></svg>
          <span className="breadcrumb-current" aria-current="page"><span className="breadcrumb-glyph">{icon}</span>{title}</span>
        </nav>
        {filter.name && (
          <button type="button" className="filter-chip" title="Show all accounts" onClick={filter.clear}>{filter.name}<CloseIcon /></button>
        )}
        {notice && <p key={notice} className="page-notice" role="status">{notice}</p>}
        {actions && <div className="page-actions">{actions}</div>}
      </header>
      {children}
    </div>
  );
}

/** A centred, quiet message for empty lists. */
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children && <p className="empty-text">{children}</p>}
    </div>
  );
}
