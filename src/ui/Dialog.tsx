import { useEffect, useRef, type ReactNode } from "react";
import { Close } from "./icons";

export function Dialog({
  title,
  onClose,
  children,
  className,
  toolbarAccess = false,
  actions,
  closeLabel = "Close dialog",
  initialFocus,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  toolbarAccess?: boolean;
  actions?: ReactNode;
  closeLabel?: string;
  initialFocus?: "close";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    (
      (initialFocus === "close" ? null : ref.current?.querySelector<HTMLElement>("input:not(:disabled):not([data-private-field]), select:not(:disabled), textarea:not(:disabled):not([data-private-field])")) ||
      ref.current?.querySelector<HTMLElement>("button:not(:disabled)")
    )?.focus();
    const handler = (e: KeyboardEvent) => {
      const dialogs = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].filter(dialog => !dialog.closest("[inert]"));
      if (dialogs.at(-1) !== ref.current) return;
      const target = e.target instanceof window.Node ? e.target : document.activeElement;
      if (e.key === "Escape" && (e.defaultPrevented || e.isComposing || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey)) return;
      if (e.key === "Escape" && toolbarAccess && target instanceof HTMLElement && target.closest("[data-escape-owner]")) return;
      if (e.key === "Escape" && (!toolbarAccess || ref.current?.contains(target))) {
        e.preventDefault();
        e.stopImmediatePropagation();
        close.current();
      }
      if (e.key !== "Tab") return;
      const selector = "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex='0']";
      const controls = [
        ...(toolbarAccess ? document.querySelectorAll<HTMLElement>('.sidebar:not(.closed) button:not(:disabled), .app-toolbar [data-compose-access]:not(:disabled)') : []),
        ...(ref.current?.querySelectorAll<HTMLElement>(selector) ?? []),
      ].filter(control => !control.closest("[inert]"));
      if (!controls?.length) return;
      if (toolbarAccess) {
        const index = controls.indexOf(document.activeElement as HTMLElement);
        if (index < 0 || e.ctrlKey || e.metaKey || e.altKey) return;
        e.preventDefault();
        controls[(index + (e.shiftKey ? -1 : 1) + controls.length) % controls.length].focus();
        return;
      }
      const first = controls[0],
        last = controls[controls.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => {
      window.removeEventListener("keydown", handler, true);
      if (previous?.isConnected && !previous.closest("[inert]")) previous.focus();
    };
  }, []);
  return (
    <div className={toolbarAccess ? "dialog-backdrop compose-backdrop" : "dialog-backdrop"}>
      <div
        className={className ? `dialog ${className}` : "dialog"}
        role="dialog"
        aria-modal={toolbarAccess ? undefined : true}
        aria-label={title}
        ref={ref}
      >
        <div className="dialog-title">
          <h2>{title}</h2>
          <button className="icon" aria-label={closeLabel} onClick={onClose}>
            <Close color="currentColor" size={13} />
          </button>
          {actions}
        </div>
        {children}
      </div>
    </div>
  );
}
