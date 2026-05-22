// Driving the admin UI with Playwright to take screenshots of each tab.
// Run via: node --env-file=.env tour.mjs
import { chromium } from "playwright";
import fs from "node:fs/promises";

const TOKEN = process.env.API_TOKEN;
const URL = "http://localhost:3000";

await fs.mkdir("screenshots", { recursive: true });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();

// Inject the API token before the app loads so the dialog never appears.
await ctx.addInitScript((tok) => {
  localStorage.setItem("toyota_token", tok);
}, TOKEN);

async function shot(tab, name) {
  await page.goto(`${URL}/admin#${tab}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `screenshots/${name}.png`, fullPage: true });
  console.log(`  → ${name}.png`);
}

console.log("Taking screenshots…");

// 1. Models
await shot("models", "01-models");

// 2. Trims
await shot("trims", "02-trims");

// 3. Quote via admin trim list — open RAV4 XLE Hybrid fees form
await page.goto(`${URL}/admin#trims`, { waitUntil: "networkidle" });
await page.waitForTimeout(500);

// 4. Search — fill the form with a real query, run it
await page.goto(`${URL}/admin#search`, { waitUntil: "networkidle" });
await page.waitForTimeout(300);
await page.selectOption("#s_year", "2026");
await page.fill("#s_body", "SUV");
await page.fill("#s_maxTotal", "55000");
await page.check("#s_hybridOnly");
await page.check("#s_awdOnly");
await page.selectOption("#s_sort", "fuel_economy");
await page.click("button.primary:has-text('Search')");
await page.waitForTimeout(1000);
await page.screenshot({ path: "screenshots/03-search.png", fullPage: true });
console.log("  → 03-search.png");

// 5. Compare — pick three trims
await page.goto(`${URL}/admin#compare`, { waitUntil: "networkidle" });
await page.waitForTimeout(500);
await page.selectOption("#cmp_0", "rav4-2026-xle-hybrid-awd");
await page.selectOption("#cmp_1", "highlander-2026-xle-hybrid-awd");
await page.selectOption("#cmp_2", "camry-2026-xle-hybrid-awd");
await page.click("button.primary:has-text('Compare')");
await page.waitForTimeout(1000);
await page.screenshot({ path: "screenshots/04-compare.png", fullPage: true });
console.log("  → 04-compare.png");

// 6. Warranties
await shot("warranties", "05-warranties");

// 7. F&I products
await shot("finance", "06-finance-products");

// 8. Rep notes
await shot("notes", "07-rep-notes");

// 9. Colors — list
await shot("colors", "08-colors-list");

// 10. Colors — show per-trim matrix
await page.goto(`${URL}/admin#colors`, { waitUntil: "networkidle" });
await page.waitForTimeout(500);
const rav4XleId = await page.evaluate(async (tok) => {
  const r = await fetch("/api/v1/trims/rav4-2026-xle-hybrid-awd", { headers: { Authorization: "Bearer " + tok } });
  return (await r.json()).id;
}, TOKEN);
await page.selectOption("#cl_pickTrim", String(rav4XleId));
await page.click("button.secondary:has-text('Load')");
await page.waitForTimeout(500);
await page.screenshot({ path: "screenshots/09-colors-per-trim.png", fullPage: true });
console.log("  → 09-colors-per-trim.png");

// 11. Powertrains
await shot("powertrains", "10-powertrains");

// 12. Scraper
await shot("scrape", "11-scraper");

// 13. AI Q&A panel (without API key, just shows the empty state)
await shot("ai", "12-ai-qa");

// 14. AI context preview via the URL — actually that's an API endpoint, skip in browser.

await browser.close();
console.log("Done. 12 screenshots in ./screenshots/");
