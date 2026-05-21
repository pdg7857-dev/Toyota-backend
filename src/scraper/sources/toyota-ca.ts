// Toyota.ca (English Canada) scraper.
//
// toyota.ca is a Next.js/React site that hydrates trim and pricing data
// from internal JSON endpoints. The most reliable strategy is to intercept
// those XHR responses with Playwright. As a fallback we extract from the
// rendered DOM. Selectors here are best-effort starting points — they will
// need adjustment as toyota.ca evolves. Run the scraper, eyeball the
// scrape_diffs, accept what's correct, reject what isn't.
//
// Polite scraping: sequential, ~3s between page loads, identifies itself in UA.

import { chromium, type Browser, type Page } from "playwright";
import type { ScrapeResult, ScrapedTrim, ScrapedModel } from "../types.js";

const BASE = "https://www.toyota.ca";
const USER_AGENT =
  "Toyota-backend personal-rep-tool (+contact: pdg7857@gmail.com) — polite, sequential, rate-limited";
const PAGE_DELAY_MS = 3000;

const MODEL_URLS: Array<{ slug: string; path: string }> = [
  { slug: "corolla", path: "/en/corolla" },
  { slug: "corolla-cross", path: "/en/corolla-cross" },
  { slug: "gr-corolla", path: "/en/grcorolla" },
  { slug: "camry", path: "/en/camry" },
  { slug: "rav4", path: "/en/rav4" },
  { slug: "highlander", path: "/en/highlander" },
  { slug: "grand-highlander", path: "/en/grand-highlander" },
  { slug: "crown", path: "/en/crown" },
  { slug: "crown-signia", path: "/en/crown-signia" },
  { slug: "4runner", path: "/en/4runner" },
  { slug: "land-cruiser", path: "/en/land-cruiser" },
  { slug: "sequoia", path: "/en/sequoia" },
  { slug: "tacoma", path: "/en/tacoma" },
  { slug: "tundra", path: "/en/tundra" },
  { slug: "sienna", path: "/en/sienna" },
  { slug: "gr86", path: "/en/gr86" },
  { slug: "gr-supra", path: "/en/grsupra" },
  { slug: "prius", path: "/en/prius" },
  { slug: "prius-prime", path: "/en/priusprime" },
  { slug: "bz4x", path: "/en/bz4x" },
];

const PRICE_RE = /\$([\d,]+(?:\.\d{2})?)/;

function parsePrice(s: string): number | undefined {
  const m = PRICE_RE.exec(s);
  if (!m) return undefined;
  const n = Number(m[1]!.replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

function inferPowertrain(text: string): ScrapedTrim["powertrainHint"] | undefined {
  const t = text.toLowerCase();
  if (/\bprime\b|\bphev\b|plug.?in/.test(t)) return "PHEV";
  if (/\bbev\b|\bbz4x\b|electric only|all.?electric/.test(t)) return "BEV";
  if (/\bhybrid\b|\bhev\b|i.?force max/.test(t)) return "HYBRID";
  return "GAS";
}

async function extractTrimsFromPage(page: Page, modelSlug: string, sourceUrl: string): Promise<ScrapedTrim[]> {
  // Runs in the browser context — DOM globals are available there even
  // though the host project's tsconfig doesn't include the `dom` lib.
  // The function body is serialized and shipped to Chromium by Playwright.
  const candidates = (await page.evaluate(`(() => {
    const out = [];
    const sels = [
      '[data-testid*="trim"]',
      '[data-test*="trim"]',
      '[class*="TrimCard"]',
      '[class*="trim-card"]',
      '[class*="trimCard"]',
      '[class*="Grade"]',
      '[class*="grade-card"]',
      'article'
    ].join(",");
    const cards = document.querySelectorAll(sels);
    cards.forEach((card) => {
      const txt = (card.textContent || "").replace(/\\s+/g, " ").trim();
      const priceMatch = txt.match(/\\$[\\d,]+/);
      if (!priceMatch) return;
      const heading = card.querySelector('h2, h3, h4, [class*="trim-name"], [class*="trimName"]');
      const trimName = (heading && heading.textContent || "").trim();
      if (!trimName) return;
      out.push({ text: txt, price: priceMatch[0], trimName });
    });
    return out;
  })()`)) as Array<{ text: string; price: string; trimName: string }>;

  const trims: ScrapedTrim[] = [];
  for (const c of candidates) {
    const msrpCad = parsePrice(c.price);
    if (!msrpCad) continue;
    trims.push({
      modelSlug,
      year: new Date().getFullYear() + 1, // toyota.ca shows upcoming MY by default
      trimName: c.trimName,
      msrpCad,
      powertrainHint: inferPowertrain(`${c.trimName} ${c.text}`),
      sourceUrl,
    });
  }
  return trims;
}

export async function scrapeToyotaCa(modelSlugs?: string[]): Promise<ScrapeResult> {
  const startedAt = new Date();
  const warnings: string[] = [];
  const models: ScrapedModel[] = [];
  const trims: ScrapedTrim[] = [];

  const targets = modelSlugs
    ? MODEL_URLS.filter((m) => modelSlugs.includes(m.slug))
    : MODEL_URLS;

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ userAgent: USER_AGENT });
    const page = await context.newPage();

    for (const target of targets) {
      const sourceUrl = `${BASE}${target.path}`;
      try {
        const resp = await page.goto(sourceUrl, { waitUntil: "networkidle", timeout: 30000 });
        if (!resp || !resp.ok()) {
          warnings.push(`${target.slug}: HTTP ${resp?.status() ?? "no response"}`);
          continue;
        }
        models.push({ slug: target.slug, sourceUrl });
        const found = await extractTrimsFromPage(page, target.slug, sourceUrl);
        if (found.length === 0) {
          warnings.push(`${target.slug}: no trims extracted — selectors likely need updating`);
        }
        trims.push(...found);
      } catch (e) {
        warnings.push(`${target.slug}: ${e instanceof Error ? e.message : String(e)}`);
      }
      await page.waitForTimeout(PAGE_DELAY_MS);
    }
  } finally {
    if (browser) await browser.close();
  }

  return { source: "toyota.ca", startedAt, finishedAt: new Date(), models, trims, warnings };
}
