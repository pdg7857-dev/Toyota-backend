// Integration tests against the running app, hitting a live test DB.
// Read-only — no mutations, no cleanup needed. Assumes the seed has run.
//
// Run with: API_TOKEN=... DATABASE_URL=... npm test

import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";

const TOKEN = process.env.API_TOKEN ?? "";

let app: Express;
beforeAll(async () => {
  process.env.API_TOKEN ??= "dev-token-1234567890abcdef-test-only";
  process.env.DATABASE_URL ??= "postgresql://toyota:toyota@localhost:5432/toyota_backend?schema=public";
  const mod = await import("../src/index.js");
  app = mod.createApp();
});

const auth = () => ({ Authorization: `Bearer ${TOKEN || "dev-token-1234567890abcdef-test-only"}` });

describe("auth + health", () => {
  it("/health is public", async () => {
    const r = await request(app).get("/health");
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });

  it("rejects requests without a bearer token", async () => {
    const r = await request(app).get("/api/v1/models");
    expect(r.status).toBe(401);
  });

  it("rejects requests with a wrong bearer token", async () => {
    const r = await request(app).get("/api/v1/models").set("Authorization", "Bearer nope");
    expect(r.status).toBe(401);
  });

  it("serves the admin UI HTML", async () => {
    const r = await request(app).get("/admin");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/html/);
    expect(r.text).toContain("<title>Toyota Backend");
  });
});

describe("catalog reads", () => {
  it("lists 20 seeded models", async () => {
    const r = await request(app).get("/api/v1/models").set(auth());
    expect(r.status).toBe(200);
    expect(r.body.models.length).toBeGreaterThanOrEqual(20);
    const slugs = r.body.models.map((m: { slug: string }) => m.slug);
    expect(slugs).toContain("rav4");
    expect(slugs).toContain("camry");
    expect(slugs).toContain("tacoma");
  });

  it("filters trims by model+year+powertrain", async () => {
    const r = await request(app)
      .get("/api/v1/trims")
      .query({ model: "rav4", year: 2026, powertrain: "HYBRID" })
      .set(auth());
    expect(r.status).toBe(200);
    expect(r.body.trims.length).toBeGreaterThan(0);
    for (const t of r.body.trims) {
      expect(t.model.slug).toBe("rav4");
      expect(t.year).toBe(2026);
      expect(t.powertrain.type).toBe("HYBRID");
    }
  });

  it("returns a quote with all Ontario fees and HST", async () => {
    const r = await request(app)
      .get("/api/v1/trims/rav4-2026-xle-hybrid-awd/quote")
      .set(auth());
    expect(r.status).toBe(200);
    const labels = r.body.feeLineItems.map((li: { label: string }) => li.label);
    expect(labels).toContain("Freight & PDI");
    expect(labels).toContain("OMVIC Fee");
    expect(labels).toContain("Tire Stewardship Fee");
    expect(r.body.hstRate).toBe(0.13);
    expect(r.body.total).toBeGreaterThan(r.body.subtotal);
    // Total should equal subtotal * 1.13 within a cent
    expect(Math.abs(r.body.total - r.body.subtotal * 1.13)).toBeLessThan(0.01);
  });

  it("returns warranties for a model-year with the HV battery row", async () => {
    const r = await request(app)
      .get("/api/v1/warranties")
      .query({ model: "rav4", year: 2026 })
      .set(auth());
    expect(r.status).toBe(200);
    const hvBattery = r.body.warranties.find(
      (w: { coverageType: string }) => w.coverageType === "HYBRID_BATTERY",
    );
    expect(hvBattery).toBeDefined();
    expect(hvBattery.durationMonths).toBe(120);
    expect(hvBattery.distanceKm).toBe(240000);
    expect(hvBattery.appliesToPowertrains).toContain("HYBRID");
  });

  it("lists F&I products including Toyota Extra Care", async () => {
    const r = await request(app).get("/api/v1/finance-products").set(auth());
    expect(r.status).toBe(200);
    const names = r.body.products.map((p: { name: string }) => p.name);
    expect(names.some((n: string) => n.includes("Toyota Extra Care"))).toBe(true);
    expect(names.some((n: string) => n.includes("GAP"))).toBe(true);
  });

  it("lists rep notes including the global Ontario fees cheat-sheet", async () => {
    const r = await request(app).get("/api/v1/rep-notes").set(auth());
    expect(r.status).toBe(200);
    const titles = r.body.notes.map((n: { title: string }) => n.title);
    expect(titles).toContain("Ontario fees cheat-sheet");
  });
});

describe("compare endpoint", () => {
  it("returns side-by-side specs for multiple trims", async () => {
    const r = await request(app)
      .post("/api/v1/compare")
      .set(auth())
      .send({
        trimSlugs: ["rav4-2026-xle-hybrid-awd", "highlander-2026-xle-hybrid-awd"],
      });
    expect(r.status).toBe(200);
    expect(r.body.trims).toHaveLength(2);
    expect(r.body.missing).toEqual([]);
    expect(r.body.trims[0].quote.total).toBeGreaterThan(0);
    // Distinct hybrid powertrains — RAV4 219hp, Highlander 243hp
    const horsepower = r.body.trims.map((t: { powertrain: { horsepowerHp: number } }) => t.powertrain.horsepowerHp);
    expect(new Set(horsepower).size).toBe(2);
    // Warranty buckets keyed by model|year
    expect(Object.keys(r.body.warrantyByModelYear)).toContain("rav4|2026");
    expect(Object.keys(r.body.warrantyByModelYear)).toContain("highlander|2026");
  });

  it("returns missing slugs separately", async () => {
    const r = await request(app)
      .post("/api/v1/compare")
      .set(auth())
      .send({ trimSlugs: ["rav4-2026-xle-hybrid-awd", "does-not-exist"] });
    expect(r.status).toBe(200);
    expect(r.body.trims).toHaveLength(1);
    expect(r.body.missing).toEqual(["does-not-exist"]);
  });

  it("validates minimum 2 trims", async () => {
    const r = await request(app)
      .post("/api/v1/compare")
      .set(auth())
      .send({ trimSlugs: ["rav4-2026-xle-hybrid-awd"] });
    expect(r.status).toBe(400);
  });
});

describe("AI introspection endpoints", () => {
  it("GET /ai/health reports config and catalog version", async () => {
    const r = await request(app).get("/api/v1/ai/health").set(auth());
    expect(r.status).toBe(200);
    expect(r.body.defaultModel).toBe("claude-haiku-4-5");
    expect(r.body.optInModel).toBe("claude-sonnet-4-6");
    expect(typeof r.body.catalogVersion).toBe("number");
    expect(typeof r.body.anthropicConfigured).toBe("boolean");
  });

  it("GET /ai/context-preview scopes models from the question", async () => {
    const r = await request(app)
      .get("/api/v1/ai/context-preview")
      .query({ question: "What is the warranty on a 2026 RAV4 Hybrid battery?" })
      .set(auth());
    expect(r.status).toBe(200);
    expect(r.body.scopedModels).toContain("rav4");
    expect(r.body.fullCatalogBlock).toContain("[trim:rav4-2026-xle-hybrid-awd]");
    expect(r.body.scopedBlock).toContain("RAV4");
    expect(r.body.sizes.fullCatalogChars).toBeGreaterThan(1000);
  });

  it("GET /ai/context-preview requires a question", async () => {
    const r = await request(app).get("/api/v1/ai/context-preview").set(auth());
    expect(r.status).toBe(400);
  });
});

describe("multi-make catalog (Toyota + Lexus)", () => {
  it("lists Lexus models when filtered by make", async () => {
    const r = await request(app).get("/api/v1/models").query({ make: "Lexus" }).set(auth());
    expect(r.status).toBe(200);
    expect(r.body.models.length).toBeGreaterThanOrEqual(10);
    const slugs = r.body.models.map((m: { slug: string }) => m.slug);
    expect(slugs).toContain("lexus-rx");
    expect(slugs).toContain("lexus-nx");
    expect(slugs).toContain("lexus-is");
  });

  it("filters trims by make", async () => {
    const r = await request(app).get("/api/v1/trims").query({ make: "Lexus", year: 2026 }).set(auth());
    expect(r.status).toBe(200);
    expect(r.body.trims.length).toBeGreaterThan(0);
    for (const t of r.body.trims) {
      expect(t.model.make).toBe("Lexus");
      expect(t.year).toBe(2026);
    }
  });

  it("returns a Lexus quote with the same Ontario fee stack", async () => {
    const r = await request(app).get("/api/v1/trims/lexus-rx-2026-350h-premium/quote").set(auth());
    expect(r.status).toBe(200);
    expect(r.body.hstRate).toBe(0.13);
    expect(r.body.total).toBeGreaterThan(r.body.msrp);
  });
});

describe("color premium in quote", () => {
  it("applies the configured premium and recomputes HST + total", async () => {
    const colors = await request(app).get("/api/v1/colors").set(auth());
    const wcp = colors.body.colors.find((c: { slug: string }) => c.slug === "wind-chill-pearl");
    const trim = await request(app).get("/api/v1/trims/highlander-2026-xle-hybrid-awd").set(auth());
    await request(app)
      .put("/api/v1/colors/trim")
      .set(auth())
      .send({ trimId: trim.body.id, bodyColorId: wcp.id, available: true, premiumChargeCad: 255 });

    const without = await request(app).get("/api/v1/trims/highlander-2026-xle-hybrid-awd/quote").set(auth());
    const withColor = await request(app)
      .get("/api/v1/trims/highlander-2026-xle-hybrid-awd/quote")
      .query({ color: "wind-chill-pearl" })
      .set(auth());
    expect(withColor.status).toBe(200);
    expect(withColor.body.colorPremium).toEqual({ colorName: "Wind Chill Pearl", amount: 255 });
    expect(withColor.body.subtotal).toBeCloseTo(without.body.subtotal + 255, 2);
    expect(withColor.body.total).toBeCloseTo(without.body.total + 255 * 1.13, 1);
  });

  it("returns 404 if the color is not available on that trim", async () => {
    const r = await request(app)
      .get("/api/v1/trims/highlander-2026-xle-hybrid-awd/quote")
      .query({ color: "nonexistent-color-slug" })
      .set(auth());
    expect(r.status).toBe(404);
  });
});

describe("payments", () => {
  it("computes finance monthly payment with Ontario HST", async () => {
    const r = await request(app)
      .post("/api/v1/payments/finance")
      .set(auth())
      .send({
        trimSlug: "rav4-2026-xle-hybrid-awd",
        aprPercent: 5.99,
        termMonths: 60,
        downPaymentCad: 5000,
      });
    expect(r.status).toBe(200);
    expect(r.body.monthlyBeforeTax).toBeGreaterThan(0);
    // Monthly HST-in should be ~13% higher than before tax
    expect(r.body.monthlyTaxInOntario).toBeCloseTo(r.body.monthlyBeforeTax * 1.13, 1);
    // Sum across all months should equal totalPaid roughly
    expect(r.body.totalPaid).toBeCloseTo(r.body.monthlyTaxInOntario * 60, 0);
  });

  it("computes lease monthly payment with residual and money factor", async () => {
    const r = await request(app)
      .post("/api/v1/payments/lease")
      .set(auth())
      .send({
        trimSlug: "lexus-rx-2026-350h-premium",
        residualPercent: 55,
        moneyFactor: 0.0025,
        termMonths: 48,
        downPaymentCad: 5000,
        acquisitionFeeCad: 695,
      });
    expect(r.status).toBe(200);
    // depreciation + rent = base monthly
    expect(r.body.baseMonthly).toBeCloseTo(
      r.body.depreciationPerMonth + r.body.rentChargePerMonth,
      1,
    );
    // effective APR ≈ moneyFactor × 2400
    expect(r.body.effectiveApr).toBeCloseTo(0.0025 * 2400, 2);
    // residual = msrp × 55%
    expect(r.body.residualValue).toBeCloseTo(r.body.msrp * 0.55, 0);
  });

  it("rejects negative amount financed", async () => {
    const r = await request(app)
      .post("/api/v1/payments/finance")
      .set(auth())
      .send({ amountFinancedCad: 0, aprPercent: 6, termMonths: 60 });
    expect(r.status).toBe(400);
  });
});

describe("body colors", () => {
  it("lists seeded colors", async () => {
    const r = await request(app).get("/api/v1/colors").set(auth());
    expect(r.status).toBe(200);
    const slugs = r.body.colors.map((c: { slug: string }) => c.slug);
    expect(slugs).toContain("wind-chill-pearl");
    expect(slugs).toContain("magnetic-gray-metallic");
    expect(slugs).toContain("midnight-black-metallic");
  });

  it("upserts trim-color availability and surfaces it on the trim detail", async () => {
    const colors = await request(app).get("/api/v1/colors").set(auth());
    const wcp = colors.body.colors.find((c: { slug: string }) => c.slug === "wind-chill-pearl");
    const trim = await request(app).get("/api/v1/trims/camry-2026-xle-hybrid-awd").set(auth());
    const upsert = await request(app)
      .put("/api/v1/colors/trim")
      .set(auth())
      .send({ trimId: trim.body.id, bodyColorId: wcp.id, available: true, premiumChargeCad: 255 });
    expect(upsert.status).toBe(200);
    const after = await request(app).get("/api/v1/trims/camry-2026-xle-hybrid-awd").set(auth());
    const slugs = after.body.colors.map((tc: { bodyColor: { slug: string } }) => tc.bodyColor.slug);
    expect(slugs).toContain("wind-chill-pearl");
  });
});

describe("search by budget & needs", () => {
  it("filters by hybrid + AWD + body style + max OTD", async () => {
    const r = await request(app)
      .post("/api/v1/search")
      .set(auth())
      .send({
        year: 2026,
        hybridOnly: true,
        awdOnly: true,
        bodyStyles: ["SUV"],
        maxTotalCad: 55000,
        sortBy: "fuel_economy",
        sortDir: "asc",
        limit: 20,
      });
    expect(r.status).toBe(200);
    expect(r.body.count).toBeGreaterThan(0);
    for (const t of r.body.results) {
      expect(t.year).toBe(2026);
      expect(["HYBRID", "PHEV", "BEV"]).toContain(t.powertrain.type);
      expect((t.powertrain.drivetrain ?? "").toUpperCase()).toContain("AWD");
      expect(t.total).toBeLessThanOrEqual(55000);
    }
  });

  it("sorts by total OTD ascending", async () => {
    const r = await request(app)
      .post("/api/v1/search")
      .set(auth())
      .send({ year: 2026, sortBy: "total", sortDir: "asc", limit: 10 });
    expect(r.status).toBe(200);
    for (let i = 1; i < r.body.results.length; i++) {
      expect(r.body.results[i].total).toBeGreaterThanOrEqual(r.body.results[i - 1].total);
    }
  });

  it("validates input schema", async () => {
    const r = await request(app).post("/api/v1/search").set(auth()).send({ year: "nope" });
    expect(r.status).toBe(400);
  });
});

describe("conversations", () => {
  it("lists conversations", async () => {
    const r = await request(app).get("/api/v1/ai/conversations").set(auth());
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.conversations)).toBe(true);
  });

  it("returns 404 for unknown conversation id", async () => {
    const r = await request(app).get("/api/v1/ai/conversations/99999999").set(auth());
    expect(r.status).toBe(404);
  });
});

describe("admin scrape endpoints", () => {
  it("lists scrape runs", async () => {
    const r = await request(app).get("/api/v1/admin/scrape/runs").set(auth());
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.runs)).toBe(true);
  });
});

describe("404 for unknown resources", () => {
  it("returns 404 for an unknown trim slug", async () => {
    const r = await request(app)
      .get("/api/v1/trims/does-not-exist/quote")
      .set(auth());
    expect(r.status).toBe(404);
  });

  it("returns 404 for an unknown model slug", async () => {
    const r = await request(app).get("/api/v1/models/does-not-exist").set(auth());
    expect(r.status).toBe(404);
  });
});
