import { Router } from "express";
import { z } from "zod";
import { PowertrainType, WarrantyCoverageType } from "@prisma/client";
import { prisma, bumpCatalogVersion } from "../db/client.js";
import { listWarranties } from "../services/catalog.js";

export const warrantiesRouter: Router = Router();

const warrantySchema = z.object({
  modelId: z.number().int().positive(),
  year: z.number().int().min(2020).max(2030),
  coverageType: z.nativeEnum(WarrantyCoverageType),
  durationMonths: z.number().int().nullable().optional(),
  distanceKm: z.number().int().nullable().optional(),
  appliesToPowertrains: z.array(z.nativeEnum(PowertrainType)).optional(),
  descriptionMd: z.string().nullable().optional(),
  sourceUrl: z.string().url().nullable().optional(),
});

warrantiesRouter.get("/", async (req, res, next) => {
  try {
    const model = typeof req.query.model === "string" ? req.query.model : undefined;
    const year = req.query.year ? Number(req.query.year) : undefined;
    const list = await listWarranties(model, year);
    res.json({ warranties: list });
  } catch (e) {
    next(e);
  }
});

warrantiesRouter.post("/", async (req, res, next) => {
  try {
    const data = warrantySchema.parse(req.body);
    const created = await prisma.warrantyCoverage.create({ data });
    await bumpCatalogVersion();
    res.status(201).json(created);
  } catch (e) {
    next(e);
  }
});

warrantiesRouter.patch("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const data = warrantySchema.partial().parse(req.body);
    const updated = await prisma.warrantyCoverage.update({ where: { id }, data });
    await bumpCatalogVersion();
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

warrantiesRouter.delete("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await prisma.warrantyCoverage.delete({ where: { id } });
    await bumpCatalogVersion();
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});
