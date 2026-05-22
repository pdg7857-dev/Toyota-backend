import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/client.js";
import { computeFinancePayment, computeLeasePayment } from "../services/payments.js";
import { computeQuote } from "../services/pricing.js";

export const paymentsRouter: Router = Router();

const financeSchema = z.object({
  trimSlug: z.string().optional(),
  amountFinancedCad: z.number().positive().optional(),
  aprPercent: z.number().min(0).max(30).optional(),
  termMonths: z.number().int().min(12).max(120),
  downPaymentCad: z.number().nonnegative().optional(),
  tradeEquityCad: z.number().optional(),
  includeFeesAndHst: z.boolean().optional(),
  usePromoRate: z.boolean().optional(),
});

const leaseSchema = z.object({
  trimSlug: z.string().optional(),
  msrpCad: z.number().positive().optional(),
  capCostCad: z.number().positive().optional(),
  downPaymentCad: z.number().nonnegative().optional(),
  tradeEquityCad: z.number().optional(),
  residualPercent: z.number().min(0).max(100).optional(),
  moneyFactor: z.number().min(0).max(0.02).optional(),
  termMonths: z.number().int().min(12).max(60),
  acquisitionFeeCad: z.number().nonnegative().optional(),
  usePromoRate: z.boolean().optional(),
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

async function findActivePromo(modelSlug: string, kind: "FINANCE" | "LEASE", termMonths: number) {
  const now = new Date();
  const promos = await prisma.financePromo.findMany({
    where: {
      modelSlug,
      kind,
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
    },
    orderBy: [{ termMonths: "asc" }],
  });
  return (
    promos.find((p) => p.termMonths === termMonths) ?? promos[promos.length - 1] ?? null
  );
}

paymentsRouter.post("/finance", async (req, res, next) => {
  try {
    const input = financeSchema.parse(req.body);
    let amountFinanced = input.amountFinancedCad;
    let info: { trim?: string; year?: number; msrp?: number; otd?: number; promoUsed?: string } = {};
    let trimRecord = null;
    if (!amountFinanced) {
      if (!input.trimSlug) return res.status(400).json({ error: "amountFinancedCad_or_trimSlug_required" });
      const r = await resolveTrimQuote(input.trimSlug);
      if (!r) return res.status(404).json({ error: "trim_not_found" });
      trimRecord = r.trim;
      const base = input.includeFeesAndHst === false ? r.quote.msrp : r.quote.total;
      amountFinanced = base - (input.downPaymentCad ?? 0) - (input.tradeEquityCad ?? 0);
      info = { trim: r.trim.slug, year: r.trim.year, msrp: r.quote.msrp, otd: r.quote.total };
    }
    if (amountFinanced <= 0) return res.status(400).json({ error: "amount_financed_must_be_positive" });

    let aprPercent = input.aprPercent;
    if (aprPercent == null) {
      if (input.usePromoRate !== false && trimRecord) {
        const trim = await prisma.trim.findUnique({ where: { id: trimRecord.id }, include: { model: true } });
        if (trim) {
          const promo = await findActivePromo(trim.model.slug, "FINANCE", input.termMonths);
          if (promo?.aprPercent) {
            aprPercent = Number(promo.aprPercent.toString());
            info.promoUsed = `${trim.model.slug} FINANCE ${promo.termMonths}mo @ ${aprPercent}%`;
          }
        }
      }
      if (aprPercent == null) return res.status(400).json({ error: "apr_required", message: "Pass aprPercent or use a trimSlug with an active finance promo." });
    }

    const result = computeFinancePayment({
      amountFinancedCad: amountFinanced,
      aprPercent,
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
    let info: { trim?: string; year?: number; promoUsed?: string } = {};
    let trimRecord = null;
    if (!msrp || !capCost) {
      if (!input.trimSlug) return res.status(400).json({ error: "msrpCad_and_capCostCad_or_trimSlug_required" });
      const r = await resolveTrimQuote(input.trimSlug);
      if (!r) return res.status(404).json({ error: "trim_not_found" });
      trimRecord = r.trim;
      msrp = msrp ?? r.quote.msrp;
      capCost = capCost ?? r.quote.subtotal;
      info = { trim: r.trim.slug, year: r.trim.year };
    }

    let { residualPercent, moneyFactor } = input;
    if ((residualPercent == null || moneyFactor == null) && input.usePromoRate !== false) {
      const tr = trimRecord ?? (input.trimSlug ? (await resolveTrimQuote(input.trimSlug))?.trim : null);
      if (tr) {
        const trim = await prisma.trim.findUnique({ where: { id: tr.id }, include: { model: true } });
        if (trim) {
          const promo = await findActivePromo(trim.model.slug, "LEASE", input.termMonths);
          if (promo?.moneyFactor && promo?.residualPercent) {
            moneyFactor = moneyFactor ?? Number(promo.moneyFactor.toString());
            residualPercent = residualPercent ?? Number(promo.residualPercent.toString());
            info.promoUsed = `${trim.model.slug} LEASE ${promo.termMonths}mo @ MF ${moneyFactor} / residual ${residualPercent}%`;
          }
        }
      }
    }
    if (residualPercent == null || moneyFactor == null) {
      return res.status(400).json({ error: "lease_terms_required", message: "Pass residualPercent + moneyFactor or use a trimSlug with an active lease promo." });
    }

    const result = computeLeasePayment({
      msrpCad: msrp!,
      capCostCad: capCost!,
      downPaymentCad: input.downPaymentCad,
      tradeEquityCad: input.tradeEquityCad,
      residualPercent,
      moneyFactor,
      termMonths: input.termMonths,
      acquisitionFeeCad: input.acquisitionFeeCad,
    });
    res.json({ ...info, msrp, capCost, ...result });
  } catch (e) {
    next(e);
  }
});
