// Compare scraped data against live DB rows. For each field-level
// difference, write a scrape_diffs row with decision='PENDING'. The rep
// reviews these via the admin endpoints/UI and accepts/rejects each one
// individually before any DB writes hit the catalog tables.

import { PrismaClient, ScrapeDiffDecision } from "@prisma/client";
import type { ScrapeResult, ScrapedTrim } from "./types.js";

const prisma = new PrismaClient();

function trimMatchKey(modelSlug: string, year: number, trimName: string): string {
  return `${modelSlug}|${year}|${trimName.toLowerCase().replace(/\s+/g, "-")}`;
}

async function diffTrims(runId: number, scraped: ScrapedTrim[]): Promise<number> {
  let diffCount = 0;
  // Build a lookup of existing trims by (model slug, year, trim name).
  const dbTrims = await prisma.trim.findMany({ include: { model: true } });
  const dbByKey = new Map<string, (typeof dbTrims)[number]>();
  for (const t of dbTrims) {
    dbByKey.set(trimMatchKey(t.model.slug, t.year, t.name), t);
  }

  for (const s of scraped) {
    const key = trimMatchKey(s.modelSlug, s.year, s.trimName);
    const db = dbByKey.get(key);
    if (!db) {
      await prisma.scrapeDiff.create({
        data: {
          runId,
          tableName: "trims",
          recordPk: key,
          field: "_new_row",
          oldValue: null,
          newValue: JSON.stringify({
            modelSlug: s.modelSlug,
            year: s.year,
            name: s.trimName,
            msrpCad: s.msrpCad,
            powertrainHint: s.powertrainHint,
            sourceUrl: s.sourceUrl,
          }),
          decision: ScrapeDiffDecision.PENDING,
        },
      });
      diffCount += 1;
      continue;
    }
    if (s.msrpCad != null) {
      const dbMsrp = Number(db.msrpCad.toString());
      if (Math.abs(dbMsrp - s.msrpCad) >= 0.01) {
        await prisma.scrapeDiff.create({
          data: {
            runId,
            tableName: "trims",
            recordPk: String(db.id),
            field: "msrpCad",
            oldValue: dbMsrp.toFixed(2),
            newValue: s.msrpCad.toFixed(2),
            decision: ScrapeDiffDecision.PENDING,
          },
        });
        diffCount += 1;
      }
    }
  }
  return diffCount;
}

export async function diffAndStore(runId: number, result: ScrapeResult): Promise<{ diffCount: number }> {
  const trimDiffs = await diffTrims(runId, result.trims);
  await prisma.scrapeRun.update({
    where: { id: runId },
    data: {
      finishedAt: new Date(),
      summaryJson: {
        diffCount: trimDiffs,
        modelsScraped: result.models.length,
        trimsScraped: result.trims.length,
        warnings: result.warnings,
      },
    },
  });
  return { diffCount: trimDiffs };
}

export async function applyAcceptedDiffs(runId: number): Promise<{ applied: number }> {
  const accepted = await prisma.scrapeDiff.findMany({
    where: { runId, decision: ScrapeDiffDecision.ACCEPT },
  });
  let applied = 0;
  await prisma.$transaction(async (tx) => {
    for (const d of accepted) {
      if (d.tableName === "trims" && d.field === "msrpCad" && d.newValue) {
        const id = Number(d.recordPk);
        if (Number.isFinite(id)) {
          await tx.trim.update({ where: { id }, data: { msrpCad: Number(d.newValue) } });
          applied += 1;
        }
      }
      // New-row creation is left manual on purpose — schema needs powertrainId,
      // slug, etc. that the scraper can't reliably infer.
    }
    await tx.scrapeRun.update({ where: { id: runId }, data: { status: "APPLIED" } });
    await tx.meta.upsert({
      where: { id: 1 },
      create: { id: 1, catalogVersion: 1 },
      update: { catalogVersion: { increment: 1 } },
    });
  });
  return { applied };
}
