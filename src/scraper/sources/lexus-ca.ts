// lexus.ca scraper. Same approach as toyota-ca.ts: Playwright, polite
// 3s delay between pages, best-effort selectors. The Lexus shopping flow
// renders trim cards with price chips. Adjust selectors if the site
// re-skins (last verified 2025-Q1).

import { chromium, type Browser, type Page } from "playwright";
import type { ComparisonScrapeResult, ScrapedComparisonModel } from "../comparison-types.js";

const BASE = "https://www.lexus.ca";
const USER_AGENT =
  "Ontario-car-comparison-db (+contact: pdg7857@gmail.com) — polite, sequential, rate-limited";
const PAGE_DELAY_MS = 3000;

// Top-of-page model URLs. Lexus rotates a couple of these every MY refresh
// (e.g. LFA returns, LBX hasn't launched in Canada at time of writing).
const MODEL_URLS: Array<{ slug: string; path: string; segment: string; bodyStyle: string }> = [
  { slug: "ux",  path: "/en/models/ux",  segment: "Subcompact luxury SUV", bodyStyle: "Subcompact SUV" },
  { slug: "nx",  path: "/en/models/nx",  segment: "Compact luxury SUV",    bodyStyle: "Compact SUV" },
  { slug: "lx-rx",  path: "/en/models/rx",  segment: "Midsize luxury SUV",    bodyStyle: "Midsize SUV" },
  { slug: "tx",  path: "/en/models/tx",  segment: "Midsize 3-row luxury SUV", bodyStyle: "Midsize SUV (3-row)" },
  { slug: "gx",  path: "/en/models/gx",  segment: "Midsize luxury off-road SUV", bodyStyle: "Body-on-frame SUV" },
  { slug: "lx",  path: "/en/models/lx",  segment: "Full-size luxury SUV",  bodyStyle: "Full-size SUV" },
  { slug: "is",  path: "/en/models/is",  segment: "Compact luxury sedan",  bodyStyle: "Sedan (RWD)" },
  { slug: "es",  path: "/en/models/es",  segment: "Midsize luxury sedan",  bodyStyle: "Sedan" },
  { slug: "ls",  path: "/en/models/ls",  segment: "Full-size luxury sedan", bodyStyle: "Full-size sedan" },
  { slug: "rc",  path: "/en/models/rc",  segment: "Compact luxury coupe",  bodyStyle: "Coupe" },
  { slug: "lc",  path: "/en/models/lc",  segment: "Grand tourer",          bodyStyle: "Coupe / Convertible" },
  { slug: "rz",  path: "/en/models/rz",  segment: "Electric luxury SUV",   bodyStyle: "Compact SUV (BEV)" },
];

const PRICE_RE = /\$([\d,]+(?:\.\d{2})?)/;

function parsePrice(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const m = PRICE_RE.exec(s);
  if (!m) return undefined;
  const n = Number(m[1]!.replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

async function extractStartingPrice(page: Page): Promise<number | undefined> {
  // Lexus pages typically include a "Starting at $XX,XXX" hero element.
  // We try a few selector candidates and fall back to a regex over body
  // text for the lowest dollar amount that looks like a price.
  const text = (await page.evaluate(`(() => {
    const sels = [
      '[class*="starting-price"]',
      '[class*="startingPrice"]',
      '[data-testid*="price"]',
      '[class*="hero-price"]',
      '[class*="msrp"]',
    ];
    for (const s of sels) {
      const el = document.querySelector(s);
      if (el && el.textContent) return el.textContent.trim();
    }
    return document.body.innerText.slice(0, 5000);
  })()`)) as string;
  return parsePrice(text);
}

export async function scrapeLexusCa(modelSlugs?: string[]): Promise<ComparisonScrapeResult> {
  const startedAt = new Date();
  const warnings: string[] = [];
  const models: ScrapedComparisonModel[] = [];
  const targets = modelSlugs ? MODEL_URLS.filter((m) => modelSlugs.includes(m.slug)) : MODEL_URLS;

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ userAgent: USER_AGENT });
    const page = await context.newPage();

    for (const target of targets) {
      const sourceUrl = `${BASE}${target.path}`;
      try {
        const resp = await page.goto(sourceUrl, { waitUntil: "networkidle", timeout: 30_000 });
        if (!resp || !resp.ok()) {
          warnings.push(`${target.slug}: HTTP ${resp?.status() ?? "no response"}`);
          continue;
        }
        const startingMsrpCad = await extractStartingPrice(page);
        if (!startingMsrpCad) {
          warnings.push(`${target.slug}: starting price not found — selectors may need updating`);
        }
        models.push({
          brandSlug: "lexus",
          modelSlug: target.slug,
          name: target.slug.toUpperCase().replace(/-/g, " "),
          bodyStyle: target.bodyStyle,
          segment: target.segment,
          startingMsrpCad,
          sourceUrl,
        });
      } catch (e) {
        warnings.push(`${target.slug}: ${e instanceof Error ? e.message : String(e)}`);
      }
      await page.waitForTimeout(PAGE_DELAY_MS);
    }
  } finally {
    if (browser) await browser.close();
  }

  return { source: "lexus.ca", startedAt, finishedAt: new Date(), models, issues: [], warnings };
}
