import { prisma, getCatalogVersion } from "../../db/client.js";
import { PowertrainType } from "@prisma/client";

function decimalToNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return v;
  if (typeof v === "object" && v !== null && "toString" in v) return Number((v as { toString: () => string }).toString());
  return Number(v as string);
}

type Question = { text: string };

export type CatalogContext = {
  catalogVersion: number;
  fullCatalogBlock: string;
  scopedBlock: string;
  scopedModels: string[];
};

const POWERTRAIN_TOKENS: Record<string, PowertrainType> = {
  hybrid: PowertrainType.HYBRID,
  hev: PowertrainType.HYBRID,
  phev: PowertrainType.PHEV,
  "plug-in": PowertrainType.PHEV,
  prime: PowertrainType.PHEV,
  bev: PowertrainType.BEV,
  electric: PowertrainType.BEV,
  ev: PowertrainType.BEV,
  gas: PowertrainType.GAS,
  gasoline: PowertrainType.GAS,
};

async function extractScopeFromQuestion(question: string): Promise<{ modelSlugs: string[]; years: number[]; powertrains: PowertrainType[] }> {
  const lower = question.toLowerCase();
  const allModels = await prisma.model.findMany({ select: { slug: true, name: true } });
  const modelSlugs = allModels
    .filter((m) => lower.includes(m.slug.toLowerCase()) || lower.includes(m.name.toLowerCase()))
    .map((m) => m.slug);
  const years: number[] = [];
  for (const y of [2025, 2026]) if (lower.includes(String(y))) years.push(y);
  const powertrains: PowertrainType[] = [];
  for (const [tok, pt] of Object.entries(POWERTRAIN_TOKENS)) {
    if (lower.includes(tok) && !powertrains.includes(pt)) powertrains.push(pt);
  }
  return { modelSlugs, years, powertrains };
}

async function buildFullCatalogSummary(): Promise<string> {
  const models = await prisma.model.findMany({
    include: {
      trims: {
        include: { powertrain: { select: { type: true, displayName: true } } },
        orderBy: [{ year: "desc" }, { msrpCad: "asc" }],
      },
    },
    orderBy: { name: "asc" },
  });
  const lines: string[] = ["# Catalog summary (all models, compact)"];
  for (const m of models) {
    lines.push(`\n## [model:${m.slug}] ${m.name}${m.bodyStyle ? ` (${m.bodyStyle})` : ""}`);
    if (m.segment) lines.push(`Segment: ${m.segment}`);
    if (m.trims.length === 0) {
      lines.push("- No trims seeded.");
      continue;
    }
    for (const t of m.trims) {
      const price = decimalToNum(t.msrpCad);
      lines.push(
        `- [trim:${t.slug}] ${t.year} ${t.name} — ${t.powertrain.type} (${t.powertrain.displayName}) — MSRP $${price?.toLocaleString("en-CA") ?? "?"}`,
      );
    }
  }
  return lines.join("\n");
}

async function buildScopedBlock(
  modelSlugs: string[],
  years: number[],
  powertrains: PowertrainType[],
): Promise<string> {
  if (modelSlugs.length === 0 && years.length === 0 && powertrains.length === 0) {
    const globalNotes = await prisma.repNote.findMany({ where: { scopeType: "GLOBAL" }, take: 20 });
    const finance = await prisma.financeProduct.findMany({ where: { active: true } });
    const lines: string[] = ["\n# Rep notes (global) and F&I products"];
    for (const n of globalNotes) lines.push(`\n## [rep_note:${n.id}] ${n.title}\nTags: ${n.tags.join(", ")}\n${n.bodyMd}`);
    for (const fp of finance)
      lines.push(`\n## [finance_product:${fp.id}] ${fp.name} (${fp.category})\n${fp.descriptionMd ?? ""}\nPricing: ${fp.pricingNotes ?? "n/a"}`);
    return lines.join("\n");
  }
  const models = await prisma.model.findMany({
    where: modelSlugs.length > 0 ? { slug: { in: modelSlugs } } : undefined,
    include: {
      trims: {
        where: {
          ...(years.length > 0 ? { year: { in: years } } : {}),
          ...(powertrains.length > 0 ? { powertrain: { type: { in: powertrains } } } : {}),
        },
        include: { powertrain: true, fees: { orderBy: { effectiveDate: "desc" }, take: 1 } },
        orderBy: [{ year: "desc" }, { msrpCad: "asc" }],
      },
      warranties: {
        where: years.length > 0 ? { year: { in: years } } : undefined,
      },
    },
  });
  const lines: string[] = ["\n# Scoped detail"];
  for (const m of models) {
    lines.push(`\n## [model:${m.slug}] ${m.name}`);
    if (m.notesMd) lines.push(`Notes: ${m.notesMd}`);
    for (const t of m.trims) {
      const fee = t.fees[0];
      lines.push(`\n### [trim:${t.slug}] ${t.year} ${t.name}`);
      lines.push(`- MSRP: $${decimalToNum(t.msrpCad)?.toLocaleString("en-CA")}`);
      lines.push(
        `- Powertrain: ${t.powertrain.type} — ${t.powertrain.displayName}${t.powertrain.horsepowerHp ? ` (${t.powertrain.horsepowerHp} hp)` : ""}`,
      );
      if (t.powertrain.drivetrain) lines.push(`- Drivetrain: ${t.powertrain.drivetrain}`);
      if (t.powertrain.fuelEconomyCombL100) lines.push(`- Combined fuel economy: ${t.powertrain.fuelEconomyCombL100} L/100km`);
      if (fee) {
        lines.push(
          `- Fees: freight/PDI $${decimalToNum(fee.freightPdiCad) ?? "?"} · A/C $${decimalToNum(fee.acExciseCad) ?? "?"} · OMVIC $${decimalToNum(fee.omvicFeeCad) ?? "?"} · tire $${decimalToNum(fee.tireStewardshipCad) ?? "?"} · dealer admin $${decimalToNum(fee.dealerAdminCad) ?? "?"}`,
        );
      }
      if (t.notesMd) lines.push(`- Rep notes: ${t.notesMd}`);
    }
    for (const w of m.warranties) {
      const distance = w.distanceKm ? `${w.distanceKm.toLocaleString("en-CA")} km` : "unlimited km";
      lines.push(`\n### [warranty:${w.id}] ${w.coverageType} (${w.year} ${m.name})`);
      lines.push(`- ${w.durationMonths ?? "?"} months / ${distance}`);
      if (w.appliesToPowertrains.length > 0) lines.push(`- Applies to: ${w.appliesToPowertrains.join(", ")}`);
      if (w.descriptionMd) lines.push(`- ${w.descriptionMd}`);
    }
  }
  if (modelSlugs.length > 0) {
    const trimIds = models.flatMap((m) => m.trims.map((t) => t.id));
    const modelIds = models.map((m) => m.id);
    const trimNotes = trimIds.length > 0
      ? await prisma.repNote.findMany({ where: { scopeType: "TRIM", scopeId: { in: trimIds } } })
      : [];
    const modelNotes = modelIds.length > 0
      ? await prisma.repNote.findMany({ where: { scopeType: "MODEL", scopeId: { in: modelIds } } })
      : [];
    for (const n of [...modelNotes, ...trimNotes]) {
      lines.push(`\n### [rep_note:${n.id}] ${n.title} (${n.scopeType})`);
      lines.push(n.bodyMd);
    }
  }
  return lines.join("\n");
}

export async function buildCatalogContext(question: Question): Promise<CatalogContext> {
  const catalogVersion = await getCatalogVersion();
  const fullCatalogBlock = await buildFullCatalogSummary();
  const scope = await extractScopeFromQuestion(question.text);
  const scopedBlock = await buildScopedBlock(scope.modelSlugs, scope.years, scope.powertrains);
  return {
    catalogVersion,
    fullCatalogBlock: `<catalog version="${catalogVersion}">\n${fullCatalogBlock}\n</catalog>`,
    scopedBlock,
    scopedModels: scope.modelSlugs,
  };
}
