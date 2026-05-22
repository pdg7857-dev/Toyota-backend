// Seed runner for the multi-brand comparison-site data.
// Run with: `npm run db:seed:comparison`
//
// Idempotent — safe to re-run. Uses brand slug + model slug as the upsert
// key, so updates to comparison-seed-data.ts overwrite the matching rows
// without duplicating data.

import {
  PrismaClient,
  IssueSeverity,
  IssueStatus,
} from "@prisma/client";
import { BRANDS, COMPARISON_MODELS } from "./comparison-seed-data.js";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding multi-brand comparison data…");

  // 1. Brands
  for (const b of BRANDS) {
    await prisma.brand.upsert({
      where: { slug: b.slug },
      create: { ...b },
      update: { ...b },
    });
  }
  console.log(`  ${BRANDS.length} brands`);

  // 2. Models (link by brand slug → id), then ownership cost, pros/cons,
  //    common issues. We attach to existing Models if their slug already
  //    exists (Toyota seed creates them too); otherwise create fresh.
  let modelCount = 0;
  let ownershipCount = 0;
  let prosConsCount = 0;
  let issueCount = 0;
  for (const m of COMPARISON_MODELS) {
    const brand = await prisma.brand.findUnique({ where: { slug: m.brandSlug } });
    if (!brand) {
      console.warn(`  unknown brand slug ${m.brandSlug} for model ${m.slug} — skipping`);
      continue;
    }
    const model = await prisma.model.upsert({
      where: { slug: m.slug },
      create: {
        slug: m.slug,
        name: m.name,
        brandId: brand.id,
        bodyStyle: m.bodyStyle,
        segment: m.segment,
        startingMsrpCad: m.startingMsrpCad,
        notesMd: m.notesMd,
      },
      update: {
        name: m.name,
        brandId: brand.id,
        bodyStyle: m.bodyStyle,
        segment: m.segment,
        startingMsrpCad: m.startingMsrpCad,
        notesMd: m.notesMd ?? undefined,
      },
    });
    modelCount += 1;

    // Ownership cost (one row per modelId × year)
    const o = m.ownership;
    await prisma.ownershipCost.upsert({
      where: { modelId_year: { modelId: model.id, year: o.year } },
      create: { ...o, modelId: model.id },
      update: { ...o },
    });
    ownershipCount += 1;

    // Pros/cons — clear and re-insert (idempotent, ordered by weight)
    await prisma.proCon.deleteMany({ where: { modelId: model.id } });
    for (const pc of m.prosCons) {
      await prisma.proCon.create({
        data: {
          modelId: model.id,
          isPro: pc.isPro,
          text: pc.text,
          weight: pc.weight ?? 1,
        },
      });
      prosConsCount += 1;
    }

    // Common issues — match by title (per model). Update count/severity if it
    // exists; create otherwise.
    for (const issue of m.commonIssues) {
      const existing = await prisma.commonIssue.findFirst({
        where: { modelId: model.id, title: issue.title },
      });
      const data = {
        title: issue.title,
        description: issue.description,
        severity: issue.severity as IssueSeverity,
        status: (issue.status ?? "REPORTED") as IssueStatus,
        yearsAffected: issue.yearsAffected,
        mentionCount: issue.mentionCount ?? 1,
        sourceUrl: issue.sourceUrl,
        modelId: model.id,
      };
      if (existing) {
        await prisma.commonIssue.update({ where: { id: existing.id }, data });
      } else {
        await prisma.commonIssue.create({ data });
      }
      issueCount += 1;
    }
  }

  console.log(`  ${modelCount} comparison models`);
  console.log(`  ${ownershipCount} ownership-cost rows`);
  console.log(`  ${prosConsCount} pros/cons`);
  console.log(`  ${issueCount} common issues`);

  // 3. Bump catalog version so the existing AI cache invalidates.
  await prisma.meta.upsert({
    where: { id: 1 },
    create: { id: 1, catalogVersion: 1 },
    update: { catalogVersion: { increment: 1 } },
  });

  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
