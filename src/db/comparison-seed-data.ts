// Ontario 2025/2026 multi-brand comparison-site seed data.
//
// Scope: brand-level warranty + reputation defaults, then top-selling
// 2025/2026 models per brand with starting MSRP, ownership cost estimates,
// editorial pros/cons, and known common issues. Toyota and Lexus get
// `isFeatured: true` so the comparison UI surfaces them first.
//
// All numbers are hand-compiled approximations from publicly available
// sources (OEM Canadian sites, Transport Canada recalls, RepairPal, Edmunds,
// Reddit consensus) at time of seeding. Treat as a starting point — the
// scraper layer is designed to overwrite these as fresher data arrives.

export type BrandSeed = {
  slug: string;
  name: string;
  country?: string;
  parentCompany?: string;
  websiteUrl?: string;
  isFeatured?: boolean;
  basicWarrantyMonths?: number;
  basicWarrantyKm?: number;
  powertrainWarrantyMonths?: number;
  powertrainWarrantyKm?: number;
  hybridComponentMonths?: number;
  hybridComponentKm?: number;
  hybridBatteryMonths?: number;
  hybridBatteryKm?: number;
  corrosionMonths?: number;
  corrosionKm?: number | null;
  roadsideMonths?: number;
  roadsideKm?: number | null;
  reliabilityScore?: number;
  resaleValueScore?: number;
  dealerNetworkScore?: number;
  notesMd?: string;
};

export type ProConSeed = { isPro: boolean; text: string; weight?: number };
export type CommonIssueSeed = {
  title: string;
  description: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status?: "REPORTED" | "RECALL_OPEN" | "RECALL_CLOSED" | "TSB" | "RESOLVED";
  yearsAffected: number[];
  mentionCount?: number;
  sourceUrl?: string;
  recallId?: string;
};

export type ComparisonModelSeed = {
  brandSlug: string;
  slug: string;
  name: string;
  bodyStyle: string;
  segment: string;
  startingMsrpCad: number;
  notesMd?: string;
  ownership: {
    year: number;
    tireFrontSize?: string;
    tireRearSize?: string;
    estTireSetCad?: number;
    estWinterTireSetCad?: number;
    oilType?: string;
    oilCapacityL?: number;
    estOilChangeCad?: number;
    oilChangeIntervalKm?: number;
    brakeJobFrontCad?: number;
    brakeJobRearCad?: number;
    dealerLabourRateCad?: number;
    indieLabourRateCad?: number;
    includedMaintenanceMonths?: number;
    includedMaintenanceKm?: number;
    includedMaintenanceNotes?: string;
    fiveYearOwnershipCostCad?: number;
    sourceUrls?: string[];
    notesMd?: string;
  };
  prosCons: ProConSeed[];
  commonIssues: CommonIssueSeed[];
};

// =========================================================================
// Brands — Canada-available makes for 2025/2026 MY. Warranty terms are the
// most-common "basic/powertrain/corrosion/roadside" headline numbers as
// published on each OEM's Canadian site.
// =========================================================================

export const BRANDS: BrandSeed[] = [
  {
    slug: "toyota",
    name: "Toyota",
    country: "Japan",
    parentCompany: "Toyota Motor Corporation",
    websiteUrl: "https://www.toyota.ca",
    isFeatured: true,
    basicWarrantyMonths: 36, basicWarrantyKm: 60000,
    powertrainWarrantyMonths: 60, powertrainWarrantyKm: 100000,
    hybridComponentMonths: 96, hybridComponentKm: 160000,
    hybridBatteryMonths: 120, hybridBatteryKm: 240000,
    corrosionMonths: 60, corrosionKm: null,
    roadsideMonths: 36, roadsideKm: null,
    reliabilityScore: 9.2, resaleValueScore: 9.4, dealerNetworkScore: 9.5,
    notesMd: "Industry benchmark for durability and resale value. Strongest hybrid lineup in Canada (Prius, Corolla, Camry, RAV4, Highlander, Sienna, Tacoma, Tundra, Sequoia, Land Cruiser). HV battery coverage (10 yr / 240,000 km on MY2020+) leads the segment. Wait times on Tacoma, Land Cruiser, and hybrid RAV4/Sienna remain long going into 2025/2026.",
  },
  {
    slug: "lexus",
    name: "Lexus",
    country: "Japan",
    parentCompany: "Toyota Motor Corporation",
    websiteUrl: "https://www.lexus.ca",
    isFeatured: true,
    basicWarrantyMonths: 48, basicWarrantyKm: 80000,
    powertrainWarrantyMonths: 72, powertrainWarrantyKm: 110000,
    hybridComponentMonths: 96, hybridComponentKm: 160000,
    hybridBatteryMonths: 120, hybridBatteryKm: 240000,
    corrosionMonths: 72, corrosionKm: null,
    roadsideMonths: 48, roadsideKm: null,
    reliabilityScore: 9.4, resaleValueScore: 9.0, dealerNetworkScore: 8.5,
    notesMd: "Toyota's luxury division — same reliability backbone with longer warranty (4 yr / 80,000 km basic, 6 yr / 110,000 km powertrain) and the same 10 yr / 240,000 km HV battery coverage. Lexus Complete Care includes 2 years of regular maintenance and roadside. Strongest luxury reliability scores in Consumer Reports / J.D. Power consistently.",
  },
  {
    slug: "honda",
    name: "Honda",
    country: "Japan",
    parentCompany: "Honda Motor Co.",
    websiteUrl: "https://www.honda.ca",
    basicWarrantyMonths: 36, basicWarrantyKm: 60000,
    powertrainWarrantyMonths: 60, powertrainWarrantyKm: 100000,
    hybridComponentMonths: 96, hybridComponentKm: 160000,
    hybridBatteryMonths: 96, hybridBatteryKm: 160000,
    corrosionMonths: 60, corrosionKm: null,
    roadsideMonths: 36, roadsideKm: 80000,
    reliabilityScore: 8.7, resaleValueScore: 8.8, dealerNetworkScore: 9.0,
    notesMd: "Closest mainstream rival to Toyota on reliability and resale. Strong hybrid lineup (Civic Hybrid, Accord Hybrid, CR-V Hybrid). HV battery covered 8 yr / 160,000 km vs Toyota's 10 yr / 240,000 km. No AWD hybrids in lineup as of 2025.",
  },
  {
    slug: "acura",
    name: "Acura",
    country: "Japan",
    parentCompany: "Honda Motor Co.",
    websiteUrl: "https://www.acura.ca",
    basicWarrantyMonths: 48, basicWarrantyKm: 80000,
    powertrainWarrantyMonths: 60, powertrainWarrantyKm: 100000,
    corrosionMonths: 60, corrosionKm: null,
    roadsideMonths: 48, roadsideKm: 80000,
    reliabilityScore: 8.5, resaleValueScore: 7.8, dealerNetworkScore: 7.5,
    notesMd: "Honda's premium brand. Shares platforms with Civic/Accord/CR-V/Pilot. Integra Type S and TLX Type S are the enthusiast halos.",
  },
  {
    slug: "mazda",
    name: "Mazda",
    country: "Japan",
    websiteUrl: "https://www.mazda.ca",
    basicWarrantyMonths: 36, basicWarrantyKm: unlimitedKm(),
    powertrainWarrantyMonths: 60, powertrainWarrantyKm: 100000,
    corrosionMonths: 84, corrosionKm: null,
    roadsideMonths: 36, roadsideKm: null,
    reliabilityScore: 8.4, resaleValueScore: 8.2, dealerNetworkScore: 7.8,
    notesMd: "Unlimited-km basic warranty — distinctive in the segment. Skyactiv-G and Skyactiv-X engines, premium-feeling interiors at mainstream prices. Inline-6 RWD platforms (CX-70, CX-90) take Mazda upmarket. No full hybrid lineup; PHEV only on CX-70/CX-90.",
  },
  {
    slug: "hyundai",
    name: "Hyundai",
    country: "South Korea",
    parentCompany: "Hyundai Motor Group",
    websiteUrl: "https://www.hyundai.ca",
    basicWarrantyMonths: 60, basicWarrantyKm: 100000,
    powertrainWarrantyMonths: 60, powertrainWarrantyKm: 100000,
    hybridBatteryMonths: 96, hybridBatteryKm: 160000,
    corrosionMonths: 60, corrosionKm: null,
    roadsideMonths: 60, roadsideKm: null,
    reliabilityScore: 8.0, resaleValueScore: 7.4, dealerNetworkScore: 8.0,
    notesMd: "5-yr basic warranty is class-leading among mainstream brands. EV expertise (Ioniq 5, Ioniq 6) is genuine — 800V architecture, 18-min 10-80% fast charging. Strong value play but newer models have had transmission and EV charging recalls.",
  },
  {
    slug: "kia",
    name: "Kia",
    country: "South Korea",
    parentCompany: "Hyundai Motor Group",
    websiteUrl: "https://www.kia.ca",
    basicWarrantyMonths: 60, basicWarrantyKm: 100000,
    powertrainWarrantyMonths: 60, powertrainWarrantyKm: 100000,
    hybridBatteryMonths: 96, hybridBatteryKm: 160000,
    corrosionMonths: 60, corrosionKm: null,
    roadsideMonths: 60, roadsideKm: null,
    reliabilityScore: 8.0, resaleValueScore: 7.6, dealerNetworkScore: 7.8,
    notesMd: "Sister brand to Hyundai — same platforms, same 5-yr warranty, distinct styling. EV6, EV9, and Sportage Hybrid are the standouts. Telluride is a Highlander/Pilot-segment hit with strong reviews.",
  },
  {
    slug: "genesis",
    name: "Genesis",
    country: "South Korea",
    parentCompany: "Hyundai Motor Group",
    websiteUrl: "https://www.genesis.com/ca/en",
    basicWarrantyMonths: 60, basicWarrantyKm: 100000,
    powertrainWarrantyMonths: 60, powertrainWarrantyKm: 100000,
    corrosionMonths: 84, corrosionKm: null,
    roadsideMonths: 60, roadsideKm: null,
    reliabilityScore: 7.8, resaleValueScore: 7.0, dealerNetworkScore: 6.5,
    notesMd: "Hyundai's luxury arm. Strong design (Luc Donckerwolke), strong value vs German Big 3. GV60 / Electrified G80 / GV70 are EV options. Smaller dealer network is the main caveat.",
  },
  {
    slug: "subaru",
    name: "Subaru",
    country: "Japan",
    websiteUrl: "https://www.subaru.ca",
    basicWarrantyMonths: 36, basicWarrantyKm: 60000,
    powertrainWarrantyMonths: 60, powertrainWarrantyKm: 100000,
    corrosionMonths: 60, corrosionKm: null,
    roadsideMonths: 36, roadsideKm: null,
    reliabilityScore: 8.2, resaleValueScore: 8.5, dealerNetworkScore: 7.5,
    notesMd: "Symmetrical AWD standard on everything except BRZ. Strong fit for Ontario winters. EyeSight driver-assist suite is well-regarded. Solterra is a sister vehicle to Toyota bZ4X.",
  },
  {
    slug: "nissan",
    name: "Nissan",
    country: "Japan",
    websiteUrl: "https://www.nissan.ca",
    basicWarrantyMonths: 36, basicWarrantyKm: 60000,
    powertrainWarrantyMonths: 60, powertrainWarrantyKm: 100000,
    corrosionMonths: 60, corrosionKm: null,
    roadsideMonths: 36, roadsideKm: 100000,
    reliabilityScore: 7.0, resaleValueScore: 6.8, dealerNetworkScore: 8.0,
    notesMd: "CVT issues on older Sentra/Altima/Versa hurt reputation; newer cars are improved but watch for forum discussion. Strong product in Rogue (refreshed) and Pathfinder. GT-R / Z carry the halo.",
  },
  {
    slug: "infiniti",
    name: "Infiniti",
    country: "Japan",
    parentCompany: "Nissan",
    websiteUrl: "https://www.infiniti.ca",
    basicWarrantyMonths: 48, basicWarrantyKm: 100000,
    powertrainWarrantyMonths: 72, powertrainWarrantyKm: 110000,
    corrosionMonths: 84, corrosionKm: null,
    roadsideMonths: 48, roadsideKm: 100000,
    reliabilityScore: 7.2, resaleValueScore: 6.5, dealerNetworkScore: 6.5,
    notesMd: "Nissan's luxury division. QX60 (Pathfinder-based) and QX80 (refreshed for 2025) are the volume products.",
  },
  {
    slug: "mitsubishi",
    name: "Mitsubishi",
    country: "Japan",
    websiteUrl: "https://www.mitsubishi-motors.ca",
    basicWarrantyMonths: 60, basicWarrantyKm: 100000,
    powertrainWarrantyMonths: 120, powertrainWarrantyKm: 160000,
    hybridBatteryMonths: 96, hybridBatteryKm: 160000,
    corrosionMonths: 84, corrosionKm: null,
    roadsideMonths: 60, roadsideKm: 100000,
    reliabilityScore: 7.0, resaleValueScore: 6.0, dealerNetworkScore: 6.0,
    notesMd: "10 yr / 160,000 km powertrain warranty is class-leading. Outlander PHEV is the strongest product — only PHEV with 3-row seating in its price range.",
  },
  {
    slug: "ford",
    name: "Ford",
    country: "USA",
    websiteUrl: "https://www.ford.ca",
    basicWarrantyMonths: 36, basicWarrantyKm: 60000,
    powertrainWarrantyMonths: 60, powertrainWarrantyKm: 100000,
    hybridBatteryMonths: 96, hybridBatteryKm: 160000,
    corrosionMonths: 60, corrosionKm: null,
    roadsideMonths: 60, roadsideKm: 100000,
    reliabilityScore: 7.0, resaleValueScore: 7.0, dealerNetworkScore: 9.2,
    notesMd: "F-150 is Canada's best-selling vehicle. Maverick hybrid pickup is a niche-killer. EV lineup (Mach-E, F-150 Lightning) had charging-network and quality issues addressed in 2024–2025 updates. SYNC infotainment remains a point of friction.",
  },
  {
    slug: "lincoln",
    name: "Lincoln",
    country: "USA",
    parentCompany: "Ford",
    websiteUrl: "https://www.lincoln.com/ca",
    basicWarrantyMonths: 48, basicWarrantyKm: 80000,
    powertrainWarrantyMonths: 72, powertrainWarrantyKm: 110000,
    corrosionMonths: 60, corrosionKm: null,
    roadsideMonths: 72, roadsideKm: null,
    reliabilityScore: 7.0, resaleValueScore: 6.0, dealerNetworkScore: 7.0,
    notesMd: "Ford's luxury brand. Nautilus and Navigator are the volume products. Sanctuary-themed interiors are a genuine differentiator.",
  },
  {
    slug: "chevrolet",
    name: "Chevrolet",
    country: "USA",
    parentCompany: "General Motors",
    websiteUrl: "https://www.chevrolet.ca",
    basicWarrantyMonths: 36, basicWarrantyKm: 60000,
    powertrainWarrantyMonths: 60, powertrainWarrantyKm: 100000,
    corrosionMonths: 72, corrosionKm: 160000,
    roadsideMonths: 60, roadsideKm: 100000,
    reliabilityScore: 7.0, resaleValueScore: 6.8, dealerNetworkScore: 9.0,
    notesMd: "Silverado is the Canadian-market answer to F-150. Equinox EV and Blazer EV are GM's volume EV plays for 2025/2026. Corvette E-Ray is the first hybrid Vette.",
  },
  {
    slug: "gmc",
    name: "GMC",
    country: "USA",
    parentCompany: "General Motors",
    websiteUrl: "https://www.gmc.ca",
    basicWarrantyMonths: 36, basicWarrantyKm: 60000,
    powertrainWarrantyMonths: 60, powertrainWarrantyKm: 100000,
    corrosionMonths: 72, corrosionKm: 160000,
    roadsideMonths: 60, roadsideKm: 100000,
    reliabilityScore: 7.0, resaleValueScore: 7.5, dealerNetworkScore: 9.0,
    notesMd: "Upmarket twin of Chevrolet. Sierra (Silverado twin), Yukon (Tahoe twin), and Hummer EV are the headliners. AT4 trims expand off-road capability.",
  },
  {
    slug: "buick",
    name: "Buick",
    country: "USA",
    parentCompany: "General Motors",
    websiteUrl: "https://www.buick.ca",
    basicWarrantyMonths: 48, basicWarrantyKm: 80000,
    powertrainWarrantyMonths: 72, powertrainWarrantyKm: 110000,
    corrosionMonths: 72, corrosionKm: 160000,
    roadsideMonths: 72, roadsideKm: 110000,
    reliabilityScore: 7.5, resaleValueScore: 6.5, dealerNetworkScore: 8.0,
    notesMd: "Lineup is now all-SUV (Envista, Encore GX, Envision). Quiet-tuning cabins are a Buick signature.",
  },
  {
    slug: "cadillac",
    name: "Cadillac",
    country: "USA",
    parentCompany: "General Motors",
    websiteUrl: "https://www.cadillac.ca",
    basicWarrantyMonths: 48, basicWarrantyKm: 80000,
    powertrainWarrantyMonths: 72, powertrainWarrantyKm: 110000,
    corrosionMonths: 72, corrosionKm: 160000,
    roadsideMonths: 72, roadsideKm: 110000,
    reliabilityScore: 7.0, resaleValueScore: 5.5, dealerNetworkScore: 8.0,
    notesMd: "GM's luxury brand pivoting hard to EVs (Lyriq, Optiq, Escalade IQ). Resale historically weak — buy used, lease new.",
  },
  {
    slug: "ram",
    name: "Ram",
    country: "USA",
    parentCompany: "Stellantis",
    websiteUrl: "https://www.ramtruck.ca",
    basicWarrantyMonths: 36, basicWarrantyKm: 60000,
    powertrainWarrantyMonths: 60, powertrainWarrantyKm: 100000,
    corrosionMonths: 60, corrosionKm: null,
    roadsideMonths: 60, roadsideKm: 100000,
    reliabilityScore: 6.5, resaleValueScore: 7.0, dealerNetworkScore: 8.0,
    notesMd: "1500 (gas/eTorque mild-hybrid/Ramcharger range-extender EV) is the lineup core. Best ride quality in full-size truck segment thanks to coil-spring rear (not leaf).",
  },
  {
    slug: "jeep",
    name: "Jeep",
    country: "USA",
    parentCompany: "Stellantis",
    websiteUrl: "https://www.jeep.ca",
    basicWarrantyMonths: 36, basicWarrantyKm: 60000,
    powertrainWarrantyMonths: 60, powertrainWarrantyKm: 100000,
    hybridBatteryMonths: 96, hybridBatteryKm: 160000,
    corrosionMonths: 60, corrosionKm: null,
    roadsideMonths: 60, roadsideKm: 100000,
    reliabilityScore: 6.0, resaleValueScore: 7.5, dealerNetworkScore: 8.5,
    notesMd: "Wrangler is iconic — strong resale despite middling reliability. 4xe PHEV variants of Wrangler / Grand Cherokee qualify for federal iZEV. Compass and Cherokee have reliability flags.",
  },
  {
    slug: "dodge",
    name: "Dodge",
    country: "USA",
    parentCompany: "Stellantis",
    websiteUrl: "https://www.dodge.ca",
    basicWarrantyMonths: 36, basicWarrantyKm: 60000,
    powertrainWarrantyMonths: 60, powertrainWarrantyKm: 100000,
    corrosionMonths: 60, corrosionKm: null,
    roadsideMonths: 60, roadsideKm: 100000,
    reliabilityScore: 6.5, resaleValueScore: 7.0, dealerNetworkScore: 8.0,
    notesMd: "Charger reborn as EV for 2025 (with an inline-6 ICE option arriving later). Hornet is the small crossover entry.",
  },
  {
    slug: "chrysler",
    name: "Chrysler",
    country: "USA",
    parentCompany: "Stellantis",
    websiteUrl: "https://www.chrysler.ca",
    basicWarrantyMonths: 36, basicWarrantyKm: 60000,
    powertrainWarrantyMonths: 60, powertrainWarrantyKm: 100000,
    hybridBatteryMonths: 120, hybridBatteryKm: 160000,
    corrosionMonths: 60, corrosionKm: null,
    roadsideMonths: 60, roadsideKm: 100000,
    reliabilityScore: 6.5, resaleValueScore: 6.5, dealerNetworkScore: 8.0,
    notesMd: "Pacifica (gas + Hybrid PHEV) is the lineup. Pacifica Hybrid is the only PHEV minivan in Canada.",
  },
  {
    slug: "volkswagen",
    name: "Volkswagen",
    country: "Germany",
    parentCompany: "Volkswagen Group",
    websiteUrl: "https://www.vw.ca",
    basicWarrantyMonths: 48, basicWarrantyKm: 80000,
    powertrainWarrantyMonths: 60, powertrainWarrantyKm: 100000,
    corrosionMonths: 84, corrosionKm: null,
    roadsideMonths: 48, roadsideKm: 80000,
    reliabilityScore: 7.0, resaleValueScore: 7.0, dealerNetworkScore: 8.0,
    notesMd: "Tiguan (redesigned for 2025), Atlas, ID.4 EV are the volume products. GTI/Golf R remain hot-hatch icons.",
  },
  {
    slug: "audi",
    name: "Audi",
    country: "Germany",
    parentCompany: "Volkswagen Group",
    websiteUrl: "https://www.audi.ca",
    basicWarrantyMonths: 48, basicWarrantyKm: 80000,
    powertrainWarrantyMonths: 48, powertrainWarrantyKm: 80000,
    corrosionMonths: 144, corrosionKm: null,
    roadsideMonths: 48, roadsideKm: 80000,
    reliabilityScore: 7.0, resaleValueScore: 6.5, dealerNetworkScore: 7.5,
    notesMd: "12-yr corrosion warranty is class-leading. Quattro AWD across most of lineup. e-tron GT and Q6 e-tron are the EV flagships.",
  },
  {
    slug: "porsche",
    name: "Porsche",
    country: "Germany",
    parentCompany: "Volkswagen Group",
    websiteUrl: "https://www.porsche.com/canada",
    basicWarrantyMonths: 48, basicWarrantyKm: unlimitedKm(),
    powertrainWarrantyMonths: 48, powertrainWarrantyKm: unlimitedKm(),
    corrosionMonths: 144, corrosionKm: null,
    roadsideMonths: 48, roadsideKm: null,
    reliabilityScore: 8.0, resaleValueScore: 8.5, dealerNetworkScore: 7.0,
    notesMd: "Unlimited-km warranty. 911 remains the halo. Taycan EV, Macan EV (2025+), Cayenne / Panamera offer breadth.",
  },
  {
    slug: "bmw",
    name: "BMW",
    country: "Germany",
    websiteUrl: "https://www.bmw.ca",
    basicWarrantyMonths: 48, basicWarrantyKm: 80000,
    powertrainWarrantyMonths: 48, powertrainWarrantyKm: 80000,
    corrosionMonths: 144, corrosionKm: null,
    roadsideMonths: 48, roadsideKm: 80000,
    reliabilityScore: 7.0, resaleValueScore: 6.5, dealerNetworkScore: 8.0,
    notesMd: "Driving dynamics remain a strength. iX, i4, i5, i7 EV lineup. BMW Ultimate Care includes 3 yr / 60,000 km of scheduled maintenance.",
  },
  {
    slug: "mini",
    name: "MINI",
    country: "UK",
    parentCompany: "BMW Group",
    websiteUrl: "https://www.mini.ca",
    basicWarrantyMonths: 48, basicWarrantyKm: 80000,
    powertrainWarrantyMonths: 48, powertrainWarrantyKm: 80000,
    corrosionMonths: 144, corrosionKm: null,
    roadsideMonths: 48, roadsideKm: 80000,
    reliabilityScore: 7.0, resaleValueScore: 6.5, dealerNetworkScore: 7.0,
    notesMd: "Cooper, Countryman, and Cooper SE EV cover the lineup. 2025+ refresh brings a much simpler interior with an OLED central display.",
  },
  {
    slug: "mercedes-benz",
    name: "Mercedes-Benz",
    country: "Germany",
    websiteUrl: "https://www.mercedes-benz.ca",
    basicWarrantyMonths: 48, basicWarrantyKm: 80000,
    powertrainWarrantyMonths: 48, powertrainWarrantyKm: 80000,
    corrosionMonths: 48, corrosionKm: 80000,
    roadsideMonths: 48, roadsideKm: null,
    reliabilityScore: 7.0, resaleValueScore: 6.5, dealerNetworkScore: 8.0,
    notesMd: "GLC / GLE / E-Class core lineup. EQS, EQE, EQB, EQS SUV define the EV side. MBUX infotainment is divisive — gorgeous but distracting.",
  },
  {
    slug: "volvo",
    name: "Volvo",
    country: "Sweden",
    parentCompany: "Geely",
    websiteUrl: "https://www.volvocars.com/en-ca",
    basicWarrantyMonths: 48, basicWarrantyKm: 80000,
    powertrainWarrantyMonths: 48, powertrainWarrantyKm: 80000,
    hybridBatteryMonths: 96, hybridBatteryKm: 160000,
    corrosionMonths: 144, corrosionKm: null,
    roadsideMonths: 48, roadsideKm: null,
    reliabilityScore: 7.5, resaleValueScore: 6.5, dealerNetworkScore: 7.0,
    notesMd: "Safety-first brand identity intact. XC60 and XC90 Recharge (PHEV) are the volume sellers. EX30 is the cheap EV play; EX90 is the new flagship.",
  },
  {
    slug: "polestar",
    name: "Polestar",
    country: "Sweden",
    parentCompany: "Geely / Volvo",
    websiteUrl: "https://www.polestar.com/ca",
    basicWarrantyMonths: 48, basicWarrantyKm: 80000,
    powertrainWarrantyMonths: 48, powertrainWarrantyKm: 80000,
    hybridBatteryMonths: 96, hybridBatteryKm: 160000,
    corrosionMonths: 144, corrosionKm: null,
    roadsideMonths: 48, roadsideKm: null,
    reliabilityScore: 7.5, resaleValueScore: 6.0, dealerNetworkScore: 5.0,
    notesMd: "All-EV brand, Polestar 2/3/4 lineup. Sister brand to Volvo. Sparse dealer/service footprint in Ontario — Volvo dealers handle service in most cities.",
  },
  {
    slug: "land-rover",
    name: "Land Rover",
    country: "UK",
    parentCompany: "JLR (Tata)",
    websiteUrl: "https://www.landrover.ca",
    basicWarrantyMonths: 48, basicWarrantyKm: 80000,
    powertrainWarrantyMonths: 60, powertrainWarrantyKm: 100000,
    corrosionMonths: 72, corrosionKm: null,
    roadsideMonths: 60, roadsideKm: 100000,
    reliabilityScore: 5.5, resaleValueScore: 6.0, dealerNetworkScore: 6.0,
    notesMd: "Range Rover and Defender are the icons. Off-road capability is genuine. Reliability remains the achilles heel — JLR ranks near the bottom of most major surveys.",
  },
  {
    slug: "jaguar",
    name: "Jaguar",
    country: "UK",
    parentCompany: "JLR (Tata)",
    websiteUrl: "https://www.jaguar.ca",
    basicWarrantyMonths: 60, basicWarrantyKm: 100000,
    powertrainWarrantyMonths: 60, powertrainWarrantyKm: 100000,
    corrosionMonths: 72, corrosionKm: null,
    roadsideMonths: 60, roadsideKm: 100000,
    reliabilityScore: 5.5, resaleValueScore: 5.0, dealerNetworkScore: 6.0,
    notesMd: "Brand is currently transitioning to all-EV ultra-luxury (re-launch announced for 2026). Current lineup is being wound down.",
  },
  {
    slug: "tesla",
    name: "Tesla",
    country: "USA",
    websiteUrl: "https://www.tesla.com/en_CA",
    basicWarrantyMonths: 48, basicWarrantyKm: 80000,
    powertrainWarrantyMonths: 96, powertrainWarrantyKm: 192000,
    hybridBatteryMonths: 96, hybridBatteryKm: 192000,
    corrosionMonths: 144, corrosionKm: null,
    roadsideMonths: 48, roadsideKm: 80000,
    reliabilityScore: 6.5, resaleValueScore: 6.0, dealerNetworkScore: 7.5,
    notesMd: "Supercharger network is the defining advantage and now (via NACS) open to most other EVs. Build quality + service-experience are recurring forum complaints. FSD remains controversial / unfinished.",
  },
  {
    slug: "rivian",
    name: "Rivian",
    country: "USA",
    websiteUrl: "https://www.rivian.com",
    basicWarrantyMonths: 60, basicWarrantyKm: 96000,
    powertrainWarrantyMonths: 96, powertrainWarrantyKm: 280000,
    hybridBatteryMonths: 96, hybridBatteryKm: 280000,
    corrosionMonths: 96, corrosionKm: null,
    roadsideMonths: 60, roadsideKm: 96000,
    reliabilityScore: 6.5, resaleValueScore: 6.0, dealerNetworkScore: 5.0,
    notesMd: "Direct-sale EV truck/SUV brand. R1T and R1S in Canada via direct delivery. Sparse service network — service rangers travel to you in some areas.",
  },
  {
    slug: "lucid",
    name: "Lucid",
    country: "USA",
    websiteUrl: "https://www.lucidmotors.com",
    basicWarrantyMonths: 48, basicWarrantyKm: 80000,
    powertrainWarrantyMonths: 96, powertrainWarrantyKm: 160000,
    hybridBatteryMonths: 96, hybridBatteryKm: 160000,
    corrosionMonths: 144, corrosionKm: null,
    roadsideMonths: 48, roadsideKm: 80000,
    reliabilityScore: 6.5, resaleValueScore: 5.5, dealerNetworkScore: 4.0,
    notesMd: "Luxury EV brand. Air Sapphire holds the production-sedan range record (~830+ km EPA). Limited Canadian footprint.",
  },
];

// Helper for warranties documented as 'unlimited km' — schema-level we use
// large sentinel (could be null but Prisma int can be 999999999).
function unlimitedKm() { return 999_999_999; }

// =========================================================================
// Models — top sellers per brand, 2025/2026 starting MSRPs and ownership
// estimates. Toyota + Lexus get fuller lineups. Other brands get 2-3 highest-
// volume models. Expand via scrape or manual entry as needed.
// =========================================================================

export const COMPARISON_MODELS: ComparisonModelSeed[] = [
  // ============================ Toyota ============================
  {
    brandSlug: "toyota", slug: "corolla", name: "Corolla", bodyStyle: "Sedan / Hatchback",
    segment: "Compact car", startingMsrpCad: 24450,
    ownership: {
      year: 2026,
      tireFrontSize: "205/55R16", estTireSetCad: 800, estWinterTireSetCad: 900,
      oilType: "0W-16 full synthetic", oilCapacityL: 4.4, estOilChangeCad: 90,
      oilChangeIntervalKm: 16000,
      brakeJobFrontCad: 480, brakeJobRearCad: 420,
      dealerLabourRateCad: 150, indieLabourRateCad: 110,
      includedMaintenanceMonths: 24, includedMaintenanceKm: 40000,
      includedMaintenanceNotes: "Toyota Service Plan covers oil + tire rotation + inspection 24 mo / 40,000 km from delivery.",
      fiveYearOwnershipCostCad: 32000,
      sourceUrls: ["https://www.toyota.ca/toyota/en/corolla"],
    },
    prosCons: [
      { isPro: true, text: "Class-leading resale value (Canadian Black Book consistently ranks Corolla top 3 in compact segment).", weight: 3 },
      { isPro: true, text: "Hybrid available with AWD (4.5–4.7 L/100km combined) — only AWD hybrid compact in Canada.", weight: 3 },
      { isPro: true, text: "Toyota Safety Sense 3.0 standard on every trim (radar cruise, lane keeping, PCS w/ pedestrian).", weight: 2 },
      { isPro: false, text: "Cabin materials trail Mazda3 and Civic Touring at top trims.", weight: 2 },
      { isPro: false, text: "Hatchback (Corolla Hatchback) only available as GAS, not Hybrid (in 2025).", weight: 1 },
    ],
    commonIssues: [
      { title: "Infotainment freezes / Apple CarPlay reconnect", severity: "LOW", yearsAffected: [2023, 2024], mentionCount: 15,
        description: "Some 2023–2024 Corolla owners report intermittent CarPlay disconnects and need to restart the head unit. Software updates from Toyota have largely addressed this for 2025+.",
        sourceUrl: "https://www.reddit.com/r/Toyota/" },
    ],
  },
  {
    brandSlug: "toyota", slug: "camry", name: "Camry", bodyStyle: "Sedan",
    segment: "Midsize sedan", startingMsrpCad: 33450,
    notesMd: "All-hybrid for 2025+. AWD optional across all trims.",
    ownership: {
      year: 2026,
      tireFrontSize: "215/55R17", estTireSetCad: 1100, estWinterTireSetCad: 1100,
      oilType: "0W-16 full synthetic", oilCapacityL: 4.5, estOilChangeCad: 95,
      oilChangeIntervalKm: 16000,
      brakeJobFrontCad: 520, brakeJobRearCad: 460,
      dealerLabourRateCad: 160, indieLabourRateCad: 115,
      includedMaintenanceMonths: 24, includedMaintenanceKm: 40000,
      fiveYearOwnershipCostCad: 36000,
      sourceUrls: ["https://www.toyota.ca/toyota/en/camry"],
    },
    prosCons: [
      { isPro: true, text: "Hybrid-only lineup with AWD optional — no direct competitor offers AWD on a mainstream midsize hybrid sedan.", weight: 3 },
      { isPro: true, text: "10-year / 240,000 km HV battery warranty.", weight: 3 },
      { isPro: true, text: "Consistently top 3 in 5-year resale value among midsize sedans.", weight: 2 },
      { isPro: false, text: "No fully-loaded V6 option — segment is moving away from V6, but Camry V6 fans will miss it.", weight: 1 },
      { isPro: false, text: "Top trims (XLE/XSE) get pricey vs Accord Touring on similar equipment.", weight: 1 },
    ],
    commonIssues: [
      { title: "Wind noise around A-pillar (2025 redesign)", severity: "LOW", yearsAffected: [2025], mentionCount: 8,
        description: "Early-build 2025 Camry owners reported wind noise around the A-pillar at highway speeds. Toyota issued a TSB; later-build cars are improved.", status: "TSB" },
    ],
  },
  {
    brandSlug: "toyota", slug: "rav4", name: "RAV4", bodyStyle: "Compact SUV",
    segment: "Compact SUV", startingMsrpCad: 33950,
    notesMd: "Canada's best-selling SUV. Hybrid is standard on all trims for 2026.",
    ownership: {
      year: 2026,
      tireFrontSize: "225/65R17", estTireSetCad: 1200, estWinterTireSetCad: 1100,
      oilType: "0W-16 full synthetic", oilCapacityL: 4.5, estOilChangeCad: 100,
      oilChangeIntervalKm: 16000,
      brakeJobFrontCad: 560, brakeJobRearCad: 490,
      dealerLabourRateCad: 160, indieLabourRateCad: 115,
      includedMaintenanceMonths: 24, includedMaintenanceKm: 40000,
      fiveYearOwnershipCostCad: 38000,
      sourceUrls: ["https://www.toyota.ca/toyota/en/rav4"],
    },
    prosCons: [
      { isPro: true, text: "Best-selling SUV in Canada for a reason — broad lineup (Hybrid, Prime PHEV, multiple AWD systems).", weight: 3 },
      { isPro: true, text: "RAV4 Prime PHEV delivers ~68 km electric range + 302 hp combined.", weight: 3 },
      { isPro: true, text: "10/240 HV battery warranty leads segment.", weight: 3 },
      { isPro: false, text: "Long wait times on Hybrid and Prime variants — 6+ months typical in Ontario.", weight: 2 },
      { isPro: false, text: "Road noise on highway is louder than CR-V or CX-5.", weight: 1 },
    ],
    commonIssues: [
      { title: "12V battery drain on hybrids parked for extended periods", severity: "LOW", yearsAffected: [2019, 2020, 2021, 2022, 2023, 2024],
        description: "Owners of 2019+ RAV4 Hybrid report 12V auxiliary battery drains if vehicle sits unused for 2+ weeks. Trickle-charger recommended for fleet/cottage use.", mentionCount: 42,
        sourceUrl: "https://www.reddit.com/r/rav4club/" },
      { title: "Fuel-tank fill issue on early Hybrid builds", severity: "MEDIUM", yearsAffected: [2019, 2020],
        description: "Pre-2021 RAV4 Hybrid had a fuel tank bladder issue limiting fill to ~9 gallons. Resolved 2021+. 2025/2026 NOT affected — leave room for buyer FAQ.", mentionCount: 25, status: "RESOLVED" },
    ],
  },
  {
    brandSlug: "toyota", slug: "highlander", name: "Highlander", bodyStyle: "Midsize SUV (3-row)",
    segment: "Midsize 3-row SUV", startingMsrpCad: 47410,
    ownership: {
      year: 2026,
      tireFrontSize: "235/65R18", estTireSetCad: 1400, estWinterTireSetCad: 1300,
      oilType: "0W-20 full synthetic (gas), 0W-16 (hybrid)", oilCapacityL: 5.0, estOilChangeCad: 110,
      oilChangeIntervalKm: 16000,
      brakeJobFrontCad: 620, brakeJobRearCad: 540,
      dealerLabourRateCad: 165, indieLabourRateCad: 120,
      includedMaintenanceMonths: 24, includedMaintenanceKm: 40000,
      fiveYearOwnershipCostCad: 44000,
    },
    prosCons: [
      { isPro: true, text: "Hybrid AWD available — Honda Pilot has no hybrid option.", weight: 3 },
      { isPro: true, text: "Strong resale + Toyota reliability halo.", weight: 2 },
      { isPro: false, text: "Third row is tighter than Pilot / Telluride. Grand Highlander is the answer.", weight: 2 },
      { isPro: false, text: "Tow rating capped at 5,000 lb (gas) / 3,500 lb (hybrid).", weight: 1 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "toyota", slug: "grand-highlander", name: "Grand Highlander", bodyStyle: "Midsize SUV (3-row)",
    segment: "Midsize 3-row SUV", startingMsrpCad: 53310,
    ownership: {
      year: 2026,
      tireFrontSize: "235/65R18", estTireSetCad: 1500, estWinterTireSetCad: 1400,
      oilType: "0W-16 full synthetic", oilCapacityL: 5.0, estOilChangeCad: 115,
      oilChangeIntervalKm: 16000,
      brakeJobFrontCad: 640, brakeJobRearCad: 560,
      dealerLabourRateCad: 165, indieLabourRateCad: 120,
      includedMaintenanceMonths: 24, includedMaintenanceKm: 40000,
      fiveYearOwnershipCostCad: 48000,
    },
    prosCons: [
      { isPro: true, text: "Real adult-usable third row vs Highlander's child-only.", weight: 3 },
      { isPro: true, text: "Hybrid MAX (362 hp) tows 5,000 lb; turbo-only tows 5,000 lb.", weight: 2 },
      { isPro: false, text: "Pricing overlaps with Lexus TX — cross-shop is real.", weight: 1 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "toyota", slug: "tacoma", name: "Tacoma", bodyStyle: "Midsize Pickup",
    segment: "Midsize truck", startingMsrpCad: 44950,
    ownership: {
      year: 2026,
      tireFrontSize: "265/70R16", estTireSetCad: 1500, estWinterTireSetCad: 1500,
      oilType: "0W-20 full synthetic", oilCapacityL: 6.4, estOilChangeCad: 130,
      oilChangeIntervalKm: 16000,
      brakeJobFrontCad: 680, brakeJobRearCad: 600,
      dealerLabourRateCad: 170, indieLabourRateCad: 125,
      includedMaintenanceMonths: 24, includedMaintenanceKm: 40000,
      fiveYearOwnershipCostCad: 46000,
    },
    prosCons: [
      { isPro: true, text: "6-speed manual available on TRD Off-Road — only midsize truck in Canada with MT.", weight: 3 },
      { isPro: true, text: "i-FORCE MAX hybrid (326 hp / 465 lb-ft) on TRD Pro and Trailhunter.", weight: 3 },
      { isPro: true, text: "Best-in-class resale (Tacoma routinely beats Ranger/Colorado by 10%+ at 5 years).", weight: 3 },
      { isPro: false, text: "Long allocation waits in Ontario — 6–12 months on TRD trims.", weight: 2 },
      { isPro: false, text: "Rear seat cramped vs Ranger SuperCrew.", weight: 1 },
    ],
    commonIssues: [
      { title: "Engine recall — 2024 Tacoma 2.4T", severity: "HIGH", yearsAffected: [2024], status: "RECALL_OPEN",
        description: "Toyota recalled select 2024 Tacoma 2.4T builds for potential engine failure due to machining debris. 2025/2026 production NOT affected, but used 2024 shoppers should verify VIN.", mentionCount: 18,
        recallId: "Toyota recall 23TC10" },
    ],
  },
  {
    brandSlug: "toyota", slug: "tundra", name: "Tundra", bodyStyle: "Full-size Pickup",
    segment: "Full-size truck", startingMsrpCad: 53450,
    ownership: {
      year: 2026,
      tireFrontSize: "265/70R18", estTireSetCad: 1800, estWinterTireSetCad: 1800,
      oilType: "0W-20 full synthetic", oilCapacityL: 7.6, estOilChangeCad: 140,
      oilChangeIntervalKm: 16000,
      brakeJobFrontCad: 750, brakeJobRearCad: 680,
      dealerLabourRateCad: 175, indieLabourRateCad: 130,
      includedMaintenanceMonths: 24, includedMaintenanceKm: 40000,
      fiveYearOwnershipCostCad: 54000,
    },
    prosCons: [
      { isPro: true, text: "i-FORCE MAX hybrid (437 hp / 583 lb-ft) competes head-on with F-150 PowerBoost.", weight: 3 },
      { isPro: true, text: "Coil-spring rear (no leaf) gives best-in-class unloaded ride.", weight: 2 },
      { isPro: true, text: "Reliability advantage vs F-150 / Silverado.", weight: 2 },
      { isPro: false, text: "Max payload (~1,940 lb) trails F-150 max (~3,300 lb).", weight: 2 },
      { isPro: false, text: "Fewer cab/bed configurations than F-150 or Silverado.", weight: 1 },
    ],
    commonIssues: [
      { title: "Wastegate noise on 3.5TT (resolved with TSB)", severity: "LOW", yearsAffected: [2022, 2023], mentionCount: 22,
        description: "Some 2022–2023 Tundra 3.5TT owners heard a turbo wastegate rattle at cold start. TSB available, mostly addressed in 2024+ production.", status: "TSB" },
    ],
  },
  {
    brandSlug: "toyota", slug: "sienna", name: "Sienna", bodyStyle: "Minivan",
    segment: "Minivan", startingMsrpCad: 45550,
    ownership: {
      year: 2026,
      tireFrontSize: "235/60R18", estTireSetCad: 1300, estWinterTireSetCad: 1300,
      oilType: "0W-16 full synthetic", oilCapacityL: 4.5, estOilChangeCad: 105,
      oilChangeIntervalKm: 16000,
      brakeJobFrontCad: 600, brakeJobRearCad: 520,
      dealerLabourRateCad: 165, indieLabourRateCad: 120,
      includedMaintenanceMonths: 24, includedMaintenanceKm: 40000,
      fiveYearOwnershipCostCad: 42000,
    },
    prosCons: [
      { isPro: true, text: "Only AWD minivan sold in Canada.", weight: 3 },
      { isPro: true, text: "Hybrid-only, ~6.6 L/100km combined.", weight: 3 },
      { isPro: false, text: "Cargo width narrower than Pacifica or Carnival.", weight: 1 },
      { isPro: false, text: "Wait times remain long going into 2025.", weight: 2 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "toyota", slug: "prius", name: "Prius", bodyStyle: "Hatchback",
    segment: "Compact hybrid", startingMsrpCad: 32850,
    ownership: {
      year: 2026,
      tireFrontSize: "195/65R17", estTireSetCad: 950,
      oilType: "0W-16 full synthetic", oilCapacityL: 4.0, estOilChangeCad: 90,
      oilChangeIntervalKm: 16000,
      brakeJobFrontCad: 500, brakeJobRearCad: 450,
      dealerLabourRateCad: 160, indieLabourRateCad: 115,
      includedMaintenanceMonths: 24, includedMaintenanceKm: 40000,
      fiveYearOwnershipCostCad: 31000,
    },
    prosCons: [
      { isPro: true, text: "194 hp + ~4.5 L/100km combined — the 5th-gen Prius is the first that's both efficient AND fun.", weight: 3 },
      { isPro: true, text: "AWD available — Civic Hybrid is FWD-only.", weight: 3 },
      { isPro: false, text: "Rear visibility is poor due to aggressive coupé roofline.", weight: 2 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "toyota", slug: "prius-prime", name: "Prius Prime", bodyStyle: "Hatchback",
    segment: "Compact PHEV", startingMsrpCad: 38990,
    ownership: {
      year: 2026,
      tireFrontSize: "195/65R17", estTireSetCad: 950,
      oilType: "0W-16 full synthetic", oilCapacityL: 4.0, estOilChangeCad: 95,
      oilChangeIntervalKm: 16000,
      brakeJobFrontCad: 520, brakeJobRearCad: 460,
      dealerLabourRateCad: 160, indieLabourRateCad: 115,
      includedMaintenanceMonths: 24, includedMaintenanceKm: 40000,
      fiveYearOwnershipCostCad: 29000,
    },
    prosCons: [
      { isPro: true, text: "~71 km electric range — long enough for most commutes on grid.", weight: 3 },
      { isPro: true, text: "$5,000 federal iZEV eligible.", weight: 3 },
      { isPro: false, text: "FWD only (Prius RZ is the AWD hybrid; Prime is FWD).", weight: 1 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "toyota", slug: "bz4x", name: "bZ4X", bodyStyle: "Compact SUV (BEV)",
    segment: "Electric SUV", startingMsrpCad: 47950,
    ownership: {
      year: 2026,
      tireFrontSize: "235/60R18", estTireSetCad: 1300,
      oilType: "n/a — BEV", estOilChangeCad: 0, oilChangeIntervalKm: undefined,
      brakeJobFrontCad: 580, brakeJobRearCad: 520,
      dealerLabourRateCad: 160, indieLabourRateCad: 130,
      includedMaintenanceMonths: 24, includedMaintenanceKm: 40000,
      fiveYearOwnershipCostCad: 28000,
    },
    prosCons: [
      { isPro: true, text: "$5,000 federal iZEV eligible.", weight: 3 },
      { isPro: true, text: "10-year / 240,000 km battery warranty.", weight: 3 },
      { isPro: false, text: "Range trails competition (~406 km FWD, ~367 km AWD vs Ioniq 5 ~488 km).", weight: 3 },
      { isPro: false, text: "DC fast-charge slower than Hyundai/Kia 800V cars (~30 min 10–80%).", weight: 2 },
    ],
    commonIssues: [
      { title: "Hub-bolt recall (2022-2023)", severity: "HIGH", yearsAffected: [2022, 2023], status: "RECALL_CLOSED",
        description: "Initial bZ4X launch had a hub-bolt loosening recall that grounded the model for months. Fully resolved; current production unaffected.", mentionCount: 60 },
    ],
  },
  {
    brandSlug: "toyota", slug: "4runner", name: "4Runner", bodyStyle: "Body-on-frame SUV",
    segment: "Midsize SUV", startingMsrpCad: 57910,
    notesMd: "Fully redesigned for 2025 — i-FORCE 2.4T and i-FORCE MAX hybrid powertrains, new platform shared with Tacoma/Land Cruiser.",
    ownership: {
      year: 2026,
      tireFrontSize: "265/70R18", estTireSetCad: 1600, estWinterTireSetCad: 1500,
      oilType: "0W-20 full synthetic", oilCapacityL: 6.4, estOilChangeCad: 135,
      oilChangeIntervalKm: 16000,
      brakeJobFrontCad: 700, brakeJobRearCad: 620,
      dealerLabourRateCad: 170, indieLabourRateCad: 125,
      includedMaintenanceMonths: 24, includedMaintenanceKm: 40000,
      fiveYearOwnershipCostCad: 50000,
    },
    prosCons: [
      { isPro: true, text: "First-ever 4Runner hybrid (i-FORCE MAX, 326 hp / 465 lb-ft).", weight: 3 },
      { isPro: true, text: "Body-on-frame durability + true off-road heritage (TRD Off-Road, TRD Pro, Trailhunter).", weight: 3 },
      { isPro: false, text: "On-road manners trail unibody competitors (Grand Cherokee, Telluride).", weight: 1 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "toyota", slug: "land-cruiser", name: "Land Cruiser", bodyStyle: "Body-on-frame SUV",
    segment: "Midsize off-road SUV", startingMsrpCad: 69990,
    notesMd: "Returned to Canada for 2024 MY as a smaller, hybrid-only Land Cruiser. Shares platform with 4Runner/Tacoma.",
    ownership: {
      year: 2026,
      tireFrontSize: "265/70R18", estTireSetCad: 1700, estWinterTireSetCad: 1600,
      oilType: "0W-16 full synthetic", oilCapacityL: 6.4, estOilChangeCad: 140,
      oilChangeIntervalKm: 16000,
      brakeJobFrontCad: 720, brakeJobRearCad: 640,
      dealerLabourRateCad: 170, indieLabourRateCad: 125,
      includedMaintenanceMonths: 24, includedMaintenanceKm: 40000,
      fiveYearOwnershipCostCad: 55000,
    },
    prosCons: [
      { isPro: true, text: "Hybrid-only powertrain (326 hp / 465 lb-ft).", weight: 3 },
      { isPro: true, text: "Full-time 4WD with locking center diff.", weight: 3 },
      { isPro: false, text: "Allocation extremely limited — most ON dealers see 1-2 units/quarter.", weight: 2 },
    ],
    commonIssues: [],
  },

  // ============================ Lexus ============================
  {
    brandSlug: "lexus", slug: "lx-rx", name: "RX", bodyStyle: "Midsize SUV",
    segment: "Midsize luxury SUV", startingMsrpCad: 64950,
    notesMd: "Lexus's best-seller globally. RX 350 turbo, RX 350h hybrid, RX 450h+ PHEV, RX 500h F SPORT Performance hybrid.",
    ownership: {
      year: 2026,
      tireFrontSize: "235/60R19", estTireSetCad: 1500, estWinterTireSetCad: 1400,
      oilType: "0W-16 full synthetic", oilCapacityL: 5.7, estOilChangeCad: 140,
      oilChangeIntervalKm: 16000,
      brakeJobFrontCad: 720, brakeJobRearCad: 640,
      dealerLabourRateCad: 195, indieLabourRateCad: 150,
      includedMaintenanceMonths: 48, includedMaintenanceKm: 80000,
      includedMaintenanceNotes: "Lexus Complete Care: 4 yr / 80,000 km scheduled maintenance + roadside.",
      fiveYearOwnershipCostCad: 48000,
    },
    prosCons: [
      { isPro: true, text: "Four powertrain choices including a 366 hp PHEV (~60 km EV range).", weight: 3 },
      { isPro: true, text: "Lexus Complete Care includes scheduled maintenance for 4 yr / 80,000 km.", weight: 3 },
      { isPro: true, text: "10-year / 240,000 km HV battery warranty.", weight: 2 },
      { isPro: false, text: "RX 500h F SPORT Performance gets thirstier than competition for a hybrid.", weight: 1 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "lexus", slug: "nx", name: "NX", bodyStyle: "Compact SUV",
    segment: "Compact luxury SUV", startingMsrpCad: 52450,
    ownership: {
      year: 2026,
      tireFrontSize: "235/60R18", estTireSetCad: 1300, estWinterTireSetCad: 1300,
      oilType: "0W-16 full synthetic", oilCapacityL: 4.5, estOilChangeCad: 135,
      oilChangeIntervalKm: 16000,
      brakeJobFrontCad: 660, brakeJobRearCad: 580,
      dealerLabourRateCad: 195, indieLabourRateCad: 150,
      includedMaintenanceMonths: 48, includedMaintenanceKm: 80000,
      fiveYearOwnershipCostCad: 42000,
    },
    prosCons: [
      { isPro: true, text: "NX 450h+ PHEV offers ~60 km EV range + 304 hp combined.", weight: 3 },
      { isPro: true, text: "Top-tier interior fit and finish at this price.", weight: 2 },
      { isPro: false, text: "Pricier than RAV4 / RAV4 Prime for similar mechanicals.", weight: 1 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "lexus", slug: "tx", name: "TX", bodyStyle: "Midsize SUV (3-row)",
    segment: "Midsize 3-row luxury SUV", startingMsrpCad: 70450,
    notesMd: "Lexus's first 3-row built on the Grand Highlander platform.",
    ownership: {
      year: 2026,
      tireFrontSize: "235/60R20", estTireSetCad: 1700, estWinterTireSetCad: 1500,
      oilType: "0W-16 full synthetic", oilCapacityL: 5.0, estOilChangeCad: 150,
      oilChangeIntervalKm: 16000,
      brakeJobFrontCad: 760, brakeJobRearCad: 660,
      dealerLabourRateCad: 195, indieLabourRateCad: 150,
      includedMaintenanceMonths: 48, includedMaintenanceKm: 80000,
      fiveYearOwnershipCostCad: 52000,
    },
    prosCons: [
      { isPro: true, text: "TX 550h+ PHEV: 404 hp combined + ~53 km EV range.", weight: 3 },
      { isPro: true, text: "Real adult third row.", weight: 2 },
      { isPro: false, text: "Tow rating ~5,000 lb — same as Grand Highlander.", weight: 1 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "lexus", slug: "gx", name: "GX", bodyStyle: "Body-on-frame SUV",
    segment: "Midsize luxury off-road SUV", startingMsrpCad: 81500,
    notesMd: "Redesigned for 2024. Shares platform with Land Cruiser, twin-turbo V6 (no hybrid in 2025).",
    ownership: {
      year: 2026,
      tireFrontSize: "265/70R18", estTireSetCad: 1800,
      oilType: "0W-20 full synthetic", oilCapacityL: 7.6, estOilChangeCad: 160,
      oilChangeIntervalKm: 16000,
      brakeJobFrontCad: 800, brakeJobRearCad: 700,
      dealerLabourRateCad: 200, indieLabourRateCad: 150,
      includedMaintenanceMonths: 48, includedMaintenanceKm: 80000,
      fiveYearOwnershipCostCad: 58000,
    },
    prosCons: [
      { isPro: true, text: "Genuine off-road heritage with on-road luxury polish.", weight: 3 },
      { isPro: true, text: "Twin-turbo 3.4L V6 (349 hp / 479 lb-ft).", weight: 2 },
      { isPro: false, text: "Real-world fuel economy in the 14–15 L/100km range — no hybrid option in Canada (yet).", weight: 2 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "lexus", slug: "es", name: "ES", bodyStyle: "Sedan",
    segment: "Midsize luxury sedan", startingMsrpCad: 51750,
    ownership: {
      year: 2026,
      tireFrontSize: "215/55R17", estTireSetCad: 1200, estWinterTireSetCad: 1100,
      oilType: "0W-16 full synthetic", oilCapacityL: 4.5, estOilChangeCad: 130,
      oilChangeIntervalKm: 16000,
      brakeJobFrontCad: 600, brakeJobRearCad: 520,
      dealerLabourRateCad: 195, indieLabourRateCad: 145,
      includedMaintenanceMonths: 48, includedMaintenanceKm: 80000,
      fiveYearOwnershipCostCad: 38000,
    },
    prosCons: [
      { isPro: true, text: "ES 300h hybrid: ~5.5 L/100km combined.", weight: 3 },
      { isPro: true, text: "Cheapest entry into Lexus.", weight: 2 },
      { isPro: false, text: "FWD/AWD (not RWD) — purists will prefer IS/RC.", weight: 1 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "lexus", slug: "is", name: "IS", bodyStyle: "Sedan (RWD)",
    segment: "Compact luxury sedan", startingMsrpCad: 47950,
    ownership: {
      year: 2026,
      tireFrontSize: "235/45R18", estTireSetCad: 1300,
      oilType: "0W-20 full synthetic", oilCapacityL: 6.0, estOilChangeCad: 140,
      oilChangeIntervalKm: 16000,
      brakeJobFrontCad: 680, brakeJobRearCad: 600,
      dealerLabourRateCad: 195, indieLabourRateCad: 145,
      includedMaintenanceMonths: 48, includedMaintenanceKm: 80000,
      fiveYearOwnershipCostCad: 40000,
    },
    prosCons: [
      { isPro: true, text: "RWD or AWD — German-style chassis tuning, Toyota reliability.", weight: 3 },
      { isPro: true, text: "IS 500 F SPORT Performance: 5.0L NA V8, 472 hp — the last analog V8 sedan you can buy new.", weight: 3 },
      { isPro: false, text: "Rear seat tight vs 3 Series / C-Class.", weight: 2 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "lexus", slug: "ux", name: "UX", bodyStyle: "Subcompact SUV",
    segment: "Subcompact luxury SUV", startingMsrpCad: 41200,
    ownership: {
      year: 2026,
      tireFrontSize: "215/60R17", estTireSetCad: 1100,
      oilType: "0W-16 full synthetic", oilCapacityL: 4.4, estOilChangeCad: 125,
      oilChangeIntervalKm: 16000,
      brakeJobFrontCad: 560, brakeJobRearCad: 480,
      dealerLabourRateCad: 195, indieLabourRateCad: 145,
      includedMaintenanceMonths: 48, includedMaintenanceKm: 80000,
      fiveYearOwnershipCostCad: 35000,
    },
    prosCons: [
      { isPro: true, text: "UX 300h hybrid: ~6.0 L/100km combined.", weight: 3 },
      { isPro: true, text: "Cheapest Lexus SUV.", weight: 2 },
      { isPro: false, text: "Cargo space is small even by subcompact standards.", weight: 2 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "lexus", slug: "rz", name: "RZ", bodyStyle: "Compact SUV (BEV)",
    segment: "Electric luxury SUV", startingMsrpCad: 60750,
    ownership: {
      year: 2026,
      tireFrontSize: "235/60R18", estTireSetCad: 1400,
      oilType: "n/a — BEV", estOilChangeCad: 0,
      brakeJobFrontCad: 620, brakeJobRearCad: 540,
      dealerLabourRateCad: 195, indieLabourRateCad: 150,
      includedMaintenanceMonths: 48, includedMaintenanceKm: 80000,
      fiveYearOwnershipCostCad: 32000,
    },
    prosCons: [
      { isPro: true, text: "Sister vehicle to bZ4X but with Lexus polish, larger battery.", weight: 2 },
      { isPro: true, text: "$5,000 federal iZEV eligible.", weight: 3 },
      { isPro: false, text: "Range still trails Ioniq 5 / Model Y.", weight: 2 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "lexus", slug: "ls", name: "LS", bodyStyle: "Full-size sedan",
    segment: "Full-size luxury sedan", startingMsrpCad: 113000,
    ownership: {
      year: 2026,
      tireFrontSize: "245/45R20", estTireSetCad: 2000,
      oilType: "0W-20 full synthetic", oilCapacityL: 6.4, estOilChangeCad: 180,
      oilChangeIntervalKm: 16000,
      brakeJobFrontCad: 900, brakeJobRearCad: 800,
      dealerLabourRateCad: 200, indieLabourRateCad: 160,
      includedMaintenanceMonths: 48, includedMaintenanceKm: 80000,
      fiveYearOwnershipCostCad: 65000,
    },
    prosCons: [
      { isPro: true, text: "Twin-turbo V6 (416 hp) or LS 500h hybrid (354 hp).", weight: 2 },
      { isPro: true, text: "Quietest cabin of any Lexus.", weight: 3 },
      { isPro: false, text: "Old-school feel vs S-Class / 7 Series digital experience.", weight: 2 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "lexus", slug: "lc", name: "LC", bodyStyle: "Coupe / Convertible",
    segment: "Grand tourer", startingMsrpCad: 113500,
    ownership: {
      year: 2026,
      tireFrontSize: "245/45R21", estTireSetCad: 2400,
      oilType: "0W-20 full synthetic", oilCapacityL: 7.0, estOilChangeCad: 200,
      oilChangeIntervalKm: 16000,
      brakeJobFrontCad: 1100, brakeJobRearCad: 900,
      dealerLabourRateCad: 200, indieLabourRateCad: 160,
      includedMaintenanceMonths: 48, includedMaintenanceKm: 80000,
      fiveYearOwnershipCostCad: 72000,
    },
    prosCons: [
      { isPro: true, text: "5.0L NA V8 (471 hp) or LC 500h hybrid.", weight: 3 },
      { isPro: true, text: "Drop-dead styling and a genuine analog GT experience.", weight: 3 },
      { isPro: false, text: "Rear seats are token.", weight: 1 },
    ],
    commonIssues: [],
  },

  // ============================ Honda ============================
  {
    brandSlug: "honda", slug: "civic", name: "Civic", bodyStyle: "Sedan / Hatchback",
    segment: "Compact car", startingMsrpCad: 26790,
    ownership: {
      year: 2026,
      tireFrontSize: "215/55R16", estTireSetCad: 900,
      oilType: "0W-20 full synthetic", oilCapacityL: 3.7, estOilChangeCad: 85,
      oilChangeIntervalKm: 12000,
      brakeJobFrontCad: 480, brakeJobRearCad: 420,
      dealerLabourRateCad: 150, indieLabourRateCad: 110,
      fiveYearOwnershipCostCad: 33000,
    },
    prosCons: [
      { isPro: true, text: "Civic Hybrid returns for 2025 — 200 hp combined, 4.8 L/100km.", weight: 3 },
      { isPro: true, text: "Strong resale and reliability — Honda's perennial #1.", weight: 3 },
      { isPro: false, text: "Civic Hybrid is FWD-only — Corolla Hybrid offers AWD.", weight: 2 },
      { isPro: false, text: "HV battery covered 8 yr / 160,000 km vs Toyota 10 yr / 240,000 km.", weight: 2 },
    ],
    commonIssues: [
      { title: "Center display software glitches (2022–2023)", severity: "LOW", yearsAffected: [2022, 2023], mentionCount: 20,
        description: "Some 2022–2023 Civic owners reported the 9-inch center display freezing or rebooting. Software updates have largely fixed this for 2025+." },
    ],
  },
  {
    brandSlug: "honda", slug: "accord", name: "Accord", bodyStyle: "Sedan",
    segment: "Midsize sedan", startingMsrpCad: 33810,
    ownership: {
      year: 2026,
      tireFrontSize: "225/50R17", estTireSetCad: 1100,
      oilType: "0W-20 full synthetic", oilCapacityL: 3.7, estOilChangeCad: 90,
      oilChangeIntervalKm: 12000,
      brakeJobFrontCad: 520, brakeJobRearCad: 460,
      dealerLabourRateCad: 155, indieLabourRateCad: 115,
      fiveYearOwnershipCostCad: 35000,
    },
    prosCons: [
      { isPro: true, text: "Accord Hybrid (204 hp combined) is the volume powertrain.", weight: 3 },
      { isPro: true, text: "Best-driving family sedan in segment.", weight: 2 },
      { isPro: false, text: "FWD only — Camry offers AWD.", weight: 2 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "honda", slug: "cr-v", name: "CR-V", bodyStyle: "Compact SUV",
    segment: "Compact SUV", startingMsrpCad: 35315,
    ownership: {
      year: 2026,
      tireFrontSize: "235/60R18", estTireSetCad: 1200,
      oilType: "0W-20 full synthetic", oilCapacityL: 3.7, estOilChangeCad: 95,
      oilChangeIntervalKm: 12000,
      brakeJobFrontCad: 560, brakeJobRearCad: 490,
      dealerLabourRateCad: 155, indieLabourRateCad: 115,
      fiveYearOwnershipCostCad: 38000,
    },
    prosCons: [
      { isPro: true, text: "CR-V Hybrid returns class-leading 6.4 L/100km (AWD).", weight: 3 },
      { isPro: true, text: "Class-leading rear seat room and cargo.", weight: 2 },
      { isPro: false, text: "HV battery 8/160 vs Toyota 10/240.", weight: 2 },
    ],
    commonIssues: [
      { title: "Fuel pump recall (2018–2020) — not affecting current MY", severity: "MEDIUM", yearsAffected: [2018, 2019, 2020], status: "RECALL_CLOSED", mentionCount: 30,
        description: "Affected models had a fuel pump that could fail. Recall is closed; current production unaffected." },
    ],
  },
  {
    brandSlug: "honda", slug: "pilot", name: "Pilot", bodyStyle: "Midsize SUV (3-row)",
    segment: "Midsize 3-row SUV", startingMsrpCad: 51890,
    ownership: {
      year: 2026,
      tireFrontSize: "245/60R18", estTireSetCad: 1400,
      oilType: "0W-20 full synthetic", oilCapacityL: 4.3, estOilChangeCad: 110,
      oilChangeIntervalKm: 12000,
      brakeJobFrontCad: 620, brakeJobRearCad: 540,
      dealerLabourRateCad: 160, indieLabourRateCad: 120,
      fiveYearOwnershipCostCad: 46000,
    },
    prosCons: [
      { isPro: true, text: "TrailSport trim has real off-road hardware (skid plates, full-size spare).", weight: 2 },
      { isPro: true, text: "3.5L V6 (285 hp) is proven.", weight: 2 },
      { isPro: false, text: "No hybrid option (Highlander Hybrid is the answer).", weight: 3 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "honda", slug: "odyssey", name: "Odyssey", bodyStyle: "Minivan",
    segment: "Minivan", startingMsrpCad: 47390,
    ownership: {
      year: 2026,
      tireFrontSize: "235/60R18", estTireSetCad: 1300,
      oilType: "0W-20 full synthetic", oilCapacityL: 4.3, estOilChangeCad: 110,
      oilChangeIntervalKm: 12000,
      brakeJobFrontCad: 600, brakeJobRearCad: 520,
      dealerLabourRateCad: 160, indieLabourRateCad: 120,
      fiveYearOwnershipCostCad: 45000,
    },
    prosCons: [
      { isPro: true, text: "Magic Slide 2nd-row seats are best-in-class for cabin flexibility.", weight: 2 },
      { isPro: false, text: "FWD only — Sienna is the only AWD minivan.", weight: 3 },
      { isPro: false, text: "No hybrid option.", weight: 3 },
    ],
    commonIssues: [],
  },

  // ============================ Mazda ============================
  {
    brandSlug: "mazda", slug: "cx-5", name: "CX-5", bodyStyle: "Compact SUV",
    segment: "Compact SUV", startingMsrpCad: 32450,
    ownership: {
      year: 2026,
      tireFrontSize: "225/65R17", estTireSetCad: 1100,
      oilType: "0W-20 full synthetic", oilCapacityL: 4.5, estOilChangeCad: 100,
      oilChangeIntervalKm: 12000,
      brakeJobFrontCad: 540, brakeJobRearCad: 470,
      dealerLabourRateCad: 150, indieLabourRateCad: 115,
      fiveYearOwnershipCostCad: 36000,
    },
    prosCons: [
      { isPro: true, text: "Premium-feeling interior at mainstream price.", weight: 2 },
      { isPro: true, text: "Standard AWD on every trim.", weight: 3 },
      { isPro: false, text: "No hybrid powertrain.", weight: 3 },
      { isPro: false, text: "Cargo space trails CR-V / RAV4.", weight: 1 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "mazda", slug: "cx-50", name: "CX-50", bodyStyle: "Compact SUV",
    segment: "Compact SUV (outdoor-leaning)", startingMsrpCad: 38100,
    notesMd: "Now available with Toyota-sourced hybrid powertrain for 2025+ (CX-50 Hybrid).",
    ownership: {
      year: 2026,
      tireFrontSize: "225/65R17", estTireSetCad: 1100,
      oilType: "0W-20 full synthetic", oilCapacityL: 4.5, estOilChangeCad: 100,
      oilChangeIntervalKm: 12000,
      brakeJobFrontCad: 540, brakeJobRearCad: 470,
      dealerLabourRateCad: 150, indieLabourRateCad: 115,
      fiveYearOwnershipCostCad: 37000,
    },
    prosCons: [
      { isPro: true, text: "CX-50 Hybrid uses the Toyota 2.5L hybrid system (RAV4 Hybrid powertrain).", weight: 3 },
      { isPro: true, text: "Premium interior, off-road-leaning styling.", weight: 2 },
      { isPro: false, text: "Hybrid HV battery covered 8/160 (Mazda warranty) vs Toyota's 10/240 on the identical hardware.", weight: 2 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "mazda", slug: "cx-90", name: "CX-90", bodyStyle: "Midsize SUV (3-row)",
    segment: "Midsize 3-row SUV", startingMsrpCad: 47100,
    ownership: {
      year: 2026,
      tireFrontSize: "265/55R19", estTireSetCad: 1500,
      oilType: "0W-20 full synthetic", oilCapacityL: 6.0, estOilChangeCad: 130,
      oilChangeIntervalKm: 12000,
      brakeJobFrontCad: 640, brakeJobRearCad: 560,
      dealerLabourRateCad: 155, indieLabourRateCad: 120,
      fiveYearOwnershipCostCad: 46000,
    },
    prosCons: [
      { isPro: true, text: "Inline-6 turbo + RWD platform — unique in segment.", weight: 3 },
      { isPro: true, text: "PHEV variant offers ~42 km EV range.", weight: 2 },
      { isPro: false, text: "Early CX-90 builds had transmission-tuning complaints, refined for 2025.", weight: 1 },
    ],
    commonIssues: [
      { title: "Transmission tuning / low-speed shifts (2024 builds)", severity: "MEDIUM", yearsAffected: [2024], mentionCount: 35, status: "TSB",
        description: "Owners reported clunky low-speed shifts on early 2024 CX-90 builds. Mazda issued a calibration update; 2025/2026 production is smoother." },
    ],
  },
  {
    brandSlug: "mazda", slug: "mazda3", name: "Mazda3", bodyStyle: "Sedan / Hatchback",
    segment: "Compact car", startingMsrpCad: 25450,
    ownership: {
      year: 2026,
      tireFrontSize: "215/45R18", estTireSetCad: 1000,
      oilType: "0W-20 full synthetic", oilCapacityL: 4.5, estOilChangeCad: 95,
      oilChangeIntervalKm: 12000,
      brakeJobFrontCad: 500, brakeJobRearCad: 440,
      dealerLabourRateCad: 150, indieLabourRateCad: 115,
      fiveYearOwnershipCostCad: 32000,
    },
    prosCons: [
      { isPro: true, text: "Class-best interior materials and chassis dynamics.", weight: 3 },
      { isPro: true, text: "AWD available — Civic is FWD-only.", weight: 2 },
      { isPro: false, text: "No hybrid option.", weight: 3 },
    ],
    commonIssues: [],
  },

  // ============================ Hyundai ============================
  {
    brandSlug: "hyundai", slug: "elantra", name: "Elantra", bodyStyle: "Sedan",
    segment: "Compact car", startingMsrpCad: 23399,
    ownership: {
      year: 2026,
      tireFrontSize: "205/55R16", estTireSetCad: 850,
      oilType: "5W-30 synthetic", oilCapacityL: 4.0, estOilChangeCad: 80,
      oilChangeIntervalKm: 12000,
      brakeJobFrontCad: 460, brakeJobRearCad: 400,
      dealerLabourRateCad: 145, indieLabourRateCad: 105,
      fiveYearOwnershipCostCad: 30000,
    },
    prosCons: [
      { isPro: true, text: "5-yr / 100,000 km basic warranty.", weight: 3 },
      { isPro: true, text: "Elantra Hybrid available — ~4.9 L/100km.", weight: 2 },
      { isPro: false, text: "Resale historically trails Civic / Corolla by 5-10%.", weight: 2 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "hyundai", slug: "tucson", name: "Tucson", bodyStyle: "Compact SUV",
    segment: "Compact SUV", startingMsrpCad: 33199,
    ownership: {
      year: 2026,
      tireFrontSize: "235/60R18", estTireSetCad: 1200,
      oilType: "5W-30 synthetic", oilCapacityL: 4.0, estOilChangeCad: 95,
      oilChangeIntervalKm: 12000,
      brakeJobFrontCad: 540, brakeJobRearCad: 480,
      dealerLabourRateCad: 145, indieLabourRateCad: 105,
      fiveYearOwnershipCostCad: 36000,
    },
    prosCons: [
      { isPro: true, text: "Hybrid (226 hp) and PHEV (~50 km EV) both available.", weight: 3 },
      { isPro: true, text: "5-yr / 100,000 km warranty.", weight: 3 },
      { isPro: false, text: "Theft-prone in some areas — Hyundai/Kia anti-theft software updates have helped.", weight: 1 },
    ],
    commonIssues: [
      { title: "Theta II engine seizure (pre-2020) — not affecting current MY", severity: "MEDIUM", yearsAffected: [2015, 2016, 2017, 2018, 2019], status: "RECALL_CLOSED", mentionCount: 50,
        description: "Earlier 2.4L engines had a recall for engine seizure. Current 2.5L/turbo engines are unaffected." },
    ],
  },
  {
    brandSlug: "hyundai", slug: "ioniq-5", name: "IONIQ 5", bodyStyle: "Compact SUV (BEV)",
    segment: "Electric SUV", startingMsrpCad: 54999,
    ownership: {
      year: 2026,
      tireFrontSize: "235/55R19", estTireSetCad: 1400,
      oilType: "n/a — BEV", estOilChangeCad: 0,
      brakeJobFrontCad: 600, brakeJobRearCad: 520,
      dealerLabourRateCad: 150, indieLabourRateCad: 120,
      fiveYearOwnershipCostCad: 26000,
    },
    prosCons: [
      { isPro: true, text: "800V architecture — ~18 min 10-80% DC fast charge.", weight: 3 },
      { isPro: true, text: "$5,000 federal iZEV eligible (verify trim).", weight: 3 },
      { isPro: true, text: "Up to ~488 km range (long range RWD).", weight: 3 },
      { isPro: false, text: "Software glitches and ICCU (charging control unit) recalls reported on early builds.", weight: 2 },
    ],
    commonIssues: [
      { title: "ICCU failure (DC charging system)", severity: "HIGH", yearsAffected: [2022, 2023, 2024], status: "RECALL_OPEN", mentionCount: 45,
        description: "Some IONIQ 5 (and EV6) owners reported the Integrated Charging Control Unit failing, leaving the vehicle unable to drive or charge. Hyundai issued software and hardware fixes; some 2024 vehicles still affected." },
    ],
  },

  // ============================ Kia ============================
  {
    brandSlug: "kia", slug: "telluride", name: "Telluride", bodyStyle: "Midsize SUV (3-row)",
    segment: "Midsize 3-row SUV", startingMsrpCad: 52995,
    ownership: {
      year: 2026,
      tireFrontSize: "245/60R20", estTireSetCad: 1500,
      oilType: "5W-30 synthetic", oilCapacityL: 5.7, estOilChangeCad: 115,
      oilChangeIntervalKm: 12000,
      brakeJobFrontCad: 640, brakeJobRearCad: 560,
      dealerLabourRateCad: 150, indieLabourRateCad: 115,
      fiveYearOwnershipCostCad: 46000,
    },
    prosCons: [
      { isPro: true, text: "Won North American Utility of the Year (2020) and remains class benchmark.", weight: 3 },
      { isPro: true, text: "5-yr / 100,000 km warranty.", weight: 3 },
      { isPro: false, text: "No hybrid option.", weight: 3 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "kia", slug: "sportage", name: "Sportage", bodyStyle: "Compact SUV",
    segment: "Compact SUV", startingMsrpCad: 31295,
    ownership: {
      year: 2026,
      tireFrontSize: "235/60R18", estTireSetCad: 1200,
      oilType: "5W-30 synthetic", oilCapacityL: 4.0, estOilChangeCad: 95,
      oilChangeIntervalKm: 12000,
      brakeJobFrontCad: 540, brakeJobRearCad: 480,
      dealerLabourRateCad: 145, indieLabourRateCad: 105,
      fiveYearOwnershipCostCad: 36000,
    },
    prosCons: [
      { isPro: true, text: "Hybrid and PHEV both available (sister to Tucson).", weight: 3 },
      { isPro: true, text: "5-yr / 100,000 km warranty.", weight: 3 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "kia", slug: "ev6", name: "EV6", bodyStyle: "Compact SUV (BEV)",
    segment: "Electric SUV", startingMsrpCad: 55995,
    ownership: {
      year: 2026,
      tireFrontSize: "235/55R19", estTireSetCad: 1400,
      oilType: "n/a — BEV", estOilChangeCad: 0,
      brakeJobFrontCad: 600, brakeJobRearCad: 520,
      dealerLabourRateCad: 150, indieLabourRateCad: 120,
      fiveYearOwnershipCostCad: 27000,
    },
    prosCons: [
      { isPro: true, text: "Sister to IONIQ 5 — 800V, fast charging.", weight: 3 },
      { isPro: true, text: "GT trim with 576 hp.", weight: 2 },
      { isPro: false, text: "ICCU recall also affected EV6.", weight: 2 },
    ],
    commonIssues: [],
  },

  // ============================ Subaru ============================
  {
    brandSlug: "subaru", slug: "forester", name: "Forester", bodyStyle: "Compact SUV",
    segment: "Compact SUV", startingMsrpCad: 33495,
    ownership: {
      year: 2026,
      tireFrontSize: "225/55R18", estTireSetCad: 1100,
      oilType: "0W-20 synthetic", oilCapacityL: 5.1, estOilChangeCad: 100,
      oilChangeIntervalKm: 9600,
      brakeJobFrontCad: 540, brakeJobRearCad: 480,
      dealerLabourRateCad: 150, indieLabourRateCad: 110,
      fiveYearOwnershipCostCad: 37000,
    },
    prosCons: [
      { isPro: true, text: "Standard symmetrical AWD.", weight: 3 },
      { isPro: true, text: "EyeSight driver-assist suite is class-leading.", weight: 2 },
      { isPro: false, text: "No hybrid option in Canada (Forester Hybrid not sold here).", weight: 3 },
      { isPro: false, text: "Short oil change interval (9,600 km).", weight: 1 },
    ],
    commonIssues: [
      { title: "Older Subaru head gasket reputation — not affecting current FB engines", severity: "LOW", yearsAffected: [2010, 2011, 2012], status: "RESOLVED", mentionCount: 80,
        description: "Earlier EJ-series engines were notorious for head gasket failure. Current FB-series engines have not shown the same issue at scale." },
    ],
  },
  {
    brandSlug: "subaru", slug: "outback", name: "Outback", bodyStyle: "Wagon / SUV crossover",
    segment: "Midsize wagon", startingMsrpCad: 36495,
    ownership: {
      year: 2026,
      tireFrontSize: "225/65R17", estTireSetCad: 1200,
      oilType: "0W-20 synthetic", oilCapacityL: 5.1, estOilChangeCad: 105,
      oilChangeIntervalKm: 9600,
      brakeJobFrontCad: 580, brakeJobRearCad: 500,
      dealerLabourRateCad: 150, indieLabourRateCad: 110,
      fiveYearOwnershipCostCad: 39000,
    },
    prosCons: [
      { isPro: true, text: "Wilderness trim brings real off-road capability.", weight: 2 },
      { isPro: true, text: "Standard symmetrical AWD.", weight: 3 },
      { isPro: false, text: "CVT-only — no traditional automatic option.", weight: 1 },
    ],
    commonIssues: [],
  },

  // ============================ Ford ============================
  {
    brandSlug: "ford", slug: "f-150", name: "F-150", bodyStyle: "Full-size Pickup",
    segment: "Full-size truck", startingMsrpCad: 50450,
    notesMd: "Canada's best-selling vehicle for 14+ consecutive years.",
    ownership: {
      year: 2026,
      tireFrontSize: "275/65R18", estTireSetCad: 1800,
      oilType: "5W-30 synthetic blend", oilCapacityL: 5.7, estOilChangeCad: 130,
      oilChangeIntervalKm: 12000,
      brakeJobFrontCad: 720, brakeJobRearCad: 640,
      dealerLabourRateCad: 165, indieLabourRateCad: 120,
      fiveYearOwnershipCostCad: 55000,
    },
    prosCons: [
      { isPro: true, text: "Highest payload + most configurations in the segment.", weight: 3 },
      { isPro: true, text: "PowerBoost hybrid (430 hp) + ProPower onboard 7.2kW generator.", weight: 3 },
      { isPro: false, text: "SYNC infotainment + driver-assist quality varies — ongoing forum complaints.", weight: 2 },
      { isPro: false, text: "Resale trails Tundra and Silverado historically.", weight: 1 },
    ],
    commonIssues: [
      { title: "10-speed transmission shudder (early builds)", severity: "MEDIUM", yearsAffected: [2017, 2018, 2019, 2020], status: "TSB", mentionCount: 120,
        description: "Ford 10R80 10-speed transmissions in earlier builds had shudder and harsh-shift issues. TSBs and calibration updates have largely resolved this in 2022+ builds." },
    ],
  },
  {
    brandSlug: "ford", slug: "maverick", name: "Maverick", bodyStyle: "Compact Pickup",
    segment: "Compact truck", startingMsrpCad: 30995,
    ownership: {
      year: 2026,
      tireFrontSize: "225/65R17", estTireSetCad: 1100,
      oilType: "0W-20 synthetic", oilCapacityL: 4.3, estOilChangeCad: 100,
      oilChangeIntervalKm: 12000,
      brakeJobFrontCad: 520, brakeJobRearCad: 460,
      dealerLabourRateCad: 155, indieLabourRateCad: 115,
      fiveYearOwnershipCostCad: 35000,
    },
    prosCons: [
      { isPro: true, text: "Standard hybrid (FWD) — ~6.7 L/100km city.", weight: 3 },
      { isPro: true, text: "Cheapest new pickup in Canada.", weight: 3 },
      { isPro: false, text: "AWD only available with the 2.0L EcoBoost gas (not hybrid).", weight: 2 },
      { isPro: false, text: "Tight allocation — order banks frequently sold out.", weight: 1 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "ford", slug: "escape", name: "Escape", bodyStyle: "Compact SUV",
    segment: "Compact SUV", startingMsrpCad: 33850,
    ownership: {
      year: 2026,
      tireFrontSize: "225/60R18", estTireSetCad: 1100,
      oilType: "5W-30 synthetic blend", oilCapacityL: 4.3, estOilChangeCad: 100,
      oilChangeIntervalKm: 12000,
      brakeJobFrontCad: 540, brakeJobRearCad: 470,
      dealerLabourRateCad: 155, indieLabourRateCad: 115,
      fiveYearOwnershipCostCad: 36000,
    },
    prosCons: [
      { isPro: true, text: "Hybrid and PHEV both available.", weight: 3 },
      { isPro: false, text: "Resale value trails RAV4/CR-V notably.", weight: 2 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "ford", slug: "mustang-mach-e", name: "Mustang Mach-E", bodyStyle: "Compact SUV (BEV)",
    segment: "Electric SUV", startingMsrpCad: 54995,
    ownership: {
      year: 2026,
      tireFrontSize: "225/55R19", estTireSetCad: 1400,
      oilType: "n/a — BEV", estOilChangeCad: 0,
      brakeJobFrontCad: 620, brakeJobRearCad: 540,
      dealerLabourRateCad: 155, indieLabourRateCad: 120,
      fiveYearOwnershipCostCad: 28000,
    },
    prosCons: [
      { isPro: true, text: "NACS-equipped (Tesla Supercharger access) for 2025+.", weight: 3 },
      { isPro: true, text: "$5,000 federal iZEV eligible (verify trim).", weight: 3 },
      { isPro: false, text: "Early 2021–2022 builds had charging-system recalls (HV battery contactor).", weight: 2 },
    ],
    commonIssues: [],
  },

  // ============================ Chevrolet ============================
  {
    brandSlug: "chevrolet", slug: "silverado-1500", name: "Silverado 1500", bodyStyle: "Full-size Pickup",
    segment: "Full-size truck", startingMsrpCad: 47998,
    ownership: {
      year: 2026,
      tireFrontSize: "265/65R18", estTireSetCad: 1700,
      oilType: "0W-20 dexos1 Gen3", oilCapacityL: 5.7, estOilChangeCad: 125,
      oilChangeIntervalKm: 12000,
      brakeJobFrontCad: 700, brakeJobRearCad: 620,
      dealerLabourRateCad: 165, indieLabourRateCad: 120,
      fiveYearOwnershipCostCad: 52000,
    },
    prosCons: [
      { isPro: true, text: "Duramax 3.0L diesel option (305 hp / 495 lb-ft) — best-in-class diesel torque.", weight: 3 },
      { isPro: true, text: "ZR2 trim is a serious off-road competitor.", weight: 2 },
      { isPro: false, text: "Interior quality on base/mid trims trails Ram and F-150.", weight: 2 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "chevrolet", slug: "equinox", name: "Equinox", bodyStyle: "Compact SUV",
    segment: "Compact SUV", startingMsrpCad: 32599,
    ownership: {
      year: 2026,
      tireFrontSize: "225/65R17", estTireSetCad: 1100,
      oilType: "0W-20 dexos1 Gen3", oilCapacityL: 4.3, estOilChangeCad: 95,
      oilChangeIntervalKm: 12000,
      brakeJobFrontCad: 520, brakeJobRearCad: 460,
      dealerLabourRateCad: 155, indieLabourRateCad: 115,
      fiveYearOwnershipCostCad: 35000,
    },
    prosCons: [
      { isPro: true, text: "Equinox EV variant available (~510 km range).", weight: 3 },
      { isPro: false, text: "Gas Equinox has no hybrid option.", weight: 3 },
    ],
    commonIssues: [],
  },

  // ============================ Ram ============================
  {
    brandSlug: "ram", slug: "1500", name: "1500", bodyStyle: "Full-size Pickup",
    segment: "Full-size truck", startingMsrpCad: 51495,
    ownership: {
      year: 2026,
      tireFrontSize: "275/65R18", estTireSetCad: 1700,
      oilType: "0W-20 synthetic", oilCapacityL: 6.6, estOilChangeCad: 130,
      oilChangeIntervalKm: 12000,
      brakeJobFrontCad: 700, brakeJobRearCad: 620,
      dealerLabourRateCad: 160, indieLabourRateCad: 120,
      fiveYearOwnershipCostCad: 53000,
    },
    prosCons: [
      { isPro: true, text: "Coil-spring rear gives best ride in segment.", weight: 3 },
      { isPro: true, text: "Hurricane inline-6 twin-turbo replaces V8 — 420 hp / 469 lb-ft standard output.", weight: 2 },
      { isPro: false, text: "Stellantis reliability trails Toyota / Ford in surveys.", weight: 2 },
    ],
    commonIssues: [],
  },

  // ============================ Volkswagen ============================
  {
    brandSlug: "volkswagen", slug: "tiguan", name: "Tiguan", bodyStyle: "Compact SUV",
    segment: "Compact SUV", startingMsrpCad: 36995,
    ownership: {
      year: 2026,
      tireFrontSize: "235/55R18", estTireSetCad: 1200,
      oilType: "0W-20 VW spec 508", oilCapacityL: 5.7, estOilChangeCad: 130,
      oilChangeIntervalKm: 16000,
      brakeJobFrontCad: 600, brakeJobRearCad: 520,
      dealerLabourRateCad: 165, indieLabourRateCad: 125,
      fiveYearOwnershipCostCad: 40000,
    },
    prosCons: [
      { isPro: true, text: "Redesigned for 2025 — European-feel chassis, available 3rd row.", weight: 2 },
      { isPro: true, text: "1.5T eHybrid available in some markets (verify Canadian availability).", weight: 1 },
      { isPro: false, text: "VW reliability/repair costs run higher than Japanese rivals.", weight: 2 },
    ],
    commonIssues: [
      { title: "DSG transmission service costs ~$500–700 every 60,000 km", severity: "LOW", yearsAffected: [2024, 2025, 2026],
        description: "DSG dual-clutch transmissions require fluid service at ~60k km. Skipping it is a leading cause of premature wear.", mentionCount: 25 },
    ],
  },
  {
    brandSlug: "volkswagen", slug: "id-4", name: "ID.4", bodyStyle: "Compact SUV (BEV)",
    segment: "Electric SUV", startingMsrpCad: 51995,
    ownership: {
      year: 2026,
      tireFrontSize: "235/55R19", estTireSetCad: 1400,
      oilType: "n/a — BEV", estOilChangeCad: 0,
      brakeJobFrontCad: 600, brakeJobRearCad: 540,
      dealerLabourRateCad: 165, indieLabourRateCad: 125,
      fiveYearOwnershipCostCad: 27000,
    },
    prosCons: [
      { isPro: true, text: "$5,000 federal iZEV eligible.", weight: 3 },
      { isPro: false, text: "Early builds had software / haptic-switch complaints — much improved for 2024+.", weight: 2 },
    ],
    commonIssues: [],
  },

  // ============================ BMW ============================
  {
    brandSlug: "bmw", slug: "x3", name: "X3", bodyStyle: "Compact SUV",
    segment: "Compact luxury SUV", startingMsrpCad: 56300,
    ownership: {
      year: 2026,
      tireFrontSize: "245/50R19", estTireSetCad: 1700,
      oilType: "0W-20 BMW Longlife-17 FE+", oilCapacityL: 6.5, estOilChangeCad: 200,
      oilChangeIntervalKm: 16000,
      brakeJobFrontCad: 900, brakeJobRearCad: 800,
      dealerLabourRateCad: 205, indieLabourRateCad: 160,
      includedMaintenanceMonths: 36, includedMaintenanceKm: 60000,
      includedMaintenanceNotes: "BMW Ultimate Care: 3 yr / 60,000 km scheduled maintenance.",
      fiveYearOwnershipCostCad: 48000,
    },
    prosCons: [
      { isPro: true, text: "Class-best dynamics among compact luxury SUVs.", weight: 3 },
      { isPro: true, text: "Ultimate Care covers scheduled maintenance 3 yr / 60,000 km.", weight: 2 },
      { isPro: false, text: "Out-of-warranty repair costs are notably high.", weight: 2 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "bmw", slug: "i4", name: "i4", bodyStyle: "Sedan (BEV)",
    segment: "Electric luxury sedan", startingMsrpCad: 59750,
    ownership: {
      year: 2026,
      tireFrontSize: "245/45R18", estTireSetCad: 1500,
      oilType: "n/a — BEV", estOilChangeCad: 0,
      brakeJobFrontCad: 850, brakeJobRearCad: 750,
      dealerLabourRateCad: 205, indieLabourRateCad: 160,
      includedMaintenanceMonths: 36, includedMaintenanceKm: 60000,
      fiveYearOwnershipCostCad: 30000,
    },
    prosCons: [
      { isPro: true, text: "i4 M50 = 536 hp, 3.7s 0–100.", weight: 3 },
      { isPro: true, text: "Familiar BMW driving feel in an EV.", weight: 2 },
      { isPro: false, text: "Range trails Tesla Model 3 / Polestar 2 long range.", weight: 1 },
    ],
    commonIssues: [],
  },

  // ============================ Mercedes-Benz ============================
  {
    brandSlug: "mercedes-benz", slug: "gle", name: "GLE", bodyStyle: "Midsize SUV",
    segment: "Midsize luxury SUV", startingMsrpCad: 75200,
    ownership: {
      year: 2026,
      tireFrontSize: "275/55R19", estTireSetCad: 1900,
      oilType: "0W-30 MB-Approval 229.5", oilCapacityL: 8.5, estOilChangeCad: 220,
      oilChangeIntervalKm: 16000,
      brakeJobFrontCad: 1100, brakeJobRearCad: 950,
      dealerLabourRateCad: 215, indieLabourRateCad: 170,
      fiveYearOwnershipCostCad: 60000,
    },
    prosCons: [
      { isPro: true, text: "Inline-6 mild-hybrid powertrain is smooth and torquey.", weight: 2 },
      { isPro: true, text: "GLE 450e PHEV offers ~80 km EV range — class-leading.", weight: 3 },
      { isPro: false, text: "Out-of-warranty repair costs are among the highest in class.", weight: 3 },
    ],
    commonIssues: [],
  },

  // ============================ Tesla ============================
  {
    brandSlug: "tesla", slug: "model-y", name: "Model Y", bodyStyle: "Compact SUV (BEV)",
    segment: "Electric SUV", startingMsrpCad: 55000,
    ownership: {
      year: 2026,
      tireFrontSize: "255/45R19", estTireSetCad: 1500,
      oilType: "n/a — BEV", estOilChangeCad: 0,
      brakeJobFrontCad: 650, brakeJobRearCad: 580,
      dealerLabourRateCad: 175, indieLabourRateCad: 150,
      fiveYearOwnershipCostCad: 26000,
    },
    prosCons: [
      { isPro: true, text: "Supercharger network access remains a defining advantage.", weight: 3 },
      { isPro: true, text: "Range up to ~525 km (Long Range).", weight: 3 },
      { isPro: true, text: "OTA updates continue to add features post-purchase.", weight: 2 },
      { isPro: false, text: "No CarPlay / Android Auto.", weight: 2 },
      { isPro: false, text: "Service experience reports vary widely; can't always book at dealer.", weight: 2 },
    ],
    commonIssues: [
      { title: "Panel-gap / paint inconsistency on early builds", severity: "LOW", yearsAffected: [2020, 2021, 2022, 2023], mentionCount: 90,
        description: "Build-quality consistency has improved year-over-year; 2024+ Y is better but inspect before delivery.", status: "REPORTED" },
    ],
  },
  {
    brandSlug: "tesla", slug: "model-3", name: "Model 3", bodyStyle: "Sedan (BEV)",
    segment: "Electric sedan", startingMsrpCad: 49990,
    ownership: {
      year: 2026,
      tireFrontSize: "235/45R18", estTireSetCad: 1400,
      oilType: "n/a — BEV", estOilChangeCad: 0,
      brakeJobFrontCad: 620, brakeJobRearCad: 540,
      dealerLabourRateCad: 175, indieLabourRateCad: 150,
      fiveYearOwnershipCostCad: 24000,
    },
    prosCons: [
      { isPro: true, text: "Highland refresh (2024+) brought better ride, quieter cabin.", weight: 2 },
      { isPro: true, text: "Performance trim returns: ~510 hp, 2.9s 0-100.", weight: 2 },
      { isPro: false, text: "No turn-signal stalk — moved to capacitive buttons (divisive).", weight: 2 },
    ],
    commonIssues: [],
  },

  // ============================ Nissan ============================
  {
    brandSlug: "nissan", slug: "rogue", name: "Rogue", bodyStyle: "Compact SUV",
    segment: "Compact SUV", startingMsrpCad: 31548,
    ownership: {
      year: 2026,
      tireFrontSize: "235/65R17", estTireSetCad: 1100,
      oilType: "0W-20 synthetic", oilCapacityL: 4.4, estOilChangeCad: 95,
      oilChangeIntervalKm: 8000,
      brakeJobFrontCad: 540, brakeJobRearCad: 470,
      dealerLabourRateCad: 150, indieLabourRateCad: 110,
      fiveYearOwnershipCostCad: 36000,
    },
    prosCons: [
      { isPro: true, text: "VC-Turbo 1.5L 3-cyl (201 hp) is unique in segment.", weight: 2 },
      { isPro: false, text: "CVT — Nissan's pre-2020 CVT reputation lingers; current Jatco units are improved but watch resale.", weight: 2 },
      { isPro: false, text: "Short oil change interval (8,000 km).", weight: 1 },
    ],
    commonIssues: [],
  },

  // ============================ Toyota (additional) ============================
  {
    brandSlug: "toyota", slug: "crown", name: "Crown", bodyStyle: "Lifted sedan",
    segment: "Midsize sedan", startingMsrpCad: 47280,
    notesMd: "Replaced the Avalon. Hybrid-only; Crown Platinum gets the Hybrid MAX (340 hp) with 6-spd AT.",
    ownership: {
      year: 2026,
      tireFrontSize: "225/45R21", estTireSetCad: 1700,
      oilType: "0W-16 full synthetic", oilCapacityL: 4.5, estOilChangeCad: 110,
      oilChangeIntervalKm: 16000,
      brakeJobFrontCad: 600, brakeJobRearCad: 540,
      dealerLabourRateCad: 160, indieLabourRateCad: 120,
      includedMaintenanceMonths: 24, includedMaintenanceKm: 40000,
      fiveYearOwnershipCostCad: 40000,
    },
    prosCons: [
      { isPro: true, text: "Standard AWD across all trims.", weight: 3 },
      { isPro: true, text: "Hybrid MAX trim hits 340 hp — Lexus-grade powertrain at Toyota price.", weight: 2 },
      { isPro: false, text: "Tall ride height divides traditional sedan buyers.", weight: 2 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "toyota", slug: "crown-signia", name: "Crown Signia", bodyStyle: "Midsize wagon/SUV",
    segment: "Midsize wagon", startingMsrpCad: 49990,
    notesMd: "Crown-branded wagon for 2025+. Hybrid AWD only, sits between Camry and Highlander.",
    ownership: {
      year: 2026,
      tireFrontSize: "235/55R19", estTireSetCad: 1400,
      oilType: "0W-16 full synthetic", oilCapacityL: 4.5, estOilChangeCad: 110,
      oilChangeIntervalKm: 16000,
      brakeJobFrontCad: 600, brakeJobRearCad: 520,
      dealerLabourRateCad: 160, indieLabourRateCad: 120,
      includedMaintenanceMonths: 24, includedMaintenanceKm: 40000,
      fiveYearOwnershipCostCad: 40000,
    },
    prosCons: [
      { isPro: true, text: "Cargo and second-row room without third-row penalty.", weight: 2 },
      { isPro: true, text: "Standard hybrid AWD, ~6.4 L/100km.", weight: 3 },
      { isPro: false, text: "No towing rating to speak of (1,500 lb).", weight: 1 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "toyota", slug: "sequoia", name: "Sequoia", bodyStyle: "Full-size SUV (3-row)",
    segment: "Full-size SUV", startingMsrpCad: 78990,
    notesMd: "Built on Tundra platform. Hybrid-only (i-FORCE MAX, 437 hp / 583 lb-ft).",
    ownership: {
      year: 2026,
      tireFrontSize: "275/55R20", estTireSetCad: 2000,
      oilType: "0W-20 full synthetic", oilCapacityL: 7.6, estOilChangeCad: 150,
      oilChangeIntervalKm: 16000,
      brakeJobFrontCad: 800, brakeJobRearCad: 700,
      dealerLabourRateCad: 170, indieLabourRateCad: 130,
      includedMaintenanceMonths: 24, includedMaintenanceKm: 40000,
      fiveYearOwnershipCostCad: 58000,
    },
    prosCons: [
      { isPro: true, text: "9,000 lb tow rating — best-in-class for a hybrid full-size SUV.", weight: 3 },
      { isPro: true, text: "Hybrid-only powertrain delivers V8-grade torque.", weight: 2 },
      { isPro: false, text: "Cargo space behind 3rd row is tight vs Yukon XL / Suburban.", weight: 2 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "toyota", slug: "gr-corolla", name: "GR Corolla", bodyStyle: "Hatchback",
    segment: "Hot hatch", startingMsrpCad: 47290,
    notesMd: "300 hp turbo 3-cyl, GR-FOUR AWD with selectable torque split. 6-spd MT standard, 8-spd AT available.",
    ownership: {
      year: 2026,
      tireFrontSize: "235/40R18", estTireSetCad: 1500,
      oilType: "0W-20 full synthetic", oilCapacityL: 5.2, estOilChangeCad: 130,
      oilChangeIntervalKm: 10000,
      brakeJobFrontCad: 750, brakeJobRearCad: 600,
      dealerLabourRateCad: 165, indieLabourRateCad: 125,
      includedMaintenanceMonths: 24, includedMaintenanceKm: 40000,
      fiveYearOwnershipCostCad: 42000,
    },
    prosCons: [
      { isPro: true, text: "GR-FOUR AWD with 60:40 / 50:50 / 30:70 selectable split.", weight: 3 },
      { isPro: true, text: "Toyota reliability backbone under a real performance car.", weight: 3 },
      { isPro: false, text: "Limited allocation — most ON dealers see 1-2 units/year.", weight: 2 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "toyota", slug: "gr86", name: "GR86", bodyStyle: "Coupe",
    segment: "Sports car", startingMsrpCad: 33150,
    ownership: {
      year: 2026,
      tireFrontSize: "215/40R18", estTireSetCad: 1300,
      oilType: "0W-20 full synthetic", oilCapacityL: 5.5, estOilChangeCad: 110,
      oilChangeIntervalKm: 10000,
      brakeJobFrontCad: 600, brakeJobRearCad: 540,
      dealerLabourRateCad: 165, indieLabourRateCad: 125,
      includedMaintenanceMonths: 24, includedMaintenanceKm: 40000,
      fiveYearOwnershipCostCad: 30000,
    },
    prosCons: [
      { isPro: true, text: "228 hp NA boxer, 6-spd MT standard — pure sports-car formula.", weight: 3 },
      { isPro: true, text: "Twin to Subaru BRZ but with Toyota warranty + dealer network.", weight: 2 },
      { isPro: false, text: "Cabin materials are plain.", weight: 2 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "toyota", slug: "gr-supra", name: "GR Supra", bodyStyle: "Coupe",
    segment: "Sports car", startingMsrpCad: 64490,
    notesMd: "Co-developed with BMW Z4 — same B58 3.0L turbo I6 (382 hp). 6-spd MT or 8-spd AT.",
    ownership: {
      year: 2026,
      tireFrontSize: "255/35R19", tireRearSize: "275/35R19", estTireSetCad: 2200,
      oilType: "0W-20 full synthetic (BMW spec)", oilCapacityL: 6.5, estOilChangeCad: 180,
      oilChangeIntervalKm: 16000,
      brakeJobFrontCad: 900, brakeJobRearCad: 800,
      dealerLabourRateCad: 170, indieLabourRateCad: 130,
      includedMaintenanceMonths: 24, includedMaintenanceKm: 40000,
      fiveYearOwnershipCostCad: 48000,
    },
    prosCons: [
      { isPro: true, text: "BMW B58 inline-6 under a Toyota warranty.", weight: 3 },
      { isPro: false, text: "Service requires BMW-spec fluids — costs run higher than other Toyotas.", weight: 2 },
      { isPro: false, text: "Discontinuation rumored after 2026 — verify availability.", weight: 1 },
    ],
    commonIssues: [],
  },

  // ============================ Acura ============================
  {
    brandSlug: "acura", slug: "integra", name: "Integra", bodyStyle: "Hatchback",
    segment: "Compact luxury sedan", startingMsrpCad: 36800,
    ownership: {
      year: 2026, tireFrontSize: "235/40R18", estTireSetCad: 1200,
      oilType: "0W-20 synthetic", oilCapacityL: 3.7, estOilChangeCad: 95,
      oilChangeIntervalKm: 12000, brakeJobFrontCad: 540, brakeJobRearCad: 480,
      dealerLabourRateCad: 165, indieLabourRateCad: 120, fiveYearOwnershipCostCad: 34000,
    },
    prosCons: [
      { isPro: true, text: "Integra Type S: 320 hp turbo + 6-spd MT — the proper hot hatch.", weight: 3 },
      { isPro: true, text: "Built on Civic Si bones — proven reliability platform.", weight: 2 },
      { isPro: false, text: "Premium fuel required.", weight: 1 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "acura", slug: "mdx", name: "MDX", bodyStyle: "Midsize SUV (3-row)",
    segment: "Midsize 3-row luxury SUV", startingMsrpCad: 60900,
    ownership: {
      year: 2026, tireFrontSize: "255/50R20", estTireSetCad: 1700,
      oilType: "0W-20 synthetic", oilCapacityL: 4.3, estOilChangeCad: 130,
      oilChangeIntervalKm: 12000, brakeJobFrontCad: 720, brakeJobRearCad: 640,
      dealerLabourRateCad: 175, indieLabourRateCad: 135, fiveYearOwnershipCostCad: 50000,
    },
    prosCons: [
      { isPro: true, text: "SH-AWD is genuinely capable in Ontario winters.", weight: 3 },
      { isPro: true, text: "Type S trim with 355 hp turbo V6.", weight: 2 },
      { isPro: false, text: "No hybrid option.", weight: 2 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "acura", slug: "rdx", name: "RDX", bodyStyle: "Compact SUV",
    segment: "Compact luxury SUV", startingMsrpCad: 50500,
    ownership: {
      year: 2026, tireFrontSize: "235/55R19", estTireSetCad: 1400,
      oilType: "0W-20 synthetic", oilCapacityL: 4.2, estOilChangeCad: 120,
      oilChangeIntervalKm: 12000, brakeJobFrontCad: 620, brakeJobRearCad: 540,
      dealerLabourRateCad: 175, indieLabourRateCad: 130, fiveYearOwnershipCostCad: 42000,
    },
    prosCons: [
      { isPro: true, text: "272 hp turbo + SH-AWD across all trims.", weight: 2 },
      { isPro: false, text: "Touchpad infotainment is divisive.", weight: 2 },
    ],
    commonIssues: [],
  },

  // ============================ Genesis ============================
  {
    brandSlug: "genesis", slug: "gv70", name: "GV70", bodyStyle: "Compact SUV",
    segment: "Compact luxury SUV", startingMsrpCad: 56000,
    ownership: {
      year: 2026, tireFrontSize: "245/45R20", estTireSetCad: 1700,
      oilType: "5W-30 synthetic", oilCapacityL: 6.5, estOilChangeCad: 150,
      oilChangeIntervalKm: 12000, brakeJobFrontCad: 800, brakeJobRearCad: 700,
      dealerLabourRateCad: 175, indieLabourRateCad: 135, fiveYearOwnershipCostCad: 46000,
    },
    prosCons: [
      { isPro: true, text: "Class-leading interior design + materials.", weight: 3 },
      { isPro: true, text: "Electrified GV70 (BEV) variant offered.", weight: 2 },
      { isPro: false, text: "Sparse dealer network in Ontario.", weight: 2 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "genesis", slug: "gv80", name: "GV80", bodyStyle: "Midsize SUV (3-row)",
    segment: "Midsize 3-row luxury SUV", startingMsrpCad: 71500,
    ownership: {
      year: 2026, tireFrontSize: "265/50R20", estTireSetCad: 1900,
      oilType: "5W-30 synthetic", oilCapacityL: 6.5, estOilChangeCad: 150,
      oilChangeIntervalKm: 12000, brakeJobFrontCad: 820, brakeJobRearCad: 720,
      dealerLabourRateCad: 175, indieLabourRateCad: 135, fiveYearOwnershipCostCad: 52000,
    },
    prosCons: [
      { isPro: true, text: "S-Class-grade ride and quietness at a discount.", weight: 3 },
      { isPro: false, text: "3rd row is child-only.", weight: 1 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "genesis", slug: "g70", name: "G70", bodyStyle: "Sedan",
    segment: "Compact luxury sedan", startingMsrpCad: 48500,
    ownership: {
      year: 2026, tireFrontSize: "225/40R19", estTireSetCad: 1500,
      oilType: "5W-30 synthetic", oilCapacityL: 6.0, estOilChangeCad: 140,
      oilChangeIntervalKm: 12000, brakeJobFrontCad: 720, brakeJobRearCad: 640,
      dealerLabourRateCad: 175, indieLabourRateCad: 135, fiveYearOwnershipCostCad: 40000,
    },
    prosCons: [
      { isPro: true, text: "3.3T V6 (365 hp) makes it the value-king sport sedan.", weight: 3 },
      { isPro: false, text: "Rear seat tight.", weight: 1 },
    ],
    commonIssues: [],
  },

  // ============================ Infiniti ============================
  {
    brandSlug: "infiniti", slug: "qx60", name: "QX60", bodyStyle: "Midsize SUV (3-row)",
    segment: "Midsize 3-row luxury SUV", startingMsrpCad: 60998,
    ownership: {
      year: 2026, tireFrontSize: "235/65R18", estTireSetCad: 1500,
      oilType: "0W-20 synthetic", oilCapacityL: 5.2, estOilChangeCad: 140,
      oilChangeIntervalKm: 12000, brakeJobFrontCad: 720, brakeJobRearCad: 620,
      dealerLabourRateCad: 165, indieLabourRateCad: 125, fiveYearOwnershipCostCad: 48000,
    },
    prosCons: [
      { isPro: true, text: "3.5L V6 + 9-spd AT (no CVT) — addresses the Pathfinder CVT criticism.", weight: 2 },
      { isPro: false, text: "Limited tech vs Acura MDX / Lexus TX.", weight: 1 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "infiniti", slug: "qx80", name: "QX80", bodyStyle: "Full-size SUV",
    segment: "Full-size luxury SUV", startingMsrpCad: 92998,
    notesMd: "Fully redesigned for 2025 — new twin-turbo V6 replaces V8, big tech overhaul.",
    ownership: {
      year: 2026, tireFrontSize: "275/50R22", estTireSetCad: 2400,
      oilType: "0W-20 synthetic", oilCapacityL: 5.7, estOilChangeCad: 170,
      oilChangeIntervalKm: 12000, brakeJobFrontCad: 900, brakeJobRearCad: 800,
      dealerLabourRateCad: 175, indieLabourRateCad: 135, fiveYearOwnershipCostCad: 64000,
    },
    prosCons: [
      { isPro: true, text: "Twin-turbo 3.5L V6 (450 hp / 516 lb-ft) is genuinely fast.", weight: 2 },
      { isPro: false, text: "No hybrid or PHEV option.", weight: 2 },
    ],
    commonIssues: [],
  },

  // ============================ Mitsubishi ============================
  {
    brandSlug: "mitsubishi", slug: "outlander", name: "Outlander", bodyStyle: "Compact SUV (3-row)",
    segment: "Compact SUV", startingMsrpCad: 33648,
    ownership: {
      year: 2026, tireFrontSize: "235/55R19", estTireSetCad: 1300,
      oilType: "0W-20 synthetic", oilCapacityL: 4.4, estOilChangeCad: 100,
      oilChangeIntervalKm: 12000, brakeJobFrontCad: 540, brakeJobRearCad: 470,
      dealerLabourRateCad: 150, indieLabourRateCad: 110, fiveYearOwnershipCostCad: 35000,
    },
    prosCons: [
      { isPro: true, text: "10 yr / 160,000 km powertrain warranty.", weight: 3 },
      { isPro: true, text: "3-row seating standard at this price.", weight: 2 },
      { isPro: false, text: "Resale value historically weak.", weight: 2 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "mitsubishi", slug: "outlander-phev", name: "Outlander PHEV", bodyStyle: "Compact SUV (PHEV, 3-row)",
    segment: "Compact PHEV", startingMsrpCad: 49998,
    ownership: {
      year: 2026, tireFrontSize: "235/55R19", estTireSetCad: 1300,
      oilType: "0W-20 synthetic", oilCapacityL: 4.4, estOilChangeCad: 105,
      oilChangeIntervalKm: 12000, brakeJobFrontCad: 540, brakeJobRearCad: 470,
      dealerLabourRateCad: 150, indieLabourRateCad: 110, fiveYearOwnershipCostCad: 30000,
    },
    prosCons: [
      { isPro: true, text: "Only PHEV with 3 rows under $60k in Canada.", weight: 3 },
      { isPro: true, text: "~61 km electric range + standard AWD via twin motors.", weight: 3 },
      { isPro: true, text: "Eligible for full $5,000 federal iZEV.", weight: 3 },
    ],
    commonIssues: [],
  },

  // ============================ Lincoln ============================
  {
    brandSlug: "lincoln", slug: "nautilus", name: "Nautilus", bodyStyle: "Midsize SUV",
    segment: "Midsize luxury SUV", startingMsrpCad: 68000,
    ownership: {
      year: 2026, tireFrontSize: "255/50R21", estTireSetCad: 1800,
      oilType: "5W-30 synthetic blend", oilCapacityL: 6.0, estOilChangeCad: 150,
      oilChangeIntervalKm: 12000, brakeJobFrontCad: 760, brakeJobRearCad: 680,
      dealerLabourRateCad: 175, indieLabourRateCad: 130, fiveYearOwnershipCostCad: 52000,
    },
    prosCons: [
      { isPro: true, text: "Hybrid powertrain option (310 hp combined).", weight: 2 },
      { isPro: true, text: "48-inch panoramic display is legitimately unique.", weight: 2 },
      { isPro: false, text: "Sync infotainment glitches persist.", weight: 2 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "lincoln", slug: "navigator", name: "Navigator", bodyStyle: "Full-size SUV",
    segment: "Full-size luxury SUV", startingMsrpCad: 124000,
    ownership: {
      year: 2026, tireFrontSize: "285/45R22", estTireSetCad: 2400,
      oilType: "5W-30 synthetic blend", oilCapacityL: 7.6, estOilChangeCad: 180,
      oilChangeIntervalKm: 12000, brakeJobFrontCad: 1000, brakeJobRearCad: 900,
      dealerLabourRateCad: 175, indieLabourRateCad: 135, fiveYearOwnershipCostCad: 70000,
    },
    prosCons: [
      { isPro: true, text: "Sanctuary-themed interior + power running boards remain class-best presentation.", weight: 3 },
      { isPro: false, text: "Twin-turbo V6 (gas only) — no hybrid yet.", weight: 2 },
    ],
    commonIssues: [],
  },

  // ============================ GMC ============================
  {
    brandSlug: "gmc", slug: "sierra-1500", name: "Sierra 1500", bodyStyle: "Full-size Pickup",
    segment: "Full-size truck", startingMsrpCad: 54498,
    ownership: {
      year: 2026, tireFrontSize: "275/65R18", estTireSetCad: 1800,
      oilType: "0W-20 dexos1 Gen3", oilCapacityL: 5.7, estOilChangeCad: 130,
      oilChangeIntervalKm: 12000, brakeJobFrontCad: 720, brakeJobRearCad: 640,
      dealerLabourRateCad: 170, indieLabourRateCad: 125, fiveYearOwnershipCostCad: 54000,
    },
    prosCons: [
      { isPro: true, text: "AT4 / AT4X trims bring real off-road hardware.", weight: 2 },
      { isPro: true, text: "Duramax 3.0L diesel option is best-in-class.", weight: 2 },
      { isPro: false, text: "Premium over Silverado for similar mechanicals.", weight: 1 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "gmc", slug: "yukon", name: "Yukon", bodyStyle: "Full-size SUV",
    segment: "Full-size SUV", startingMsrpCad: 73798,
    ownership: {
      year: 2026, tireFrontSize: "275/55R20", estTireSetCad: 2000,
      oilType: "0W-20 dexos1 Gen3", oilCapacityL: 7.6, estOilChangeCad: 150,
      oilChangeIntervalKm: 12000, brakeJobFrontCad: 820, brakeJobRearCad: 720,
      dealerLabourRateCad: 170, indieLabourRateCad: 125, fiveYearOwnershipCostCad: 58000,
    },
    prosCons: [
      { isPro: true, text: "Cargo behind 3rd row is class-leading.", weight: 2 },
      { isPro: true, text: "Diesel option available.", weight: 2 },
      { isPro: false, text: "No hybrid; Sequoia Hybrid is the answer.", weight: 2 },
    ],
    commonIssues: [],
  },

  // ============================ Buick ============================
  {
    brandSlug: "buick", slug: "envista", name: "Envista", bodyStyle: "Compact SUV",
    segment: "Compact SUV", startingMsrpCad: 28199,
    ownership: {
      year: 2026, tireFrontSize: "225/55R18", estTireSetCad: 1100,
      oilType: "0W-20 dexos1 Gen3", oilCapacityL: 4.0, estOilChangeCad: 95,
      oilChangeIntervalKm: 12000, brakeJobFrontCad: 480, brakeJobRearCad: 420,
      dealerLabourRateCad: 155, indieLabourRateCad: 115, fiveYearOwnershipCostCad: 30000,
    },
    prosCons: [
      { isPro: true, text: "Most affordable Buick + sharp coupe-SUV styling.", weight: 2 },
      { isPro: false, text: "1.2L turbo 3-cyl is small for highway loads.", weight: 1 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "buick", slug: "envision", name: "Envision", bodyStyle: "Compact SUV",
    segment: "Compact luxury SUV", startingMsrpCad: 41599,
    ownership: {
      year: 2026, tireFrontSize: "235/55R19", estTireSetCad: 1300,
      oilType: "0W-20 dexos1 Gen3", oilCapacityL: 4.7, estOilChangeCad: 110,
      oilChangeIntervalKm: 12000, brakeJobFrontCad: 540, brakeJobRearCad: 470,
      dealerLabourRateCad: 160, indieLabourRateCad: 120, fiveYearOwnershipCostCad: 36000,
    },
    prosCons: [
      { isPro: true, text: "Quiet-tuned cabin is signature Buick.", weight: 2 },
      { isPro: false, text: "No hybrid option.", weight: 2 },
    ],
    commonIssues: [],
  },

  // ============================ Cadillac ============================
  {
    brandSlug: "cadillac", slug: "xt5", name: "XT5", bodyStyle: "Midsize SUV",
    segment: "Midsize luxury SUV", startingMsrpCad: 56998,
    ownership: {
      year: 2026, tireFrontSize: "235/60R18", estTireSetCad: 1500,
      oilType: "0W-20 dexos1 Gen3", oilCapacityL: 5.7, estOilChangeCad: 140,
      oilChangeIntervalKm: 12000, brakeJobFrontCad: 720, brakeJobRearCad: 640,
      dealerLabourRateCad: 175, indieLabourRateCad: 130, fiveYearOwnershipCostCad: 46000,
    },
    prosCons: [
      { isPro: true, text: "3.6L V6 still available — increasingly rare.", weight: 1 },
      { isPro: false, text: "Resale weak vs RX / GLE.", weight: 3 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "cadillac", slug: "lyriq", name: "Lyriq", bodyStyle: "Midsize SUV (BEV)",
    segment: "Electric luxury SUV", startingMsrpCad: 70998,
    ownership: {
      year: 2026, tireFrontSize: "265/50R20", estTireSetCad: 1700,
      oilType: "n/a — BEV", estOilChangeCad: 0,
      brakeJobFrontCad: 720, brakeJobRearCad: 640,
      dealerLabourRateCad: 175, indieLabourRateCad: 135, fiveYearOwnershipCostCad: 32000,
    },
    prosCons: [
      { isPro: true, text: "33-inch OLED display + Super Cruise.", weight: 3 },
      { isPro: true, text: "$5,000 federal iZEV eligible (verify trim).", weight: 3 },
      { isPro: false, text: "Early-build software glitches widely reported.", weight: 2 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "cadillac", slug: "escalade", name: "Escalade", bodyStyle: "Full-size SUV",
    segment: "Full-size luxury SUV", startingMsrpCad: 105998,
    ownership: {
      year: 2026, tireFrontSize: "285/45R22", estTireSetCad: 2500,
      oilType: "0W-20 dexos1 Gen3", oilCapacityL: 7.6, estOilChangeCad: 180,
      oilChangeIntervalKm: 12000, brakeJobFrontCad: 1000, brakeJobRearCad: 900,
      dealerLabourRateCad: 175, indieLabourRateCad: 135, fiveYearOwnershipCostCad: 68000,
    },
    prosCons: [
      { isPro: true, text: "55-inch OLED dash + Super Cruise hands-free.", weight: 3 },
      { isPro: true, text: "Available 3.0L diesel.", weight: 1 },
      { isPro: false, text: "Escalade IQ (full BEV) is a separate product if you want electric.", weight: 1 },
    ],
    commonIssues: [],
  },

  // ============================ Jeep ============================
  {
    brandSlug: "jeep", slug: "wrangler", name: "Wrangler", bodyStyle: "Body-on-frame SUV",
    segment: "Off-road SUV", startingMsrpCad: 43995,
    notesMd: "4xe PHEV variant available — only PHEV in the segment with real Rubicon hardware.",
    ownership: {
      year: 2026, tireFrontSize: "255/75R17", estTireSetCad: 1500,
      oilType: "0W-20 synthetic", oilCapacityL: 5.7, estOilChangeCad: 120,
      oilChangeIntervalKm: 12000, brakeJobFrontCad: 600, brakeJobRearCad: 540,
      dealerLabourRateCad: 160, indieLabourRateCad: 120, fiveYearOwnershipCostCad: 42000,
    },
    prosCons: [
      { isPro: true, text: "Strongest resale in the Stellantis lineup.", weight: 3 },
      { isPro: true, text: "4xe PHEV (~35 km EV range) + locking diffs + sway-bar disconnect.", weight: 3 },
      { isPro: false, text: "On-road manners trail every unibody competitor.", weight: 2 },
    ],
    commonIssues: [
      { title: "Death wobble (steering wobble on impact)", severity: "MEDIUM", yearsAffected: [2018, 2019, 2020, 2021, 2022], mentionCount: 110,
        description: "Wrangler JL owners report a steering-system wobble triggered by bumps at highway speed. Jeep has issued multiple TSBs (steering damper, track bar). 2024+ builds with revised steering box are improved.", status: "TSB" },
    ],
  },
  {
    brandSlug: "jeep", slug: "grand-cherokee", name: "Grand Cherokee", bodyStyle: "Midsize SUV",
    segment: "Midsize SUV", startingMsrpCad: 50295,
    ownership: {
      year: 2026, tireFrontSize: "265/60R18", estTireSetCad: 1500,
      oilType: "0W-20 synthetic", oilCapacityL: 5.7, estOilChangeCad: 120,
      oilChangeIntervalKm: 12000, brakeJobFrontCad: 640, brakeJobRearCad: 560,
      dealerLabourRateCad: 160, indieLabourRateCad: 120, fiveYearOwnershipCostCad: 46000,
    },
    prosCons: [
      { isPro: true, text: "4xe PHEV variant; 3-row L variant for family use.", weight: 2 },
      { isPro: true, text: "Air suspension on top trims.", weight: 2 },
      { isPro: false, text: "Stellantis reliability ranks bottom-third in surveys.", weight: 2 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "jeep", slug: "compass", name: "Compass", bodyStyle: "Compact SUV",
    segment: "Compact SUV", startingMsrpCad: 34995,
    ownership: {
      year: 2026, tireFrontSize: "225/55R18", estTireSetCad: 1100,
      oilType: "0W-20 synthetic", oilCapacityL: 4.7, estOilChangeCad: 105,
      oilChangeIntervalKm: 12000, brakeJobFrontCad: 520, brakeJobRearCad: 460,
      dealerLabourRateCad: 160, indieLabourRateCad: 115, fiveYearOwnershipCostCad: 36000,
    },
    prosCons: [
      { isPro: true, text: "Genuine off-road option in the compact-SUV segment (Trailhawk).", weight: 2 },
      { isPro: false, text: "Cabin and tech trail Korean / Japanese rivals.", weight: 3 },
    ],
    commonIssues: [],
  },

  // ============================ Dodge ============================
  {
    brandSlug: "dodge", slug: "hornet", name: "Hornet", bodyStyle: "Compact SUV",
    segment: "Compact SUV", startingMsrpCad: 39995,
    ownership: {
      year: 2026, tireFrontSize: "225/55R18", estTireSetCad: 1100,
      oilType: "0W-20 synthetic", oilCapacityL: 4.4, estOilChangeCad: 105,
      oilChangeIntervalKm: 12000, brakeJobFrontCad: 540, brakeJobRearCad: 460,
      dealerLabourRateCad: 155, indieLabourRateCad: 115, fiveYearOwnershipCostCad: 36000,
    },
    prosCons: [
      { isPro: true, text: "R/T PHEV variant (288 hp combined, ~52 km EV).", weight: 3 },
      { isPro: false, text: "Twin of Alfa Romeo Tonale — early-build reliability questions.", weight: 2 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "dodge", slug: "charger", name: "Charger", bodyStyle: "Sedan / Coupe (BEV)",
    segment: "Electric performance", startingMsrpCad: 71995,
    notesMd: "Reborn for 2025 — Daytona BEV launches first (Daytona Scat Pack: 670 hp), inline-6 SIXPACK gas version follows.",
    ownership: {
      year: 2026, tireFrontSize: "245/45R20", estTireSetCad: 1800,
      oilType: "n/a — BEV", estOilChangeCad: 0,
      brakeJobFrontCad: 800, brakeJobRearCad: 700,
      dealerLabourRateCad: 160, indieLabourRateCad: 130, fiveYearOwnershipCostCad: 38000,
    },
    prosCons: [
      { isPro: true, text: "Fratzonic exhaust chamber simulates V8 sound.", weight: 2 },
      { isPro: true, text: "$5,000 federal iZEV eligible (verify trim).", weight: 3 },
      { isPro: false, text: "EV-only at launch — gas version pushed back.", weight: 2 },
    ],
    commonIssues: [],
  },

  // ============================ Chrysler ============================
  {
    brandSlug: "chrysler", slug: "pacifica", name: "Pacifica", bodyStyle: "Minivan",
    segment: "Minivan", startingMsrpCad: 50795,
    notesMd: "Available as gas or Pacifica Hybrid (PHEV, ~51 km electric range). Only minivan PHEV in Canada.",
    ownership: {
      year: 2026, tireFrontSize: "235/60R18", estTireSetCad: 1300,
      oilType: "0W-20 synthetic", oilCapacityL: 5.7, estOilChangeCad: 120,
      oilChangeIntervalKm: 12000, brakeJobFrontCad: 600, brakeJobRearCad: 520,
      dealerLabourRateCad: 160, indieLabourRateCad: 120, fiveYearOwnershipCostCad: 42000,
    },
    prosCons: [
      { isPro: true, text: "Only PHEV minivan in Canada — full iZEV eligibility.", weight: 3 },
      { isPro: true, text: "Stow 'n Go 2nd-row seats stay best-in-class for utility.", weight: 2 },
      { isPro: false, text: "FWD only — Sienna is the only AWD minivan.", weight: 3 },
    ],
    commonIssues: [],
  },

  // ============================ Audi ============================
  {
    brandSlug: "audi", slug: "a4", name: "A4", bodyStyle: "Sedan",
    segment: "Compact luxury sedan", startingMsrpCad: 51100,
    ownership: {
      year: 2026, tireFrontSize: "245/40R18", estTireSetCad: 1500,
      oilType: "0W-20 Audi spec", oilCapacityL: 6.0, estOilChangeCad: 180,
      oilChangeIntervalKm: 16000, brakeJobFrontCad: 800, brakeJobRearCad: 700,
      dealerLabourRateCad: 200, indieLabourRateCad: 155, fiveYearOwnershipCostCad: 44000,
    },
    prosCons: [
      { isPro: true, text: "Quattro AWD standard.", weight: 2 },
      { isPro: false, text: "Out-of-warranty repair costs run high.", weight: 2 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "audi", slug: "q5", name: "Q5", bodyStyle: "Compact SUV",
    segment: "Compact luxury SUV", startingMsrpCad: 54550,
    ownership: {
      year: 2026, tireFrontSize: "235/55R19", estTireSetCad: 1500,
      oilType: "0W-20 Audi spec", oilCapacityL: 6.0, estOilChangeCad: 180,
      oilChangeIntervalKm: 16000, brakeJobFrontCad: 820, brakeJobRearCad: 720,
      dealerLabourRateCad: 200, indieLabourRateCad: 155, fiveYearOwnershipCostCad: 46000,
    },
    prosCons: [
      { isPro: true, text: "Quattro AWD standard; PHEV variant available.", weight: 2 },
      { isPro: false, text: "Pricier than X3 / GLC base trim.", weight: 1 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "audi", slug: "q6-e-tron", name: "Q6 e-tron", bodyStyle: "Midsize SUV (BEV)",
    segment: "Electric luxury SUV", startingMsrpCad: 79900,
    ownership: {
      year: 2026, tireFrontSize: "255/55R19", estTireSetCad: 1700,
      oilType: "n/a — BEV", estOilChangeCad: 0,
      brakeJobFrontCad: 850, brakeJobRearCad: 750,
      dealerLabourRateCad: 200, indieLabourRateCad: 155, fiveYearOwnershipCostCad: 34000,
    },
    prosCons: [
      { isPro: true, text: "800V architecture (fast DC charging).", weight: 3 },
      { isPro: true, text: "Built on the PPE platform shared with Porsche Macan EV.", weight: 2 },
    ],
    commonIssues: [],
  },

  // ============================ Porsche ============================
  {
    brandSlug: "porsche", slug: "macan", name: "Macan / Macan EV", bodyStyle: "Compact SUV (gas + BEV)",
    segment: "Compact luxury SUV", startingMsrpCad: 80500,
    notesMd: "Gas Macan continues into 2025/2026 alongside the all-new Macan EV (PPE platform, ~575 km range).",
    ownership: {
      year: 2026, tireFrontSize: "265/45R20", estTireSetCad: 2200,
      oilType: "0W-40 Porsche spec", oilCapacityL: 8.0, estOilChangeCad: 250,
      oilChangeIntervalKm: 16000, brakeJobFrontCad: 1200, brakeJobRearCad: 1000,
      dealerLabourRateCad: 220, indieLabourRateCad: 175, fiveYearOwnershipCostCad: 54000,
    },
    prosCons: [
      { isPro: true, text: "Best-driving compact luxury SUV by a wide margin.", weight: 3 },
      { isPro: true, text: "Macan EV qualifies for federal iZEV (verify trim cap).", weight: 2 },
      { isPro: false, text: "Options inflation — base car is mid-$80s, optioned $110k+.", weight: 2 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "porsche", slug: "911", name: "911", bodyStyle: "Coupe / Convertible",
    segment: "Sports car", startingMsrpCad: 144500,
    ownership: {
      year: 2026, tireFrontSize: "245/35R20", tireRearSize: "305/30R21", estTireSetCad: 3000,
      oilType: "0W-40 Porsche spec", oilCapacityL: 8.5, estOilChangeCad: 280,
      oilChangeIntervalKm: 16000, brakeJobFrontCad: 1800, brakeJobRearCad: 1500,
      dealerLabourRateCad: 225, indieLabourRateCad: 180, fiveYearOwnershipCostCad: 70000,
    },
    prosCons: [
      { isPro: true, text: "Best new-car resale value in the entire industry.", weight: 3 },
      { isPro: true, text: "T-Hybrid 911 GTS (2025) is the first hybrid 911 — 532 hp.", weight: 3 },
      { isPro: false, text: "Cayman / Boxman are gone for 2025-26 (EV replacements delayed).", weight: 1 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "porsche", slug: "taycan", name: "Taycan", bodyStyle: "Sedan (BEV)",
    segment: "Electric sports sedan", startingMsrpCad: 119900,
    ownership: {
      year: 2026, tireFrontSize: "245/45R20", estTireSetCad: 2400,
      oilType: "n/a — BEV", estOilChangeCad: 0,
      brakeJobFrontCad: 1500, brakeJobRearCad: 1300,
      dealerLabourRateCad: 225, indieLabourRateCad: 180, fiveYearOwnershipCostCad: 50000,
    },
    prosCons: [
      { isPro: true, text: "800V — fastest DC fast-charging in production.", weight: 3 },
      { isPro: true, text: "Turbo GT is the lap-record holder at multiple tracks.", weight: 2 },
      { isPro: false, text: "Range trails Lucid Air / Tesla Model S.", weight: 2 },
    ],
    commonIssues: [],
  },

  // ============================ MINI ============================
  {
    brandSlug: "mini", slug: "cooper", name: "Cooper", bodyStyle: "Hatchback",
    segment: "Subcompact", startingMsrpCad: 32990,
    ownership: {
      year: 2026, tireFrontSize: "195/55R16", estTireSetCad: 1000,
      oilType: "0W-20 BMW spec", oilCapacityL: 4.5, estOilChangeCad: 160,
      oilChangeIntervalKm: 16000, brakeJobFrontCad: 600, brakeJobRearCad: 520,
      dealerLabourRateCad: 195, indieLabourRateCad: 145, fiveYearOwnershipCostCad: 32000,
    },
    prosCons: [
      { isPro: true, text: "All-new 2025 design with simplified OLED-only cabin.", weight: 2 },
      { isPro: true, text: "Cooper SE (BEV) variant is the EV option.", weight: 2 },
      { isPro: false, text: "Rear seat is token even by subcompact standards.", weight: 2 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "mini", slug: "countryman", name: "Countryman", bodyStyle: "Subcompact SUV",
    segment: "Subcompact SUV", startingMsrpCad: 41990,
    ownership: {
      year: 2026, tireFrontSize: "225/55R18", estTireSetCad: 1200,
      oilType: "0W-20 BMW spec", oilCapacityL: 4.5, estOilChangeCad: 170,
      oilChangeIntervalKm: 16000, brakeJobFrontCad: 640, brakeJobRearCad: 560,
      dealerLabourRateCad: 195, indieLabourRateCad: 145, fiveYearOwnershipCostCad: 36000,
    },
    prosCons: [
      { isPro: true, text: "Countryman SE (BEV) all-electric variant.", weight: 2 },
      { isPro: false, text: "Cargo and rear seat smaller than BMW X1 (shared platform).", weight: 2 },
    ],
    commonIssues: [],
  },

  // ============================ Volvo ============================
  {
    brandSlug: "volvo", slug: "xc60", name: "XC60", bodyStyle: "Compact SUV",
    segment: "Compact luxury SUV", startingMsrpCad: 57950,
    ownership: {
      year: 2026, tireFrontSize: "235/55R19", estTireSetCad: 1500,
      oilType: "0W-20 synthetic", oilCapacityL: 5.5, estOilChangeCad: 170,
      oilChangeIntervalKm: 16000, brakeJobFrontCad: 720, brakeJobRearCad: 640,
      dealerLabourRateCad: 185, indieLabourRateCad: 145, fiveYearOwnershipCostCad: 46000,
    },
    prosCons: [
      { isPro: true, text: "Recharge T8 PHEV (~58 km EV range, 455 hp).", weight: 3 },
      { isPro: true, text: "Class-leading active safety baked in across all trims.", weight: 2 },
      { isPro: false, text: "Cabin design simpler than German peers, intentionally minimal.", weight: 1 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "volvo", slug: "xc90", name: "XC90", bodyStyle: "Midsize SUV (3-row)",
    segment: "Midsize 3-row luxury SUV", startingMsrpCad: 75450,
    ownership: {
      year: 2026, tireFrontSize: "265/45R21", estTireSetCad: 1900,
      oilType: "0W-20 synthetic", oilCapacityL: 5.5, estOilChangeCad: 180,
      oilChangeIntervalKm: 16000, brakeJobFrontCad: 800, brakeJobRearCad: 700,
      dealerLabourRateCad: 185, indieLabourRateCad: 145, fiveYearOwnershipCostCad: 52000,
    },
    prosCons: [
      { isPro: true, text: "Recharge T8 PHEV variant (~52 km EV range).", weight: 3 },
      { isPro: true, text: "Refreshed for 2025 — keeps the 2015 design DNA but bigger screens.", weight: 2 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "volvo", slug: "ex30", name: "EX30", bodyStyle: "Subcompact SUV (BEV)",
    segment: "Electric subcompact SUV", startingMsrpCad: 53400,
    ownership: {
      year: 2026, tireFrontSize: "225/55R19", estTireSetCad: 1400,
      oilType: "n/a — BEV", estOilChangeCad: 0,
      brakeJobFrontCad: 620, brakeJobRearCad: 540,
      dealerLabourRateCad: 185, indieLabourRateCad: 145, fiveYearOwnershipCostCad: 28000,
    },
    prosCons: [
      { isPro: true, text: "Most affordable Volvo + $5,000 iZEV eligible (verify).", weight: 3 },
      { isPro: false, text: "All controls live on the central touchscreen — no driver display.", weight: 2 },
    ],
    commonIssues: [],
  },

  // ============================ Polestar ============================
  {
    brandSlug: "polestar", slug: "polestar-2", name: "Polestar 2", bodyStyle: "Sedan (BEV)",
    segment: "Electric sedan", startingMsrpCad: 56900,
    ownership: {
      year: 2026, tireFrontSize: "245/45R19", estTireSetCad: 1400,
      oilType: "n/a — BEV", estOilChangeCad: 0,
      brakeJobFrontCad: 700, brakeJobRearCad: 620,
      dealerLabourRateCad: 185, indieLabourRateCad: 150, fiveYearOwnershipCostCad: 28000,
    },
    prosCons: [
      { isPro: true, text: "Google built-in OS is the best in-car Android Auto experience.", weight: 2 },
      { isPro: true, text: "Long Range Single Motor variant: ~526 km range.", weight: 3 },
      { isPro: false, text: "Service handled through Volvo dealer network — limited Polestar-specific support.", weight: 2 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "polestar", slug: "polestar-3", name: "Polestar 3", bodyStyle: "Midsize SUV (BEV)",
    segment: "Electric luxury SUV", startingMsrpCad: 92900,
    ownership: {
      year: 2026, tireFrontSize: "265/45R21", estTireSetCad: 1800,
      oilType: "n/a — BEV", estOilChangeCad: 0,
      brakeJobFrontCad: 800, brakeJobRearCad: 700,
      dealerLabourRateCad: 185, indieLabourRateCad: 150, fiveYearOwnershipCostCad: 34000,
    },
    prosCons: [
      { isPro: true, text: "517 hp dual motor, ~480 km range.", weight: 2 },
      { isPro: false, text: "Pricing collides with Porsche Macan EV / X5.", weight: 2 },
    ],
    commonIssues: [],
  },

  // ============================ Land Rover ============================
  {
    brandSlug: "land-rover", slug: "defender", name: "Defender", bodyStyle: "Body-on-frame SUV",
    segment: "Midsize off-road SUV", startingMsrpCad: 73500,
    ownership: {
      year: 2026, tireFrontSize: "255/65R19", estTireSetCad: 1900,
      oilType: "0W-20 synthetic", oilCapacityL: 7.0, estOilChangeCad: 200,
      oilChangeIntervalKm: 16000, brakeJobFrontCad: 900, brakeJobRearCad: 800,
      dealerLabourRateCad: 205, indieLabourRateCad: 165, fiveYearOwnershipCostCad: 58000,
    },
    prosCons: [
      { isPro: true, text: "Genuine off-road capability + actually-modern interior.", weight: 3 },
      { isPro: false, text: "JLR reliability remains the achilles heel — bottom-third in surveys.", weight: 3 },
      { isPro: false, text: "Out-of-warranty repair costs are very high.", weight: 2 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "land-rover", slug: "range-rover", name: "Range Rover", bodyStyle: "Midsize SUV",
    segment: "Full-size luxury SUV", startingMsrpCad: 137500,
    ownership: {
      year: 2026, tireFrontSize: "275/50R22", estTireSetCad: 2400,
      oilType: "0W-20 synthetic", oilCapacityL: 7.5, estOilChangeCad: 220,
      oilChangeIntervalKm: 16000, brakeJobFrontCad: 1100, brakeJobRearCad: 950,
      dealerLabourRateCad: 215, indieLabourRateCad: 170, fiveYearOwnershipCostCad: 78000,
    },
    prosCons: [
      { isPro: true, text: "PHEV variant: ~88 km EV range — class-leading.", weight: 3 },
      { isPro: false, text: "Worst-in-class reliability scores.", weight: 3 },
    ],
    commonIssues: [],
  },

  // ============================ Jaguar ============================
  {
    brandSlug: "jaguar", slug: "f-pace", name: "F-PACE", bodyStyle: "Midsize SUV",
    segment: "Midsize luxury SUV", startingMsrpCad: 65000,
    ownership: {
      year: 2026, tireFrontSize: "255/55R20", estTireSetCad: 1700,
      oilType: "0W-20 synthetic", oilCapacityL: 6.5, estOilChangeCad: 200,
      oilChangeIntervalKm: 16000, brakeJobFrontCad: 800, brakeJobRearCad: 700,
      dealerLabourRateCad: 200, indieLabourRateCad: 160, fiveYearOwnershipCostCad: 50000,
    },
    prosCons: [
      { isPro: true, text: "F-PACE SVR (550 hp supercharged V8) is a unicorn.", weight: 2 },
      { isPro: false, text: "Brand pivoting all-EV ultra-luxury for 2026+ — F-PACE wind-down.", weight: 2 },
    ],
    commonIssues: [],
  },

  // ============================ Rivian ============================
  {
    brandSlug: "rivian", slug: "r1t", name: "R1T", bodyStyle: "Full-size Pickup (BEV)",
    segment: "Electric truck", startingMsrpCad: 105000,
    ownership: {
      year: 2026, tireFrontSize: "275/65R20", estTireSetCad: 2200,
      oilType: "n/a — BEV", estOilChangeCad: 0,
      brakeJobFrontCad: 900, brakeJobRearCad: 800,
      dealerLabourRateCad: 185, indieLabourRateCad: 160, fiveYearOwnershipCostCad: 36000,
    },
    prosCons: [
      { isPro: true, text: "Quad-motor: 835 hp / 908 lb-ft.", weight: 3 },
      { isPro: true, text: "Tank turn, hydraulic anti-roll, gear tunnel — genuinely innovative.", weight: 3 },
      { isPro: false, text: "Service is sparse — service rangers travel in some areas.", weight: 3 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "rivian", slug: "r1s", name: "R1S", bodyStyle: "Full-size SUV (BEV)",
    segment: "Electric SUV", startingMsrpCad: 110000,
    ownership: {
      year: 2026, tireFrontSize: "275/65R20", estTireSetCad: 2200,
      oilType: "n/a — BEV", estOilChangeCad: 0,
      brakeJobFrontCad: 900, brakeJobRearCad: 800,
      dealerLabourRateCad: 185, indieLabourRateCad: 160, fiveYearOwnershipCostCad: 36000,
    },
    prosCons: [
      { isPro: true, text: "7-seat full-size SUV — only EV alternative to Escalade IQ in this size.", weight: 3 },
      { isPro: false, text: "Same sparse-service caveat as R1T.", weight: 3 },
    ],
    commonIssues: [],
  },

  // ============================ Lucid ============================
  {
    brandSlug: "lucid", slug: "air", name: "Air", bodyStyle: "Sedan (BEV)",
    segment: "Electric luxury sedan", startingMsrpCad: 99000,
    ownership: {
      year: 2026, tireFrontSize: "245/45R19", estTireSetCad: 1800,
      oilType: "n/a — BEV", estOilChangeCad: 0,
      brakeJobFrontCad: 1000, brakeJobRearCad: 900,
      dealerLabourRateCad: 200, indieLabourRateCad: 170, fiveYearOwnershipCostCad: 36000,
    },
    prosCons: [
      { isPro: true, text: "Air Touring achieves ~830+ km EPA range (longest in production).", weight: 3 },
      { isPro: true, text: "Air Sapphire: 1,234 hp / 1,430 lb-ft.", weight: 2 },
      { isPro: false, text: "Service network in Canada is very limited.", weight: 3 },
    ],
    commonIssues: [],
  },

  // ============================ Honda (deepen) ============================
  {
    brandSlug: "honda", slug: "hr-v", name: "HR-V", bodyStyle: "Subcompact SUV",
    segment: "Subcompact SUV", startingMsrpCad: 30970,
    ownership: {
      year: 2026, tireFrontSize: "215/60R17", estTireSetCad: 1000,
      oilType: "0W-20 synthetic", oilCapacityL: 3.7, estOilChangeCad: 85,
      oilChangeIntervalKm: 12000, brakeJobFrontCad: 500, brakeJobRearCad: 440,
      dealerLabourRateCad: 150, indieLabourRateCad: 110, fiveYearOwnershipCostCad: 32000,
    },
    prosCons: [
      { isPro: true, text: "Magic Seat (rear) is unique to Honda subcompacts.", weight: 2 },
      { isPro: false, text: "No hybrid — Corolla Cross Hybrid AWD has no Honda answer.", weight: 3 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "honda", slug: "passport", name: "Passport", bodyStyle: "Midsize SUV",
    segment: "Midsize SUV", startingMsrpCad: 49070,
    notesMd: "Fully redesigned for 2026 — TrailSport gets serious off-road hardware. Hybrid TrailSport rumored.",
    ownership: {
      year: 2026, tireFrontSize: "265/65R18", estTireSetCad: 1400,
      oilType: "0W-20 synthetic", oilCapacityL: 4.3, estOilChangeCad: 110,
      oilChangeIntervalKm: 12000, brakeJobFrontCad: 600, brakeJobRearCad: 520,
      dealerLabourRateCad: 160, indieLabourRateCad: 120, fiveYearOwnershipCostCad: 44000,
    },
    prosCons: [
      { isPro: true, text: "TrailSport trim has 31-inch all-terrain tires + Trail-tuned suspension.", weight: 3 },
      { isPro: false, text: "No hybrid for 2025 (2026 TBD).", weight: 2 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "honda", slug: "ridgeline", name: "Ridgeline", bodyStyle: "Midsize Pickup",
    segment: "Midsize truck", startingMsrpCad: 46870,
    ownership: {
      year: 2026, tireFrontSize: "245/60R18", estTireSetCad: 1300,
      oilType: "0W-20 synthetic", oilCapacityL: 4.3, estOilChangeCad: 110,
      oilChangeIntervalKm: 12000, brakeJobFrontCad: 600, brakeJobRearCad: 520,
      dealerLabourRateCad: 160, indieLabourRateCad: 120, fiveYearOwnershipCostCad: 42000,
    },
    prosCons: [
      { isPro: true, text: "Unibody construction = best on-road ride in segment.", weight: 3 },
      { isPro: true, text: "In-bed trunk + dual-action tailgate.", weight: 2 },
      { isPro: false, text: "Towing capped at 5,000 lb vs Tacoma's 6,400 lb.", weight: 2 },
    ],
    commonIssues: [],
  },

  // ============================ Mazda (deepen) ============================
  {
    brandSlug: "mazda", slug: "cx-30", name: "CX-30", bodyStyle: "Subcompact SUV",
    segment: "Subcompact SUV", startingMsrpCad: 26450,
    ownership: {
      year: 2026, tireFrontSize: "215/55R18", estTireSetCad: 1000,
      oilType: "0W-20 synthetic", oilCapacityL: 4.5, estOilChangeCad: 100,
      oilChangeIntervalKm: 12000, brakeJobFrontCad: 500, brakeJobRearCad: 440,
      dealerLabourRateCad: 150, indieLabourRateCad: 110, fiveYearOwnershipCostCad: 32000,
    },
    prosCons: [
      { isPro: true, text: "Standard AWD even on the base trim.", weight: 3 },
      { isPro: true, text: "Class-leading interior materials.", weight: 2 },
      { isPro: false, text: "Cargo space tight.", weight: 1 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "mazda", slug: "cx-70", name: "CX-70", bodyStyle: "Midsize SUV",
    segment: "Midsize SUV", startingMsrpCad: 49950,
    notesMd: "2-row sibling to CX-90 (RWD-biased, inline-6 turbo or PHEV).",
    ownership: {
      year: 2026, tireFrontSize: "265/55R19", estTireSetCad: 1500,
      oilType: "0W-20 synthetic", oilCapacityL: 6.0, estOilChangeCad: 130,
      oilChangeIntervalKm: 12000, brakeJobFrontCad: 640, brakeJobRearCad: 560,
      dealerLabourRateCad: 155, indieLabourRateCad: 120, fiveYearOwnershipCostCad: 44000,
    },
    prosCons: [
      { isPro: true, text: "Inline-6 turbo (340 hp) or PHEV powertrain.", weight: 2 },
      { isPro: false, text: "Only meaningful difference vs CX-90 is the missing 3rd row.", weight: 1 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "mazda", slug: "mx-5", name: "MX-5 Miata", bodyStyle: "Roadster",
    segment: "Sports car", startingMsrpCad: 38250,
    ownership: {
      year: 2026, tireFrontSize: "205/45R17", estTireSetCad: 1100,
      oilType: "0W-20 synthetic", oilCapacityL: 4.0, estOilChangeCad: 95,
      oilChangeIntervalKm: 12000, brakeJobFrontCad: 540, brakeJobRearCad: 480,
      dealerLabourRateCad: 150, indieLabourRateCad: 115, fiveYearOwnershipCostCad: 32000,
    },
    prosCons: [
      { isPro: true, text: "Best driver's car under $50k in Canada.", weight: 3 },
      { isPro: true, text: "RF retractable hardtop variant adds year-round usability.", weight: 2 },
      { isPro: false, text: "Two seats; tiny trunk; no real winter use.", weight: 2 },
    ],
    commonIssues: [],
  },

  // ============================ Hyundai (deepen) ============================
  {
    brandSlug: "hyundai", slug: "kona", name: "Kona", bodyStyle: "Subcompact SUV",
    segment: "Subcompact SUV", startingMsrpCad: 25999,
    ownership: {
      year: 2026, tireFrontSize: "215/55R17", estTireSetCad: 1000,
      oilType: "5W-30 synthetic", oilCapacityL: 4.0, estOilChangeCad: 85,
      oilChangeIntervalKm: 12000, brakeJobFrontCad: 480, brakeJobRearCad: 420,
      dealerLabourRateCad: 145, indieLabourRateCad: 105, fiveYearOwnershipCostCad: 30000,
    },
    prosCons: [
      { isPro: true, text: "Available BEV variant (Kona Electric).", weight: 2 },
      { isPro: true, text: "5-yr / 100,000 km warranty.", weight: 3 },
      { isPro: false, text: "No hybrid variant in Canada.", weight: 2 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "hyundai", slug: "santa-fe", name: "Santa Fe", bodyStyle: "Midsize SUV (3-row)",
    segment: "Midsize 3-row SUV", startingMsrpCad: 39499,
    notesMd: "All-new boxy design for 2024+; XRT trim adds off-road styling.",
    ownership: {
      year: 2026, tireFrontSize: "235/60R18", estTireSetCad: 1300,
      oilType: "5W-30 synthetic", oilCapacityL: 4.5, estOilChangeCad: 105,
      oilChangeIntervalKm: 12000, brakeJobFrontCad: 580, brakeJobRearCad: 500,
      dealerLabourRateCad: 145, indieLabourRateCad: 110, fiveYearOwnershipCostCad: 40000,
    },
    prosCons: [
      { isPro: true, text: "Hybrid variant available.", weight: 3 },
      { isPro: true, text: "3rd row + cargo box / fridge in top trims.", weight: 2 },
      { isPro: false, text: "Tow rating capped at 3,500 lb.", weight: 1 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "hyundai", slug: "palisade", name: "Palisade", bodyStyle: "Midsize SUV (3-row)",
    segment: "Midsize 3-row SUV", startingMsrpCad: 49799,
    ownership: {
      year: 2026, tireFrontSize: "245/60R18", estTireSetCad: 1500,
      oilType: "5W-30 synthetic", oilCapacityL: 5.7, estOilChangeCad: 115,
      oilChangeIntervalKm: 12000, brakeJobFrontCad: 640, brakeJobRearCad: 560,
      dealerLabourRateCad: 145, indieLabourRateCad: 110, fiveYearOwnershipCostCad: 44000,
    },
    prosCons: [
      { isPro: true, text: "Best-in-class 3rd-row room (with Telluride).", weight: 3 },
      { isPro: true, text: "5-yr warranty.", weight: 3 },
      { isPro: false, text: "No hybrid option.", weight: 3 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "hyundai", slug: "ioniq-6", name: "IONIQ 6", bodyStyle: "Sedan (BEV)",
    segment: "Electric sedan", startingMsrpCad: 56999,
    ownership: {
      year: 2026, tireFrontSize: "245/40R20", estTireSetCad: 1500,
      oilType: "n/a — BEV", estOilChangeCad: 0,
      brakeJobFrontCad: 580, brakeJobRearCad: 500,
      dealerLabourRateCad: 150, indieLabourRateCad: 120, fiveYearOwnershipCostCad: 26000,
    },
    prosCons: [
      { isPro: true, text: "~582 km range — best in class for the price.", weight: 3 },
      { isPro: true, text: "800V architecture, ~18 min 10-80%.", weight: 3 },
      { isPro: false, text: "Sedan body style limits cargo vs IONIQ 5.", weight: 1 },
    ],
    commonIssues: [],
  },

  // ============================ Kia (deepen) ============================
  {
    brandSlug: "kia", slug: "ev9", name: "EV9", bodyStyle: "Midsize SUV (BEV, 3-row)",
    segment: "Electric 3-row SUV", startingMsrpCad: 64995,
    ownership: {
      year: 2026, tireFrontSize: "255/60R20", estTireSetCad: 1700,
      oilType: "n/a — BEV", estOilChangeCad: 0,
      brakeJobFrontCad: 700, brakeJobRearCad: 620,
      dealerLabourRateCad: 150, indieLabourRateCad: 120, fiveYearOwnershipCostCad: 32000,
    },
    prosCons: [
      { isPro: true, text: "Only EV in Canada with proper 3 rows under $80k.", weight: 3 },
      { isPro: true, text: "800V; ~480 km range RWD.", weight: 3 },
      { isPro: false, text: "ICCU recall lineage also applies.", weight: 1 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "kia", slug: "carnival", name: "Carnival", bodyStyle: "Minivan",
    segment: "Minivan", startingMsrpCad: 41995,
    notesMd: "Hybrid variant arrives for 2025+ in Canada.",
    ownership: {
      year: 2026, tireFrontSize: "235/60R18", estTireSetCad: 1300,
      oilType: "5W-30 synthetic", oilCapacityL: 5.7, estOilChangeCad: 110,
      oilChangeIntervalKm: 12000, brakeJobFrontCad: 600, brakeJobRearCad: 520,
      dealerLabourRateCad: 145, indieLabourRateCad: 110, fiveYearOwnershipCostCad: 42000,
    },
    prosCons: [
      { isPro: true, text: "SUV-like styling on a minivan platform.", weight: 2 },
      { isPro: true, text: "Hybrid finally arriving — ~6.8 L/100km combined target.", weight: 3 },
      { isPro: false, text: "FWD only — Sienna remains the only AWD minivan.", weight: 3 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "kia", slug: "niro", name: "Niro", bodyStyle: "Subcompact SUV (Hybrid/PHEV/BEV)",
    segment: "Subcompact SUV", startingMsrpCad: 28995,
    ownership: {
      year: 2026, tireFrontSize: "215/55R17", estTireSetCad: 1100,
      oilType: "5W-30 synthetic", oilCapacityL: 3.7, estOilChangeCad: 90,
      oilChangeIntervalKm: 12000, brakeJobFrontCad: 500, brakeJobRearCad: 440,
      dealerLabourRateCad: 145, indieLabourRateCad: 105, fiveYearOwnershipCostCad: 30000,
    },
    prosCons: [
      { isPro: true, text: "Three powertrains under one badge (HEV, PHEV, BEV).", weight: 3 },
      { isPro: true, text: "Niro Hybrid claims ~5.0 L/100km combined.", weight: 3 },
      { isPro: false, text: "FWD only across all powertrains.", weight: 2 },
    ],
    commonIssues: [],
  },

  // ============================ Subaru (deepen) ============================
  {
    brandSlug: "subaru", slug: "crosstrek", name: "Crosstrek", bodyStyle: "Subcompact SUV",
    segment: "Subcompact SUV", startingMsrpCad: 28995,
    ownership: {
      year: 2026, tireFrontSize: "225/60R17", estTireSetCad: 1100,
      oilType: "0W-20 synthetic", oilCapacityL: 5.1, estOilChangeCad: 100,
      oilChangeIntervalKm: 9600, brakeJobFrontCad: 520, brakeJobRearCad: 460,
      dealerLabourRateCad: 150, indieLabourRateCad: 110, fiveYearOwnershipCostCad: 33000,
    },
    prosCons: [
      { isPro: true, text: "Standard symmetrical AWD + Wilderness trim is genuinely capable.", weight: 3 },
      { isPro: false, text: "No hybrid variant in Canada.", weight: 2 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "subaru", slug: "solterra", name: "Solterra", bodyStyle: "Compact SUV (BEV)",
    segment: "Electric SUV", startingMsrpCad: 53995,
    notesMd: "Sister vehicle to Toyota bZ4X — same platform, Subaru-tuned AWD.",
    ownership: {
      year: 2026, tireFrontSize: "235/60R18", estTireSetCad: 1300,
      oilType: "n/a — BEV", estOilChangeCad: 0,
      brakeJobFrontCad: 580, brakeJobRearCad: 500,
      dealerLabourRateCad: 150, indieLabourRateCad: 120, fiveYearOwnershipCostCad: 28000,
    },
    prosCons: [
      { isPro: true, text: "Standard AWD on every trim.", weight: 3 },
      { isPro: false, text: "Same range trail vs Ioniq 5 / Model Y as the bZ4X.", weight: 2 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "subaru", slug: "wrx", name: "WRX", bodyStyle: "Sedan",
    segment: "Sport compact", startingMsrpCad: 35995,
    ownership: {
      year: 2026, tireFrontSize: "245/40R18", estTireSetCad: 1400,
      oilType: "0W-20 synthetic", oilCapacityL: 5.4, estOilChangeCad: 110,
      oilChangeIntervalKm: 9600, brakeJobFrontCad: 600, brakeJobRearCad: 520,
      dealerLabourRateCad: 150, indieLabourRateCad: 115, fiveYearOwnershipCostCad: 36000,
    },
    prosCons: [
      { isPro: true, text: "271 hp turbo boxer + standard AWD + 6-spd MT.", weight: 3 },
      { isPro: true, text: "tS variant: STI-grade brakes, dampers, no auto option.", weight: 2 },
      { isPro: false, text: "No STI variant on this generation (yet).", weight: 2 },
    ],
    commonIssues: [],
  },

  // ============================ Nissan (deepen) ============================
  {
    brandSlug: "nissan", slug: "pathfinder", name: "Pathfinder", bodyStyle: "Midsize SUV (3-row)",
    segment: "Midsize 3-row SUV", startingMsrpCad: 47398,
    ownership: {
      year: 2026, tireFrontSize: "255/60R18", estTireSetCad: 1400,
      oilType: "0W-20 synthetic", oilCapacityL: 5.2, estOilChangeCad: 110,
      oilChangeIntervalKm: 8000, brakeJobFrontCad: 580, brakeJobRearCad: 500,
      dealerLabourRateCad: 150, indieLabourRateCad: 110, fiveYearOwnershipCostCad: 42000,
    },
    prosCons: [
      { isPro: true, text: "3.5L V6 + 9-spd AT (no CVT).", weight: 2 },
      { isPro: false, text: "No hybrid; Pilot also lacks one but Highlander Hybrid is the obvious cross-shop.", weight: 2 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "nissan", slug: "ariya", name: "Ariya", bodyStyle: "Compact SUV (BEV)",
    segment: "Electric SUV", startingMsrpCad: 53198,
    ownership: {
      year: 2026, tireFrontSize: "235/55R19", estTireSetCad: 1400,
      oilType: "n/a — BEV", estOilChangeCad: 0,
      brakeJobFrontCad: 580, brakeJobRearCad: 500,
      dealerLabourRateCad: 150, indieLabourRateCad: 120, fiveYearOwnershipCostCad: 27000,
    },
    prosCons: [
      { isPro: true, text: "Nissan's first proper EV after the LEAF.", weight: 2 },
      { isPro: false, text: "Range trails Ioniq 5 / EV6 on the same money.", weight: 2 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "nissan", slug: "frontier", name: "Frontier", bodyStyle: "Midsize Pickup",
    segment: "Midsize truck", startingMsrpCad: 41748,
    ownership: {
      year: 2026, tireFrontSize: "265/70R17", estTireSetCad: 1400,
      oilType: "5W-30 synthetic", oilCapacityL: 5.4, estOilChangeCad: 115,
      oilChangeIntervalKm: 8000, brakeJobFrontCad: 600, brakeJobRearCad: 540,
      dealerLabourRateCad: 150, indieLabourRateCad: 110, fiveYearOwnershipCostCad: 42000,
    },
    prosCons: [
      { isPro: true, text: "3.8L V6 (310 hp) is the only non-turbo NA V6 in segment.", weight: 2 },
      { isPro: false, text: "No hybrid; Tacoma i-FORCE MAX is the answer.", weight: 2 },
    ],
    commonIssues: [],
  },

  // ============================ Ford (deepen) ============================
  {
    brandSlug: "ford", slug: "bronco", name: "Bronco", bodyStyle: "Body-on-frame SUV",
    segment: "Off-road SUV", startingMsrpCad: 48995,
    ownership: {
      year: 2026, tireFrontSize: "255/75R17", estTireSetCad: 1500,
      oilType: "5W-30 synthetic", oilCapacityL: 5.7, estOilChangeCad: 120,
      oilChangeIntervalKm: 12000, brakeJobFrontCad: 600, brakeJobRearCad: 520,
      dealerLabourRateCad: 165, indieLabourRateCad: 120, fiveYearOwnershipCostCad: 44000,
    },
    prosCons: [
      { isPro: true, text: "Removable doors and roof + Sasquatch package = legit Wrangler rival.", weight: 3 },
      { isPro: true, text: "Bronco Raptor (418 hp, 37-inch tires) is a desert weapon.", weight: 2 },
      { isPro: false, text: "Hardtop quality has been a recall topic — verify build date.", weight: 2 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "ford", slug: "explorer", name: "Explorer", bodyStyle: "Midsize SUV (3-row)",
    segment: "Midsize 3-row SUV", startingMsrpCad: 49450,
    ownership: {
      year: 2026, tireFrontSize: "255/55R20", estTireSetCad: 1500,
      oilType: "5W-30 synthetic blend", oilCapacityL: 5.4, estOilChangeCad: 120,
      oilChangeIntervalKm: 12000, brakeJobFrontCad: 620, brakeJobRearCad: 540,
      dealerLabourRateCad: 165, indieLabourRateCad: 120, fiveYearOwnershipCostCad: 46000,
    },
    prosCons: [
      { isPro: true, text: "ST-Line / ST trims bring 400 hp twin-turbo V6.", weight: 2 },
      { isPro: false, text: "Hybrid removed from Canadian lineup post-2024.", weight: 3 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "ford", slug: "f-150-lightning", name: "F-150 Lightning", bodyStyle: "Full-size Pickup (BEV)",
    segment: "Electric truck", startingMsrpCad: 67995,
    ownership: {
      year: 2026, tireFrontSize: "275/65R18", estTireSetCad: 1900,
      oilType: "n/a — BEV", estOilChangeCad: 0,
      brakeJobFrontCad: 750, brakeJobRearCad: 660,
      dealerLabourRateCad: 165, indieLabourRateCad: 120, fiveYearOwnershipCostCad: 38000,
    },
    prosCons: [
      { isPro: true, text: "Extended Range: ~515 km EPA, 580 hp.", weight: 3 },
      { isPro: true, text: "ProPower Onboard (9.6 kW generator).", weight: 3 },
      { isPro: false, text: "Battery pack production hiccups have caused price cuts + stock-on-lot fluctuation.", weight: 2 },
    ],
    commonIssues: [],
  },

  // ============================ Chevrolet (deepen) ============================
  {
    brandSlug: "chevrolet", slug: "trax", name: "Trax", bodyStyle: "Subcompact SUV",
    segment: "Subcompact SUV", startingMsrpCad: 24299,
    ownership: {
      year: 2026, tireFrontSize: "215/55R18", estTireSetCad: 1000,
      oilType: "0W-20 dexos1 Gen3", oilCapacityL: 4.0, estOilChangeCad: 95,
      oilChangeIntervalKm: 12000, brakeJobFrontCad: 480, brakeJobRearCad: 420,
      dealerLabourRateCad: 150, indieLabourRateCad: 115, fiveYearOwnershipCostCad: 28000,
    },
    prosCons: [
      { isPro: true, text: "Cheapest new SUV in Canada (verify trim).", weight: 3 },
      { isPro: false, text: "FWD only; 1.2L turbo 3-cyl is small for highway loads.", weight: 2 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "chevrolet", slug: "blazer-ev", name: "Blazer EV", bodyStyle: "Midsize SUV (BEV)",
    segment: "Electric SUV", startingMsrpCad: 59448,
    ownership: {
      year: 2026, tireFrontSize: "255/55R20", estTireSetCad: 1600,
      oilType: "n/a — BEV", estOilChangeCad: 0,
      brakeJobFrontCad: 640, brakeJobRearCad: 560,
      dealerLabourRateCad: 160, indieLabourRateCad: 125, fiveYearOwnershipCostCad: 30000,
    },
    prosCons: [
      { isPro: true, text: "SS trim: 615 hp, 0-100 in 3.7s.", weight: 2 },
      { isPro: false, text: "Early-build software issues caused a stop-sale that's since lifted.", weight: 3 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "chevrolet", slug: "equinox-ev", name: "Equinox EV", bodyStyle: "Compact SUV (BEV)",
    segment: "Electric SUV", startingMsrpCad: 47999,
    ownership: {
      year: 2026, tireFrontSize: "225/55R19", estTireSetCad: 1300,
      oilType: "n/a — BEV", estOilChangeCad: 0,
      brakeJobFrontCad: 540, brakeJobRearCad: 470,
      dealerLabourRateCad: 160, indieLabourRateCad: 125, fiveYearOwnershipCostCad: 28000,
    },
    prosCons: [
      { isPro: true, text: "~510 km range under $50k starting — strongest range/$ value in segment.", weight: 3 },
      { isPro: true, text: "Federal iZEV eligible (verify trim).", weight: 3 },
    ],
    commonIssues: [],
  },

  // ============================ BMW (deepen) ============================
  {
    brandSlug: "bmw", slug: "x1", name: "X1", bodyStyle: "Subcompact SUV",
    segment: "Subcompact luxury SUV", startingMsrpCad: 47100,
    ownership: {
      year: 2026, tireFrontSize: "225/55R18", estTireSetCad: 1400,
      oilType: "0W-20 BMW LL-17+", oilCapacityL: 5.0, estOilChangeCad: 190,
      oilChangeIntervalKm: 16000, brakeJobFrontCad: 800, brakeJobRearCad: 700,
      dealerLabourRateCad: 205, indieLabourRateCad: 160,
      includedMaintenanceMonths: 36, includedMaintenanceKm: 60000,
      fiveYearOwnershipCostCad: 42000,
    },
    prosCons: [
      { isPro: true, text: "iX1 BEV variant available.", weight: 2 },
      { isPro: false, text: "FWD-biased layout (xDrive standard in Canada).", weight: 1 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "bmw", slug: "x5", name: "X5", bodyStyle: "Midsize SUV",
    segment: "Midsize luxury SUV", startingMsrpCad: 81100,
    ownership: {
      year: 2026, tireFrontSize: "265/50R19", estTireSetCad: 1900,
      oilType: "0W-20 BMW LL-17+", oilCapacityL: 6.5, estOilChangeCad: 210,
      oilChangeIntervalKm: 16000, brakeJobFrontCad: 1000, brakeJobRearCad: 900,
      dealerLabourRateCad: 205, indieLabourRateCad: 160,
      includedMaintenanceMonths: 36, includedMaintenanceKm: 60000,
      fiveYearOwnershipCostCad: 56000,
    },
    prosCons: [
      { isPro: true, text: "PHEV variant: ~64 km EV range.", weight: 3 },
      { isPro: true, text: "Inline-6 mild-hybrid is the smoothest 6-cyl in segment.", weight: 2 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "bmw", slug: "3-series", name: "3 Series", bodyStyle: "Sedan",
    segment: "Compact luxury sedan", startingMsrpCad: 53800,
    ownership: {
      year: 2026, tireFrontSize: "225/45R19", estTireSetCad: 1500,
      oilType: "0W-20 BMW LL-17+", oilCapacityL: 6.5, estOilChangeCad: 200,
      oilChangeIntervalKm: 16000, brakeJobFrontCad: 900, brakeJobRearCad: 800,
      dealerLabourRateCad: 205, indieLabourRateCad: 160,
      includedMaintenanceMonths: 36, includedMaintenanceKm: 60000,
      fiveYearOwnershipCostCad: 48000,
    },
    prosCons: [
      { isPro: true, text: "M3 + M3 Touring wagon available in Canada.", weight: 3 },
      { isPro: true, text: "Still the segment benchmark for chassis tuning.", weight: 2 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "bmw", slug: "ix", name: "iX", bodyStyle: "Midsize SUV (BEV)",
    segment: "Electric luxury SUV", startingMsrpCad: 89500,
    ownership: {
      year: 2026, tireFrontSize: "265/45R22", estTireSetCad: 2200,
      oilType: "n/a — BEV", estOilChangeCad: 0,
      brakeJobFrontCad: 950, brakeJobRearCad: 850,
      dealerLabourRateCad: 205, indieLabourRateCad: 160,
      includedMaintenanceMonths: 36, includedMaintenanceKm: 60000,
      fiveYearOwnershipCostCad: 36000,
    },
    prosCons: [
      { isPro: true, text: "iX M70 (610 hp) is the performance halo.", weight: 2 },
      { isPro: false, text: "Polarizing styling.", weight: 1 },
    ],
    commonIssues: [],
  },

  // ============================ Mercedes-Benz (deepen) ============================
  {
    brandSlug: "mercedes-benz", slug: "glc", name: "GLC", bodyStyle: "Compact SUV",
    segment: "Compact luxury SUV", startingMsrpCad: 60900,
    ownership: {
      year: 2026, tireFrontSize: "235/55R19", estTireSetCad: 1600,
      oilType: "0W-30 MB-Approval 229.5", oilCapacityL: 6.5, estOilChangeCad: 210,
      oilChangeIntervalKm: 16000, brakeJobFrontCad: 950, brakeJobRearCad: 850,
      dealerLabourRateCad: 215, indieLabourRateCad: 170, fiveYearOwnershipCostCad: 50000,
    },
    prosCons: [
      { isPro: true, text: "GLC 300e PHEV: ~95 km EV range — best in class.", weight: 3 },
      { isPro: true, text: "Quietest cabin in compact-luxury-SUV segment.", weight: 2 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "mercedes-benz", slug: "c-class", name: "C-Class", bodyStyle: "Sedan",
    segment: "Compact luxury sedan", startingMsrpCad: 53000,
    ownership: {
      year: 2026, tireFrontSize: "225/45R18", estTireSetCad: 1500,
      oilType: "0W-30 MB-Approval 229.5", oilCapacityL: 6.5, estOilChangeCad: 200,
      oilChangeIntervalKm: 16000, brakeJobFrontCad: 900, brakeJobRearCad: 800,
      dealerLabourRateCad: 215, indieLabourRateCad: 170, fiveYearOwnershipCostCad: 46000,
    },
    prosCons: [
      { isPro: true, text: "AMG C 63 S E Performance: F1-derived 671 hp PHEV.", weight: 3 },
      { isPro: false, text: "All 4-cyl turbo from base (no straight-6).", weight: 2 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "mercedes-benz", slug: "eqs", name: "EQS", bodyStyle: "Sedan (BEV)",
    segment: "Electric flagship sedan", startingMsrpCad: 132900,
    ownership: {
      year: 2026, tireFrontSize: "265/40R21", estTireSetCad: 2400,
      oilType: "n/a — BEV", estOilChangeCad: 0,
      brakeJobFrontCad: 1200, brakeJobRearCad: 1100,
      dealerLabourRateCad: 215, indieLabourRateCad: 170, fiveYearOwnershipCostCad: 50000,
    },
    prosCons: [
      { isPro: true, text: "~770 km range (450+ EPA equivalent), Hyperscreen dashboard.", weight: 2 },
      { isPro: false, text: "Resale value softer than ICE S-Class.", weight: 2 },
    ],
    commonIssues: [],
  },

  // ============================ Tesla (deepen) ============================
  {
    brandSlug: "tesla", slug: "model-s", name: "Model S", bodyStyle: "Sedan (BEV)",
    segment: "Electric luxury sedan", startingMsrpCad: 99990,
    ownership: {
      year: 2026, tireFrontSize: "265/40R21", estTireSetCad: 2000,
      oilType: "n/a — BEV", estOilChangeCad: 0,
      brakeJobFrontCad: 800, brakeJobRearCad: 700,
      dealerLabourRateCad: 175, indieLabourRateCad: 150, fiveYearOwnershipCostCad: 32000,
    },
    prosCons: [
      { isPro: true, text: "Plaid variant: 1,020 hp, ~1.99s 0-100.", weight: 3 },
      { isPro: false, text: "Yoke steering returning to round option only — confirm spec.", weight: 1 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "tesla", slug: "model-x", name: "Model X", bodyStyle: "Midsize SUV (BEV)",
    segment: "Electric luxury SUV", startingMsrpCad: 109990,
    ownership: {
      year: 2026, tireFrontSize: "265/45R20", estTireSetCad: 1900,
      oilType: "n/a — BEV", estOilChangeCad: 0,
      brakeJobFrontCad: 800, brakeJobRearCad: 700,
      dealerLabourRateCad: 175, indieLabourRateCad: 150, fiveYearOwnershipCostCad: 34000,
    },
    prosCons: [
      { isPro: true, text: "Falcon-wing doors + 6/7-seat configs.", weight: 2 },
      { isPro: false, text: "Premium over Model Y / Y Long Range for limited additional range.", weight: 2 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "tesla", slug: "cybertruck", name: "Cybertruck", bodyStyle: "Full-size Pickup (BEV)",
    segment: "Electric truck", startingMsrpCad: 119000,
    notesMd: "Limited Canadian availability as of 2025. Stainless steel exoskeleton, 48V architecture.",
    ownership: {
      year: 2026, tireFrontSize: "285/65R20", estTireSetCad: 2200,
      oilType: "n/a — BEV", estOilChangeCad: 0,
      brakeJobFrontCad: 900, brakeJobRearCad: 800,
      dealerLabourRateCad: 175, indieLabourRateCad: 150, fiveYearOwnershipCostCad: 38000,
    },
    prosCons: [
      { isPro: true, text: "Steer-by-wire + four-wheel steering = car-park-grade maneuverability.", weight: 2 },
      { isPro: false, text: "Stainless body shows fingerprints + rust spots; care guide is non-trivial.", weight: 3 },
      { isPro: false, text: "Multiple recalls since launch (accelerator pedal, drive inverter).", weight: 3 },
    ],
    commonIssues: [
      { title: "Accelerator pedal trim (recall, 2024)", severity: "HIGH", yearsAffected: [2024], status: "RECALL_CLOSED", mentionCount: 60,
        description: "Pedal pad could dislodge and cause stuck-on acceleration. Recall complete; verify VIN before delivery." },
    ],
  },

  // ============================ Volkswagen (deepen) ============================
  {
    brandSlug: "volkswagen", slug: "atlas", name: "Atlas", bodyStyle: "Midsize SUV (3-row)",
    segment: "Midsize 3-row SUV", startingMsrpCad: 50795,
    ownership: {
      year: 2026, tireFrontSize: "255/60R18", estTireSetCad: 1400,
      oilType: "0W-20 VW spec 508", oilCapacityL: 6.0, estOilChangeCad: 140,
      oilChangeIntervalKm: 16000, brakeJobFrontCad: 640, brakeJobRearCad: 560,
      dealerLabourRateCad: 165, indieLabourRateCad: 125, fiveYearOwnershipCostCad: 44000,
    },
    prosCons: [
      { isPro: true, text: "Largest 3rd row in segment (Telluride / Palisade equivalent).", weight: 3 },
      { isPro: false, text: "No hybrid option (Highlander Hybrid is the answer).", weight: 3 },
    ],
    commonIssues: [],
  },
  {
    brandSlug: "volkswagen", slug: "golf-gti", name: "Golf GTI", bodyStyle: "Hatchback",
    segment: "Hot hatch", startingMsrpCad: 35495,
    notesMd: "2025+ MQB Evo refresh; manual returning for the final ICE-only generation.",
    ownership: {
      year: 2026, tireFrontSize: "225/40R18", estTireSetCad: 1300,
      oilType: "0W-20 VW spec 508", oilCapacityL: 5.7, estOilChangeCad: 140,
      oilChangeIntervalKm: 16000, brakeJobFrontCad: 580, brakeJobRearCad: 500,
      dealerLabourRateCad: 165, indieLabourRateCad: 125, fiveYearOwnershipCostCad: 38000,
    },
    prosCons: [
      { isPro: true, text: "241 hp + 6-spd MT (returning for 2025).", weight: 3 },
      { isPro: true, text: "Cabin tech: physical buttons restored on steering wheel.", weight: 2 },
      { isPro: false, text: "Golf R is the AWD answer; GTI is FWD-only.", weight: 1 },
    ],
    commonIssues: [],
  },

  // ============================ Ram (deepen) ============================
  {
    brandSlug: "ram", slug: "2500", name: "2500", bodyStyle: "Heavy-duty Pickup",
    segment: "HD truck", startingMsrpCad: 71540,
    ownership: {
      year: 2026, tireFrontSize: "275/70R18", estTireSetCad: 2100,
      oilType: "0W-40 synthetic (Cummins diesel: 15W-40)", oilCapacityL: 7.6, estOilChangeCad: 200,
      oilChangeIntervalKm: 12000, brakeJobFrontCad: 900, brakeJobRearCad: 800,
      dealerLabourRateCad: 160, indieLabourRateCad: 125, fiveYearOwnershipCostCad: 62000,
    },
    prosCons: [
      { isPro: true, text: "Cummins 6.7L diesel option (430 hp / 1,075 lb-ft).", weight: 3 },
      { isPro: true, text: "Best ride in HD segment thanks to coil-spring rear.", weight: 2 },
      { isPro: false, text: "Diesel adds ~$13k.", weight: 1 },
    ],
    commonIssues: [],
  },
];
