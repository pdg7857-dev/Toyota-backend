// Types for the multi-brand comparison-site scrapers. Kept separate from
// `scraper/types.ts` (which feeds the Toyota-only sales-rep diff workflow)
// because the comparison schema has more fields and we write directly to the
// comparison tables rather than going through a manual-review queue.

export type ScrapedComparisonModel = {
  brandSlug: string;
  modelSlug: string;
  name: string;
  bodyStyle?: string;
  segment?: string;
  startingMsrpCad?: number;
  imageUrl?: string;
  sourceUrl: string;
  // Optional warranty override at the model level — most brands inherit from
  // the Brand row. EVs/PHEVs sometimes deviate.
  warranties?: Array<{
    coverageType: string;
    durationMonths?: number;
    distanceKm?: number;
    notes?: string;
  }>;
};

export type ScrapedRedditIssue = {
  modelSlug?: string;
  brandSlug?: string;
  title: string;
  url: string;
  subreddit?: string;
  author?: string;
  upvotes?: number;
  summary?: string;
  postedAt?: Date;
  sentiment?: "POSITIVE" | "NEGATIVE" | "NEUTRAL" | "MIXED";
};

export type ComparisonScrapeResult = {
  source: string;
  startedAt: Date;
  finishedAt: Date;
  models: ScrapedComparisonModel[];
  issues: ScrapedRedditIssue[];
  warnings: string[];
};

// Every brand scraper implements this shape so `run-comparison.ts` can
// dispatch over a registry.
export type ComparisonScraper = {
  brandSlug: string;
  source: string;
  scrape: (modelSlugs?: string[]) => Promise<ComparisonScrapeResult>;
};
