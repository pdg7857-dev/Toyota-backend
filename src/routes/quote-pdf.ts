// PDF render of the quote.html — proxy fetch to the same server and pipe
// through Playwright Chromium. Keeps the HTML template as single source of
// truth and avoids reimplementing the layout twice.

import { Router } from "express";
import { chromium } from "playwright";
import { config } from "../config.js";

export const quotePdfRouter: Router = Router();

quotePdfRouter.get("/trims/:slug/quote.pdf", async (req, res, next) => {
  let browser;
  try {
    const slug = req.params.slug;
    if (!slug) return res.status(400).json({ error: "missing_slug" });

    // Build the same-server URL we want to print, forwarding query params.
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(req.query)) {
      if (typeof v === "string") qs.set(k, v);
    }
    const url = `http://127.0.0.1:${config.PORT}/api/v1/trims/${encodeURIComponent(slug)}/quote.html${qs.toString() ? "?" + qs.toString() : ""}`;

    browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({
      extraHTTPHeaders: { Authorization: req.header("authorization") ?? "" },
    });
    const page = await ctx.newPage();
    const resp = await page.goto(url, { waitUntil: "networkidle", timeout: 15000 });
    if (!resp || !resp.ok()) {
      const body = await page.content().catch(() => "");
      return res.status(resp?.status() ?? 502).json({ error: "render_failed", details: body.slice(0, 500) });
    }
    const pdf = await page.pdf({ format: "Letter", printBackground: true });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="quote-${slug}.pdf"`);
    res.send(pdf);
  } catch (e) {
    next(e);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});
