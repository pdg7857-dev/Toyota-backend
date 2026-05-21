import { Router } from "express";
import { z } from "zod";
import { RepNoteScope } from "@prisma/client";
import { prisma, bumpCatalogVersion } from "../db/client.js";
import { listRepNotes } from "../services/catalog.js";

export const notesRouter: Router = Router();

const noteSchema = z.object({
  scopeType: z.nativeEnum(RepNoteScope),
  scopeId: z.number().int().positive().nullable().optional(),
  title: z.string().min(1),
  bodyMd: z.string().min(1),
  tags: z.array(z.string()).optional(),
});

notesRouter.get("/", async (req, res, next) => {
  try {
    const scope = typeof req.query.scope === "string" ? req.query.scope : undefined;
    const scopeId = req.query.scopeId ? Number(req.query.scopeId) : undefined;
    const tagsRaw = typeof req.query.tags === "string" ? req.query.tags : undefined;
    const tags = tagsRaw ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean) : undefined;
    const notes = await listRepNotes({ scope, scopeId, tags });
    res.json({ notes });
  } catch (e) {
    next(e);
  }
});

notesRouter.post("/", async (req, res, next) => {
  try {
    const data = noteSchema.parse(req.body);
    const created = await prisma.repNote.create({ data: { ...data, tags: data.tags ?? [] } });
    await bumpCatalogVersion();
    res.status(201).json(created);
  } catch (e) {
    next(e);
  }
});

notesRouter.patch("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const data = noteSchema.partial().parse(req.body);
    const updated = await prisma.repNote.update({ where: { id }, data });
    await bumpCatalogVersion();
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

notesRouter.delete("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await prisma.repNote.delete({ where: { id } });
    await bumpCatalogVersion();
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});
