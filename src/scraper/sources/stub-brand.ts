// Stub-brand scraper factory.
//
// Building a polished Playwright scraper per OEM is multi-day work — every
// site re-skins itself yearly and ships interesting client-side hydration.
// To unblock the comparison site, we ship "stub" scrapers for the remaining
// brands: they hit each model's URL with a headless browser, record the
// page status (so a 404 surfaces as a maintenance signal), and extract the
// most aggressive starting-price match they can find.
//
// Each stub returns `ComparisonScrapeResult` rows that downstream code can
// merge into the DB — manual seed data wins on tie unless the scraped MSRP
// is non-null and within a 30% sanity envelope (`run-comparison.ts`).
//
// To upgrade a stub to a full scraper, add a dedicated `sources/<brand>.ts`
// with custom selectors and remove the brand from STUB_BRAND_TARGETS in
// `run-comparison.ts`.

import { chromium, type Browser } from "playwright";
import type { ComparisonScrapeResult, ScrapedComparisonModel } from "../comparison-types.js";

const USER_AGENT =
  "Ontario-car-comparison-db (+contact: pdg7857@gmail.com) — polite, sequential, rate-limited";
const PAGE_DELAY_MS = 3000;
const PRICE_RE = /\$\s?([\d,]{4,})/g; // 4+ digits = at least $1,000

export type StubBrandConfig = {
  brandSlug: string;
  source: string; // domain, e.g. "honda.ca"
  models: Array<{
    modelSlug: string;
    name: string;
    bodyStyle?: string;
    segment?: string;
    url: string;
  }>;
};

function pickLowestPlausiblePrice(text: string): number | undefined {
  const matches = [...text.matchAll(PRICE_RE)];
  const numbers = matches
    .map((m) => Number(m[1]!.replace(/,/g, "")))
    .filter((n) => Number.isFinite(n) && n >= 15_000 && n <= 500_000);
  if (numbers.length === 0) return undefined;
  return Math.min(...numbers);
}

export function createStubScraper(cfg: StubBrandConfig) {
  return {
    brandSlug: cfg.brandSlug,
    source: cfg.source,
    scrape: async (modelSlugs?: string[]): Promise<ComparisonScrapeResult> => {
      const startedAt = new Date();
      const warnings: string[] = [];
      const models: ScrapedComparisonModel[] = [];
      const targets = modelSlugs ? cfg.models.filter((m) => modelSlugs.includes(m.modelSlug)) : cfg.models;

      let browser: Browser | undefined;
      try {
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({ userAgent: USER_AGENT });
        const page = await context.newPage();

        for (const target of targets) {
          try {
            const resp = await page.goto(target.url, { waitUntil: "networkidle", timeout: 30_000 });
            if (!resp || !resp.ok()) {
              warnings.push(`${target.modelSlug}: HTTP ${resp?.status() ?? "no response"}`);
              continue;
            }
            const text = (await page.evaluate(`document.body.innerText.slice(0, 30000)`)) as string;
            const startingMsrpCad = pickLowestPlausiblePrice(text);
            if (!startingMsrpCad) {
              warnings.push(`${target.modelSlug}: no plausible MSRP extracted`);
            }
            models.push({
              brandSlug: cfg.brandSlug,
              modelSlug: target.modelSlug,
              name: target.name,
              bodyStyle: target.bodyStyle,
              segment: target.segment,
              startingMsrpCad,
              sourceUrl: target.url,
            });
          } catch (e) {
            warnings.push(`${target.modelSlug}: ${e instanceof Error ? e.message : String(e)}`);
          }
          await page.waitForTimeout(PAGE_DELAY_MS);
        }
      } finally {
        if (browser) await browser.close();
      }

      return { source: cfg.source, startedAt, finishedAt: new Date(), models, issues: [], warnings };
    },
  };
}

// Pre-configured stub registries — extend by adding more brands here.
export const HONDA_STUB: StubBrandConfig = {
  brandSlug: "honda",
  source: "honda.ca",
  models: [
    { modelSlug: "civic",   name: "Civic",   bodyStyle: "Sedan / Hatchback", segment: "Compact car",  url: "https://www.honda.ca/en/civic" },
    { modelSlug: "accord",  name: "Accord",  bodyStyle: "Sedan",             segment: "Midsize sedan", url: "https://www.honda.ca/en/accord" },
    { modelSlug: "cr-v",    name: "CR-V",    bodyStyle: "Compact SUV",       segment: "Compact SUV",  url: "https://www.honda.ca/en/crv" },
    { modelSlug: "pilot",   name: "Pilot",   bodyStyle: "Midsize SUV (3-row)", segment: "Midsize 3-row SUV", url: "https://www.honda.ca/en/pilot" },
    { modelSlug: "odyssey", name: "Odyssey", bodyStyle: "Minivan",           segment: "Minivan",      url: "https://www.honda.ca/en/odyssey" },
  ],
};

export const MAZDA_STUB: StubBrandConfig = {
  brandSlug: "mazda",
  source: "mazda.ca",
  models: [
    { modelSlug: "mazda3", name: "Mazda3", bodyStyle: "Sedan / Hatchback", segment: "Compact car",  url: "https://www.mazda.ca/en/vehicles/mazda3-sport/" },
    { modelSlug: "cx-5",   name: "CX-5",   bodyStyle: "Compact SUV",       segment: "Compact SUV",  url: "https://www.mazda.ca/en/vehicles/cx-5/" },
    { modelSlug: "cx-50",  name: "CX-50",  bodyStyle: "Compact SUV",       segment: "Compact SUV",  url: "https://www.mazda.ca/en/vehicles/cx-50/" },
    { modelSlug: "cx-90",  name: "CX-90",  bodyStyle: "Midsize SUV (3-row)", segment: "Midsize 3-row SUV", url: "https://www.mazda.ca/en/vehicles/cx-90/" },
  ],
};

export const HYUNDAI_STUB: StubBrandConfig = {
  brandSlug: "hyundai",
  source: "hyundai.ca",
  models: [
    { modelSlug: "elantra",  name: "Elantra",  bodyStyle: "Sedan",       segment: "Compact car",  url: "https://www.hyundai.ca/en/showroom/2026/elantra" },
    { modelSlug: "tucson",   name: "Tucson",   bodyStyle: "Compact SUV", segment: "Compact SUV",  url: "https://www.hyundai.ca/en/showroom/2026/tucson" },
    { modelSlug: "ioniq-5",  name: "IONIQ 5",  bodyStyle: "Compact SUV (BEV)", segment: "Electric SUV", url: "https://www.hyundai.ca/en/showroom/2026/ioniq-5" },
  ],
};

export const KIA_STUB: StubBrandConfig = {
  brandSlug: "kia",
  source: "kia.ca",
  models: [
    { modelSlug: "telluride", name: "Telluride", bodyStyle: "Midsize SUV (3-row)", segment: "Midsize 3-row SUV", url: "https://www.kia.ca/en/telluride" },
    { modelSlug: "sportage",  name: "Sportage",  bodyStyle: "Compact SUV", segment: "Compact SUV", url: "https://www.kia.ca/en/sportage" },
    { modelSlug: "ev6",       name: "EV6",       bodyStyle: "Compact SUV (BEV)", segment: "Electric SUV", url: "https://www.kia.ca/en/ev6" },
  ],
};

export const SUBARU_STUB: StubBrandConfig = {
  brandSlug: "subaru",
  source: "subaru.ca",
  models: [
    { modelSlug: "forester", name: "Forester", bodyStyle: "Compact SUV", segment: "Compact SUV", url: "https://www.subaru.ca/WebPage.aspx?WebSiteID=210" },
    { modelSlug: "outback",  name: "Outback",  bodyStyle: "Wagon / SUV crossover", segment: "Midsize wagon", url: "https://www.subaru.ca/WebPage.aspx?WebSiteID=211" },
  ],
};

export const FORD_STUB: StubBrandConfig = {
  brandSlug: "ford",
  source: "ford.ca",
  models: [
    { modelSlug: "f-150",          name: "F-150",          bodyStyle: "Full-size Pickup", segment: "Full-size truck", url: "https://www.ford.ca/trucks/f150/" },
    { modelSlug: "maverick",       name: "Maverick",       bodyStyle: "Compact Pickup",  segment: "Compact truck",   url: "https://www.ford.ca/trucks/maverick/" },
    { modelSlug: "escape",         name: "Escape",         bodyStyle: "Compact SUV",     segment: "Compact SUV",     url: "https://www.ford.ca/suvs/escape/" },
    { modelSlug: "mustang-mach-e", name: "Mustang Mach-E", bodyStyle: "Compact SUV (BEV)", segment: "Electric SUV",  url: "https://www.ford.ca/suvs/mach-e/" },
  ],
};

export const CHEVROLET_STUB: StubBrandConfig = {
  brandSlug: "chevrolet",
  source: "chevrolet.ca",
  models: [
    { modelSlug: "silverado-1500", name: "Silverado 1500", bodyStyle: "Full-size Pickup", segment: "Full-size truck", url: "https://www.chevrolet.ca/en/trucks/silverado-1500" },
    { modelSlug: "equinox",        name: "Equinox",        bodyStyle: "Compact SUV",      segment: "Compact SUV",     url: "https://www.chevrolet.ca/en/suvs/equinox" },
  ],
};

export const VOLKSWAGEN_STUB: StubBrandConfig = {
  brandSlug: "volkswagen",
  source: "vw.ca",
  models: [
    { modelSlug: "tiguan", name: "Tiguan", bodyStyle: "Compact SUV", segment: "Compact SUV", url: "https://www.vw.ca/en/models/tiguan.html" },
    { modelSlug: "id-4",   name: "ID.4",   bodyStyle: "Compact SUV (BEV)", segment: "Electric SUV", url: "https://www.vw.ca/en/models/id-4.html" },
  ],
};

export const BMW_STUB: StubBrandConfig = {
  brandSlug: "bmw",
  source: "bmw.ca",
  models: [
    { modelSlug: "x3", name: "X3", bodyStyle: "Compact SUV", segment: "Compact luxury SUV", url: "https://www.bmw.ca/en/all-models/x-series/X3/2025/bmw-x3-overview.html" },
    { modelSlug: "i4", name: "i4", bodyStyle: "Sedan (BEV)", segment: "Electric luxury sedan", url: "https://www.bmw.ca/en/all-models/bmw-i/i4/2025/bmw-i4-overview.html" },
  ],
};

export const MERCEDES_STUB: StubBrandConfig = {
  brandSlug: "mercedes-benz",
  source: "mercedes-benz.ca",
  models: [
    { modelSlug: "gle", name: "GLE", bodyStyle: "Midsize SUV", segment: "Midsize luxury SUV", url: "https://www.mercedes-benz.ca/en/passengercars/models/suv/gle/explore.html" },
  ],
};

export const TESLA_STUB: StubBrandConfig = {
  brandSlug: "tesla",
  source: "tesla.com",
  models: [
    { modelSlug: "model-y", name: "Model Y", bodyStyle: "Compact SUV (BEV)", segment: "Electric SUV",   url: "https://www.tesla.com/en_CA/modely" },
    { modelSlug: "model-3", name: "Model 3", bodyStyle: "Sedan (BEV)",       segment: "Electric sedan", url: "https://www.tesla.com/en_CA/model3" },
  ],
};

export const RAM_STUB: StubBrandConfig = {
  brandSlug: "ram",
  source: "ramtruck.ca",
  models: [
    { modelSlug: "1500", name: "1500", bodyStyle: "Full-size Pickup", segment: "Full-size truck", url: "https://www.ramtruck.ca/en/ram-1500" },
  ],
};

export const NISSAN_STUB: StubBrandConfig = {
  brandSlug: "nissan",
  source: "nissan.ca",
  models: [
    { modelSlug: "rogue", name: "Rogue", bodyStyle: "Compact SUV", segment: "Compact SUV", url: "https://www.nissan.ca/vehicles/crossovers-suvs/rogue.html" },
  ],
};

export const STUB_BRAND_CONFIGS: StubBrandConfig[] = [
  HONDA_STUB,
  MAZDA_STUB,
  HYUNDAI_STUB,
  KIA_STUB,
  SUBARU_STUB,
  FORD_STUB,
  CHEVROLET_STUB,
  VOLKSWAGEN_STUB,
  BMW_STUB,
  MERCEDES_STUB,
  TESLA_STUB,
  RAM_STUB,
  NISSAN_STUB,
];
