// Lease and finance payment math. Used by /payments endpoint.
//
// Finance: standard amortization formula.
// Lease: depreciation + lease (rent) charge model used by Toyota Financial
//   Services and most Canadian captive lenders. Tax is applied to the
//   monthly payment (Ontario "pay-tax-as-you-go" lease model).

export type FinanceInput = {
  amountFinancedCad: number;   // price + fees - down payment - trade equity
  aprPercent: number;           // e.g. 5.99 for 5.99%
  termMonths: number;           // 24..96 typical
  hstRate?: number;             // 0.13 default
  taxIncluded?: boolean;        // if false, return both before-tax monthly and tax-in monthly
};

export type FinanceResult = {
  monthlyBeforeTax: number;
  monthlyTaxInOntario: number;
  totalPaid: number;
  totalInterest: number;
  apr: number;
  term: number;
};

export type LeaseInput = {
  msrpCad: number;
  capCostCad: number;            // negotiated price + fees (what's "sold" for tax purposes)
  downPaymentCad?: number;       // cap cost reduction
  tradeEquityCad?: number;       // applied as cap reduction
  residualPercent: number;       // e.g. 55 for 55%
  moneyFactor: number;           // (APR/2400) — e.g. 0.00250 ≈ 6% APR
  termMonths: number;            // 24..60 typical
  hstRate?: number;
  acquisitionFeeCad?: number;    // Toyota Financial Services typical $695
};

export type LeaseResult = {
  adjustedCapCost: number;
  residualValue: number;
  depreciationPerMonth: number;
  rentChargePerMonth: number;
  baseMonthly: number;
  hstOnMonthly: number;
  monthlyTaxIn: number;
  effectiveApr: number;
  totalPaid: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeFinancePayment(input: FinanceInput): FinanceResult {
  const r = input.aprPercent / 100 / 12;
  const n = input.termMonths;
  const P = input.amountFinancedCad;
  const monthlyBeforeTax =
    r === 0 ? P / n : (P * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  const hst = input.hstRate ?? 0.13;
  const monthlyTaxIn = monthlyBeforeTax * (1 + hst);
  const totalPaid = monthlyTaxIn * n;
  return {
    monthlyBeforeTax: round2(monthlyBeforeTax),
    monthlyTaxInOntario: round2(monthlyTaxIn),
    totalPaid: round2(totalPaid),
    totalInterest: round2(monthlyBeforeTax * n - P),
    apr: input.aprPercent,
    term: n,
  };
}

export function computeLeasePayment(input: LeaseInput): LeaseResult {
  const down = input.downPaymentCad ?? 0;
  const trade = input.tradeEquityCad ?? 0;
  const acq = input.acquisitionFeeCad ?? 0;
  const adjustedCapCost = input.capCostCad + acq - down - trade;
  const residualValue = input.msrpCad * (input.residualPercent / 100);
  const depreciation = (adjustedCapCost - residualValue) / input.termMonths;
  const rent = (adjustedCapCost + residualValue) * input.moneyFactor;
  const base = depreciation + rent;
  const hstRate = input.hstRate ?? 0.13;
  const hst = base * hstRate;
  const monthlyTaxIn = base + hst;
  const totalPaid = monthlyTaxIn * input.termMonths + down;
  const effectiveApr = input.moneyFactor * 2400;
  return {
    adjustedCapCost: round2(adjustedCapCost),
    residualValue: round2(residualValue),
    depreciationPerMonth: round2(depreciation),
    rentChargePerMonth: round2(rent),
    baseMonthly: round2(base),
    hstOnMonthly: round2(hst),
    monthlyTaxIn: round2(monthlyTaxIn),
    effectiveApr: round2(effectiveApr),
    totalPaid: round2(totalPaid),
  };
}
