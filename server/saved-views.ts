import { randomUUID } from "node:crypto";
import express from "express";
import { z } from "zod";
import { savedViewDefinitionSchema, savedViewNameSchema } from "../shared/saved-views.js";
import { all, get, put, remove, transaction } from "./store.js";

const createSchema = z.object({ name: savedViewNameSchema, definition: savedViewDefinitionSchema }).strict();
const renameSchema = z.object({ name: savedViewNameSchema, revision: z.number().int().positive() }).strict();
const deleteSchema = renameSchema.pick({ revision: true });
class ViewError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export function mountSavedViews(app: express.Express) {
  const router = express.Router();
  const current = (id: string, revision: number) => {
    const view = get("savedView", id);
    if (!view) throw new ViewError(404, "This saved view no longer exists. Reopen Commands to refresh.");
    if (view.revision !== revision) throw new ViewError(409, "This saved view changed. Reopen Commands before editing it.");
    return view;
  };
  router.get("/", (_req, res) => res.json(all("savedView")));
  router.post("/", (req, res) => {
    const input = createSchema.parse(req.body);
    const view = transaction(() => {
      if (all("savedView").length >= 100) throw new ViewError(409, "Saved view limit reached. Delete a view before adding another.");
      const view = { ...input, id: randomUUID(), revision: 1 };
      put("savedView", view.id, view);
      return view;
    });
    res.status(201).json(view);
  });
  router.patch<{ id: string }>("/:id", (req, res) => {
    const input = renameSchema.parse(req.body);
    res.json(transaction(() => {
      const view = current(req.params.id, input.revision);
      const updated = { ...view, name: input.name, revision: view.revision + 1 };
      put("savedView", view.id, updated);
      return updated;
    }));
  });
  router.delete<{ id: string }>("/:id", (req, res) => {
    const input = deleteSchema.parse(req.body);
    transaction(() => { current(req.params.id, input.revision); remove("savedView", req.params.id); });
    res.json({ ok: true });
  });
  router.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (error instanceof ViewError) res.status(error.status).json({ error: error.message });
    else if (error instanceof z.ZodError) res.status(400).json({ error: "Enter a single-line name of 1 to 80 characters and valid search filters." });
    else next(error);
  });
  // Session, origin, CSRF, sync and update guards are inherited from /api.
  app.use("/api/saved-views", router);
}
