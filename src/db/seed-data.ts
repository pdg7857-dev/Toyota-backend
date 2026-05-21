// Toyota Ontario 2025/2026 lineup seed data.
//
// Prices are approximate Ontario MSRPs (CAD) based on publicly available
// information at time of seeding. ALWAYS verify against toyota.ca and the
// current dealer price book before quoting customers. Treat this file as a
// starting point — edit via the admin UI as new info comes out.

import { PowertrainType } from "@prisma/client";

export type PowertrainSeed = {
  key: string; // local key used by trims below
  type: PowertrainType;
  displayName: string;
  engineDesc?: string;
  horsepowerHp?: number;
  torqueLbft?: number;
  transmission?: string;
  drivetrain?: string;
  batteryKwh?: number;
  electricRangeKm?: number;
  fuelEconomyCityL100?: number;
  fuelEconomyHwyL100?: number;
  fuelEconomyCombL100?: number;
};

export const POWERTRAINS: PowertrainSeed[] = [
  // ===== Gas engines =====
  { key: "corolla-1_8-cvt-fwd", type: PowertrainType.GAS, displayName: "1.8L 4-cyl FWD",
    engineDesc: "1.8L DOHC 16V 4-cylinder", horsepowerHp: 169, torqueLbft: 151,
    transmission: "CVT", drivetrain: "FWD",
    fuelEconomyCityL100: 7.6, fuelEconomyHwyL100: 5.8, fuelEconomyCombL100: 6.8 },
  { key: "corolla-2_0-cvt-fwd", type: PowertrainType.GAS, displayName: "2.0L 4-cyl FWD",
    engineDesc: "2.0L Dynamic Force 4-cylinder", horsepowerHp: 169, torqueLbft: 151,
    transmission: "CVT", drivetrain: "FWD",
    fuelEconomyCityL100: 7.5, fuelEconomyHwyL100: 5.6, fuelEconomyCombL100: 6.7 },
  { key: "gr-corolla-1_6t-mt-awd", type: PowertrainType.GAS, displayName: "1.6L Turbo 3-cyl AWD",
    engineDesc: "1.6L turbocharged 3-cylinder", horsepowerHp: 300, torqueLbft: 295,
    transmission: "6-spd MT / 8-spd AT", drivetrain: "AWD (GR-FOUR)",
    fuelEconomyCityL100: 11.4, fuelEconomyHwyL100: 9.4, fuelEconomyCombL100: 10.5 },
  { key: "corolla-cross-2_0-cvt", type: PowertrainType.GAS, displayName: "2.0L 4-cyl",
    engineDesc: "2.0L Dynamic Force 4-cylinder", horsepowerHp: 169, torqueLbft: 151,
    transmission: "CVT", drivetrain: "FWD or AWD",
    fuelEconomyCityL100: 8.8, fuelEconomyHwyL100: 7.2, fuelEconomyCombL100: 8.1 },
  { key: "rav4-2_5-8at", type: PowertrainType.GAS, displayName: "2.5L 4-cyl 8AT",
    engineDesc: "2.5L Dynamic Force 4-cylinder", horsepowerHp: 203, torqueLbft: 184,
    transmission: "8-speed automatic", drivetrain: "AWD",
    fuelEconomyCityL100: 9.5, fuelEconomyHwyL100: 7.1, fuelEconomyCombL100: 8.4 },
  { key: "highlander-2_4t-8at-awd", type: PowertrainType.GAS, displayName: "2.4L Turbo AWD",
    engineDesc: "2.4L turbocharged 4-cylinder", horsepowerHp: 265, torqueLbft: 309,
    transmission: "8-speed automatic", drivetrain: "AWD",
    fuelEconomyCityL100: 11.0, fuelEconomyHwyL100: 8.5, fuelEconomyCombL100: 9.9 },
  { key: "4runner-2_4t", type: PowertrainType.GAS, displayName: "2.4L Turbo i-FORCE 4WD",
    engineDesc: "2.4L turbocharged 4-cylinder (i-FORCE)", horsepowerHp: 278, torqueLbft: 317,
    transmission: "8-speed automatic", drivetrain: "Part-time 4WD",
    fuelEconomyCityL100: 12.5, fuelEconomyHwyL100: 10.5, fuelEconomyCombL100: 11.6 },
  { key: "sequoia-3_4tt-hybrid", type: PowertrainType.HYBRID, displayName: "3.4L V6 Twin-Turbo i-FORCE MAX",
    engineDesc: "3.4L twin-turbo V6 + electric motor", horsepowerHp: 437, torqueLbft: 583,
    transmission: "10-speed automatic", drivetrain: "Part-time 4WD",
    fuelEconomyCityL100: 13.5, fuelEconomyHwyL100: 11.0, fuelEconomyCombL100: 12.4 },
  { key: "tacoma-2_4t", type: PowertrainType.GAS, displayName: "2.4L Turbo i-FORCE",
    engineDesc: "2.4L turbocharged 4-cylinder", horsepowerHp: 278, torqueLbft: 317,
    transmission: "8-spd AT / 6-spd MT", drivetrain: "Part-time 4WD",
    fuelEconomyCityL100: 11.5, fuelEconomyHwyL100: 9.5, fuelEconomyCombL100: 10.6 },
  { key: "tacoma-i-force-max", type: PowertrainType.HYBRID, displayName: "Tacoma i-FORCE MAX Hybrid 2.4T",
    engineDesc: "2.4L turbo 4-cyl + electric motor", horsepowerHp: 326, torqueLbft: 465,
    transmission: "8-speed automatic", drivetrain: "Part-time 4WD",
    fuelEconomyCityL100: 11.6, fuelEconomyHwyL100: 10.0, fuelEconomyCombL100: 10.9 },
  { key: "tundra-3_5tt", type: PowertrainType.GAS, displayName: "3.5L V6 Twin-Turbo i-FORCE",
    engineDesc: "3.5L twin-turbo V6", horsepowerHp: 389, torqueLbft: 479,
    transmission: "10-speed automatic", drivetrain: "Part-time 4WD",
    fuelEconomyCityL100: 14.0, fuelEconomyHwyL100: 10.5, fuelEconomyCombL100: 12.4 },
  { key: "tundra-i-force-max", type: PowertrainType.HYBRID, displayName: "Tundra i-FORCE MAX Hybrid 3.5TT",
    engineDesc: "3.5L twin-turbo V6 + electric motor", horsepowerHp: 437, torqueLbft: 583,
    transmission: "10-speed automatic", drivetrain: "Part-time 4WD",
    fuelEconomyCityL100: 13.5, fuelEconomyHwyL100: 10.7, fuelEconomyCombL100: 12.2 },
  { key: "gr86-2_4-mt", type: PowertrainType.GAS, displayName: "2.4L Boxer 6MT",
    engineDesc: "2.4L naturally aspirated flat-4", horsepowerHp: 228, torqueLbft: 184,
    transmission: "6-speed MT (6AT optional)", drivetrain: "RWD",
    fuelEconomyCityL100: 11.6, fuelEconomyHwyL100: 8.3, fuelEconomyCombL100: 10.1 },
  { key: "supra-3_0t-mt", type: PowertrainType.GAS, displayName: "3.0L Turbo I6",
    engineDesc: "3.0L turbocharged inline-6", horsepowerHp: 382, torqueLbft: 368,
    transmission: "6-spd MT / 8-spd AT", drivetrain: "RWD",
    fuelEconomyCityL100: 11.5, fuelEconomyHwyL100: 8.6, fuelEconomyCombL100: 10.2 },
  { key: "land-cruiser-i-force-max", type: PowertrainType.HYBRID, displayName: "2.4L Turbo i-FORCE MAX",
    engineDesc: "2.4L turbo 4-cyl + electric motor", horsepowerHp: 326, torqueLbft: 465,
    transmission: "8-speed automatic", drivetrain: "Full-time 4WD",
    fuelEconomyCityL100: 11.6, fuelEconomyHwyL100: 10.0, fuelEconomyCombL100: 10.9 },

  // ===== Hybrids =====
  { key: "corolla-hybrid-fwd", type: PowertrainType.HYBRID, displayName: "1.8L Hybrid FWD",
    engineDesc: "1.8L 4-cyl + electric motor", horsepowerHp: 138, torqueLbft: 105,
    transmission: "eCVT", drivetrain: "FWD",
    fuelEconomyCityL100: 4.5, fuelEconomyHwyL100: 4.5, fuelEconomyCombL100: 4.5 },
  { key: "corolla-hybrid-awd", type: PowertrainType.HYBRID, displayName: "1.8L Hybrid AWD",
    engineDesc: "1.8L 4-cyl + electric motors (front+rear)", horsepowerHp: 138, torqueLbft: 105,
    transmission: "eCVT", drivetrain: "AWD (AWD-e)",
    fuelEconomyCityL100: 4.7, fuelEconomyHwyL100: 4.8, fuelEconomyCombL100: 4.7 },
  { key: "corolla-cross-hybrid-awd", type: PowertrainType.HYBRID, displayName: "Corolla Cross 2.0L Hybrid AWD",
    engineDesc: "2.0L 4-cyl + electric motors", horsepowerHp: 196, torqueLbft: 152,
    transmission: "eCVT", drivetrain: "AWD (AWD-e)",
    fuelEconomyCityL100: 5.7, fuelEconomyHwyL100: 6.4, fuelEconomyCombL100: 6.0 },
  { key: "camry-hybrid-fwd", type: PowertrainType.HYBRID, displayName: "Camry 2.5L Hybrid FWD",
    engineDesc: "2.5L 4-cyl + electric motor", horsepowerHp: 225, torqueLbft: 163,
    transmission: "eCVT", drivetrain: "FWD",
    fuelEconomyCityL100: 4.8, fuelEconomyHwyL100: 4.9, fuelEconomyCombL100: 4.8 },
  { key: "camry-hybrid-awd", type: PowertrainType.HYBRID, displayName: "Camry 2.5L Hybrid AWD",
    engineDesc: "2.5L 4-cyl + electric motors", horsepowerHp: 232, torqueLbft: 163,
    transmission: "eCVT", drivetrain: "AWD (AWD-e)",
    fuelEconomyCityL100: 5.0, fuelEconomyHwyL100: 5.1, fuelEconomyCombL100: 5.0 },
  { key: "rav4-hybrid-awd", type: PowertrainType.HYBRID, displayName: "RAV4 2.5L Hybrid AWD",
    engineDesc: "2.5L 4-cyl + electric motors", horsepowerHp: 219, torqueLbft: 163,
    transmission: "eCVT", drivetrain: "AWD (AWD-e)",
    fuelEconomyCityL100: 5.8, fuelEconomyHwyL100: 6.3, fuelEconomyCombL100: 6.0 },
  { key: "highlander-hybrid-awd", type: PowertrainType.HYBRID, displayName: "Highlander 2.5L Hybrid AWD",
    engineDesc: "2.5L 4-cyl + electric motors", horsepowerHp: 243, torqueLbft: 175,
    transmission: "eCVT", drivetrain: "AWD (AWD-e)",
    fuelEconomyCityL100: 6.6, fuelEconomyHwyL100: 6.7, fuelEconomyCombL100: 6.7 },
  { key: "grand-highlander-hybrid-max", type: PowertrainType.HYBRID, displayName: "Grand Highlander 2.4L Turbo Hybrid MAX AWD",
    engineDesc: "2.4L turbo 4-cyl + electric motor", horsepowerHp: 362, torqueLbft: 400,
    transmission: "6-speed automatic", drivetrain: "AWD",
    fuelEconomyCityL100: 8.6, fuelEconomyHwyL100: 8.3, fuelEconomyCombL100: 8.5 },
  { key: "grand-highlander-hybrid", type: PowertrainType.HYBRID, displayName: "Grand Highlander 2.5L Hybrid AWD",
    engineDesc: "2.5L 4-cyl + electric motors", horsepowerHp: 245, torqueLbft: 175,
    transmission: "eCVT", drivetrain: "AWD (AWD-e)",
    fuelEconomyCityL100: 6.8, fuelEconomyHwyL100: 6.9, fuelEconomyCombL100: 6.8 },
  { key: "crown-hybrid", type: PowertrainType.HYBRID, displayName: "Crown 2.5L Hybrid AWD",
    engineDesc: "2.5L 4-cyl + electric motors", horsepowerHp: 236, torqueLbft: 163,
    transmission: "eCVT", drivetrain: "AWD",
    fuelEconomyCityL100: 6.3, fuelEconomyHwyL100: 6.0, fuelEconomyCombL100: 6.2 },
  { key: "crown-hybrid-max", type: PowertrainType.HYBRID, displayName: "Crown 2.4L Turbo Hybrid MAX AWD",
    engineDesc: "2.4L turbo 4-cyl + electric motor", horsepowerHp: 340, torqueLbft: 400,
    transmission: "6-speed automatic", drivetrain: "AWD",
    fuelEconomyCityL100: 8.3, fuelEconomyHwyL100: 7.8, fuelEconomyCombL100: 8.1 },
  { key: "crown-signia-hybrid", type: PowertrainType.HYBRID, displayName: "Crown Signia 2.5L Hybrid AWD",
    engineDesc: "2.5L 4-cyl + electric motors", horsepowerHp: 240, torqueLbft: 175,
    transmission: "eCVT", drivetrain: "AWD (AWD-e)",
    fuelEconomyCityL100: 6.4, fuelEconomyHwyL100: 6.6, fuelEconomyCombL100: 6.5 },
  { key: "sienna-hybrid", type: PowertrainType.HYBRID, displayName: "Sienna 2.5L Hybrid",
    engineDesc: "2.5L 4-cyl + electric motors", horsepowerHp: 245, torqueLbft: 176,
    transmission: "eCVT", drivetrain: "FWD or AWD (AWD-e)",
    fuelEconomyCityL100: 6.6, fuelEconomyHwyL100: 6.8, fuelEconomyCombL100: 6.7 },
  { key: "prius-hybrid-awd", type: PowertrainType.HYBRID, displayName: "Prius 2.0L Hybrid AWD",
    engineDesc: "2.0L 4-cyl + electric motors", horsepowerHp: 196, torqueLbft: 152,
    transmission: "eCVT", drivetrain: "AWD (AWD-e)",
    fuelEconomyCityL100: 4.4, fuelEconomyHwyL100: 4.7, fuelEconomyCombL100: 4.6 },

  // ===== PHEVs =====
  { key: "rav4-prime", type: PowertrainType.PHEV, displayName: "2.5L PHEV AWD",
    engineDesc: "2.5L 4-cyl + plug-in electric motors", horsepowerHp: 302, torqueLbft: 0,
    transmission: "eCVT", drivetrain: "AWD",
    batteryKwh: 18.1, electricRangeKm: 68,
    fuelEconomyCityL100: 6.0, fuelEconomyHwyL100: 6.4, fuelEconomyCombL100: 6.2 },
  { key: "prius-prime", type: PowertrainType.PHEV, displayName: "2.0L Prius Prime PHEV",
    engineDesc: "2.0L 4-cyl + plug-in electric motor", horsepowerHp: 220, torqueLbft: 139,
    transmission: "eCVT", drivetrain: "FWD",
    batteryKwh: 13.6, electricRangeKm: 72,
    fuelEconomyCityL100: 4.3, fuelEconomyHwyL100: 4.6, fuelEconomyCombL100: 4.4 },

  // ===== BEVs =====
  { key: "bz4x-fwd", type: PowertrainType.BEV, displayName: "bZ4X FWD",
    engineDesc: "Single-motor BEV", horsepowerHp: 201, torqueLbft: 196,
    transmission: "Single-speed", drivetrain: "FWD",
    batteryKwh: 71.4, electricRangeKm: 406 },
  { key: "bz4x-awd", type: PowertrainType.BEV, displayName: "bZ4X AWD",
    engineDesc: "Dual-motor BEV", horsepowerHp: 214, torqueLbft: 248,
    transmission: "Single-speed", drivetrain: "AWD",
    batteryKwh: 71.4, electricRangeKm: 367 },
];

// =======================================================================
// MODELS + TRIMS
// =======================================================================

export type TrimSeed = {
  name: string;
  slug: string;
  year: 2025 | 2026;
  powertrainKey: string;
  msrpCad: number;
  notesMd?: string;
};

export type ModelSeed = {
  slug: string;
  name: string;
  bodyStyle: string;
  segment: string;
  notesMd?: string;
  trims: TrimSeed[];
};

// Standard Ontario fee block applied to every trim. The rep can edit per-trim
// via the admin UI / PUT /trims/:id/fees once exact dealer numbers are known.
export const DEFAULT_FEES = {
  freightPdiCad: 1930,
  acExciseCad: 100,
  omvicFeeCad: 12.5,
  tireStewardshipCad: 22.4,
  dealerAdminCad: 499,
  hstRate: 0.13,
};

export const MODELS: ModelSeed[] = [
  // ---------- Corolla (Sedan) ----------
  {
    slug: "corolla",
    name: "Corolla",
    bodyStyle: "Sedan",
    segment: "Compact Sedan",
    notesMd: "Best-selling compact in Canada. Lead with: AWD-e hybrid availability is unique vs Civic, Toyota Safety Sense 3.0 standard, strong residuals.",
    trims: [
      { name: "LE", slug: "corolla-2025-le-gas", year: 2025, powertrainKey: "corolla-1_8-cvt-fwd", msrpCad: 24350 },
      { name: "SE", slug: "corolla-2025-se-gas", year: 2025, powertrainKey: "corolla-2_0-cvt-fwd", msrpCad: 26450 },
      { name: "SE Upgrade", slug: "corolla-2025-se-upgrade-gas", year: 2025, powertrainKey: "corolla-2_0-cvt-fwd", msrpCad: 28550 },
      { name: "XSE", slug: "corolla-2025-xse-gas", year: 2025, powertrainKey: "corolla-2_0-cvt-fwd", msrpCad: 30050 },
      { name: "LE Hybrid", slug: "corolla-2025-le-hybrid-fwd", year: 2025, powertrainKey: "corolla-hybrid-fwd", msrpCad: 27950 },
      { name: "SE Hybrid AWD", slug: "corolla-2025-se-hybrid-awd", year: 2025, powertrainKey: "corolla-hybrid-awd", msrpCad: 31350 },
      { name: "XLE Hybrid AWD", slug: "corolla-2025-xle-hybrid-awd", year: 2025, powertrainKey: "corolla-hybrid-awd", msrpCad: 33550 },
      { name: "LE", slug: "corolla-2026-le-gas", year: 2026, powertrainKey: "corolla-1_8-cvt-fwd", msrpCad: 25050 },
      { name: "SE", slug: "corolla-2026-se-gas", year: 2026, powertrainKey: "corolla-2_0-cvt-fwd", msrpCad: 27150 },
      { name: "SE Upgrade", slug: "corolla-2026-se-upgrade-gas", year: 2026, powertrainKey: "corolla-2_0-cvt-fwd", msrpCad: 29250 },
      { name: "XSE", slug: "corolla-2026-xse-gas", year: 2026, powertrainKey: "corolla-2_0-cvt-fwd", msrpCad: 30750 },
      { name: "LE Hybrid", slug: "corolla-2026-le-hybrid-fwd", year: 2026, powertrainKey: "corolla-hybrid-fwd", msrpCad: 28650 },
      { name: "SE Hybrid AWD", slug: "corolla-2026-se-hybrid-awd", year: 2026, powertrainKey: "corolla-hybrid-awd", msrpCad: 32050 },
      { name: "XLE Hybrid AWD", slug: "corolla-2026-xle-hybrid-awd", year: 2026, powertrainKey: "corolla-hybrid-awd", msrpCad: 34250 },
    ],
  },
  // ---------- GR Corolla ----------
  {
    slug: "gr-corolla",
    name: "GR Corolla",
    bodyStyle: "Hatchback",
    segment: "Performance Compact",
    notesMd: "300 hp / GR-FOUR AWD / MT or 8AT. Halo product for enthusiasts. Limited allocation — sell on scarcity.",
    trims: [
      { name: "Core MT", slug: "gr-corolla-2025-core-mt", year: 2025, powertrainKey: "gr-corolla-1_6t-mt-awd", msrpCad: 49950 },
      { name: "Premium 8AT", slug: "gr-corolla-2025-premium-at", year: 2025, powertrainKey: "gr-corolla-1_6t-mt-awd", msrpCad: 56250 },
      { name: "Core MT", slug: "gr-corolla-2026-core-mt", year: 2026, powertrainKey: "gr-corolla-1_6t-mt-awd", msrpCad: 51250 },
      { name: "Premium 8AT", slug: "gr-corolla-2026-premium-at", year: 2026, powertrainKey: "gr-corolla-1_6t-mt-awd", msrpCad: 57550 },
    ],
  },
  // ---------- Camry (Hybrid-only since MY2025) ----------
  {
    slug: "camry",
    name: "Camry",
    bodyStyle: "Sedan",
    segment: "Midsize Sedan",
    notesMd: "Hybrid-only from 2025+. AWD hybrid is industry-leading for mid-size sedans. Lead vs Accord Hybrid: AWD availability, 240k-km HV battery warranty.",
    trims: [
      { name: "SE Hybrid FWD", slug: "camry-2025-se-hybrid-fwd", year: 2025, powertrainKey: "camry-hybrid-fwd", msrpCad: 35650 },
      { name: "SE Hybrid AWD", slug: "camry-2025-se-hybrid-awd", year: 2025, powertrainKey: "camry-hybrid-awd", msrpCad: 38150 },
      { name: "XLE Hybrid", slug: "camry-2025-xle-hybrid-awd", year: 2025, powertrainKey: "camry-hybrid-awd", msrpCad: 42550 },
      { name: "XSE Hybrid", slug: "camry-2025-xse-hybrid-awd", year: 2025, powertrainKey: "camry-hybrid-awd", msrpCad: 44550 },
      { name: "SE Hybrid FWD", slug: "camry-2026-se-hybrid-fwd", year: 2026, powertrainKey: "camry-hybrid-fwd", msrpCad: 36450 },
      { name: "SE Hybrid AWD", slug: "camry-2026-se-hybrid-awd", year: 2026, powertrainKey: "camry-hybrid-awd", msrpCad: 38950 },
      { name: "XLE Hybrid", slug: "camry-2026-xle-hybrid-awd", year: 2026, powertrainKey: "camry-hybrid-awd", msrpCad: 43350 },
      { name: "XSE Hybrid", slug: "camry-2026-xse-hybrid-awd", year: 2026, powertrainKey: "camry-hybrid-awd", msrpCad: 45350 },
    ],
  },
  // ---------- Corolla Cross ----------
  {
    slug: "corolla-cross",
    name: "Corolla Cross",
    bodyStyle: "SUV",
    segment: "Subcompact SUV",
    notesMd: "Entry SUV. Hybrid AWD trims compete strongly vs HR-V / Kona on fuel economy.",
    trims: [
      { name: "L AWD", slug: "corolla-cross-2025-l-awd-gas", year: 2025, powertrainKey: "corolla-cross-2_0-cvt", msrpCad: 28850 },
      { name: "LE AWD", slug: "corolla-cross-2025-le-awd-gas", year: 2025, powertrainKey: "corolla-cross-2_0-cvt", msrpCad: 30950 },
      { name: "XLE AWD", slug: "corolla-cross-2025-xle-awd-gas", year: 2025, powertrainKey: "corolla-cross-2_0-cvt", msrpCad: 34250 },
      { name: "S Hybrid AWD", slug: "corolla-cross-2025-s-hybrid-awd", year: 2025, powertrainKey: "corolla-cross-hybrid-awd", msrpCad: 34250 },
      { name: "SE Hybrid AWD", slug: "corolla-cross-2025-se-hybrid-awd", year: 2025, powertrainKey: "corolla-cross-hybrid-awd", msrpCad: 36750 },
      { name: "XSE Hybrid AWD", slug: "corolla-cross-2025-xse-hybrid-awd", year: 2025, powertrainKey: "corolla-cross-hybrid-awd", msrpCad: 39950 },
      { name: "L AWD", slug: "corolla-cross-2026-l-awd-gas", year: 2026, powertrainKey: "corolla-cross-2_0-cvt", msrpCad: 29550 },
      { name: "LE AWD", slug: "corolla-cross-2026-le-awd-gas", year: 2026, powertrainKey: "corolla-cross-2_0-cvt", msrpCad: 31650 },
      { name: "XLE AWD", slug: "corolla-cross-2026-xle-awd-gas", year: 2026, powertrainKey: "corolla-cross-2_0-cvt", msrpCad: 34950 },
      { name: "S Hybrid AWD", slug: "corolla-cross-2026-s-hybrid-awd", year: 2026, powertrainKey: "corolla-cross-hybrid-awd", msrpCad: 34950 },
      { name: "SE Hybrid AWD", slug: "corolla-cross-2026-se-hybrid-awd", year: 2026, powertrainKey: "corolla-cross-hybrid-awd", msrpCad: 37450 },
      { name: "XSE Hybrid AWD", slug: "corolla-cross-2026-xse-hybrid-awd", year: 2026, powertrainKey: "corolla-cross-hybrid-awd", msrpCad: 40650 },
    ],
  },
  // ---------- RAV4 ----------
  {
    slug: "rav4",
    name: "RAV4",
    bodyStyle: "SUV",
    segment: "Compact SUV",
    notesMd: "Bestselling SUV in Canada. 2026 is hybrid-only — pitch supply tightness. Hybrid AWD-e + 240k HV battery warranty is the headline.",
    trims: [
      { name: "LE AWD", slug: "rav4-2025-le-awd-gas", year: 2025, powertrainKey: "rav4-2_5-8at", msrpCad: 35150 },
      { name: "XLE AWD", slug: "rav4-2025-xle-awd-gas", year: 2025, powertrainKey: "rav4-2_5-8at", msrpCad: 38450 },
      { name: "Trail AWD", slug: "rav4-2025-trail-awd-gas", year: 2025, powertrainKey: "rav4-2_5-8at", msrpCad: 42850 },
      { name: "Limited AWD", slug: "rav4-2025-limited-awd-gas", year: 2025, powertrainKey: "rav4-2_5-8at", msrpCad: 44650 },
      { name: "LE Hybrid AWD", slug: "rav4-2025-le-hybrid-awd", year: 2025, powertrainKey: "rav4-hybrid-awd", msrpCad: 37650 },
      { name: "XLE Hybrid AWD", slug: "rav4-2025-xle-hybrid-awd", year: 2025, powertrainKey: "rav4-hybrid-awd", msrpCad: 40950 },
      { name: "XSE Hybrid AWD", slug: "rav4-2025-xse-hybrid-awd", year: 2025, powertrainKey: "rav4-hybrid-awd", msrpCad: 44850 },
      { name: "Woodland Hybrid AWD", slug: "rav4-2025-woodland-hybrid-awd", year: 2025, powertrainKey: "rav4-hybrid-awd", msrpCad: 45250 },
      { name: "Limited Hybrid AWD", slug: "rav4-2025-limited-hybrid-awd", year: 2025, powertrainKey: "rav4-hybrid-awd", msrpCad: 47150 },
      { name: "SE PHEV AWD", slug: "rav4-2025-se-phev-awd", year: 2025, powertrainKey: "rav4-prime", msrpCad: 50450 },
      { name: "XSE PHEV AWD", slug: "rav4-2025-xse-phev-awd", year: 2025, powertrainKey: "rav4-prime", msrpCad: 56350 },
      // 2026 — hybrid/PHEV only per Toyota's announcement
      { name: "LE Hybrid AWD", slug: "rav4-2026-le-hybrid-awd", year: 2026, powertrainKey: "rav4-hybrid-awd", msrpCad: 38950, notesMd: "2026 lineup is hybrid/PHEV only — no more gas-only trims." },
      { name: "XLE Hybrid AWD", slug: "rav4-2026-xle-hybrid-awd", year: 2026, powertrainKey: "rav4-hybrid-awd", msrpCad: 42150 },
      { name: "XSE Hybrid AWD", slug: "rav4-2026-xse-hybrid-awd", year: 2026, powertrainKey: "rav4-hybrid-awd", msrpCad: 46050 },
      { name: "Woodland Hybrid AWD", slug: "rav4-2026-woodland-hybrid-awd", year: 2026, powertrainKey: "rav4-hybrid-awd", msrpCad: 46550 },
      { name: "Limited Hybrid AWD", slug: "rav4-2026-limited-hybrid-awd", year: 2026, powertrainKey: "rav4-hybrid-awd", msrpCad: 48350 },
      { name: "SE PHEV AWD", slug: "rav4-2026-se-phev-awd", year: 2026, powertrainKey: "rav4-prime", msrpCad: 51950 },
      { name: "XSE PHEV AWD", slug: "rav4-2026-xse-phev-awd", year: 2026, powertrainKey: "rav4-prime", msrpCad: 57850 },
    ],
  },
  // ---------- Highlander ----------
  {
    slug: "highlander",
    name: "Highlander",
    bodyStyle: "SUV",
    segment: "Midsize 3-row SUV",
    notesMd: "Gas 2.4T or self-charging hybrid. For more towing/space step up to Grand Highlander.",
    trims: [
      { name: "LE AWD", slug: "highlander-2025-le-awd-gas", year: 2025, powertrainKey: "highlander-2_4t-8at-awd", msrpCad: 50050 },
      { name: "XLE AWD", slug: "highlander-2025-xle-awd-gas", year: 2025, powertrainKey: "highlander-2_4t-8at-awd", msrpCad: 53450 },
      { name: "Limited AWD", slug: "highlander-2025-limited-awd-gas", year: 2025, powertrainKey: "highlander-2_4t-8at-awd", msrpCad: 58450 },
      { name: "Platinum AWD", slug: "highlander-2025-platinum-awd-gas", year: 2025, powertrainKey: "highlander-2_4t-8at-awd", msrpCad: 62550 },
      { name: "LE Hybrid AWD", slug: "highlander-2025-le-hybrid-awd", year: 2025, powertrainKey: "highlander-hybrid-awd", msrpCad: 52950 },
      { name: "XLE Hybrid AWD", slug: "highlander-2025-xle-hybrid-awd", year: 2025, powertrainKey: "highlander-hybrid-awd", msrpCad: 56350 },
      { name: "Limited Hybrid AWD", slug: "highlander-2025-limited-hybrid-awd", year: 2025, powertrainKey: "highlander-hybrid-awd", msrpCad: 61350 },
      { name: "Platinum Hybrid AWD", slug: "highlander-2025-platinum-hybrid-awd", year: 2025, powertrainKey: "highlander-hybrid-awd", msrpCad: 65450 },
      { name: "LE AWD", slug: "highlander-2026-le-awd-gas", year: 2026, powertrainKey: "highlander-2_4t-8at-awd", msrpCad: 50950 },
      { name: "XLE AWD", slug: "highlander-2026-xle-awd-gas", year: 2026, powertrainKey: "highlander-2_4t-8at-awd", msrpCad: 54350 },
      { name: "Limited AWD", slug: "highlander-2026-limited-awd-gas", year: 2026, powertrainKey: "highlander-2_4t-8at-awd", msrpCad: 59350 },
      { name: "Platinum AWD", slug: "highlander-2026-platinum-awd-gas", year: 2026, powertrainKey: "highlander-2_4t-8at-awd", msrpCad: 63450 },
      { name: "LE Hybrid AWD", slug: "highlander-2026-le-hybrid-awd", year: 2026, powertrainKey: "highlander-hybrid-awd", msrpCad: 53850 },
      { name: "XLE Hybrid AWD", slug: "highlander-2026-xle-hybrid-awd", year: 2026, powertrainKey: "highlander-hybrid-awd", msrpCad: 57250 },
      { name: "Limited Hybrid AWD", slug: "highlander-2026-limited-hybrid-awd", year: 2026, powertrainKey: "highlander-hybrid-awd", msrpCad: 62250 },
      { name: "Platinum Hybrid AWD", slug: "highlander-2026-platinum-hybrid-awd", year: 2026, powertrainKey: "highlander-hybrid-awd", msrpCad: 66350 },
    ],
  },
  // ---------- Grand Highlander ----------
  {
    slug: "grand-highlander",
    name: "Grand Highlander",
    bodyStyle: "SUV",
    segment: "Large 3-row SUV",
    notesMd: "Bigger cabin and 3rd row than Highlander. Hybrid MAX delivers 362 hp + 8,000 lb tow.",
    trims: [
      { name: "XLE Hybrid AWD", slug: "grand-highlander-2025-xle-hybrid-awd", year: 2025, powertrainKey: "grand-highlander-hybrid", msrpCad: 58650 },
      { name: "Limited Hybrid AWD", slug: "grand-highlander-2025-limited-hybrid-awd", year: 2025, powertrainKey: "grand-highlander-hybrid", msrpCad: 64950 },
      { name: "Platinum Hybrid MAX AWD", slug: "grand-highlander-2025-platinum-hybrid-max-awd", year: 2025, powertrainKey: "grand-highlander-hybrid-max", msrpCad: 73450 },
      { name: "XLE Hybrid AWD", slug: "grand-highlander-2026-xle-hybrid-awd", year: 2026, powertrainKey: "grand-highlander-hybrid", msrpCad: 59550 },
      { name: "Limited Hybrid AWD", slug: "grand-highlander-2026-limited-hybrid-awd", year: 2026, powertrainKey: "grand-highlander-hybrid", msrpCad: 65850 },
      { name: "Platinum Hybrid MAX AWD", slug: "grand-highlander-2026-platinum-hybrid-max-awd", year: 2026, powertrainKey: "grand-highlander-hybrid-max", msrpCad: 74350 },
    ],
  },
  // ---------- Crown (Sedan) ----------
  {
    slug: "crown",
    name: "Crown",
    bodyStyle: "Sedan",
    segment: "Premium Sedan",
    notesMd: "Lifted sedan styling, AWD standard. Limited supply.",
    trims: [
      { name: "XLE Hybrid AWD", slug: "crown-2025-xle-hybrid-awd", year: 2025, powertrainKey: "crown-hybrid", msrpCad: 52450 },
      { name: "Limited Hybrid AWD", slug: "crown-2025-limited-hybrid-awd", year: 2025, powertrainKey: "crown-hybrid", msrpCad: 57550 },
      { name: "Platinum Hybrid MAX AWD", slug: "crown-2025-platinum-hybrid-max-awd", year: 2025, powertrainKey: "crown-hybrid-max", msrpCad: 65450 },
      { name: "XLE Hybrid AWD", slug: "crown-2026-xle-hybrid-awd", year: 2026, powertrainKey: "crown-hybrid", msrpCad: 53350 },
      { name: "Limited Hybrid AWD", slug: "crown-2026-limited-hybrid-awd", year: 2026, powertrainKey: "crown-hybrid", msrpCad: 58450 },
      { name: "Platinum Hybrid MAX AWD", slug: "crown-2026-platinum-hybrid-max-awd", year: 2026, powertrainKey: "crown-hybrid-max", msrpCad: 66350 },
    ],
  },
  // ---------- Crown Signia (Wagon) ----------
  {
    slug: "crown-signia",
    name: "Crown Signia",
    bodyStyle: "Wagon",
    segment: "Premium Wagon/SUV",
    notesMd: "Premium hybrid wagon. Pitch as a Lexus RX alternative at a lower price.",
    trims: [
      { name: "XLE Hybrid AWD", slug: "crown-signia-2025-xle-hybrid-awd", year: 2025, powertrainKey: "crown-signia-hybrid", msrpCad: 53450 },
      { name: "Limited Hybrid AWD", slug: "crown-signia-2025-limited-hybrid-awd", year: 2025, powertrainKey: "crown-signia-hybrid", msrpCad: 58550 },
      { name: "XLE Hybrid AWD", slug: "crown-signia-2026-xle-hybrid-awd", year: 2026, powertrainKey: "crown-signia-hybrid", msrpCad: 54350 },
      { name: "Limited Hybrid AWD", slug: "crown-signia-2026-limited-hybrid-awd", year: 2026, powertrainKey: "crown-signia-hybrid", msrpCad: 59450 },
    ],
  },
  // ---------- 4Runner ----------
  {
    slug: "4runner",
    name: "4Runner",
    bodyStyle: "SUV",
    segment: "Midsize Body-on-Frame SUV",
    notesMd: "Fully redesigned 2025. New i-FORCE 2.4T base + i-FORCE MAX hybrid up top. Pitch off-road heritage + body-on-frame durability.",
    trims: [
      { name: "SR5 4WD", slug: "4runner-2025-sr5-4wd", year: 2025, powertrainKey: "4runner-2_4t", msrpCad: 56450 },
      { name: "TRD Off-Road 4WD", slug: "4runner-2025-trd-off-road-4wd", year: 2025, powertrainKey: "4runner-2_4t", msrpCad: 62450 },
      { name: "TRD Sport 4WD", slug: "4runner-2025-trd-sport-4wd", year: 2025, powertrainKey: "4runner-2_4t", msrpCad: 61450 },
      { name: "Limited 4WD", slug: "4runner-2025-limited-4wd", year: 2025, powertrainKey: "4runner-2_4t", msrpCad: 70450 },
      { name: "TRD Pro Hybrid 4WD", slug: "4runner-2025-trd-pro-hybrid-4wd", year: 2025, powertrainKey: "land-cruiser-i-force-max", msrpCad: 78450 },
      { name: "Trailhunter Hybrid 4WD", slug: "4runner-2025-trailhunter-hybrid-4wd", year: 2025, powertrainKey: "land-cruiser-i-force-max", msrpCad: 81450 },
      { name: "SR5 4WD", slug: "4runner-2026-sr5-4wd", year: 2026, powertrainKey: "4runner-2_4t", msrpCad: 57350 },
      { name: "TRD Off-Road 4WD", slug: "4runner-2026-trd-off-road-4wd", year: 2026, powertrainKey: "4runner-2_4t", msrpCad: 63350 },
      { name: "TRD Sport 4WD", slug: "4runner-2026-trd-sport-4wd", year: 2026, powertrainKey: "4runner-2_4t", msrpCad: 62350 },
      { name: "Limited 4WD", slug: "4runner-2026-limited-4wd", year: 2026, powertrainKey: "4runner-2_4t", msrpCad: 71350 },
      { name: "TRD Pro Hybrid 4WD", slug: "4runner-2026-trd-pro-hybrid-4wd", year: 2026, powertrainKey: "land-cruiser-i-force-max", msrpCad: 79350 },
      { name: "Trailhunter Hybrid 4WD", slug: "4runner-2026-trailhunter-hybrid-4wd", year: 2026, powertrainKey: "land-cruiser-i-force-max", msrpCad: 82350 },
    ],
  },
  // ---------- Land Cruiser ----------
  {
    slug: "land-cruiser",
    name: "Land Cruiser",
    bodyStyle: "SUV",
    segment: "Midsize Premium Body-on-Frame SUV",
    notesMd: "Returns to Canada 2024+ on GA-F platform. i-FORCE MAX hybrid only. Halo product — sell on heritage.",
    trims: [
      { name: "1958 Hybrid 4WD", slug: "land-cruiser-2025-1958-hybrid-4wd", year: 2025, powertrainKey: "land-cruiser-i-force-max", msrpCad: 72950 },
      { name: "Hybrid 4WD", slug: "land-cruiser-2025-hybrid-4wd", year: 2025, powertrainKey: "land-cruiser-i-force-max", msrpCad: 80950 },
      { name: "1958 Hybrid 4WD", slug: "land-cruiser-2026-1958-hybrid-4wd", year: 2026, powertrainKey: "land-cruiser-i-force-max", msrpCad: 73850 },
      { name: "Hybrid 4WD", slug: "land-cruiser-2026-hybrid-4wd", year: 2026, powertrainKey: "land-cruiser-i-force-max", msrpCad: 81850 },
    ],
  },
  // ---------- Sequoia ----------
  {
    slug: "sequoia",
    name: "Sequoia",
    bodyStyle: "SUV",
    segment: "Full-size 3-row SUV",
    notesMd: "Twin-turbo V6 hybrid only. Strong tow (~9,000 lb). Compete vs Tahoe / Expedition.",
    trims: [
      { name: "SR5 4WD", slug: "sequoia-2025-sr5-4wd", year: 2025, powertrainKey: "sequoia-3_4tt-hybrid", msrpCad: 86950 },
      { name: "Limited 4WD", slug: "sequoia-2025-limited-4wd", year: 2025, powertrainKey: "sequoia-3_4tt-hybrid", msrpCad: 91950 },
      { name: "Platinum 4WD", slug: "sequoia-2025-platinum-4wd", year: 2025, powertrainKey: "sequoia-3_4tt-hybrid", msrpCad: 99950 },
      { name: "TRD Pro 4WD", slug: "sequoia-2025-trd-pro-4wd", year: 2025, powertrainKey: "sequoia-3_4tt-hybrid", msrpCad: 105950 },
      { name: "Capstone 4WD", slug: "sequoia-2025-capstone-4wd", year: 2025, powertrainKey: "sequoia-3_4tt-hybrid", msrpCad: 109950 },
      { name: "SR5 4WD", slug: "sequoia-2026-sr5-4wd", year: 2026, powertrainKey: "sequoia-3_4tt-hybrid", msrpCad: 87950 },
      { name: "Limited 4WD", slug: "sequoia-2026-limited-4wd", year: 2026, powertrainKey: "sequoia-3_4tt-hybrid", msrpCad: 92950 },
      { name: "Platinum 4WD", slug: "sequoia-2026-platinum-4wd", year: 2026, powertrainKey: "sequoia-3_4tt-hybrid", msrpCad: 100950 },
      { name: "TRD Pro 4WD", slug: "sequoia-2026-trd-pro-4wd", year: 2026, powertrainKey: "sequoia-3_4tt-hybrid", msrpCad: 106950 },
      { name: "Capstone 4WD", slug: "sequoia-2026-capstone-4wd", year: 2026, powertrainKey: "sequoia-3_4tt-hybrid", msrpCad: 110950 },
    ],
  },
  // ---------- Tacoma ----------
  {
    slug: "tacoma",
    name: "Tacoma",
    bodyStyle: "Truck",
    segment: "Midsize Pickup",
    notesMd: "All-new 2024+ on TNGA-F. Manual transmission available on TRD Off-Road. i-FORCE MAX hybrid up top.",
    trims: [
      { name: "SR Access Cab 4WD", slug: "tacoma-2025-sr-accesscab-4wd-gas", year: 2025, powertrainKey: "tacoma-2_4t", msrpCad: 47450 },
      { name: "SR5 Double Cab 4WD", slug: "tacoma-2025-sr5-doublecab-4wd-gas", year: 2025, powertrainKey: "tacoma-2_4t", msrpCad: 52450 },
      { name: "TRD Sport Double Cab 4WD", slug: "tacoma-2025-trd-sport-doublecab-4wd-gas", year: 2025, powertrainKey: "tacoma-2_4t", msrpCad: 56450 },
      { name: "TRD Off-Road Double Cab 4WD", slug: "tacoma-2025-trd-off-road-doublecab-4wd-gas", year: 2025, powertrainKey: "tacoma-2_4t", msrpCad: 58950 },
      { name: "Limited Double Cab 4WD", slug: "tacoma-2025-limited-doublecab-4wd-gas", year: 2025, powertrainKey: "tacoma-2_4t", msrpCad: 67450 },
      { name: "TRD Pro Hybrid 4WD", slug: "tacoma-2025-trd-pro-hybrid-4wd", year: 2025, powertrainKey: "tacoma-i-force-max", msrpCad: 76950 },
      { name: "Trailhunter Hybrid 4WD", slug: "tacoma-2025-trailhunter-hybrid-4wd", year: 2025, powertrainKey: "tacoma-i-force-max", msrpCad: 80950 },
      { name: "SR Access Cab 4WD", slug: "tacoma-2026-sr-accesscab-4wd-gas", year: 2026, powertrainKey: "tacoma-2_4t", msrpCad: 48350 },
      { name: "SR5 Double Cab 4WD", slug: "tacoma-2026-sr5-doublecab-4wd-gas", year: 2026, powertrainKey: "tacoma-2_4t", msrpCad: 53350 },
      { name: "TRD Sport Double Cab 4WD", slug: "tacoma-2026-trd-sport-doublecab-4wd-gas", year: 2026, powertrainKey: "tacoma-2_4t", msrpCad: 57350 },
      { name: "TRD Off-Road Double Cab 4WD", slug: "tacoma-2026-trd-off-road-doublecab-4wd-gas", year: 2026, powertrainKey: "tacoma-2_4t", msrpCad: 59850 },
      { name: "Limited Double Cab 4WD", slug: "tacoma-2026-limited-doublecab-4wd-gas", year: 2026, powertrainKey: "tacoma-2_4t", msrpCad: 68350 },
      { name: "TRD Pro Hybrid 4WD", slug: "tacoma-2026-trd-pro-hybrid-4wd", year: 2026, powertrainKey: "tacoma-i-force-max", msrpCad: 77850 },
      { name: "Trailhunter Hybrid 4WD", slug: "tacoma-2026-trailhunter-hybrid-4wd", year: 2026, powertrainKey: "tacoma-i-force-max", msrpCad: 81850 },
    ],
  },
  // ---------- Tundra ----------
  {
    slug: "tundra",
    name: "Tundra",
    bodyStyle: "Truck",
    segment: "Full-size Pickup",
    notesMd: "Twin-turbo V6 base / i-FORCE MAX hybrid up top. Tows up to ~12,000 lb. Compete vs F-150 PowerBoost.",
    trims: [
      { name: "SR5 Double Cab 4WD", slug: "tundra-2025-sr5-doublecab-4wd-gas", year: 2025, powertrainKey: "tundra-3_5tt", msrpCad: 60950 },
      { name: "SR5 CrewMax 4WD", slug: "tundra-2025-sr5-crewmax-4wd-gas", year: 2025, powertrainKey: "tundra-3_5tt", msrpCad: 64950 },
      { name: "Limited CrewMax 4WD", slug: "tundra-2025-limited-crewmax-4wd-gas", year: 2025, powertrainKey: "tundra-3_5tt", msrpCad: 73950 },
      { name: "Platinum CrewMax Hybrid 4WD", slug: "tundra-2025-platinum-crewmax-hybrid-4wd", year: 2025, powertrainKey: "tundra-i-force-max", msrpCad: 84950 },
      { name: "1794 Edition Hybrid 4WD", slug: "tundra-2025-1794-hybrid-4wd", year: 2025, powertrainKey: "tundra-i-force-max", msrpCad: 87950 },
      { name: "TRD Pro Hybrid 4WD", slug: "tundra-2025-trd-pro-hybrid-4wd", year: 2025, powertrainKey: "tundra-i-force-max", msrpCad: 90950 },
      { name: "Capstone Hybrid 4WD", slug: "tundra-2025-capstone-hybrid-4wd", year: 2025, powertrainKey: "tundra-i-force-max", msrpCad: 94950 },
      { name: "SR5 Double Cab 4WD", slug: "tundra-2026-sr5-doublecab-4wd-gas", year: 2026, powertrainKey: "tundra-3_5tt", msrpCad: 61850 },
      { name: "SR5 CrewMax 4WD", slug: "tundra-2026-sr5-crewmax-4wd-gas", year: 2026, powertrainKey: "tundra-3_5tt", msrpCad: 65850 },
      { name: "Limited CrewMax 4WD", slug: "tundra-2026-limited-crewmax-4wd-gas", year: 2026, powertrainKey: "tundra-3_5tt", msrpCad: 74850 },
      { name: "Platinum CrewMax Hybrid 4WD", slug: "tundra-2026-platinum-crewmax-hybrid-4wd", year: 2026, powertrainKey: "tundra-i-force-max", msrpCad: 85850 },
      { name: "1794 Edition Hybrid 4WD", slug: "tundra-2026-1794-hybrid-4wd", year: 2026, powertrainKey: "tundra-i-force-max", msrpCad: 88850 },
      { name: "TRD Pro Hybrid 4WD", slug: "tundra-2026-trd-pro-hybrid-4wd", year: 2026, powertrainKey: "tundra-i-force-max", msrpCad: 91850 },
      { name: "Capstone Hybrid 4WD", slug: "tundra-2026-capstone-hybrid-4wd", year: 2026, powertrainKey: "tundra-i-force-max", msrpCad: 95850 },
    ],
  },
  // ---------- Sienna ----------
  {
    slug: "sienna",
    name: "Sienna",
    bodyStyle: "Minivan",
    segment: "Minivan",
    notesMd: "Hybrid-only minivan, AWD optional. Lead vs Pacifica Hybrid / Odyssey: AWD availability + ~6.7 L/100km combined.",
    trims: [
      { name: "LE Hybrid FWD 7-pass", slug: "sienna-2025-le-hybrid-fwd-7p", year: 2025, powertrainKey: "sienna-hybrid", msrpCad: 49450 },
      { name: "XLE Hybrid AWD 7-pass", slug: "sienna-2025-xle-hybrid-awd-7p", year: 2025, powertrainKey: "sienna-hybrid", msrpCad: 56450 },
      { name: "XSE Hybrid AWD 7-pass", slug: "sienna-2025-xse-hybrid-awd-7p", year: 2025, powertrainKey: "sienna-hybrid", msrpCad: 60450 },
      { name: "Limited Hybrid AWD 7-pass", slug: "sienna-2025-limited-hybrid-awd-7p", year: 2025, powertrainKey: "sienna-hybrid", msrpCad: 65950 },
      { name: "Platinum Hybrid AWD 7-pass", slug: "sienna-2025-platinum-hybrid-awd-7p", year: 2025, powertrainKey: "sienna-hybrid", msrpCad: 70950 },
      { name: "LE Hybrid FWD 7-pass", slug: "sienna-2026-le-hybrid-fwd-7p", year: 2026, powertrainKey: "sienna-hybrid", msrpCad: 50350 },
      { name: "XLE Hybrid AWD 7-pass", slug: "sienna-2026-xle-hybrid-awd-7p", year: 2026, powertrainKey: "sienna-hybrid", msrpCad: 57350 },
      { name: "XSE Hybrid AWD 7-pass", slug: "sienna-2026-xse-hybrid-awd-7p", year: 2026, powertrainKey: "sienna-hybrid", msrpCad: 61350 },
      { name: "Limited Hybrid AWD 7-pass", slug: "sienna-2026-limited-hybrid-awd-7p", year: 2026, powertrainKey: "sienna-hybrid", msrpCad: 66850 },
      { name: "Platinum Hybrid AWD 7-pass", slug: "sienna-2026-platinum-hybrid-awd-7p", year: 2026, powertrainKey: "sienna-hybrid", msrpCad: 71850 },
    ],
  },
  // ---------- GR86 ----------
  {
    slug: "gr86",
    name: "GR86",
    bodyStyle: "Coupe",
    segment: "Sport Coupe",
    notesMd: "Sport-coupe halo. RWD, 6MT or 6AT. Limited allocation, sells fast.",
    trims: [
      { name: "Base MT", slug: "gr86-2025-base-mt", year: 2025, powertrainKey: "gr86-2_4-mt", msrpCad: 33450 },
      { name: "Premium MT", slug: "gr86-2025-premium-mt", year: 2025, powertrainKey: "gr86-2_4-mt", msrpCad: 38450 },
      { name: "Base MT", slug: "gr86-2026-base-mt", year: 2026, powertrainKey: "gr86-2_4-mt", msrpCad: 34350 },
      { name: "Premium MT", slug: "gr86-2026-premium-mt", year: 2026, powertrainKey: "gr86-2_4-mt", msrpCad: 39350 },
    ],
  },
  // ---------- GR Supra ----------
  {
    slug: "gr-supra",
    name: "GR Supra",
    bodyStyle: "Coupe",
    segment: "Premium Sport Coupe",
    notesMd: "Inline-6 turbo, MT or 8AT. Compete vs M2 / Cayman.",
    trims: [
      { name: "3.0 Premium", slug: "gr-supra-2025-3_0-premium", year: 2025, powertrainKey: "supra-3_0t-mt", msrpCad: 73950 },
      { name: "3.0 Premium", slug: "gr-supra-2026-3_0-premium", year: 2026, powertrainKey: "supra-3_0t-mt", msrpCad: 74850 },
    ],
  },
  // ---------- Prius ----------
  {
    slug: "prius",
    name: "Prius",
    bodyStyle: "Hatchback",
    segment: "Compact Hybrid",
    notesMd: "5th-gen redesign. AWD available. Pitch as the most efficient gas vehicle Toyota sells (sub-5 L/100km).",
    trims: [
      { name: "AWD", slug: "prius-2025-awd", year: 2025, powertrainKey: "prius-hybrid-awd", msrpCad: 33950 },
      { name: "XLE AWD", slug: "prius-2025-xle-awd", year: 2025, powertrainKey: "prius-hybrid-awd", msrpCad: 36950 },
      { name: "Limited AWD", slug: "prius-2025-limited-awd", year: 2025, powertrainKey: "prius-hybrid-awd", msrpCad: 40450 },
      { name: "AWD", slug: "prius-2026-awd", year: 2026, powertrainKey: "prius-hybrid-awd", msrpCad: 34850 },
      { name: "XLE AWD", slug: "prius-2026-xle-awd", year: 2026, powertrainKey: "prius-hybrid-awd", msrpCad: 37850 },
      { name: "Limited AWD", slug: "prius-2026-limited-awd", year: 2026, powertrainKey: "prius-hybrid-awd", msrpCad: 41350 },
    ],
  },
  // ---------- Prius Prime (PHEV) ----------
  {
    slug: "prius-prime",
    name: "Prius Prime",
    bodyStyle: "Hatchback",
    segment: "Compact PHEV",
    notesMd: "72 km EV range, qualifies for federal iZEV ($5,000) and applicable ON incentives — check current programs.",
    trims: [
      { name: "SE", slug: "prius-prime-2025-se", year: 2025, powertrainKey: "prius-prime", msrpCad: 39950 },
      { name: "XSE", slug: "prius-prime-2025-xse", year: 2025, powertrainKey: "prius-prime", msrpCad: 43450 },
      { name: "XSE Premium", slug: "prius-prime-2025-xse-premium", year: 2025, powertrainKey: "prius-prime", msrpCad: 46950 },
      { name: "SE", slug: "prius-prime-2026-se", year: 2026, powertrainKey: "prius-prime", msrpCad: 40850 },
      { name: "XSE", slug: "prius-prime-2026-xse", year: 2026, powertrainKey: "prius-prime", msrpCad: 44350 },
      { name: "XSE Premium", slug: "prius-prime-2026-xse-premium", year: 2026, powertrainKey: "prius-prime", msrpCad: 47850 },
    ],
  },
  // ---------- bZ4X (BEV) ----------
  {
    slug: "bz4x",
    name: "bZ4X",
    bodyStyle: "SUV",
    segment: "Compact BEV SUV",
    notesMd: "Toyota's first dedicated BEV in Canada. ~400 km range FWD. Qualifies for federal iZEV — verify current eligibility.",
    trims: [
      { name: "LE FWD", slug: "bz4x-2025-le-fwd", year: 2025, powertrainKey: "bz4x-fwd", msrpCad: 45450 },
      { name: "XLE FWD", slug: "bz4x-2025-xle-fwd", year: 2025, powertrainKey: "bz4x-fwd", msrpCad: 49450 },
      { name: "XLE AWD", slug: "bz4x-2025-xle-awd", year: 2025, powertrainKey: "bz4x-awd", msrpCad: 52450 },
      { name: "Limited AWD", slug: "bz4x-2025-limited-awd", year: 2025, powertrainKey: "bz4x-awd", msrpCad: 56450 },
      { name: "LE FWD", slug: "bz4x-2026-le-fwd", year: 2026, powertrainKey: "bz4x-fwd", msrpCad: 46350 },
      { name: "XLE FWD", slug: "bz4x-2026-xle-fwd", year: 2026, powertrainKey: "bz4x-fwd", msrpCad: 50350 },
      { name: "XLE AWD", slug: "bz4x-2026-xle-awd", year: 2026, powertrainKey: "bz4x-awd", msrpCad: 53350 },
      { name: "Limited AWD", slug: "bz4x-2026-limited-awd", year: 2026, powertrainKey: "bz4x-awd", msrpCad: 57350 },
    ],
  },
];
