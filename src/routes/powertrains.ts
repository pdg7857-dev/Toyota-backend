import { Router } from "express";
import { z } from "zod";
import { PowertrainType } from "@prisma/client";
import { prisma, bumpCatalogVersion } from "../db/client.js";

export const powertrainsRouter: Router = Router();

const powertrainSchema = z.object({
  type: z.nativeEnum(PowertrainType),
  displayName: z.string().min(1),
  engineDesc: z.string().nullable().optional(),
  horsepowerHp: z.number().int().nullable().optional(),
  torqueLbft: z.number().int().nullable().optional(),
  transmission: z.string().nullable().optional(),
  drivetrain: z.string().nullable().optional(),
  batteryKwh: z.number().nullable().optional(),
  electricRangeKm: z.number().int().nullable().optional(),
  fuelEconomyCityL100: z.number().nullable().optional(),
  fuelEconomyHwyL100: z.number().nullable().optional(),
  fuelEconomyCombL100: z.number().nullable().optional(),
});

powertrainsRouter.get("/", async (_req, res, next) => {
  try {
    const list = await prisma.powertrain.findMany({ orderBy: { displayName: "asc" } });
    res.json({ powertrains: list });
  } catch (e) {
    next(e);
  }
});

powertrainsRouter.post("/", async (req, res, next) => {
  try {
    const data = powertrainSchema.parse(req.body);
    const created = await prisma.powertrain.create({ data });
    await bumpCatalogVersion();
    res.status(201).json(created);
  } catch (e) {
    next(e);
  }
});

powertrainsRouter.patch("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const data = powertrainSchema.partial().parse(req.body);
    const updated = await prisma.powertrain.update({ where: { id }, data });
    await bumpCatalogVersion();
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

powertrainsRouter.delete("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await prisma.powertrain.delete({ where: { id } });
    await bumpCatalogVersion();
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});
