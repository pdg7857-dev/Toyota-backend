// Run with: `npm run db:seed` (after `npm run prisma:migrate`)
import { PrismaClient, PowertrainType, WarrantyCoverageType, FinanceProductCategory, RepNoteScope } from "@prisma/client";
import { POWERTRAINS, MODELS, DEFAULT_FEES } from "./seed-data.js";

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
];

async function main() {
  console.log("Seeding Toyota catalog…");

  // 1. Powertrains. No natural unique key in the schema, so we match by
  // (type, displayName) which is unique among our seed rows. Existing rows
  // are updated in place; new rows are created.
  const powertrainIdByKey = new Map<string, number>();
  for (const p of POWERTRAINS) {
    const { key, ...data } = p;
    const existing = await prisma.powertrain.findFirst({
      where: { type: data.type, displayName: data.displayName },
    });
    const row = existing
      ? await prisma.powertrain.update({ where: { id: existing.id }, data })
      : await prisma.powertrain.create({ data });
    powertrainIdByKey.set(key, row.id);
  }
  console.log(`  ${POWERTRAINS.length} powertrains`);

  // 2. Models + trims + fees
  let trimCount = 0;
  for (const m of MODELS) {
    const model = await prisma.model.upsert({
      where: { slug: m.slug },
      create: { slug: m.slug, name: m.name, bodyStyle: m.bodyStyle, segment: m.segment, notesMd: m.notesMd },
      update: { name: m.name, bodyStyle: m.bodyStyle, segment: m.segment, notesMd: m.notesMd },
    });
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
  console.log(`  ${MODELS.length} models, ${trimCount} trims (with default Ontario fees)`);

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

  // 6. Meta
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
