import { Router } from "express";
import { z } from "zod";
import { prisma, bumpCatalogVersion } from "../db/client.js";

export const optionsRouter: Router = Router();

const packageSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  descriptionMd: z.string().nullable().optional(),
  featuresJson: z.unknown().nullable().optional(),
});

const trimOptionSchema = z.object({
  trimId: z.number().int().positive(),
  optionPackageId: z.number().int().positive(),
  priceCad: z.number().nonnegative().nullable().optional(),
  available: z.boolean().optional(),
  required: z.boolean().optional(),
  notesMd: z.string().nullable().optional(),
});

optionsRouter.get("/", async (_req, res, next) => {
  try {
    const list = await prisma.optionPackage.findMany({ orderBy: { name: "asc" } });
    res.json({ packages: list });
  } catch (e) {
    next(e);
  }
});

optionsRouter.get("/trim/:trimId", async (req, res, next) => {
  try {
    const trimId = Number(req.params.trimId);
    const rows = await prisma.trimOption.findMany({
      where: { trimId },
      include: { optionPackage: true },
      orderBy: { optionPackage: { name: "asc" } },
    });
    res.json({ trimOptions: rows });
  } catch (e) {
    next(e);
  }
});

optionsRouter.post("/", async (req, res, next) => {
  try {
    const data = packageSchema.parse(req.body);
    const created = await prisma.optionPackage.create({
      data: { ...data, featuresJson: data.featuresJson as never },
    });
    await bumpCatalogVersion();
    res.status(201).json(created);
  } catch (e) {
    next(e);
  }
});

optionsRouter.patch("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const data = packageSchema.partial().parse(req.body);
    const updated = await prisma.optionPackage.update({
      where: { id },
      data: { ...data, featuresJson: data.featuresJson as never },
    });
    await bumpCatalogVersion();
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

optionsRouter.delete("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await prisma.optionPackage.delete({ where: { id } });
    await bumpCatalogVersion();
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

optionsRouter.put("/trim", async (req, res, next) => {
  try {
    const data = trimOptionSchema.parse(req.body);
    const row = await prisma.trimOption.upsert({
      where: { trimId_optionPackageId: { trimId: data.trimId, optionPackageId: data.optionPackageId } },
      create: data,
      update: {
        priceCad: data.priceCad,
        available: data.available,
        required: data.required,
        notesMd: data.notesMd,
      },
    });
    await bumpCatalogVersion();
    res.json(row);
  } catch (e) {
    next(e);
  }
});

optionsRouter.delete("/trim/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await prisma.trimOption.delete({ where: { id } });
    await bumpCatalogVersion();
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});
