import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { savedViewDefinitionSchema, savedViewNameSchema, savedViewSchema, type SavedView, type SavedViewDefinition } from "../shared/saved-views";
import type { Api } from "./api";
import type { MailLocation } from "./navigation";
import type { PaletteCommand } from "./dialogs/CommandPalette";
import { Dialog } from "./ui/Dialog";
import { PrivateField } from "./ui/PrivateField";

export type SavedViewEdit = { kind: "create"; definition: SavedViewDefinition } | { kind: "rename" | "delete"; view: SavedView };

function SavedViewDialog({ edit, api, onSaved, onClose }: {
  edit: SavedViewEdit; api: Api; onSaved: (view: SavedView | null) => void; onClose: () => void;
}) {
  const [name, setName] = useState(edit.kind === "create" ? "" : edit.view.name);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const title = edit.kind === "create" ? "Save view" : edit.kind === "rename" ? "Rename saved view" : "Delete saved view";
  const save = async () => {
    if (lock.current) return;
    lock.current = true; setPending(true); setError("");
    try {
      if (edit.kind === "delete") {
        await api(`/saved-views/${edit.view.id}`, "DELETE", { revision: edit.view.revision });
        onSaved(null);
      } else {
        const response = edit.kind === "create"
          ? await api("/saved-views", "POST", { name, definition: edit.definition })
          : await api(`/saved-views/${edit.view.id}`, "PATCH", { name, revision: edit.view.revision });
        onSaved(savedViewSchema.parse(response));
      }
      onClose();
    } catch (error) { setError(error instanceof Error ? error.message : "The saved view could not be changed. Try again."); }
    finally { lock.current = false; setPending(false); }
  };
  const close = () => { if (!lock.current) onClose(); };
  return <Dialog title={title} onClose={close}>
    <form className="settings-form" onSubmit={event => { event.preventDefault(); void save(); }}>
      {edit.kind === "delete" ? <p className="dialog-copy">Delete this saved view? Cached mail and drafts stay on this device.</p> :
        <PrivateField label="View name" value={name} onChange={setName} maxLength={80} required disabled={pending} />}
      {error && <p role="alert">{error}</p>}
      <div className="form-actions">
        <button type="button" className="button" disabled={pending} onClick={close}>Cancel</button>
        <button type="submit" className="button" disabled={pending || edit.kind !== "delete" && !savedViewNameSchema.safeParse(name).success}>
          {pending ? "Saving…" : edit.kind === "delete" ? "Delete view" : "Save"}
        </button>
      </div>
    </form>
  </Dialog>;
}

export function useSavedViews({ api, active, location, privacy, available, onOpen, onError, edit, setEdit }: {
  api: Api; active: boolean; location: MailLocation; privacy: boolean;
  available: (definition: SavedViewDefinition) => boolean;
  onOpen: (definition: SavedViewDefinition) => void; onError: (message: string) => void;
  edit: SavedViewEdit | null; setEdit: (edit: SavedViewEdit | null) => void;
}) {
  const [views, setViews] = useState<SavedView[]>([]);
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    void api("/saved-views", "GET", undefined, controller.signal).then(response => {
      const next = z.array(savedViewSchema).parse(response);
      if (!controller.signal.aborted) { setViews(next); setLoadError(false); }
    }).catch(() => { if (!controller.signal.aborted) setLoadError(true); });
    return () => controller.abort();
  }, [active, api]);
  const { view, tab, query, accountFilter, labelFilter, readFilter, relevanceFilter, sort } = location;
  const definition = savedViewDefinitionSchema.safeParse({ view, tab, query, accountFilter, labelFilter, readFilter, relevanceFilter, sort });
  const canSave = definition.success && (!!query.trim() || accountFilter !== "all" || labelFilter !== "all" ||
    readFilter !== "all" || relevanceFilter !== "all" || sort !== "newest");
  const startSave = () => { if (canSave && definition.success) setEdit({ kind: "create", definition: definition.data }); };
  const commands: PaletteCommand[] = [
    { id: "save-view", label: "Save current view", group: "navigation", disabled: !canSave,
      disabledReason: "Search or apply a mail filter first", run: startSave },
    ...(loadError ? [{ id: "saved-views-error", label: "Saved views unavailable", group: "navigation" as const,
      disabled: true, disabledReason: "Reopen Commands to try again", run: () => {} }] : []),
    ...views.flatMap((saved, index): PaletteCommand[] => {
      const label = privacy ? `Saved view ${index + 1}` : saved.name;
      const exists = available(saved.definition);
      return [
        { id: `saved-open-${saved.id}`, label: `Open ${label}`, group: "navigation", disabled: !exists,
          disabledReason: "The saved account or label is no longer available", run: () => {
            if (available(saved.definition)) onOpen(saved.definition);
            else onError("The saved account or label is no longer available.");
          } },
        { id: `saved-rename-${saved.id}`, label: `Rename ${label}`, group: "navigation", run: () => setEdit({ kind: "rename", view: saved }) },
        { id: `saved-delete-${saved.id}`, label: `Delete ${label}`, group: "navigation", run: () => setEdit({ kind: "delete", view: saved }) },
      ];
    }),
  ];
  const dialog = edit && <SavedViewDialog edit={edit} api={api} onClose={() => setEdit(null)} onSaved={saved => {
    setViews(current => saved ? [...current.filter(view => view.id !== saved.id), saved] :
      current.filter(view => edit.kind === "create" || view.id !== edit.view.id));
  }} />;
  return { commands, canSave, startSave, dialog, editing: edit !== null };
}
