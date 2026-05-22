import { Router } from "express";
import { z } from "zod";
import { prisma, bumpCatalogVersion } from "../db/client.js";
import { getModelBySlug, listModels } from "../services/catalog.js";

export const modelsRouter: Router = Router();

const modelInputSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  make: z.string().min(1).optional(),
  bodyStyle: z.string().nullable().optional(),
  segment: z.string().nullable().optional(),
  notesMd: z.string().nullable().optional(),
});

modelsRouter.get("/", async (req, res, next) => {
  try {
    const yearParam = req.query.year;
    const year = yearParam ? Number(yearParam) : undefined;
    const make = typeof req.query.make === "string" ? req.query.make : undefined;
    const models = await listModels(year, make);
    res.json({ models });
  } catch (e) {
    next(e);
  }
});

modelsRouter.get("/:slug", async (req, res, next) => {
  try {
    const slug = req.params.slug;
    if (!slug) return res.status(400).json({ error: "missing_slug" });
    const model = await getModelBySlug(slug);
    if (!model) return res.status(404).json({ error: "not_found" });
    res.json(model);
  } catch (e) {
    next(e);
  }
});

modelsRouter.post("/", async (req, res, next) => {
  try {
    const data = modelInputSchema.parse(req.body);
    const model = await prisma.model.create({ data });
    await bumpCatalogVersion();
    res.status(201).json(model);
  } catch (e) {
    next(e);
  }
});

modelsRouter.patch("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const data = modelInputSchema.partial().parse(req.body);
    const model = await prisma.model.update({ where: { id }, data });
    await bumpCatalogVersion();
    res.json(model);
  } catch (e) {
    next(e);
  }
});

modelsRouter.delete("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await prisma.model.delete({ where: { id } });
    await bumpCatalogVersion();
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});
