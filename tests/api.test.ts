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
