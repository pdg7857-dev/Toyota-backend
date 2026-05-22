import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/client.js";

export const maintenanceRouter: Router = Router();

const projectionSchema = z.object({
  modelSlug: z.string().optional(),
  targetKm: z.number().int().positive(),
  labourRateCad: z.number().nonnegative().default(180),
  startingKm: z.number().int().nonnegative().default(0),
});

maintenanceRouter.get("/", async (req, res, next) => {
  try {
    const modelSlug = typeof req.query.modelSlug === "string" ? req.query.modelSlug : undefined;
    const rows = await prisma.maintenanceInterval.findMany({
      where: modelSlug ? { OR: [{ modelSlug }, { modelSlug: null }] } : undefined,
      orderBy: { intervalKm: "asc" },
    });
    res.json({ intervals: rows });
  } catch (e) {
    next(e);
  }
});

// Project total cost from startingKm up to targetKm.
maintenanceRouter.post("/project", async (req, res, next) => {
  try {
    const input = projectionSchema.parse(req.body);
    const allIntervals = await prisma.maintenanceInterval.findMany({
      where: input.modelSlug
        ? { OR: [{ modelSlug: input.modelSlug }, { modelSlug: null }] }
        : { modelSlug: null },
      orderBy: { intervalKm: "asc" },
    });

    // Compute the periodic services hit between startingKm and targetKm.
    // Services repeat at multiples of their intervalKm. E.g. 8k oil change
    // applies at 8, 16, 24, 32, ... so it overlaps with the 16k major service.
    // We let each interval row "fire" at every multiple — services include
    // base oil change in both 8k and 16k, so this matches real cost-of-service.
    const lineItems: Array<{ km: number; intervalKm: number; services: string[]; partsCost: number; labourCost: number }> = [];
    for (let km = Math.max(1, input.startingKm + 1); km <= input.targetKm; km++) {
      for (const intv of allIntervals) {
        if (km % intv.intervalKm === 0) {
          const services = ((intv.servicesJson as { services?: string[] } | null)?.services) ?? [];
          const partsCost = intv.partsCostCad ? Number(intv.partsCostCad.toString()) : 0;
          const labourCost = intv.labourMinutes ? (intv.labourMinutes / 60) * input.labourRateCad : 0;
          lineItems.push({
            km,
            intervalKm: intv.intervalKm,
            services,
            partsCost: Math.round(partsCost * 100) / 100,
            labourCost: Math.round(labourCost * 100) / 100,
          });
        }
      }
    }

    const totalParts = lineItems.reduce((a, l) => a + l.partsCost, 0);
    const totalLabour = lineItems.reduce((a, l) => a + l.labourCost, 0);
    const total = Math.round((totalParts + totalLabour) * 100) / 100;

    res.json({
      modelSlug: input.modelSlug ?? null,
      startingKm: input.startingKm,
      targetKm: input.targetKm,
      labourRateCad: input.labourRateCad,
      lineItems,
      totals: {
        parts: Math.round(totalParts * 100) / 100,
        labour: Math.round(totalLabour * 100) / 100,
        total,
        visits: lineItems.length,
      },
    });
  } catch (e) {
    next(e);
  }
});
