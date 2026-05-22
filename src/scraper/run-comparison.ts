// Comparison-site scrape runner.
//
// `tsx src/scraper/run-comparison.ts [--brands toyota,honda] [--no-reddit]`
//
// Walks every registered brand scraper (Toyota CA / Lexus CA + the stub
// brands), persists any MSRP/segment updates that pass sanity checks, then
// pulls Reddit issue mentions for the models in `DEFAULT_REDDIT_TARGETS`.
//
// Sanity rule: a scraped MSRP overwrites the seed value only when:
//   - it's within ±30% of the seed value (defensive against extracting "$5,000
//     down" instead of MSRP), OR
//   - the model has no seed MSRP yet.
// Same-model rows scraped multiple times in one run keep the lowest plausible
// value (matches "starting at…" UX).

import { PrismaClient, MentionPlatform, Sentiment } from "@prisma/client";
import type { ComparisonScraper, ComparisonScrapeResult } from "./comparison-types.js";
import { scrapeLexusCa } from "./sources/lexus-ca.js";
import { scrapeRedditIssues, DEFAULT_REDDIT_TARGETS } from "./sources/reddit-issues.js";
import { createStubScraper, STUB_BRAND_CONFIGS } from "./sources/stub-brand.js";
import { scrapeToyotaCa } from "./sources/toyota-ca.js";

const prisma = new PrismaClient();
const SANITY_TOLERANCE = 0.3; // 30% drift from seed value triggers a warning skip

function parseArgs(argv: string[]) {
  const out: { brands?: string[]; noReddit?: boolean; redditOnly?: boolean } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--brands") out.brands = argv[++i]?.split(",").filter(Boolean);
    if (argv[i] === "--no-reddit") out.noReddit = true;
    if (argv[i] === "--reddit-only") out.redditOnly = true;
  }
  return out;
}

// Wrap the existing Toyota scraper into a `ComparisonScraper` shape.
const toyotaComparisonScraper: ComparisonScraper = {
  brandSlug: "toyota",
  source: "toyota.ca",
  scrape: async (modelSlugs?: string[]): Promise<ComparisonScrapeResult> => {
    const inner = await scrapeToyotaCa(modelSlugs);
    // Roll up trims to the lowest plausible MSRP per model (the same logic the
    // comparison site treats as "starting at").
    const lowestByModel = new Map<string, { msrp?: number; sourceUrl: string }>();
    for (const t of inner.trims) {
      const cur = lowestByModel.get(t.modelSlug);
      if (!cur || (t.msrpCad && (!cur.msrp || t.msrpCad < cur.msrp))) {
        lowestByModel.set(t.modelSlug, { msrp: t.msrpCad, sourceUrl: t.sourceUrl });
      }
    }
    return {
      source: inner.source,
      startedAt: inner.startedAt,
      finishedAt: inner.finishedAt,
      models: [...lowestByModel.entries()].map(([slug, info]) => ({
        brandSlug: "toyota",
        modelSlug: slug,
        name: slug,
        startingMsrpCad: info.msrp,
        sourceUrl: info.sourceUrl,
      })),
      issues: [],
      warnings: inner.warnings,
    };
  },
};

const lexusComparisonScraper: ComparisonScraper = {
  brandSlug: "lexus",
  source: "lexus.ca",
  scrape: scrapeLexusCa,
};

const SCRAPERS: ComparisonScraper[] = [
  toyotaComparisonScraper,
  lexusComparisonScraper,
  ...STUB_BRAND_CONFIGS.map((cfg) => createStubScraper(cfg)),
];

async function persistModels(result: ComparisonScrapeResult): Promise<{ updated: number; skipped: number }> {
  let updated = 0;
  let skipped = 0;
  for (const m of result.models) {
    const existing = await prisma.model.findUnique({ where: { slug: m.modelSlug } });
    if (!existing) {
      console.log(`  ! model ${m.modelSlug} (${m.brandSlug}) not in DB — skip; add to comparison-seed first`);
      skipped += 1;
      continue;
    }
    if (m.startingMsrpCad) {
      const seedMsrp = existing.startingMsrpCad ? Number(existing.startingMsrpCad) : undefined;
      const within = seedMsrp ? Math.abs(m.startingMsrpCad - seedMsrp) / seedMsrp <= SANITY_TOLERANCE : true;
      if (!within) {
        console.log(`  ⚠ ${m.modelSlug}: scraped $${m.startingMsrpCad} vs seed $${seedMsrp} (>30% drift) — skip`);
        skipped += 1;
        continue;
      }
      await prisma.model.update({
        where: { id: existing.id },
        data: { startingMsrpCad: m.startingMsrpCad },
      });
      updated += 1;
    }
  }
  return { updated, skipped };
}

async function persistRedditIssues(result: ComparisonScrapeResult): Promise<number> {
  let stored = 0;
  for (const issue of result.issues) {
    const model = issue.modelSlug
      ? await prisma.model.findUnique({ where: { slug: issue.modelSlug } })
      : null;
    const brand = issue.brandSlug
      ? await prisma.brand.findUnique({ where: { slug: issue.brandSlug } })
      : null;
    if (!model && !brand) continue;
    // External mention deduped by URL (schema-level unique constraint).
    try {
      await prisma.externalMention.upsert({
        where: { url: issue.url },
        create: {
          platform: MentionPlatform.REDDIT,
          modelId: model?.id,
          brandId: brand?.id,
          title: issue.title,
          url: issue.url,
          subreddit: issue.subreddit,
          authorHandle: issue.author,
          upvotes: issue.upvotes,
          summary: issue.summary,
          sentiment: issue.sentiment as Sentiment | undefined,
          postedAt: issue.postedAt,
        },
        update: {
          upvotes: issue.upvotes,
          summary: issue.summary,
          sentiment: issue.sentiment as Sentiment | undefined,
        },
      });
      stored += 1;
    } catch (e) {
      console.log(`  ! reddit upsert failed for ${issue.url}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return stored;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const enabledScrapers = args.brands
    ? SCRAPERS.filter((s) => args.brands!.includes(s.brandSlug))
    : SCRAPERS;

  if (!args.redditOnly) {
    console.log(`[scrape-comparison] running ${enabledScrapers.length} brand scrapers`);
    for (const scraper of enabledScrapers) {
      console.log(`\n— ${scraper.brandSlug} (${scraper.source}) —`);
      try {
        const result = await scraper.scrape();
        const { updated, skipped } = await persistModels(result);
        console.log(`  ${result.models.length} models scraped → ${updated} updated, ${skipped} skipped`);
        for (const w of result.warnings) console.log(`  ⚠ ${w}`);
      } catch (e) {
        console.error(`  ✖ ${scraper.brandSlug} failed:`, e);
      }
    }
  }

  if (!args.noReddit) {
    console.log(`\n— Reddit issues (${DEFAULT_REDDIT_TARGETS.length} model targets) —`);
    try {
      const redditTargets = args.brands
        ? DEFAULT_REDDIT_TARGETS.filter((t) => args.brands!.includes(t.brandSlug))
        : DEFAULT_REDDIT_TARGETS;
      const result = await scrapeRedditIssues(redditTargets);
      const stored = await persistRedditIssues(result);
      console.log(`  ${result.issues.length} issue posts found → ${stored} stored`);
      for (const w of result.warnings) console.log(`  ⚠ ${w}`);
    } catch (e) {
      console.error("  ✖ reddit scrape failed:", e);
    }
  }

  console.log("\n[scrape-comparison] done.");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
