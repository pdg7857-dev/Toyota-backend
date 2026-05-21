import { describe, it, expect } from "vitest";
import { computeQuote } from "../src/services/pricing.js";

describe("computeQuote", () => {
  it("returns just MSRP + HST when no fees", () => {
    const q = computeQuote(40000, null);
    expect(q.msrp).toBe(40000);
    expect(q.feeLineItems).toEqual([]);
    expect(q.subtotal).toBe(40000);
    expect(q.hstRate).toBe(0.13);
    expect(q.hst).toBe(5200);
    expect(q.total).toBe(45200);
  });

  it("sums Ontario fees and applies HST on the subtotal", () => {
    const q = computeQuote(40000, {
      freightPdiCad: 1930,
      acExciseCad: 100,
      omvicFeeCad: 12.5,
      tireStewardshipCad: 22.4,
      dealerAdminCad: 499,
      otherFeesJson: null,
      hstRate: 0.13,
    });
    // 40000 + 1930 + 100 + 12.5 + 22.4 + 499 = 42563.9
    expect(q.subtotal).toBe(42563.9);
    expect(q.hst).toBe(5533.31);
    expect(q.total).toBe(48097.21);
    expect(q.feeLineItems).toHaveLength(5);
  });

  it("ignores zero/null fee components", () => {
    const q = computeQuote(30000, {
      freightPdiCad: 1500,
      acExciseCad: 100,
      omvicFeeCad: null,
      tireStewardshipCad: 0,
      dealerAdminCad: null,
      otherFeesJson: null,
      hstRate: 0.13,
    });
    expect(q.feeLineItems).toHaveLength(2);
    expect(q.subtotal).toBe(31600);
  });

  it("handles otherFeesJson catchall", () => {
    const q = computeQuote(30000, {
      freightPdiCad: null,
      acExciseCad: null,
      omvicFeeCad: null,
      tireStewardshipCad: null,
      dealerAdminCad: null,
      otherFeesJson: { "Block heater": 250, "Floor mats": 150 },
      hstRate: 0.13,
    });
    expect(q.feeLineItems).toHaveLength(2);
    expect(q.subtotal).toBe(30400);
  });

  it("uses provided HST rate if non-default", () => {
    const q = computeQuote(10000, {
      freightPdiCad: null,
      acExciseCad: null,
      omvicFeeCad: null,
      tireStewardshipCad: null,
      dealerAdminCad: null,
      otherFeesJson: null,
      hstRate: 0.15,
    });
    expect(q.hstRate).toBe(0.15);
    expect(q.hst).toBe(1500);
    expect(q.total).toBe(11500);
  });
});
