import { Router } from "express";
import { z } from "zod";
import { Prisma, PowertrainType } from "@prisma/client";
import { prisma, bumpCatalogVersion } from "../db/client.js";
import { getTrimBySlug, listTrims } from "../services/catalog.js";
import { computeQuote } from "../services/pricing.js";

export const trimsRouter: Router = Router();

const trimInputSchema = z.object({
  modelId: z.number().int().positive(),
  powertrainId: z.number().int().positive(),
  year: z.number().int().min(2020).max(2030),
  name: z.string().min(1),
  slug: z.string().min(1),
  msrpCad: z.number().nonnegative(),
  notesMd: z.string().nullable().optional(),
  previousTrimId: z.number().int().positive().nullable().optional(),
});

const feeInputSchema = z.object({
  freightPdiCad: z.number().nonnegative().nullable().optional(),
  acExciseCad: z.number().nonnegative().nullable().optional(),
  omvicFeeCad: z.number().nonnegative().nullable().optional(),
  tireStewardshipCad: z.number().nonnegative().nullable().optional(),
  dealerAdminCad: z.number().nonnegative().nullable().optional(),
  otherFeesJson: z.record(z.number()).nullable().optional(),
  hstRate: z.number().min(0).max(1).optional(),
  effectiveDate: z.string().optional(),
});

trimsRouter.get("/", async (req, res, next) => {
  try {
    const filters = {
      model: typeof req.query.model === "string" ? req.query.model : undefined,
      make: typeof req.query.make === "string" ? req.query.make : undefined,
      year: req.query.year ? Number(req.query.year) : undefined,
      powertrain:
        typeof req.query.powertrain === "string"
          ? (req.query.powertrain.toUpperCase() as PowertrainType)
          : undefined,
      maxPrice: req.query.maxPrice ? Number(req.query.maxPrice) : undefined,
    };
    const trims = await listTrims(filters);
    res.json({ trims });
  } catch (e) {
    next(e);
  }
});

trimsRouter.get("/:slug", async (req, res, next) => {
  try {
    const slug = req.params.slug;
    if (!slug) return res.status(400).json({ error: "missing_slug" });
    const trim = await getTrimBySlug(slug);
    if (!trim) return res.status(404).json({ error: "not_found" });
    res.json(trim);
  } catch (e) {
    next(e);
  }
});

trimsRouter.get("/:slug/quote", async (req, res, next) => {
  try {
    const slug = req.params.slug;
    if (!slug) return res.status(400).json({ error: "missing_slug" });
    const trim = await getTrimBySlug(slug);
    if (!trim) return res.status(404).json({ error: "not_found" });
    const fee = trim.fees[0] ?? null;
    const colorSlug = typeof req.query.color === "string" ? req.query.color : undefined;
    let colorPremium: { colorName: string; amount: number } | undefined;
    if (colorSlug) {
      const match = trim.colors.find((c) => c.bodyColor.slug === colorSlug);
      if (!match) return res.status(404).json({ error: "color_not_available_for_trim", color: colorSlug });
      const premium = match.premiumChargeCad ? Number(match.premiumChargeCad.toString()) : 0;
      colorPremium = { colorName: match.bodyColor.name, amount: premium };
    }
    const quote = computeQuote(trim.msrpCad, fee, colorPremium);
    res.json({
      trim: { slug: trim.slug, name: trim.name, year: trim.year, model: trim.model.name },
      ...quote,
      effectiveDate: fee?.effectiveDate ?? null,
    });
  } catch (e) {
    next(e);
  }
});

trimsRouter.post("/", async (req, res, next) => {
  try {
    const data = trimInputSchema.parse(req.body);
    const trim = await prisma.trim.create({ data });
    await bumpCatalogVersion();
    res.status(201).json(trim);
  } catch (e) {
    next(e);
  }
});

trimsRouter.patch("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const data = trimInputSchema.partial().parse(req.body);
    const trim = await prisma.trim.update({ where: { id }, data });
    await bumpCatalogVersion();
    res.json(trim);
  } catch (e) {
    next(e);
  }
});

trimsRouter.delete("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await prisma.trim.delete({ where: { id } });
    await bumpCatalogVersion();
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

trimsRouter.put("/:id/fees", async (req, res, next) => {
  try {
    const trimId = Number(req.params.id);
    const input = feeInputSchema.parse(req.body);
    const effectiveDate = input.effectiveDate ? new Date(input.effectiveDate) : new Date();
    const { otherFeesJson, effectiveDate: _ed, ...rest } = input;
    const data = {
      ...rest,
      otherFeesJson: otherFeesJson === null ? Prisma.JsonNull : otherFeesJson === undefined ? undefined : (otherFeesJson as Prisma.InputJsonValue),
    };
    const fee = await prisma.fee.upsert({
      where: { trimId_effectiveDate: { trimId, effectiveDate } },
      create: { trimId, effectiveDate, ...data },
      update: data,
    });
    await bumpCatalogVersion();
    res.json(fee);
  } catch (e) {
    next(e);
  }
});
