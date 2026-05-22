import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/client.js";
import { computeFinancePayment, computeLeasePayment } from "../services/payments.js";
import { computeQuote } from "../services/pricing.js";

export const paymentsRouter: Router = Router();

const financeSchema = z.object({
  trimSlug: z.string().optional(),
  amountFinancedCad: z.number().positive().optional(),
  aprPercent: z.number().min(0).max(30),
  termMonths: z.number().int().min(12).max(120),
  downPaymentCad: z.number().nonnegative().optional(),
  tradeEquityCad: z.number().optional(),
  includeFeesAndHst: z.boolean().optional(),
});

const leaseSchema = z.object({
  trimSlug: z.string().optional(),
  msrpCad: z.number().positive().optional(),
  capCostCad: z.number().positive().optional(),
  downPaymentCad: z.number().nonnegative().optional(),
  tradeEquityCad: z.number().optional(),
  residualPercent: z.number().min(0).max(100),
  moneyFactor: z.number().min(0).max(0.02),
  termMonths: z.number().int().min(12).max(60),
  acquisitionFeeCad: z.number().nonnegative().optional(),
});

async function resolveTrimQuote(slug: string) {
  const trim = await prisma.trim.findUnique({
    where: { slug },
    include: { fees: { orderBy: { effectiveDate: "desc" }, take: 1 } },
  });
  if (!trim) return null;
  const fee = trim.fees[0] ?? null;
  const quote = computeQuote(trim.msrpCad, fee);
  return { trim, fee, quote };
}

paymentsRouter.post("/finance", async (req, res, next) => {
  try {
    const input = financeSchema.parse(req.body);
    let amountFinanced = input.amountFinancedCad;
    let info: { trim?: string; year?: number; msrp?: number; otd?: number } = {};
    if (!amountFinanced) {
      if (!input.trimSlug) return res.status(400).json({ error: "amountFinancedCad_or_trimSlug_required" });
      const r = await resolveTrimQuote(input.trimSlug);
      if (!r) return res.status(404).json({ error: "trim_not_found" });
      const base = input.includeFeesAndHst === false ? r.quote.msrp : r.quote.total;
      amountFinanced = base - (input.downPaymentCad ?? 0) - (input.tradeEquityCad ?? 0);
      info = { trim: r.trim.slug, year: r.trim.year, msrp: r.quote.msrp, otd: r.quote.total };
    }
    if (amountFinanced <= 0) return res.status(400).json({ error: "amount_financed_must_be_positive" });
    const result = computeFinancePayment({
      amountFinancedCad: amountFinanced,
      aprPercent: input.aprPercent,
      termMonths: input.termMonths,
    });
    res.json({ ...info, amountFinanced, ...result });
  } catch (e) {
    next(e);
  }
});

paymentsRouter.post("/lease", async (req, res, next) => {
  try {
    const input = leaseSchema.parse(req.body);
    let msrp = input.msrpCad;
    let capCost = input.capCostCad;
    let info: { trim?: string; year?: number } = {};
    if (!msrp || !capCost) {
      if (!input.trimSlug) return res.status(400).json({ error: "msrpCad_and_capCostCad_or_trimSlug_required" });
      const r = await resolveTrimQuote(input.trimSlug);
      if (!r) return res.status(404).json({ error: "trim_not_found" });
      msrp = msrp ?? r.quote.msrp;
      // capCost defaults to MSRP + all fees (the price before tax)
      capCost = capCost ?? r.quote.subtotal;
      info = { trim: r.trim.slug, year: r.trim.year };
    }
    const result = computeLeasePayment({
      msrpCad: msrp,
      capCostCad: capCost,
      downPaymentCad: input.downPaymentCad,
      tradeEquityCad: input.tradeEquityCad,
      residualPercent: input.residualPercent,
      moneyFactor: input.moneyFactor,
      termMonths: input.termMonths,
      acquisitionFeeCad: input.acquisitionFeeCad,
    });
    res.json({ ...info, msrp, capCost, ...result });
  } catch (e) {
    next(e);
  }
});
