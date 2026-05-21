// CLI entrypoint: `tsx src/scraper/run.ts [--models slug1,slug2] [--run-id N]`
//
// Invoked either directly by the rep (`npm run scrape`) or spawned by the
// admin endpoint POST /admin/scrape/run. Always writes to scrape_diffs —
// never directly to live catalog tables. The rep accepts/rejects diffs in
// the admin UI before they're applied.

import { PrismaClient } from "@prisma/client";
import { scrapeToyotaCa } from "./sources/toyota-ca.js";
import { diffAndStore } from "./diff.js";

const prisma = new PrismaClient();

function parseArgs(argv: string[]): { models?: string[]; runId?: number } {
  const out: { models?: string[]; runId?: number } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--models") out.models = argv[++i]?.split(",").filter(Boolean);
    if (argv[i] === "--run-id") out.runId = Number(argv[++i]);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const run = args.runId
    ? await prisma.scrapeRun.update({ where: { id: args.runId }, data: { status: "PENDING_REVIEW" } })
    : await prisma.scrapeRun.create({ data: { source: "toyota.ca", status: "PENDING_REVIEW" } });

  console.log(`[scrape] run id=${run.id} source=toyota.ca models=${args.models?.join(",") ?? "ALL"}`);
  try {
    const result = await scrapeToyotaCa(args.models);
    const { diffCount } = await diffAndStore(run.id, result);
    console.log(`[scrape] done: ${result.trims.length} trims, ${diffCount} diffs, ${result.warnings.length} warnings`);
    if (result.warnings.length > 0) {
      for (const w of result.warnings) console.log(`  ⚠ ${w}`);
    }
  } catch (e) {
    console.error("[scrape] failed:", e);
    await prisma.scrapeRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), status: "REJECTED", summaryJson: { error: String(e) } },
    });
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
