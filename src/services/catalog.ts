import { prisma } from "../db/client.js";
import type { Prisma, PowertrainType } from "@prisma/client";

export async function listModels(year?: number, make?: string) {
  return prisma.model.findMany({
    where: make ? { make } : undefined,
    orderBy: [{ make: "asc" }, { name: "asc" }],
    include: year
      ? { trims: { where: { year }, select: { id: true, name: true, year: true, slug: true, msrpCad: true } } }
      : { trims: { select: { id: true, name: true, year: true, slug: true, msrpCad: true } } },
  });
}

export async function getModelBySlug(slug: string) {
  return prisma.model.findUnique({
    where: { slug },
    include: {
      trims: {
        include: { powertrain: true, fees: { orderBy: { effectiveDate: "desc" }, take: 1 } },
        orderBy: [{ year: "desc" }, { msrpCad: "asc" }],
      },
      warranties: true,
    },
  });
}

export type TrimFilters = {
  model?: string;
  make?: string;
  year?: number;
  powertrain?: PowertrainType;
  maxPrice?: number;
};

export async function listTrims(filters: TrimFilters) {
  const where: Prisma.TrimWhereInput = {};
  if (filters.model || filters.make) {
    where.model = {};
    if (filters.model) where.model.slug = filters.model;
    if (filters.make) where.model.make = filters.make;
  }
  if (filters.year) where.year = filters.year;
  if (filters.powertrain) where.powertrain = { type: filters.powertrain };
  if (filters.maxPrice) where.msrpCad = { lte: filters.maxPrice };
  return prisma.trim.findMany({
    where,
    include: { model: true, powertrain: true, fees: { orderBy: { effectiveDate: "desc" }, take: 1 } },
    orderBy: [{ year: "desc" }, { msrpCad: "asc" }],
  });
}

export async function getTrimBySlug(slug: string) {
  const trim = await prisma.trim.findUnique({
    where: { slug },
    include: {
      model: true,
      powertrain: true,
      fees: { orderBy: { effectiveDate: "desc" }, take: 1 },
      colors: { include: { bodyColor: true }, orderBy: { bodyColor: { name: "asc" } } },
    },
  });
  if (!trim) return null;
  const warranties = await prisma.warrantyCoverage.findMany({
    where: {
      modelId: trim.modelId,
      year: trim.year,
      OR: [
        { appliesToPowertrains: { isEmpty: true } },
        { appliesToPowertrains: { has: trim.powertrain.type } },
      ],
    },
  });
  return { ...trim, applicableWarranties: warranties };
}

export async function listWarranties(model?: string, year?: number) {
  const where: Prisma.WarrantyCoverageWhereInput = {};
  if (model) where.model = { slug: model };
  if (year) where.year = year;
  return prisma.warrantyCoverage.findMany({ where, include: { model: true }, orderBy: { coverageType: "asc" } });
}

export async function listFinanceProducts(category?: string) {
  return prisma.financeProduct.findMany({
    where: category ? { category: category as Prisma.FinanceProductWhereInput["category"], active: true } : { active: true },
    orderBy: { name: "asc" },
  });
}

export async function listRepNotes(opts: { scope?: string; scopeId?: number; tags?: string[] }) {
  const where: Prisma.RepNoteWhereInput = {};
  if (opts.scope) where.scopeType = opts.scope as Prisma.RepNoteWhereInput["scopeType"];
  if (opts.scopeId !== undefined) where.scopeId = opts.scopeId;
  if (opts.tags && opts.tags.length > 0) where.tags = { hasSome: opts.tags };
  return prisma.repNote.findMany({ where, orderBy: { updatedAt: "desc" } });
}
