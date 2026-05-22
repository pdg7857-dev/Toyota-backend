// Reddit reliability/issues scraper.
//
// Uses Reddit's public JSON endpoints (no auth required for read-only,
// rate-limited to ~60 req/min). For each model we hit:
//   https://www.reddit.com/r/{subreddit}/search.json?q=...&restrict_sr=on&sort=top&t=year
// and filter for posts that look like issue reports (heuristic title match).
//
// To respect Reddit's rate limit:
//   - sequential, ~2s between calls
//   - identifies itself with a descriptive User-Agent
//   - capped at 25 posts per model
//
// This is not a substitute for the official Reddit API (OAuth) for heavy
// usage. If a customer needs bulk pulls, switch to the `snoowrap` client
// with their own OAuth credentials.

import type { ComparisonScrapeResult, ScrapedRedditIssue } from "../comparison-types.js";

const USER_AGENT =
  "ontario-car-comparison/0.1 (issue-tracker; contact: pdg7857@gmail.com)";
const REQUEST_DELAY_MS = 2000;
const PER_MODEL_LIMIT = 25;

// Issue-y title patterns. Conservative — we want signal, not noise.
const ISSUE_PATTERNS = [
  /\b(issue|problem|fault|broke|broken|failure|fail|recall|tsb)\b/i,
  /\b(won'?t start|stalls?|stalling|misfire|hesitat)/i,
  /\b(transmission|cvt|dsg|gearbox)\b.*(shudder|slip|grind|jerk)/i,
  /\b(check engine|cel|warning light)/i,
  /\b(rattle|squeak|clunk|grind)/i,
  /\b(leak|leaking|burns? oil)/i,
  /\b(infotainment|carplay|android auto)\b.*(freez|crash|reboot|disconnect)/i,
  /\b(common|known)\s+(issue|problem)s?\b/i,
];

function looksLikeIssue(title: string): boolean {
  return ISSUE_PATTERNS.some((re) => re.test(title));
}

function classifySentiment(title: string, score: number): ScrapedRedditIssue["sentiment"] {
  // Heuristic — title scan + upvote weight.
  if (/\blove\b|\bgreat\b|\bawesome\b|\bperfect\b/i.test(title) && score > 10) return "POSITIVE";
  if (looksLikeIssue(title)) return "NEGATIVE";
  if (/\b(thoughts|review|opinion)/i.test(title)) return "MIXED";
  return "NEUTRAL";
}

export type RedditTarget = {
  modelSlug: string;
  brandSlug: string;
  // Subreddits to query. Most popular models have a dedicated sub
  // (e.g. r/rav4club, r/Civic). Fall back to brand/general subs.
  subreddits: string[];
  // Search terms — usually the model name. Use specific terms for ambiguous
  // names (e.g. "Lexus RX" not "RX").
  searchQuery: string;
};

export const DEFAULT_REDDIT_TARGETS: RedditTarget[] = [
  // ============ Toyota ============
  { modelSlug: "rav4",            brandSlug: "toyota", subreddits: ["rav4club", "Toyota"],     searchQuery: "RAV4 problem" },
  { modelSlug: "tacoma",          brandSlug: "toyota", subreddits: ["ToyotaTacoma", "Toyota"], searchQuery: "Tacoma problem" },
  { modelSlug: "tundra",          brandSlug: "toyota", subreddits: ["ToyotaTundra", "Toyota"], searchQuery: "Tundra problem" },
  { modelSlug: "corolla",         brandSlug: "toyota", subreddits: ["Corolla", "Toyota"],      searchQuery: "Corolla problem" },
  { modelSlug: "camry",           brandSlug: "toyota", subreddits: ["camry", "Toyota"],        searchQuery: "Camry problem" },
  { modelSlug: "highlander",      brandSlug: "toyota", subreddits: ["Highlander", "Toyota"],   searchQuery: "Highlander problem" },
  { modelSlug: "grand-highlander", brandSlug: "toyota", subreddits: ["Toyota"],                 searchQuery: "Grand Highlander problem" },
  { modelSlug: "4runner",         brandSlug: "toyota", subreddits: ["4Runner", "Toyota"],      searchQuery: "4Runner problem" },
  { modelSlug: "land-cruiser",    brandSlug: "toyota", subreddits: ["LandCruisers", "Toyota"], searchQuery: "Land Cruiser problem" },
  { modelSlug: "sienna",          brandSlug: "toyota", subreddits: ["ToyotaSienna", "Toyota"], searchQuery: "Sienna problem" },
  { modelSlug: "prius",           brandSlug: "toyota", subreddits: ["prius", "Toyota"],        searchQuery: "Prius problem" },
  { modelSlug: "prius-prime",     brandSlug: "toyota", subreddits: ["prius", "Toyota"],        searchQuery: "Prius Prime problem" },
  { modelSlug: "bz4x",            brandSlug: "toyota", subreddits: ["bz4x", "Toyota"],         searchQuery: "bZ4X problem" },

  // ============ Lexus ============
  { modelSlug: "lx-rx", brandSlug: "lexus", subreddits: ["Lexus"], searchQuery: "Lexus RX problem" },
  { modelSlug: "nx",    brandSlug: "lexus", subreddits: ["Lexus"], searchQuery: "Lexus NX problem" },
  { modelSlug: "tx",    brandSlug: "lexus", subreddits: ["Lexus"], searchQuery: "Lexus TX problem" },
  { modelSlug: "gx",    brandSlug: "lexus", subreddits: ["Lexus"], searchQuery: "Lexus GX problem" },
  { modelSlug: "es",    brandSlug: "lexus", subreddits: ["Lexus"], searchQuery: "Lexus ES problem" },
  { modelSlug: "is",    brandSlug: "lexus", subreddits: ["Lexus"], searchQuery: "Lexus IS problem" },
  { modelSlug: "ux",    brandSlug: "lexus", subreddits: ["Lexus"], searchQuery: "Lexus UX problem" },
  { modelSlug: "rz",    brandSlug: "lexus", subreddits: ["Lexus"], searchQuery: "Lexus RZ problem" },

  // ============ Honda / Mazda / Hyundai / Kia / Subaru / Ford / Tesla ============
  { modelSlug: "civic",     brandSlug: "honda",      subreddits: ["civic", "Honda"],     searchQuery: "Civic problem" },
  { modelSlug: "accord",    brandSlug: "honda",      subreddits: ["Accord", "Honda"],    searchQuery: "Accord problem" },
  { modelSlug: "cr-v",      brandSlug: "honda",      subreddits: ["crv", "Honda"],       searchQuery: "CR-V problem" },
  { modelSlug: "pilot",     brandSlug: "honda",      subreddits: ["HondaPilot", "Honda"], searchQuery: "Pilot problem" },
  { modelSlug: "cx-5",      brandSlug: "mazda",      subreddits: ["mazda"],              searchQuery: "CX-5 problem" },
  { modelSlug: "cx-90",     brandSlug: "mazda",      subreddits: ["mazda", "CX90"],      searchQuery: "CX-90 problem" },
  { modelSlug: "ioniq-5",   brandSlug: "hyundai",    subreddits: ["Ioniq5", "Hyundai"],  searchQuery: "Ioniq 5 problem" },
  { modelSlug: "ev6",       brandSlug: "kia",        subreddits: ["KiaEV6", "kia"],      searchQuery: "EV6 problem" },
  { modelSlug: "telluride", brandSlug: "kia",        subreddits: ["Telluride", "kia"],   searchQuery: "Telluride problem" },
  { modelSlug: "forester",  brandSlug: "subaru",     subreddits: ["forester", "subaru"], searchQuery: "Forester problem" },
  { modelSlug: "outback",   brandSlug: "subaru",     subreddits: ["outback", "subaru"],  searchQuery: "Outback problem" },
  { modelSlug: "f-150",     brandSlug: "ford",       subreddits: ["F150", "ford"],       searchQuery: "F-150 problem" },
  { modelSlug: "maverick",  brandSlug: "ford",       subreddits: ["FordMaverickTruck"],  searchQuery: "Maverick problem" },
  { modelSlug: "model-y",   brandSlug: "tesla",      subreddits: ["TeslaModelY", "teslamotors"], searchQuery: "Model Y problem" },
  { modelSlug: "model-3",   brandSlug: "tesla",      subreddits: ["Model3", "teslamotors"], searchQuery: "Model 3 problem" },
];

async function fetchRedditJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Reddit HTTP ${res.status} for ${url}`);
  return res.json();
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function scrapeRedditIssues(
  targets: RedditTarget[] = DEFAULT_REDDIT_TARGETS,
): Promise<ComparisonScrapeResult> {
  const startedAt = new Date();
  const issues: ScrapedRedditIssue[] = [];
  const warnings: string[] = [];

  for (const t of targets) {
    for (const sub of t.subreddits) {
      const url = `https://www.reddit.com/r/${encodeURIComponent(sub)}/search.json?q=${encodeURIComponent(t.searchQuery)}&restrict_sr=on&sort=top&t=year&limit=${PER_MODEL_LIMIT}`;
      try {
        const json = (await fetchRedditJson(url)) as { data?: { children?: Array<{ data: RawRedditPost }> } };
        const posts = json.data?.children ?? [];
        for (const child of posts) {
          const p = child.data;
          if (!p || !p.title || !p.permalink) continue;
          if (!looksLikeIssue(p.title)) continue;
          issues.push({
            modelSlug: t.modelSlug,
            brandSlug: t.brandSlug,
            title: p.title,
            url: `https://www.reddit.com${p.permalink}`,
            subreddit: p.subreddit,
            author: p.author,
            upvotes: p.ups,
            summary: (p.selftext ?? "").slice(0, 600) || undefined,
            postedAt: p.created_utc ? new Date(p.created_utc * 1000) : undefined,
            sentiment: classifySentiment(p.title, p.ups ?? 0),
          });
        }
      } catch (e) {
        warnings.push(`${t.modelSlug} (r/${sub}): ${e instanceof Error ? e.message : String(e)}`);
      }
      await delay(REQUEST_DELAY_MS);
    }
  }

  return {
    source: "reddit.com",
    startedAt,
    finishedAt: new Date(),
    models: [],
    issues,
    warnings,
  };
}

type RawRedditPost = {
  title?: string;
  permalink?: string;
  subreddit?: string;
  author?: string;
  ups?: number;
  selftext?: string;
  created_utc?: number;
};
