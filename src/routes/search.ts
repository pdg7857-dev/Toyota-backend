import { Router } from "express";
import { z } from "zod";
import { Prisma, PowertrainType } from "@prisma/client";
import { prisma } from "../db/client.js";
import { computeQuote } from "../services/pricing.js";

export const searchRouter: Router = Router();

const searchSchema = z.object({
  make: z.enum(["Toyota", "Lexus"]).optional(),
  year: z.number().int().optional(),
  bodyStyles: z.array(z.string()).optional(),
  segments: z.array(z.string()).optional(),
  powertrains: z.array(z.nativeEnum(PowertrainType)).optional(),
  drivetrainContains: z.string().optional(),
  colorSlugs: z.array(z.string()).optional(),
  minHp: z.number().int().optional(),
  maxHp: z.number().int().optional(),
  maxComboL100: z.number().optional(),
  minElectricRangeKm: z.number().int().optional(),
  maxMsrpCad: z.number().optional(),
  maxTotalCad: z.number().optional(),
  hybridOnly: z.boolean().optional(),
  awdOnly: z.boolean().optional(),
  sortBy: z
    .enum(["msrp", "total", "fuel_economy", "horsepower", "electric_range"])
    .optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

searchRouter.post("/", async (req, res, next) => {
  try {
    const f = searchSchema.parse(req.body);

    const where: Prisma.TrimWhereInput = {};
    if (f.year) where.year = f.year;
    const modelWhere: Prisma.ModelWhereInput = {};
    if (f.make) modelWhere.make = f.make;
    if (f.bodyStyles && f.bodyStyles.length > 0) modelWhere.bodyStyle = { in: f.bodyStyles };
    if (f.segments && f.segments.length > 0) modelWhere.segment = { in: f.segments };
    if (Object.keys(modelWhere).length > 0) where.model = modelWhere;
    if (f.maxMsrpCad != null) where.msrpCad = { lte: f.maxMsrpCad };
    if (f.colorSlugs && f.colorSlugs.length > 0) {
      where.colors = { some: { available: true, bodyColor: { slug: { in: f.colorSlugs } } } };
    }

    const powertrainWhere: Prisma.PowertrainWhereInput = {};
    let needsPtFilter = false;
    if (f.hybridOnly) {
      powertrainWhere.type = { in: [PowertrainType.HYBRID, PowertrainType.PHEV, PowertrainType.BEV] };
      needsPtFilter = true;
    } else if (f.powertrains && f.powertrains.length > 0) {
      powertrainWhere.type = { in: f.powertrains };
      needsPtFilter = true;
    }
    if (f.awdOnly || f.drivetrainContains) {
      const term = f.awdOnly ? "AWD" : f.drivetrainContains!;
      powertrainWhere.drivetrain = { contains: term, mode: "insensitive" };
      needsPtFilter = true;
    }
    const hpFilter: Prisma.IntNullableFilter = {};
    if (f.minHp != null) hpFilter.gte = f.minHp;
    if (f.maxHp != null) hpFilter.lte = f.maxHp;
    if (f.minHp != null || f.maxHp != null) {
      powertrainWhere.horsepowerHp = hpFilter;
      needsPtFilter = true;
    }
    if (f.maxComboL100 != null) {
      powertrainWhere.fuelEconomyCombL100 = { lte: f.maxComboL100 };
      needsPtFilter = true;
    }
    if (f.minElectricRangeKm != null) {
      powertrainWhere.electricRangeKm = { gte: f.minElectricRangeKm };
      needsPtFilter = true;
    }
    if (needsPtFilter) where.powertrain = powertrainWhere;

    const orderBy: Prisma.TrimOrderByWithRelationInput[] = [];
    const dir = f.sortDir ?? "asc";
    switch (f.sortBy) {
      case "fuel_economy":
        orderBy.push({ powertrain: { fuelEconomyCombL100: dir } });
        break;
      case "horsepower":
        orderBy.push({ powertrain: { horsepowerHp: dir } });
        break;
      case "electric_range":
        orderBy.push({ powertrain: { electricRangeKm: dir } });
        break;
      case "total":
      case "msrp":
      default:
        orderBy.push({ msrpCad: dir });
    }
    orderBy.push({ year: "desc" });

    const trims = await prisma.trim.findMany({
      where,
      include: {
        model: true,
        powertrain: true,
        fees: { orderBy: { effectiveDate: "desc" }, take: 1 },
      },
      orderBy,
      take: f.limit ?? 50,
    });

    const results = trims.map((t) => {
      const fee = t.fees[0] ?? null;
      const quote = computeQuote(t.msrpCad, fee);
      return {
        slug: t.slug,
        year: t.year,
        name: t.name,
        model: { slug: t.model.slug, name: t.model.name, bodyStyle: t.model.bodyStyle, segment: t.model.segment },
        powertrain: {
          type: t.powertrain.type,
          displayName: t.powertrain.displayName,
          horsepowerHp: t.powertrain.horsepowerHp,
          drivetrain: t.powertrain.drivetrain,
          fuelEconomyCombL100: t.powertrain.fuelEconomyCombL100,
          electricRangeKm: t.powertrain.electricRangeKm,
        },
        msrp: quote.msrp,
        total: quote.total,
      };
    });

    // maxTotalCad filter is applied post-quote because it depends on fees+HST math
    const filtered = f.maxTotalCad != null ? results.filter((r) => r.total <= f.maxTotalCad!) : results;

    // Re-sort if sortBy=total (DB sort can't see total)
    if (f.sortBy === "total") {
      filtered.sort((a, b) => (dir === "asc" ? a.total - b.total : b.total - a.total));
    }

    res.json({ count: filtered.length, results: filtered });
  } catch (e) {
    next(e);
  }
});
