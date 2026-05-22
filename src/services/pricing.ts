import { Prisma } from "@prisma/client";

type FeeInput = {
  freightPdiCad: Prisma.Decimal | number | null;
  acExciseCad: Prisma.Decimal | number | null;
  omvicFeeCad: Prisma.Decimal | number | null;
  tireStewardshipCad: Prisma.Decimal | number | null;
  dealerAdminCad: Prisma.Decimal | number | null;
  otherFeesJson: Prisma.JsonValue | null;
  hstRate: Prisma.Decimal | number;
};

export type QuoteLineItem = { label: string; amount: number };

export type Quote = {
  msrp: number;
  feeLineItems: QuoteLineItem[];
  colorPremium?: { colorName: string; amount: number };
  subtotal: number;
  hstRate: number;
  hst: number;
  total: number;
};

export type ColorPremium = { colorName: string; amount: number };

function toNum(v: Prisma.Decimal | number | null | undefined): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  return Number(v.toString());
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeQuote(
  msrp: Prisma.Decimal | number,
  fee: FeeInput | null,
  colorPremium?: ColorPremium | null,
): Quote {
  const msrpN = toNum(msrp);
  const lineItems: QuoteLineItem[] = [];
  if (fee) {
    if (toNum(fee.freightPdiCad) > 0)
      lineItems.push({ label: "Freight & PDI", amount: toNum(fee.freightPdiCad) });
    if (toNum(fee.acExciseCad) > 0)
      lineItems.push({ label: "A/C Excise Tax", amount: toNum(fee.acExciseCad) });
    if (toNum(fee.omvicFeeCad) > 0)
      lineItems.push({ label: "OMVIC Fee", amount: toNum(fee.omvicFeeCad) });
    if (toNum(fee.tireStewardshipCad) > 0)
      lineItems.push({ label: "Tire Stewardship Fee", amount: toNum(fee.tireStewardshipCad) });
    if (toNum(fee.dealerAdminCad) > 0)
      lineItems.push({ label: "Dealer Admin Fee", amount: toNum(fee.dealerAdminCad) });
    if (fee.otherFeesJson && typeof fee.otherFeesJson === "object" && !Array.isArray(fee.otherFeesJson)) {
      for (const [label, value] of Object.entries(fee.otherFeesJson as Record<string, unknown>)) {
        const amount = typeof value === "number" ? value : Number(value);
        if (Number.isFinite(amount) && amount > 0) lineItems.push({ label, amount });
      }
    }
  }
  const colorAmount = colorPremium && colorPremium.amount > 0 ? colorPremium.amount : 0;
  const feesSum = lineItems.reduce((acc, li) => acc + li.amount, 0);
  const subtotal = round2(msrpN + feesSum + colorAmount);
  const hstRate = fee ? toNum(fee.hstRate) : 0.13;
  const hst = round2(subtotal * hstRate);
  const total = round2(subtotal + hst);
  return {
    msrp: round2(msrpN),
    feeLineItems: lineItems.map((li) => ({ label: li.label, amount: round2(li.amount) })),
    colorPremium: colorAmount > 0 ? { colorName: colorPremium!.colorName, amount: round2(colorAmount) } : undefined,
    subtotal,
    hstRate,
    hst,
    total,
  };
}
