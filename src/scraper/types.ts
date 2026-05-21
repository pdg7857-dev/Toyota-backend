// Shared types between the scraper, diff engine, and admin endpoints.

export type ScrapedTrim = {
  modelSlug: string;
  year: number;
  trimName: string;
  trimSlug?: string;
  msrpCad?: number;
  powertrainHint?: "GAS" | "HYBRID" | "PHEV" | "BEV";
  drivetrain?: string;
  sourceUrl: string;
};

export type ScrapedModel = {
  slug: string;
  name?: string;
  bodyStyle?: string;
  segment?: string;
  sourceUrl: string;
};

export type ScrapeResult = {
  source: string;
  startedAt: Date;
  finishedAt: Date;
  models: ScrapedModel[];
  trims: ScrapedTrim[];
  warnings: string[];
};
