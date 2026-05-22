import { Router } from "express";
import { z } from "zod";
import { IncentiveKind } from "@prisma/client";
import { prisma, bumpCatalogVersion } from "../db/client.js";

export const incentivesRouter: Router = Router();

const incentiveSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  kind: z.nativeEnum(IncentiveKind),
  amountCad: z.number().nullable().optional(),
  stackable: z.boolean().optional(),
  eligibleMakes: z.array(z.string()).optional(),
  eligibleSlugs: z.array(z.string()).optional(),
  eligibleYears: z.array(z.number().int()).optional(),
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable().optional(),
  notesMd: z.string().nullable().optional(),
  active: z.boolean().optional(),
});

incentivesRouter.get("/", async (req, res, next) => {
  try {
    const activeOnly = req.query.activeOnly !== "false";
    const now = new Date();
    const list = await prisma.incentive.findMany({
      where: activeOnly
        ? { active: true, effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] }
        : undefined,
      orderBy: { name: "asc" },
    });
    res.json({ incentives: list });
  } catch (e) {
    next(e);
  }
});

// Compute eligible stackable + non-stackable incentives for a trim slug.
incentivesRouter.get("/for-trim/:slug", async (req, res, next) => {
  try {
    const slug = req.params.slug;
    if (!slug) return res.status(400).json({ error: "missing_slug" });
    const trim = await prisma.trim.findUnique({ where: { slug }, include: { model: true } });
    if (!trim) return res.status(404).json({ error: "trim_not_found" });
    const now = new Date();
    const all = await prisma.incentive.findMany({
      where: { active: true, effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] },
    });
    const eligible = all.filter((i) => {
      if (i.eligibleMakes.length > 0 && !i.eligibleMakes.includes(trim.model.make)) return false;
      if (i.eligibleSlugs.length > 0 && !i.eligibleSlugs.includes(trim.model.slug)) return false;
      if (i.eligibleYears.length > 0 && !i.eligibleYears.includes(trim.year)) return false;
      return true;
    });
    const stackable = eligible.filter((i) => i.stackable);
    const nonStackable = eligible.filter((i) => !i.stackable);
    const maxStackTotal = stackable.reduce(
      (acc, i) => acc + (i.amountCad ? Number(i.amountCad.toString()) : 0),
      0,
    );
    res.json({ trim: { slug: trim.slug, year: trim.year, model: trim.model.slug, make: trim.model.make }, stackable, nonStackable, maxStackTotal });
  } catch (e) {
    next(e);
  }
});

incentivesRouter.post("/", async (req, res, next) => {
  try {
    const data = incentiveSchema.parse(req.body);
    const row = await prisma.incentive.create({
      data: {
        ...data,
        effectiveFrom: new Date(data.effectiveFrom),
        effectiveTo: data.effectiveTo ? new Date(data.effectiveTo) : null,
        eligibleMakes: data.eligibleMakes ?? [],
        eligibleSlugs: data.eligibleSlugs ?? [],
        eligibleYears: data.eligibleYears ?? [],
      },
    });
    await bumpCatalogVersion();
    res.status(201).json(row);
  } catch (e) {
    next(e);
  }
});

incentivesRouter.patch("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const data = incentiveSchema.partial().parse(req.body);
    const row = await prisma.incentive.update({
      where: { id },
      data: {
        ...data,
        effectiveFrom: data.effectiveFrom ? new Date(data.effectiveFrom) : undefined,
        effectiveTo: data.effectiveTo !== undefined ? (data.effectiveTo ? new Date(data.effectiveTo) : null) : undefined,
      },
    });
    await bumpCatalogVersion();
    res.json(row);
  } catch (e) {
    next(e);
  }
});

incentivesRouter.delete("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await prisma.incentive.delete({ where: { id } });
    await bumpCatalogVersion();
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});
