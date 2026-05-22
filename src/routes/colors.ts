import { Router } from "express";
import { z } from "zod";
import { BodyColorType } from "@prisma/client";
import { prisma, bumpCatalogVersion } from "../db/client.js";

export const colorsRouter: Router = Router();

const colorSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  hex: z.string().nullable().optional(),
  type: z.nativeEnum(BodyColorType).optional(),
  notesMd: z.string().nullable().optional(),
});

const trimColorSchema = z.object({
  trimId: z.number().int().positive(),
  bodyColorId: z.number().int().positive(),
  available: z.boolean().optional(),
  premiumChargeCad: z.number().nonnegative().nullable().optional(),
  notesMd: z.string().nullable().optional(),
});

colorsRouter.get("/", async (_req, res, next) => {
  try {
    const colors = await prisma.bodyColor.findMany({ orderBy: { name: "asc" } });
    res.json({ colors });
  } catch (e) {
    next(e);
  }
});

colorsRouter.post("/", async (req, res, next) => {
  try {
    const data = colorSchema.parse(req.body);
    const created = await prisma.bodyColor.create({ data });
    await bumpCatalogVersion();
    res.status(201).json(created);
  } catch (e) {
    next(e);
  }
});

colorsRouter.patch("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const data = colorSchema.partial().parse(req.body);
    const updated = await prisma.bodyColor.update({ where: { id }, data });
    await bumpCatalogVersion();
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

colorsRouter.delete("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await prisma.bodyColor.delete({ where: { id } });
    await bumpCatalogVersion();
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// Trim-color availability (the join table)
colorsRouter.get("/trim/:trimId", async (req, res, next) => {
  try {
    const trimId = Number(req.params.trimId);
    const list = await prisma.trimColor.findMany({
      where: { trimId },
      include: { bodyColor: true },
      orderBy: { bodyColor: { name: "asc" } },
    });
    res.json({ trimColors: list });
  } catch (e) {
    next(e);
  }
});

colorsRouter.put("/trim", async (req, res, next) => {
  try {
    const data = trimColorSchema.parse(req.body);
    const row = await prisma.trimColor.upsert({
      where: { trimId_bodyColorId: { trimId: data.trimId, bodyColorId: data.bodyColorId } },
      create: data,
      update: {
        available: data.available,
        premiumChargeCad: data.premiumChargeCad,
        notesMd: data.notesMd,
      },
    });
    await bumpCatalogVersion();
    res.json(row);
  } catch (e) {
    next(e);
  }
});

colorsRouter.delete("/trim/:trimColorId", async (req, res, next) => {
  try {
    const id = Number(req.params.trimColorId);
    await prisma.trimColor.delete({ where: { id } });
    await bumpCatalogVersion();
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});
