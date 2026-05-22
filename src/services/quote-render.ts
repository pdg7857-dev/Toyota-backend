// Server-side HTML rendering of a customer-facing quote sheet. Used by
// /trims/:slug/quote.html (browser-printable) and /quote.pdf (Playwright).

import type { Quote } from "./pricing.js";

export function renderQuoteHtml(opts: {
  trim: { slug: string; year: number; name: string; model: string; make?: string };
  quote: Quote;
  effectiveDate?: Date | null;
  monthlyFinance?: { aprPercent: number; termMonths: number; monthlyTaxIn: number; downPayment: number } | null;
  monthlyLease?: { moneyFactor: number; residualPercent: number; termMonths: number; monthlyTaxIn: number; downPayment: number } | null;
  incentives?: Array<{ name: string; amountCad: number | null }>;
  dealer?: { name?: string; address?: string; phone?: string };
}): string {
  const { trim, quote, monthlyFinance, monthlyLease, incentives, dealer } = opts;
  const fmt = (n: number) =>
    "$" +
    n.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const date = opts.effectiveDate ? new Date(opts.effectiveDate).toLocaleDateString("en-CA") : new Date().toLocaleDateString("en-CA");

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>${trim.year} ${trim.make ?? ""} ${trim.model} ${trim.name} — Quote</title>
<style>
  @media print { @page { margin: 18mm 16mm; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  body { font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1a1a1a; max-width: 720px; margin: 24px auto; padding: 0 20px; }
  h1 { margin: 0 0 4px; font-size: 22px; }
  .sub { color: #666; font-size: 13px; margin-bottom: 24px; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0 18px; }
  th, td { padding: 7px 10px; text-align: left; }
  thead th { background: #f3f4f6; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: #444; }
  tbody tr td { border-bottom: 1px solid #e5e7eb; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .total td { font-weight: 700; font-size: 15px; padding-top: 12px; padding-bottom: 12px; background: #f9fafb; }
  .section-title { margin: 28px 0 8px; font-size: 14px; font-weight: 600; color: #444; text-transform: uppercase; letter-spacing: 0.04em; }
  .payment-card { display: inline-block; background: #f3f4f6; border-radius: 6px; padding: 14px 18px; margin: 4px 8px 4px 0; min-width: 180px; vertical-align: top; }
  .payment-card .label { font-size: 11px; color: #666; text-transform: uppercase; letter-spacing: 0.04em; }
  .payment-card .amount { font-size: 24px; font-weight: 700; margin: 4px 0; }
  .payment-card .term { font-size: 12px; color: #444; }
  .footer { margin-top: 32px; font-size: 11px; color: #888; }
  .dealer { margin-bottom: 16px; font-size: 12px; color: #555; }
</style>
</head>
<body>
  ${dealer?.name ? `<div class="dealer"><strong>${dealer.name}</strong>${dealer.address ? ` · ${dealer.address}` : ""}${dealer.phone ? ` · ${dealer.phone}` : ""}</div>` : ""}
  <h1>${trim.year} ${trim.make ?? ""} ${trim.model} ${trim.name}</h1>
  <div class="sub">Quote dated ${date}. Pricing in CAD. Ontario fees included.</div>

  <div class="section-title">Price Summary</div>
  <table>
    <tbody>
      <tr><td>MSRP</td><td class="num">${fmt(quote.msrp)}</td></tr>
      ${quote.feeLineItems.map((li) => `<tr><td>${li.label}</td><td class="num">${fmt(li.amount)}</td></tr>`).join("")}
      ${quote.colorPremium ? `<tr><td>Premium colour — ${quote.colorPremium.colorName}</td><td class="num">${fmt(quote.colorPremium.amount)}</td></tr>` : ""}
      <tr><td>Subtotal</td><td class="num">${fmt(quote.subtotal)}</td></tr>
      <tr><td>HST (${(quote.hstRate * 100).toFixed(0)}%)</td><td class="num">${fmt(quote.hst)}</td></tr>
      <tr class="total"><td>Out-the-Door Total</td><td class="num">${fmt(quote.total)}</td></tr>
    </tbody>
  </table>

  ${monthlyFinance || monthlyLease ? `<div class="section-title">Payment options</div>` : ""}
  ${monthlyFinance ? `
    <div class="payment-card">
      <div class="label">Finance</div>
      <div class="amount">${fmt(monthlyFinance.monthlyTaxIn)}/mo</div>
      <div class="term">${monthlyFinance.termMonths} mo @ ${monthlyFinance.aprPercent}% APR · ${fmt(monthlyFinance.downPayment)} down · HST in</div>
    </div>` : ""}
  ${monthlyLease ? `
    <div class="payment-card">
      <div class="label">Lease</div>
      <div class="amount">${fmt(monthlyLease.monthlyTaxIn)}/mo</div>
      <div class="term">${monthlyLease.termMonths} mo · ${monthlyLease.residualPercent}% residual · MF ${monthlyLease.moneyFactor} · ${fmt(monthlyLease.downPayment)} down · HST in</div>
    </div>` : ""}

  ${incentives && incentives.length > 0 ? `
    <div class="section-title">Available Incentives (apply if eligible)</div>
    <table><tbody>
      ${incentives.map((i) => `<tr><td>${i.name}</td><td class="num">${i.amountCad ? "−" + fmt(i.amountCad) : ""}</td></tr>`).join("")}
    </tbody></table>
  ` : ""}

  <div class="footer">
    Pricing subject to dealer confirmation. Promo rates and incentives subject to OAC and program rules.
    Licensing, registration, and tire registration not included unless specified.
  </div>
</body></html>`;
}
