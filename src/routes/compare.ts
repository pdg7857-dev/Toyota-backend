import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/client.js";
import { computeQuote } from "../services/pricing.js";

export const compareRouter: Router = Router();

const compareSchema = z.object({
  trimSlugs: z.array(z.string().min(1)).min(2).max(6),
});

compareRouter.post("/", async (req, res, next) => {
  try {
    const { trimSlugs } = compareSchema.parse(req.body);
    const trims = await prisma.trim.findMany({
      where: { slug: { in: trimSlugs } },
      include: {
        model: true,
        powertrain: true,
        fees: { orderBy: { effectiveDate: "desc" }, take: 1 },
      },
    });
    const found = new Map(trims.map((t) => [t.slug, t]));
    const missing = trimSlugs.filter((s) => !found.has(s));

    const rows = trimSlugs
      .map((slug) => found.get(slug))
      .filter((t): t is NonNullable<typeof t> => Boolean(t))
      .map((t) => {
        const fee = t.fees[0] ?? null;
        const quote = computeQuote(t.msrpCad, fee);
        return {
          slug: t.slug,
          year: t.year,
          name: t.name,
          model: { slug: t.model.slug, name: t.model.name, segment: t.model.segment },
          powertrain: {
            type: t.powertrain.type,
            displayName: t.powertrain.displayName,
            horsepowerHp: t.powertrain.horsepowerHp,
            torqueLbft: t.powertrain.torqueLbft,
            drivetrain: t.powertrain.drivetrain,
            fuelEconomyCombL100: t.powertrain.fuelEconomyCombL100,
            electricRangeKm: t.powertrain.electricRangeKm,
          },
          quote,
          notesMd: t.notesMd,
        };
      });

    // Pull the warranty rows that apply to any of the compared trims, scoped
    // to the model-years involved.
    const modelYearPairs = new Set(rows.map((r) => `${r.model.slug}|${r.year}`));
    const warranties = await prisma.warrantyCoverage.findMany({
      where: {
        OR: rows.map((r) => ({ model: { slug: r.model.slug }, year: r.year })),
      },
      include: { model: true },
    });
    const warrantyByModelYear: Record<string, typeof warranties> = {};
    for (const w of warranties) {
      const k = `${w.model.slug}|${w.year}`;
      if (!modelYearPairs.has(k)) continue;
      (warrantyByModelYear[k] ??= []).push(w);
    }

    res.json({ trims: rows, warrantyByModelYear, missing });
  } catch (e) {
    next(e);
  }
});
