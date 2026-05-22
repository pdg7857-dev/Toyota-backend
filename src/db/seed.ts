// Run with: `npm run db:seed` (after `npm run prisma:migrate`)
import { PrismaClient, PowertrainType, WarrantyCoverageType, FinanceProductCategory, RepNoteScope } from "@prisma/client";
import { POWERTRAINS, MODELS, DEFAULT_FEES } from "./seed-data.js";
import { BODY_COLORS } from "./colors-seed.js";
import { LEXUS_POWERTRAINS, LEXUS_MODELS } from "./lexus-seed.js";

const prisma = new PrismaClient();

const TOYOTA_CANADA_WARRANTY_BASELINE: Array<{
  type: WarrantyCoverageType;
  months: number;
  km: number | null;
  appliesTo: PowertrainType[];
  description: string;
}> = [
  { type: WarrantyCoverageType.BASIC, months: 36, km: 60000, appliesTo: [], description: "Comprehensive basic coverage. Whichever comes first." },
  { type: WarrantyCoverageType.POWERTRAIN, months: 60, km: 100000, appliesTo: [], description: "Engine, transmission, transaxle, drive system." },
  { type: WarrantyCoverageType.HYBRID_COMPONENT, months: 96, km: 160000, appliesTo: [PowertrainType.HYBRID, PowertrainType.PHEV, PowertrainType.BEV], description: "Hybrid system components (inverter, transaxle, HV ECU, etc.)." },
  { type: WarrantyCoverageType.HYBRID_BATTERY, months: 120, km: 240000, appliesTo: [PowertrainType.HYBRID, PowertrainType.PHEV, PowertrainType.BEV], description: "HV traction battery, 10 years / 240,000 km on MY2020+ vehicles." },
  { type: WarrantyCoverageType.CORROSION_PERFORATION, months: 60, km: null, appliesTo: [], description: "Body sheet metal corrosion perforation. Unlimited km." },
  { type: WarrantyCoverageType.EMISSIONS, months: 96, km: 130000, appliesTo: [], description: "Major emission control components." },
  { type: WarrantyCoverageType.ACCESSORIES, months: 36, km: 60000, appliesTo: [], description: "Toyota Genuine Accessories installed at delivery, prorated thereafter." },
  { type: WarrantyCoverageType.ROADSIDE, months: 36, km: null, appliesTo: [], description: "Toyota Roadside Assistance. Unlimited km." },
];

const FINANCE_PRODUCTS: Array<{
  slug: string;
  name: string;
  category: FinanceProductCategory;
  descriptionMd: string;
  pricingNotes: string;
  termOptionsJson?: unknown;
}> = [
  {
    slug: "toyota-extra-care-gold",
    name: "Toyota Extra Care — Gold (ETP)",
    category: FinanceProductCategory.EXTENDED_WARRANTY,
    descriptionMd: "Extended protection beyond basic comprehensive coverage. Covers major mechanical and electrical components on top of base warranty. Backed by Toyota Canada.",
    pricingNotes: "Pricing varies by term/km and vehicle. Confirm in your dealer ETP quoting tool. Sweet spot: 84 mo / 140,000 km for typical 5-year-loan customers.",
    termOptionsJson: { tiers: ["72mo/120k", "84mo/140k", "96mo/160k", "120mo/200k"] },
  },
  {
    slug: "toyota-extra-care-platinum",
    name: "Toyota Extra Care — Platinum (Top of the line)",
    category: FinanceProductCategory.EXTENDED_WARRANTY,
    descriptionMd: "Broadest coverage tier. Approaches bumper-to-bumper on top of base warranty. Best for customers who keep vehicles >5 years or have higher-tech trims.",
    pricingNotes: "Premium tier. Verify pricing in dealer tool — typically $1,500–$2,500 depending on term and vehicle.",
    termOptionsJson: { tiers: ["72mo/120k", "84mo/140k", "96mo/160k", "120mo/200k"] },
  },
  {
    slug: "tire-and-rim-protection",
    name: "Tire & Rim Protection",
    category: FinanceProductCategory.TIRE_RIM,
    descriptionMd: "Covers tire/wheel damage from road hazards (potholes, debris). Ontario has lots of potholes — easy pitch in spring.",
    pricingNotes: "Usually $499–$799 depending on term. High attach rate.",
  },
  {
    slug: "paint-protection-film",
    name: "Paint Protection Film (PPF)",
    category: FinanceProductCategory.PPF,
    descriptionMd: "Clear film on hood, fenders, mirrors, bumpers. Protects against stone chips and minor scratches.",
    pricingNotes: "Dealer-installed. $999 partial-front, $1,799 full-front, ~$3,999 full-body.",
  },
  {
    slug: "appearance-protection",
    name: "Appearance Protection Package",
    category: FinanceProductCategory.APPEARANCE,
    descriptionMd: "Paint sealant + interior fabric protection. Multi-year coverage against environmental contaminants and stains.",
    pricingNotes: "~$599–$899 typical.",
  },
  {
    slug: "gap-insurance",
    name: "GAP Insurance",
    category: FinanceProductCategory.GAP,
    descriptionMd: "Covers the gap between insurance payout and loan balance if vehicle is totaled. Critical for customers with low down payments or long loan terms.",
    pricingNotes: "~$499–$799. Pitch on every long-term loan (84+ months) and every lease.",
  },
  {
    slug: "key-replacement",
    name: "Key Replacement Coverage",
    category: FinanceProductCategory.KEY_REPLACEMENT,
    descriptionMd: "Replacement of lost/stolen/damaged smart keys. Modern smart keys can cost $400+ to replace out of pocket.",
    pricingNotes: "~$199–$299 typical.",
  },
  {
    slug: "rust-protection-undercoating",
    name: "Rust Protection / Electronic Module",
    category: FinanceProductCategory.UNDERCOATING,
    descriptionMd: "Ontario winters + road salt = rust risk. Electronic module or sprayed undercoating slows perforation. Stack with corrosion warranty.",
    pricingNotes: "$799–$1,299 typical.",
  },
];

const REP_NOTES: Array<{
  scopeType: RepNoteScope;
  title: string;
  bodyMd: string;
  tags: string[];
}> = [
  {
    scopeType: RepNoteScope.GLOBAL,
    title: "Ontario fees cheat-sheet",
    bodyMd: "HST 13%. Standard add-ons on top of MSRP:\n- Freight & PDI: ~$1,930 (varies by model)\n- A/C excise tax: $100 (federal)\n- OMVIC fee: $12.50\n- Tire stewardship: $22.40\n- Dealer admin: varies (~$499 typical)\n\nLicensing/plates: ~$60 (new), ~$32 (transfer). Not included in dealer quote.",
    tags: ["pricing", "fees", "ontario", "cheat-sheet"],
  },
  {
    scopeType: RepNoteScope.GLOBAL,
    title: "Toyota Canada warranty headline numbers",
    bodyMd: "- Basic: 3 yr / 60,000 km\n- Powertrain: 5 yr / 100,000 km\n- Hybrid system components: 8 yr / 160,000 km\n- HV battery (hybrid/PHEV/BEV): **10 yr / 240,000 km** (MY2020+) — this is the big one to lead with vs Honda's 8/160 and Ford's 8/160.\n- Corrosion perforation: 5 yr / unlimited km\n- Major emissions: 8 yr / 130,000 km\n- Roadside assistance: 3 yr / unlimited km",
    tags: ["warranty", "cheat-sheet"],
  },
  {
    scopeType: RepNoteScope.COMPETITOR,
    title: "RAV4 Hybrid vs Honda CR-V Hybrid",
    bodyMd: "Customer says CR-V Hybrid is cheaper.\n- True on base MSRP, but RAV4 has standard AWD; CR-V Hybrid AWD adds $2,500+.\n- HV battery warranty: Toyota **10/240** vs Honda 8/160.\n- Resale value: RAV4 historically retains 5–7% more at 3 years (verify with current Canadian Black Book).\n- Customer-facing line: \"You're comparing list price, but on AWD trims and over the lifetime of the warranty, RAV4 Hybrid is actually the lower-cost-of-ownership choice.\"",
    tags: ["objection-handling", "competitor", "rav4", "hybrid"],
  },
  {
    scopeType: RepNoteScope.COMPETITOR,
    title: "Tacoma vs Ranger / Colorado",
    bodyMd: "Tacoma 2.4T = 278 hp / 317 lb-ft, competitive with Ranger 2.3T and Colorado 2.7T. Differentiators:\n- Available 6-speed manual on TRD Off-Road (no other midsize truck offers MT in Canada).\n- i-FORCE MAX hybrid (326 hp / 465 lb-ft) — TRD Pro and Trailhunter only.\n- Resale: Tacoma historically beats both rivals by 10%+ at 5 years.\n- Off-road: factory disconnecting front sway bar (TRD Off-Road / TRD Pro / Trailhunter).",
    tags: ["objection-handling", "competitor", "tacoma", "truck"],
  },
  {
    scopeType: RepNoteScope.COMPETITOR,
    title: "Camry Hybrid vs Accord Hybrid",
    bodyMd: "Camry is hybrid-only 2025+, Accord Hybrid exists but is FWD-only in Canada. Lead with:\n- AWD availability (Honda doesn't offer it).\n- HV battery 10/240 vs Honda 8/160.\n- Toyota Safety Sense 3.0 features all standard; Honda Sensing is comparable but Camry's adaptive cruise has stop-and-go from base.",
    tags: ["objection-handling", "competitor", "camry", "hybrid"],
  },
  {
    scopeType: RepNoteScope.GLOBAL,
    title: "F&I attach checklist (per deal)",
    bodyMd: "On every deal, pitch in this order:\n1. **Toyota Extra Care extended warranty** — match term to loan term, e.g. 84mo loan → 84mo/140k ETP.\n2. **GAP insurance** — mandatory pitch on any loan ≥72 mo or any lease.\n3. **Tire & Rim** — Ontario potholes. Easy yes in spring.\n4. **PPF / Appearance** — bundle if customer cares about resale or has a darker color.\n5. **Rust protection** — Ontario salt. Stack with corrosion warranty.\n6. **Key replacement** — cheap, high-attach.",
    tags: ["sales-process", "f&i", "checklist"],
  },
  {
    scopeType: RepNoteScope.GLOBAL,
    title: "Hybrid pitch — quick script",
    bodyMd: "When customer hesitates on hybrid premium:\n\"On a [model], you'll pay about $2,500–3,000 more for hybrid up front. At today's gas prices ($1.65/L average ON), that pays back in about 3–4 years of average driving (20,000 km/yr). And — this is the part most people miss — Toyota covers the HV battery for **10 years or 240,000 kilometres**. So you're not taking on hybrid risk, you're hedging against gas-price risk for a decade.\"",
    tags: ["sales-script", "hybrid"],
  },
  {
    scopeType: RepNoteScope.COMPETITOR,
    title: "Highlander vs Honda Pilot",
    bodyMd: "Pilot has bigger 3rd row, no hybrid option.\n- Highlander Hybrid AWD has no Pilot equivalent — instant differentiator.\n- Pilot's V6 = better towing (5,000 lb vs ~3,500). If they need to tow, push Grand Highlander Hybrid MAX (8,000 lb) instead.\n- HV battery warranty 10/240 vs Honda 8/160.\n- Resale: comparable. Differentiator is hybrid availability and powertrain breadth.",
    tags: ["objection-handling", "competitor", "highlander", "suv"],
  },
  {
    scopeType: RepNoteScope.COMPETITOR,
    title: "Sienna vs Honda Odyssey / Chrysler Pacifica",
    bodyMd: "Sienna is hybrid-only. AWD available — Odyssey is FWD-only.\n- Pacifica Hybrid is a PHEV (FWD-only, 51 km electric range). Sienna is HEV — no plug, 6.7 L/100km combined.\n- Sienna wins on: AWD, fuel economy, resale, no plug-in lifestyle change required.\n- Odyssey wins on: cabin width, Magic Slide 2nd-row seats.\n- Customer-facing line: \"If you want one vehicle that does Costco runs in the city AND a winter cottage trip, Sienna Hybrid AWD is the only AWD minivan in Canada.\"",
    tags: ["objection-handling", "competitor", "sienna", "minivan"],
  },
  {
    scopeType: RepNoteScope.COMPETITOR,
    title: "Tundra vs Ford F-150",
    bodyMd: "Tundra i-FORCE MAX (437 hp / 583 lb-ft) competes with F-150 PowerBoost (430 hp / 570 lb-ft).\n- Toyota wins on: HV battery warranty (10/240 vs Ford 8/160), proven hybrid reputation, no Sync issues.\n- F-150 wins on: more cab/bed configurations, ProPower onboard (7.2kW gen), Lightning EV option if they want full electric truck.\n- Both tow ~11,000–12,000 lb. Tundra max payload is lower (~1,940 lb vs F-150 max ~3,300).\n- For F&I retention: Tundra historically loses ~$3,000/yr depreciation vs F-150's ~$4,500.",
    tags: ["objection-handling", "competitor", "tundra", "truck"],
  },
  {
    scopeType: RepNoteScope.COMPETITOR,
    title: "Corolla Cross Hybrid vs HR-V / Kona",
    bodyMd: "Honda HR-V doesn't offer hybrid. Hyundai Kona Hybrid isn't sold in Canada (only ICE + EV).\n- Corolla Cross Hybrid AWD = 196 hp combined, 6.0 L/100km, AWD-e standard. No direct competitor in the subcompact-hybrid-AWD slot.\n- Lead: \"In your size and price range, this is literally the only AWD hybrid subcompact SUV available in Canada.\"\n- HR-V wins on cabin packaging (Magic Seat). Kona EV is the comparison if they're EV-curious.",
    tags: ["objection-handling", "competitor", "corolla-cross", "hybrid"],
  },
  {
    scopeType: RepNoteScope.COMPETITOR,
    title: "bZ4X vs Hyundai Ioniq 5 / VW ID.4 / Tesla Model Y",
    bodyMd: "Hardest segment to defend on paper. bZ4X range ~406 km FWD vs Ioniq 5 ~488 km, Model Y ~525 km.\n- Toyota wins on: dealer network density, hybrid system experience, NACS port (2026+ via adapter — verify timing), bundled DC fast charging credits at delivery (verify current program).\n- Tesla wins on: Supercharger network (now shared via NACS), range, software.\n- Ioniq 5 wins on: 800V charging (~18 min 10–80%), retro-futurist styling.\n- Lead with the value angle: starting MSRP undercuts Model Y, plus full iZEV incentive eligibility. Don't argue range head-to-head — flip to total cost of ownership and Toyota reliability.",
    tags: ["objection-handling", "competitor", "bz4x", "bev"],
  },
  {
    scopeType: RepNoteScope.COMPETITOR,
    title: "Prius vs Civic Hybrid",
    bodyMd: "Civic Hybrid (returns to Canada lineup) is the cleanest direct competitor.\n- Prius wins on: AWD availability (Civic Hybrid is FWD-only), fuel economy (~4.5 L/100km combined vs Civic ~4.8), HV battery 10/240 vs Honda 8/160.\n- Civic wins on: cabin space, value, traditional sedan profile if customer doesn't want hatchback.\n- Lead: \"Both are great. Question is, do you ever drive in snow? Because Prius is the only mainstream compact hybrid with AWD in Canada.\"",
    tags: ["objection-handling", "competitor", "prius", "hybrid"],
  },
  {
    scopeType: RepNoteScope.GLOBAL,
    title: "Lease vs finance — quick decision framework",
    bodyMd: "Ask in this order:\n1. **How long will you keep it?** <4 yrs → lease. >6 yrs → finance. 4–6 yrs → either.\n2. **Annual km?** <20,000/yr → lease is fine. >24,000/yr → finance (lease excess km is ~$0.15–0.20/km).\n3. **Down payment available?** Low down + high km → finance. High down + low km → lease.\n4. **Want to customize / modify?** → finance (lease prohibits permanent mods).\n5. **Use vehicle for business?** → lease often better for tax write-offs (consult CRA).\n\nGAP insurance is mandatory pitch on both, but ESPECIALLY long-term finance.",
    tags: ["sales-process", "lease", "finance"],
  },
  {
    scopeType: RepNoteScope.GLOBAL,
    title: "Toyota Safety Sense 3.0 — talking points",
    bodyMd: "Standard on every 2025+ Toyota in Canada (no trim upgrade needed):\n- Pre-Collision System with Pedestrian Detection (now includes motorcyclists and oncoming-vehicle detection at intersections)\n- Full-Speed Dynamic Radar Cruise Control with curve speed management\n- Lane Departure Alert + Steering Assist + Lane Tracing Assist\n- Automatic High Beams\n- Road Sign Assist\n- Proactive Driving Assist (new in TSS 3.0 — gentle braking + steering input in routine driving)\n\nCustomer-facing line: \"Every 2025 Toyota — from the base Corolla LE to a Tundra Capstone — comes with the same active-safety package. You're not paying for trim to get safety.\"",
    tags: ["safety", "feature", "cheat-sheet"],
  },
  {
    scopeType: RepNoteScope.GLOBAL,
    title: "Ontario EV/PHEV incentives (verify current!)",
    bodyMd: "**Always check toyota.ca/transport-canada current rates before quoting — these change.**\n- Federal iZEV: up to $5,000 for eligible BEVs, $2,500 for eligible PHEVs (≥50 km range). Applied at delivery by dealer.\n- Ontario: provincial EV rebate ended 2018; **no current ON-specific rebate** (as of recent verification — confirm).\n- Eligible 2025/2026 Toyotas: Prius Prime (PHEV), RAV4 Prime (PHEV), bZ4X (BEV) — subject to MSRP caps. Verify each cap before quoting.\n- Eligible 2025/2026 Lexus: NX 450h+ (PHEV), RX 450h+ (PHEV), TX 550h+ (PHEV), RZ 300e/450e (BEV) — also subject to caps.\n- Tip: federal program is point-of-sale, not income-tested. Easy yes for the customer.",
    tags: ["incentives", "izev", "ev", "phev", "cheat-sheet"],
  },
  {
    scopeType: RepNoteScope.GLOBAL,
    title: "Lexus Complimentary Maintenance — major differentiator",
    bodyMd: "Lexus Canada includes **scheduled maintenance free for the first 4 years / 80,000 km** (whichever comes first):\n- Oil + filter changes\n- Tire rotations\n- Brake inspections\n- All factory-scheduled services\n\nGermans (BMW/Audi/Mercedes) charge for everything after year 1 unless customer buys a Service Inclusive plan ($2,000–$4,000+). \n\nCustomer-facing line: \"With Lexus, you don't pay for an oil change or tire rotation for four years. With [German brand], your first dealer-paid service is the day after delivery.\" Quantify it: roughly $2,500–$3,500 of free maintenance value.",
    tags: ["lexus", "warranty", "maintenance", "cheat-sheet"],
  },
  {
    scopeType: RepNoteScope.COMPETITOR,
    title: "Lexus NX vs Acura RDX",
    bodyMd: "Closest cross-shop in Canada.\n- NX 350h Hybrid AWD has no RDX equivalent (Acura doesn't offer RDX hybrid). Instant differentiator.\n- NX 450h+ PHEV qualifies for federal iZEV ($2,500). RDX doesn't.\n- 4yr/80k complimentary maintenance vs Acura's Premier Service (varies, typically not included).\n- RDX wins on: A-SPEC styling, ELS Studio audio, slightly more interior space.\n- Pricing: NX 250 base $50,900 vs RDX base ~$54,000 — Lexus is actually cheaper on entry, more expensive on top trims.",
    tags: ["lexus", "competitor", "nx", "objection-handling"],
  },
  {
    scopeType: RepNoteScope.COMPETITOR,
    title: "Lexus RX vs BMW X5 / Audi Q7 / Acura MDX",
    bodyMd: "RX is a 5-seater (TX for 3-row). Adjust the comparison:\n- RX 350h Hybrid AWD vs X5 xDrive40i: better fuel economy (6.5 vs 9.5 L/100km), 4yr free maintenance, 10/240 HV battery warranty.\n- RX 500h F SPORT Performance (366 hp DIRECT4) competes with X5 M60i (523 hp) on feel — not on numbers.\n- RX 450h+ PHEV is the iZEV play. ~60 km EV range. No direct BMW equivalent (XM is much higher).\n- BMW wins on driving dynamics, brand cachet, more powerful top trims.\n- Lexus wins on reliability (consistently top 3 in JD Power), free maintenance, no warranty surprises.",
    tags: ["lexus", "competitor", "rx", "objection-handling"],
  },
  {
    scopeType: RepNoteScope.COMPETITOR,
    title: "Lexus IS 500 vs BMW M340i / Audi S4",
    bodyMd: "IS 500 = 472 hp 5.0L NA V8 RWD. The only naturally-aspirated V8 sport sedan left under $100k in Canada.\n- M340i: 386 hp turbo I6 AWD, faster on paper.\n- S4: 349 hp turbo V6 AWD, comparable performance.\n- IS 500 wins on character — the V8 sound, RWD purity, F SPORT Performance limited supply.\n- Sell on emotion and exclusivity, not stats. \"This is one of the last great V8 sport sedans you can buy new.\"",
    tags: ["lexus", "competitor", "is", "objection-handling"],
  },
  {
    scopeType: RepNoteScope.GLOBAL,
    title: "Toyota → Lexus cross-shop conversations",
    bodyMd: "Common scenarios where a Toyota customer is genuinely better off in a Lexus (referral opportunity, even if you only sell Toyota):\n- Customer wants RAV4 Limited Hybrid at $48k → NX 350h Premium at $57k. ~$9k for materially upgraded interior, F SPORT options, 4yr free maintenance.\n- Customer wants Highlander Platinum Hybrid at $66k → RX 350h Premium at $68k. Basically free upgrade in materials.\n- Customer wants Grand Highlander Platinum Hybrid MAX at $74k → TX 500h F SPORT 2 at $86k. Worth the step if budget allows.\n- Customer wants Land Cruiser at $82k → GX 550 Overtrail at $93k or LX 700h Overtrail at $130k.\n\nWhen the gap is <$10k, the Lexus complimentary maintenance often closes most of it on TCO.",
    tags: ["lexus", "cross-shop", "sales-process"],
  },
];

async function main() {
  console.log("Seeding Toyota catalog…");

  // 1. Powertrains (Toyota + Lexus combined).
  const allPowertrains = [...POWERTRAINS, ...LEXUS_POWERTRAINS];
  const powertrainIdByKey = new Map<string, number>();
  for (const p of allPowertrains) {
    const { key, ...data } = p;
    const existing = await prisma.powertrain.findFirst({
      where: { type: data.type, displayName: data.displayName },
    });
    const row = existing
      ? await prisma.powertrain.update({ where: { id: existing.id }, data })
      : await prisma.powertrain.create({ data });
    powertrainIdByKey.set(key, row.id);
  }
  console.log(`  ${allPowertrains.length} powertrains`);

  // 2. Models + trims + fees (Toyota + Lexus)
  const seedMakes: Array<{ make: string; models: typeof MODELS }> = [
    { make: "Toyota", models: MODELS },
    { make: "Lexus", models: LEXUS_MODELS },
  ];
  let totalModels = 0;
  let trimCount = 0;
  for (const { make, models } of seedMakes) {
    for (const m of models) {
      const model = await prisma.model.upsert({
        where: { slug: m.slug },
        create: { slug: m.slug, name: m.name, make, bodyStyle: m.bodyStyle, segment: m.segment, notesMd: m.notesMd },
        update: { name: m.name, make, bodyStyle: m.bodyStyle, segment: m.segment, notesMd: m.notesMd },
      });
      totalModels += 1;
      for (const t of m.trims) {
        const powertrainId = powertrainIdByKey.get(t.powertrainKey);
        if (!powertrainId) {
          console.warn(`  skipping trim ${t.slug} — unknown powertrain key ${t.powertrainKey}`);
          continue;
        }
        const trim = await prisma.trim.upsert({
          where: { slug: t.slug },
          create: { slug: t.slug, name: t.name, year: t.year, msrpCad: t.msrpCad, modelId: model.id, powertrainId, notesMd: t.notesMd },
          update: { name: t.name, year: t.year, msrpCad: t.msrpCad, modelId: model.id, powertrainId, notesMd: t.notesMd },
        });
        const effectiveDate = new Date("2025-01-01");
        await prisma.fee.upsert({
          where: { trimId_effectiveDate: { trimId: trim.id, effectiveDate } },
          create: { trimId: trim.id, effectiveDate, ...DEFAULT_FEES },
          update: { ...DEFAULT_FEES },
        });
        trimCount += 1;
      }
    }
  }
  console.log(`  ${totalModels} models, ${trimCount} trims (with default Ontario fees)`);

  // 3. Warranties — apply baseline to every model × year (2025, 2026)
  const allModels = await prisma.model.findMany();
  let warrantyCount = 0;
  for (const m of allModels) {
    for (const year of [2025, 2026]) {
      for (const w of TOYOTA_CANADA_WARRANTY_BASELINE) {
        await prisma.warrantyCoverage.upsert({
          where: { modelId_year_coverageType: { modelId: m.id, year, coverageType: w.type } },
          create: {
            modelId: m.id,
            year,
            coverageType: w.type,
            durationMonths: w.months,
            distanceKm: w.km,
            appliesToPowertrains: w.appliesTo,
            descriptionMd: w.description,
            sourceUrl: "https://www.toyota.ca/toyota/en/owners/maintenance/warranty",
          },
          update: {
            durationMonths: w.months,
            distanceKm: w.km,
            appliesToPowertrains: w.appliesTo,
            descriptionMd: w.description,
          },
        });
        warrantyCount += 1;
      }
    }
  }
  console.log(`  ${warrantyCount} warranty coverages (${TOYOTA_CANADA_WARRANTY_BASELINE.length} types × ${allModels.length} models × 2 years)`);

  // 4. Finance products
  for (const fp of FINANCE_PRODUCTS) {
    await prisma.financeProduct.upsert({
      where: { slug: fp.slug },
      create: {
        slug: fp.slug,
        name: fp.name,
        category: fp.category,
        descriptionMd: fp.descriptionMd,
        pricingNotes: fp.pricingNotes,
        termOptionsJson: fp.termOptionsJson as never,
      },
      update: {
        name: fp.name,
        category: fp.category,
        descriptionMd: fp.descriptionMd,
        pricingNotes: fp.pricingNotes,
        termOptionsJson: fp.termOptionsJson as never,
      },
    });
  }
  console.log(`  ${FINANCE_PRODUCTS.length} finance products`);

  // 5. Rep notes (global + competitor only — model/trim notes are added via admin UI)
  for (const n of REP_NOTES) {
    const existing = await prisma.repNote.findFirst({ where: { scopeType: n.scopeType, title: n.title } });
    if (existing) {
      await prisma.repNote.update({ where: { id: existing.id }, data: { bodyMd: n.bodyMd, tags: n.tags } });
    } else {
      await prisma.repNote.create({ data: { scopeType: n.scopeType, title: n.title, bodyMd: n.bodyMd, tags: n.tags } });
    }
  }
  console.log(`  ${REP_NOTES.length} rep notes (global + competitor)`);

  // 6. Body colors (catalog only — trim availability is curated via admin UI)
  for (const c of BODY_COLORS) {
    await prisma.bodyColor.upsert({
      where: { slug: c.slug },
      create: c,
      update: { name: c.name, hex: c.hex ?? null, type: c.type, notesMd: c.notesMd ?? null },
    });
  }
  console.log(`  ${BODY_COLORS.length} body colors`);

  // 7. Meta
  await prisma.meta.upsert({
    where: { id: 1 },
    create: { id: 1, catalogVersion: 1 },
    update: { catalogVersion: { increment: 1 } },
  });

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
