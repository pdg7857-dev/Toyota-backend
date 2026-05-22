// Option packages, finance promos, incentives, maintenance intervals,
// and walkaround rep notes. All are starting points — refresh from Toyota
// Canada / Lexus Canada monthly bulletins.

import { FinancePromoKind, IncentiveKind, RepNoteScope } from "@prisma/client";

export const OPTION_PACKAGES = [
  {
    slug: "premium-audio",
    name: "Premium Audio (JBL)",
    descriptionMd: "Premium JBL-branded audio system with subwoofer and amplifier. Available on most XLE+ Toyota trims and Premium+ Lexus trims.",
    featuresJson: { speakers: 9, watts: 800, subwoofer: true, brand: "JBL" },
  },
  {
    slug: "technology-package",
    name: "Technology Package",
    descriptionMd: "Adds head-up display, 360° camera, digital rearview mirror, advanced parking assist.",
    featuresJson: { features: ["Head-up Display", "Panoramic View Monitor", "Digital Rearview Mirror", "Advanced Park", "Front+Rear Parking Sonar"] },
  },
  {
    slug: "weather-package",
    name: "Cold Weather Package",
    descriptionMd: "Heated steering wheel + heated rear seats + heated windshield wiper de-icer. Critical for Ontario winters.",
    featuresJson: { features: ["Heated Steering Wheel", "Heated Rear Seats", "Windshield Wiper De-icer"] },
  },
  {
    slug: "tow-package",
    name: "Tow Prep Package",
    descriptionMd: "Class III/IV hitch receiver, 7-pin connector, trans cooler, wiring harness. Required for max tow ratings on most SUVs.",
    featuresJson: { features: ["Hitch Receiver", "7-pin Connector", "Trans Cooler", "Wiring Harness"] },
  },
  {
    slug: "panoramic-moonroof",
    name: "Panoramic Moonroof",
    descriptionMd: "Dual-pane panoramic moonroof, front panel sliding.",
  },
  {
    slug: "advanced-tech-pkg",
    name: "Advanced Technology Package",
    descriptionMd: "Lexus-specific: Mark Levinson audio, head-up display, panoramic view monitor, hands-free power liftgate.",
    featuresJson: { features: ["Mark Levinson Audio", "Head-up Display", "Panoramic View Monitor", "Hands-Free Liftgate"] },
  },
  {
    slug: "trailer-tow-prep-tundra",
    name: "Tundra Tow Tech Package",
    descriptionMd: "Trailer brake controller, integrated tow mirrors with power-fold and heating, panoramic view monitor with hitch view.",
  },
  {
    slug: "lexus-luxury-pkg",
    name: "Luxury Package (Lexus)",
    descriptionMd: "Power passenger seat lumbar, semi-aniline leather, climate-controlled front seats, perforated leather steering wheel.",
  },
];

// trim_options join records — examples per trim. The full set should be filled
// out by the rep via the admin UI; this seeds enough to demo the feature.
export const TRIM_OPTION_LINKS: Array<{
  trimSlug: string;
  packageSlug: string;
  priceCad: number;
  notesMd?: string;
}> = [
  { trimSlug: "rav4-2026-xle-hybrid-awd", packageSlug: "weather-package", priceCad: 700 },
  { trimSlug: "rav4-2026-xle-hybrid-awd", packageSlug: "premium-audio", priceCad: 1300 },
  { trimSlug: "rav4-2026-limited-hybrid-awd", packageSlug: "technology-package", priceCad: 2400 },
  { trimSlug: "rav4-2026-limited-hybrid-awd", packageSlug: "panoramic-moonroof", priceCad: 1500 },
  { trimSlug: "camry-2026-xle-hybrid-awd", packageSlug: "premium-audio", priceCad: 1300 },
  { trimSlug: "camry-2026-xle-hybrid-awd", packageSlug: "panoramic-moonroof", priceCad: 1500 },
  { trimSlug: "highlander-2026-platinum-hybrid-awd", packageSlug: "technology-package", priceCad: 2400 },
  { trimSlug: "highlander-2026-platinum-hybrid-awd", packageSlug: "premium-audio", priceCad: 1700 },
  { trimSlug: "tundra-2026-platinum-crewmax-hybrid-4wd", packageSlug: "trailer-tow-prep-tundra", priceCad: 1300 },
  { trimSlug: "tundra-2026-1794-hybrid-4wd", packageSlug: "trailer-tow-prep-tundra", priceCad: 1300 },
  { trimSlug: "lexus-rx-2026-350h-luxury", packageSlug: "lexus-luxury-pkg", priceCad: 3500 },
  { trimSlug: "lexus-rx-2026-350h-luxury", packageSlug: "advanced-tech-pkg", priceCad: 4500 },
  { trimSlug: "lexus-nx-2026-350h-luxury", packageSlug: "lexus-luxury-pkg", priceCad: 3500 },
  { trimSlug: "lexus-tx-2026-500h-fsport2", packageSlug: "advanced-tech-pkg", priceCad: 4500 },
];

// Sample finance promos. Refresh monthly from Toyota Canada / Lexus Canada
// dealer bulletins.
export const FINANCE_PROMOS: Array<{
  modelSlug: string;
  kind: FinancePromoKind;
  termMonths: number;
  aprPercent?: number;
  moneyFactor?: number;
  residualPercent?: number;
  effectiveFrom: string;
  effectiveTo?: string;
  notesMd?: string;
}> = [
  // Toyota — placeholders. Real numbers come from monthly bulletins.
  { modelSlug: "rav4", kind: FinancePromoKind.FINANCE, termMonths: 60, aprPercent: 4.99, effectiveFrom: "2026-05-01", effectiveTo: "2026-05-31",
    notesMd: "Standard rate. Featured promo varies — check Toyota Bulletin." },
  { modelSlug: "rav4", kind: FinancePromoKind.LEASE, termMonths: 48, moneyFactor: 0.00195, residualPercent: 58, effectiveFrom: "2026-05-01", effectiveTo: "2026-05-31",
    notesMd: "Hybrid trims, 20,000 km/yr allowance." },
  { modelSlug: "camry", kind: FinancePromoKind.FINANCE, termMonths: 60, aprPercent: 3.99, effectiveFrom: "2026-05-01", effectiveTo: "2026-05-31" },
  { modelSlug: "camry", kind: FinancePromoKind.LEASE, termMonths: 48, moneyFactor: 0.00150, residualPercent: 60, effectiveFrom: "2026-05-01", effectiveTo: "2026-05-31" },
  { modelSlug: "corolla", kind: FinancePromoKind.FINANCE, termMonths: 60, aprPercent: 2.99, effectiveFrom: "2026-05-01", effectiveTo: "2026-05-31" },
  { modelSlug: "corolla", kind: FinancePromoKind.LEASE, termMonths: 60, moneyFactor: 0.00125, residualPercent: 50, effectiveFrom: "2026-05-01", effectiveTo: "2026-05-31" },
  { modelSlug: "highlander", kind: FinancePromoKind.FINANCE, termMonths: 60, aprPercent: 5.49, effectiveFrom: "2026-05-01", effectiveTo: "2026-05-31" },
  { modelSlug: "tacoma", kind: FinancePromoKind.FINANCE, termMonths: 60, aprPercent: 5.99, effectiveFrom: "2026-05-01", effectiveTo: "2026-05-31" },
  { modelSlug: "tundra", kind: FinancePromoKind.FINANCE, termMonths: 60, aprPercent: 5.99, effectiveFrom: "2026-05-01", effectiveTo: "2026-05-31" },
  { modelSlug: "prius-prime", kind: FinancePromoKind.LEASE, termMonths: 48, moneyFactor: 0.00099, residualPercent: 55, effectiveFrom: "2026-05-01", effectiveTo: "2026-05-31",
    notesMd: "PHEV — stacks with federal iZEV $2,500 at delivery." },
  { modelSlug: "bz4x", kind: FinancePromoKind.LEASE, termMonths: 48, moneyFactor: 0.00150, residualPercent: 52, effectiveFrom: "2026-05-01", effectiveTo: "2026-05-31",
    notesMd: "BEV — stacks with federal iZEV $5,000 at delivery." },
  // Lexus
  { modelSlug: "lexus-rx", kind: FinancePromoKind.FINANCE, termMonths: 60, aprPercent: 4.49, effectiveFrom: "2026-05-01", effectiveTo: "2026-05-31" },
  { modelSlug: "lexus-rx", kind: FinancePromoKind.LEASE, termMonths: 48, moneyFactor: 0.00175, residualPercent: 60, effectiveFrom: "2026-05-01", effectiveTo: "2026-05-31" },
  { modelSlug: "lexus-nx", kind: FinancePromoKind.FINANCE, termMonths: 60, aprPercent: 4.49, effectiveFrom: "2026-05-01", effectiveTo: "2026-05-31" },
  { modelSlug: "lexus-nx", kind: FinancePromoKind.LEASE, termMonths: 48, moneyFactor: 0.00175, residualPercent: 58, effectiveFrom: "2026-05-01", effectiveTo: "2026-05-31" },
  { modelSlug: "lexus-tx", kind: FinancePromoKind.LEASE, termMonths: 48, moneyFactor: 0.00185, residualPercent: 55, effectiveFrom: "2026-05-01", effectiveTo: "2026-05-31" },
  { modelSlug: "lexus-es", kind: FinancePromoKind.LEASE, termMonths: 48, moneyFactor: 0.00165, residualPercent: 57, effectiveFrom: "2026-05-01", effectiveTo: "2026-05-31" },
];

export const INCENTIVES: Array<{
  slug: string;
  name: string;
  kind: IncentiveKind;
  amountCad?: number;
  stackable?: boolean;
  eligibleMakes?: string[];
  eligibleSlugs?: string[];
  eligibleYears?: number[];
  effectiveFrom: string;
  effectiveTo?: string;
  notesMd?: string;
}> = [
  {
    slug: "toyota-loyalty-500",
    name: "Toyota Loyalty",
    kind: IncentiveKind.LOYALTY,
    amountCad: 500,
    eligibleMakes: ["Toyota"],
    effectiveFrom: "2026-01-01",
    notesMd: "Customer must currently own or have owned a Toyota in the last 5 years. Combinable with most promo rates. Verify in dealer portal.",
  },
  {
    slug: "toyota-conquest-500",
    name: "Toyota Conquest",
    kind: IncentiveKind.CONQUEST,
    amountCad: 500,
    eligibleMakes: ["Toyota"],
    effectiveFrom: "2026-01-01",
    notesMd: "Customer trades in a competing brand. Cannot stack with loyalty.",
  },
  {
    slug: "lexus-loyalty-1000",
    name: "Lexus Loyalty",
    kind: IncentiveKind.LOYALTY,
    amountCad: 1000,
    eligibleMakes: ["Lexus"],
    effectiveFrom: "2026-01-01",
    notesMd: "Existing Lexus owner. Stacks with most promo rates.",
  },
  {
    slug: "lexus-conquest-1500",
    name: "Lexus Conquest",
    kind: IncentiveKind.CONQUEST,
    amountCad: 1500,
    eligibleMakes: ["Lexus"],
    effectiveFrom: "2026-01-01",
    notesMd: "Trading from a competing luxury brand (BMW/Audi/Mercedes/Genesis/Acura). Generous in 2026 — verify amount monthly.",
  },
  {
    slug: "izev-bev-5000",
    name: "Federal iZEV — BEV",
    kind: IncentiveKind.CASH_REBATE,
    amountCad: 5000,
    eligibleMakes: ["Toyota", "Lexus"],
    eligibleSlugs: ["bz4x", "lexus-rz"],
    effectiveFrom: "2026-01-01",
    notesMd: "Federal Incentives for Zero-Emission Vehicles. Applied at delivery by dealer. Subject to MSRP caps and program funding.",
  },
  {
    slug: "izev-phev-2500",
    name: "Federal iZEV — PHEV",
    kind: IncentiveKind.CASH_REBATE,
    amountCad: 2500,
    eligibleMakes: ["Toyota", "Lexus"],
    eligibleSlugs: ["rav4", "prius-prime", "lexus-nx", "lexus-rx", "lexus-tx"],
    effectiveFrom: "2026-01-01",
    notesMd: "PHEVs with ≥50 km electric range. Applies to: RAV4 Prime, Prius Prime, Lexus NX 450h+, RX 450h+, TX 550h+.",
  },
  {
    slug: "student-grad-750",
    name: "Toyota Student Grad",
    kind: IncentiveKind.STUDENT_GRAD,
    amountCad: 750,
    eligibleMakes: ["Toyota"],
    effectiveFrom: "2026-01-01",
    notesMd: "Recent (within 2 years) or current post-secondary student. Show transcript or enrollment letter.",
  },
  {
    slug: "lexus-graduate-1000",
    name: "Lexus Graduate Program",
    kind: IncentiveKind.STUDENT_GRAD,
    amountCad: 1000,
    eligibleMakes: ["Lexus"],
    effectiveFrom: "2026-01-01",
    notesMd: "Bachelor's degree within last 2 years. Verify program rules monthly.",
  },
  {
    slug: "first-responder-750",
    name: "First Responder / Military",
    kind: IncentiveKind.FIRST_RESPONDER,
    amountCad: 750,
    eligibleMakes: ["Toyota", "Lexus"],
    effectiveFrom: "2026-01-01",
    notesMd: "Active duty / veteran / police / fire / paramedic. Proof of service required.",
  },
];

// Standard Toyota/Lexus maintenance schedule (gas + hybrid). Real intervals
// can vary; verify against the model's owner's manual.
export const MAINTENANCE_INTERVALS: Array<{
  modelSlug?: string;
  powertrainType?: string;
  intervalKm: number;
  servicesJson: object;
  partsCostCad?: number;
  labourMinutes?: number;
  notesMd?: string;
}> = [
  // Default schedule applied to ALL trims (overridable per model).
  { intervalKm: 8000, servicesJson: { services: ["Engine oil & filter", "Tire rotation", "Multi-point inspection"] }, partsCostCad: 70, labourMinutes: 30 },
  { intervalKm: 16000, servicesJson: { services: ["Engine oil & filter", "Tire rotation", "Brake inspection", "Cabin air filter check"] }, partsCostCad: 90, labourMinutes: 45 },
  { intervalKm: 24000, servicesJson: { services: ["Engine oil & filter", "Tire rotation", "Brake fluid level"] }, partsCostCad: 70, labourMinutes: 30 },
  { intervalKm: 32000, servicesJson: { services: ["Engine oil & filter", "Tire rotation", "Engine air filter", "Cabin air filter"] }, partsCostCad: 180, labourMinutes: 60 },
  { intervalKm: 48000, servicesJson: { services: ["Engine oil & filter", "Tire rotation", "Brake inspection", "Coolant top-up"] }, partsCostCad: 110, labourMinutes: 60 },
  { intervalKm: 64000, servicesJson: { services: ["Engine oil & filter", "Tire rotation", "Spark plug inspection", "All filters"] }, partsCostCad: 250, labourMinutes: 90 },
  { intervalKm: 96000, servicesJson: { services: ["Engine oil & filter", "Tire rotation", "Spark plugs (replace)", "Transmission fluid", "Coolant flush"] }, partsCostCad: 650, labourMinutes: 180 },
  { intervalKm: 160000, servicesJson: { services: ["Engine oil & filter", "Tire rotation", "Spark plugs", "All fluids", "Drive belts inspection"] }, partsCostCad: 850, labourMinutes: 240 },
  { intervalKm: 200000, servicesJson: { services: ["Engine oil & filter", "Tire rotation", "Transfer case fluid", "Differential fluid", "Major inspection"] }, partsCostCad: 950, labourMinutes: 240 },
];

export const WALKAROUND_NOTES: Array<{
  scopeSlug: string; // trim slug — resolved to id at seed time
  title: string;
  bodyMd: string;
  tags: string[];
}> = [
  {
    scopeSlug: "rav4-2026-xle-hybrid-awd",
    title: "Walk-around: 2026 RAV4 XLE Hybrid AWD",
    bodyMd: "**Outside**\n- Point out chiseled fender flares and 18\" alloy wheels (5 spoke).\n- Lift the hood: 2.5L Atkinson-cycle engine + electric motor combo, 219 hp combined.\n- Walk to rear — hands-free power liftgate (kick under bumper).\n\n**Driving position**\n- Front: heated leather-wrapped steering, 8-way power driver, 4-way power passenger.\n- 10.5\" infotainment with wireless CarPlay/Android Auto.\n- Have customer feel the seat bolstering — RAV4 XLE has noticeably better support than LE.\n\n**Tech demo**\n- Show TSS 3.0 settings page — Proactive Driving Assist is new for 2025+.\n- Toyota Audio Multimedia menu → Profiles → demo per-driver settings.\n\n**On the drive**\n- Highlight the AWD-e engagement — invisible, but worth saying \"the rear electric motor kicks in within milliseconds when needed.\"\n- Demo radar cruise from 0 with full stop-and-go.",
    tags: ["walkaround", "rav4", "hybrid"],
  },
  {
    scopeSlug: "lexus-rx-2026-350h-premium",
    title: "Walk-around: 2026 RX 350h Premium",
    bodyMd: "**Outside**\n- Spindle grille, single-piece L-shape DRLs. 19\" alloys standard on Premium.\n- Power hands-free liftgate (foot wave under rear bumper).\n\n**Inside**\n- 14\" Lexus Interface infotainment with wireless CarPlay/Android Auto.\n- 10-speaker Lexus Premium audio. (Upgrade to Mark Levinson 21-speaker on Luxury.)\n- Lexus Memory Seat — 3 driver profiles with mirror + steering position.\n- 12.3\" digital cluster.\n\n**The pitch**\n- Lexus Complimentary Maintenance: **4 years / 80,000 km** of scheduled service FREE.\n- HV battery warranty: 10 years / 240,000 km.\n- Toyota Safety Sense 3.0 + Lexus-only Predictive Efficient Drive (uses GPS + driving habits to pre-charge battery).\n\n**Drive**\n- Highlight quietness vs RAV4 Hybrid: laminated front glass on Premium.\n- 5.0L → 6.5 L/100km combined despite 246 hp.",
    tags: ["walkaround", "lexus", "rx", "hybrid"],
  },
  {
    scopeSlug: "tacoma-2026-trd-off-road-doublecab-4wd-gas",
    title: "Walk-around: 2026 Tacoma TRD Off-Road",
    bodyMd: "**Stance & exterior**\n- 33\" Goodyear Wrangler Territory tires, 17\" TRD wheels.\n- Skid plate, multi-link rear suspension (new for 2024+), bed step (option).\n\n**Off-road kit (the pitch)**\n- Crawl Control: low-speed cruise control for trails (0-8 km/h, hands-off).\n- Multi-Terrain Select: Mud/Sand/Rock+Dirt modes.\n- Front sway-bar disconnect (push of a button) — no competitor offers this from the factory.\n- Locking rear differential.\n\n**Cabin**\n- 14\" infotainment, Toyota Multimedia.\n- 12.3\" digital cluster.\n- Available 6-speed manual ONLY on this trim (and TRD Pro) — call this out for enthusiasts.\n\n**Powertrain**\n- 2.4L turbo i-FORCE: 278 hp / 317 lb-ft. Tow 6,500 lbs.\n- Step up to i-FORCE MAX hybrid on TRD Pro / Trailhunter for 326 hp / 465 lb-ft.",
    tags: ["walkaround", "tacoma", "off-road"],
  },
];

export const EXTRA_REP_NOTES = [
  {
    scopeType: RepNoteScope.GLOBAL,
    title: "How to use the promo rates table",
    bodyMd: "Promo rates are stored per model + term. The Payments tab can auto-suggest the current rate. **Refresh monthly** from:\n1. Toyota Canada Dealer Bulletin (Toyota dealer portal)\n2. Lexus Canada Dealer Bulletin\n3. Toyota Financial Services rate sheet\n\nIf a rate isn't in the system, default to base bank rate (~6.99% as of mid-2026) and add a manual override.",
    tags: ["promo", "cheat-sheet", "operations"],
  },
  {
    scopeType: RepNoteScope.GLOBAL,
    title: "Stacking incentives — what combines with what",
    bodyMd: "Standard rules (verify monthly in dealer portal):\n- Loyalty + Promo Rate: ✅ stack\n- Conquest + Promo Rate: ✅ stack\n- Loyalty + Conquest: ❌ cannot stack (customer picks one)\n- iZEV federal rebate: ✅ stacks with everything (it's a federal program)\n- Student Grad + Loyalty: ✅ usually stack\n- First Responder: ✅ usually stacks with loyalty/conquest\n\nMax typical stack on a Lexus PHEV: Loyalty $1,000 + iZEV $2,500 + Lease Promo Rate = $3,500 customer benefit before negotiation.",
    tags: ["incentives", "cheat-sheet"],
  },
];
