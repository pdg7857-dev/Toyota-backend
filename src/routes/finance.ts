import { Router } from "express";
import { z } from "zod";
import { FinanceProductCategory, PowertrainType } from "@prisma/client";
import { prisma, bumpCatalogVersion } from "../db/client.js";
import { listFinanceProducts } from "../services/catalog.js";

export const financeRouter: Router = Router();

const financeSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  category: z.nativeEnum(FinanceProductCategory),
  descriptionMd: z.string().nullable().optional(),
  pricingNotes: z.string().nullable().optional(),
  termOptionsJson: z.unknown().nullable().optional(),
  eligiblePowertrains: z.array(z.nativeEnum(PowertrainType)).optional(),
  active: z.boolean().optional(),
});

financeRouter.get("/", async (req, res, next) => {
  try {
    const category = typeof req.query.category === "string" ? req.query.category : undefined;
    const products = await listFinanceProducts(category);
    res.json({ products });
  } catch (e) {
    next(e);
  }
});

financeRouter.post("/", async (req, res, next) => {
  try {
    const data = financeSchema.parse(req.body);
    const created = await prisma.financeProduct.create({
      data: { ...data, termOptionsJson: data.termOptionsJson as never },
    });
    await bumpCatalogVersion();
    res.status(201).json(created);
  } catch (e) {
    next(e);
  }
});

financeRouter.patch("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const data = financeSchema.partial().parse(req.body);
    const updated = await prisma.financeProduct.update({
      where: { id },
      data: { ...data, termOptionsJson: data.termOptionsJson as never },
    });
    await bumpCatalogVersion();
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

financeRouter.delete("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await prisma.financeProduct.delete({ where: { id } });
    await bumpCatalogVersion();
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});
