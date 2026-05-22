import { Router } from "express";
import { z } from "zod";
import { FinancePromoKind } from "@prisma/client";
import { prisma, bumpCatalogVersion } from "../db/client.js";

export const promosRouter: Router = Router();

const promoSchema = z.object({
  trimId: z.number().int().positive().nullable().optional(),
  modelSlug: z.string().nullable().optional(),
  kind: z.nativeEnum(FinancePromoKind),
  termMonths: z.number().int().min(6).max(120),
  aprPercent: z.number().min(0).max(30).nullable().optional(),
  moneyFactor: z.number().min(0).max(0.02).nullable().optional(),
  residualPercent: z.number().min(0).max(100).nullable().optional(),
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable().optional(),
  notesMd: z.string().nullable().optional(),
});

promosRouter.get("/", async (req, res, next) => {
  try {
    const modelSlug = typeof req.query.modelSlug === "string" ? req.query.modelSlug : undefined;
    const kind = typeof req.query.kind === "string" ? (req.query.kind as FinancePromoKind) : undefined;
    const activeOnly = req.query.activeOnly !== "false";
    const now = new Date();
    const promos = await prisma.financePromo.findMany({
      where: {
        ...(modelSlug ? { modelSlug } : {}),
        ...(kind ? { kind } : {}),
        ...(activeOnly
          ? { effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] }
          : {}),
      },
      orderBy: [{ modelSlug: "asc" }, { kind: "asc" }, { termMonths: "asc" }],
    });
    res.json({ promos });
  } catch (e) {
    next(e);
  }
});

promosRouter.post("/", async (req, res, next) => {
  try {
    const data = promoSchema.parse(req.body);
    const promo = await prisma.financePromo.create({
      data: {
        ...data,
        effectiveFrom: new Date(data.effectiveFrom),
        effectiveTo: data.effectiveTo ? new Date(data.effectiveTo) : null,
      },
    });
    await bumpCatalogVersion();
    res.status(201).json(promo);
  } catch (e) {
    next(e);
  }
});

promosRouter.patch("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const data = promoSchema.partial().parse(req.body);
    const promo = await prisma.financePromo.update({
      where: { id },
      data: {
        ...data,
        effectiveFrom: data.effectiveFrom ? new Date(data.effectiveFrom) : undefined,
        effectiveTo: data.effectiveTo !== undefined ? (data.effectiveTo ? new Date(data.effectiveTo) : null) : undefined,
      },
    });
    await bumpCatalogVersion();
    res.json(promo);
  } catch (e) {
    next(e);
  }
});

promosRouter.delete("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await prisma.financePromo.delete({ where: { id } });
    await bumpCatalogVersion();
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});
