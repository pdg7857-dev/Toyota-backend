// Tow / payload ratings for truck and SUV trims. Numbers are approximate
// Toyota Canada / Lexus Canada figures — verify against the spec sheet before
// quoting customers.

export const TOW_RATINGS: Array<{
  trimSlug: string;
  towRatingLbs?: number;
  payloadLbs?: number;
  gvwrLbs?: number;
}> = [
  // ===== Tacoma =====
  { trimSlug: "tacoma-2025-sr-accesscab-4wd-gas", towRatingLbs: 3500, payloadLbs: 1685 },
  { trimSlug: "tacoma-2025-sr5-doublecab-4wd-gas", towRatingLbs: 6500, payloadLbs: 1685 },
  { trimSlug: "tacoma-2025-trd-sport-doublecab-4wd-gas", towRatingLbs: 6500, payloadLbs: 1610 },
  { trimSlug: "tacoma-2025-trd-off-road-doublecab-4wd-gas", towRatingLbs: 6500, payloadLbs: 1610 },
  { trimSlug: "tacoma-2025-limited-doublecab-4wd-gas", towRatingLbs: 6500, payloadLbs: 1545 },
  { trimSlug: "tacoma-2025-trd-pro-hybrid-4wd", towRatingLbs: 6000, payloadLbs: 1545 },
  { trimSlug: "tacoma-2025-trailhunter-hybrid-4wd", towRatingLbs: 6000, payloadLbs: 1545 },
  { trimSlug: "tacoma-2026-sr-accesscab-4wd-gas", towRatingLbs: 3500, payloadLbs: 1685 },
  { trimSlug: "tacoma-2026-sr5-doublecab-4wd-gas", towRatingLbs: 6500, payloadLbs: 1685 },
  { trimSlug: "tacoma-2026-trd-sport-doublecab-4wd-gas", towRatingLbs: 6500, payloadLbs: 1610 },
  { trimSlug: "tacoma-2026-trd-off-road-doublecab-4wd-gas", towRatingLbs: 6500, payloadLbs: 1610 },
  { trimSlug: "tacoma-2026-limited-doublecab-4wd-gas", towRatingLbs: 6500, payloadLbs: 1545 },
  { trimSlug: "tacoma-2026-trd-pro-hybrid-4wd", towRatingLbs: 6000, payloadLbs: 1545 },
  { trimSlug: "tacoma-2026-trailhunter-hybrid-4wd", towRatingLbs: 6000, payloadLbs: 1545 },

  // ===== Tundra =====
  { trimSlug: "tundra-2025-sr5-doublecab-4wd-gas", towRatingLbs: 12000, payloadLbs: 1940 },
  { trimSlug: "tundra-2025-sr5-crewmax-4wd-gas", towRatingLbs: 11380, payloadLbs: 1730 },
  { trimSlug: "tundra-2025-limited-crewmax-4wd-gas", towRatingLbs: 11380, payloadLbs: 1730 },
  { trimSlug: "tundra-2025-platinum-crewmax-hybrid-4wd", towRatingLbs: 11000, payloadLbs: 1525 },
  { trimSlug: "tundra-2025-1794-hybrid-4wd", towRatingLbs: 11000, payloadLbs: 1525 },
  { trimSlug: "tundra-2025-trd-pro-hybrid-4wd", towRatingLbs: 11175, payloadLbs: 1485 },
  { trimSlug: "tundra-2025-capstone-hybrid-4wd", towRatingLbs: 10340, payloadLbs: 1485 },
  { trimSlug: "tundra-2026-sr5-doublecab-4wd-gas", towRatingLbs: 12000, payloadLbs: 1940 },
  { trimSlug: "tundra-2026-sr5-crewmax-4wd-gas", towRatingLbs: 11380, payloadLbs: 1730 },
  { trimSlug: "tundra-2026-limited-crewmax-4wd-gas", towRatingLbs: 11380, payloadLbs: 1730 },
  { trimSlug: "tundra-2026-platinum-crewmax-hybrid-4wd", towRatingLbs: 11000, payloadLbs: 1525 },
  { trimSlug: "tundra-2026-1794-hybrid-4wd", towRatingLbs: 11000, payloadLbs: 1525 },
  { trimSlug: "tundra-2026-trd-pro-hybrid-4wd", towRatingLbs: 11175, payloadLbs: 1485 },
  { trimSlug: "tundra-2026-capstone-hybrid-4wd", towRatingLbs: 10340, payloadLbs: 1485 },

  // ===== Sequoia =====
  { trimSlug: "sequoia-2025-sr5-4wd", towRatingLbs: 9520, payloadLbs: 1730 },
  { trimSlug: "sequoia-2025-limited-4wd", towRatingLbs: 9020, payloadLbs: 1610 },
  { trimSlug: "sequoia-2025-platinum-4wd", towRatingLbs: 8980, payloadLbs: 1570 },
  { trimSlug: "sequoia-2025-trd-pro-4wd", towRatingLbs: 8980, payloadLbs: 1500 },
  { trimSlug: "sequoia-2025-capstone-4wd", towRatingLbs: 8980, payloadLbs: 1500 },
  { trimSlug: "sequoia-2026-sr5-4wd", towRatingLbs: 9520, payloadLbs: 1730 },
  { trimSlug: "sequoia-2026-limited-4wd", towRatingLbs: 9020, payloadLbs: 1610 },
  { trimSlug: "sequoia-2026-platinum-4wd", towRatingLbs: 8980, payloadLbs: 1570 },
  { trimSlug: "sequoia-2026-trd-pro-4wd", towRatingLbs: 8980, payloadLbs: 1500 },
  { trimSlug: "sequoia-2026-capstone-4wd", towRatingLbs: 8980, payloadLbs: 1500 },

  // ===== 4Runner =====
  { trimSlug: "4runner-2025-sr5-4wd", towRatingLbs: 6000, payloadLbs: 1545 },
  { trimSlug: "4runner-2025-trd-off-road-4wd", towRatingLbs: 6000, payloadLbs: 1545 },
  { trimSlug: "4runner-2025-trd-sport-4wd", towRatingLbs: 6000, payloadLbs: 1545 },
  { trimSlug: "4runner-2025-limited-4wd", towRatingLbs: 6000, payloadLbs: 1525 },
  { trimSlug: "4runner-2025-trd-pro-hybrid-4wd", towRatingLbs: 6000, payloadLbs: 1525 },
  { trimSlug: "4runner-2025-trailhunter-hybrid-4wd", towRatingLbs: 6000, payloadLbs: 1525 },
  { trimSlug: "4runner-2026-sr5-4wd", towRatingLbs: 6000, payloadLbs: 1545 },
  { trimSlug: "4runner-2026-trd-off-road-4wd", towRatingLbs: 6000, payloadLbs: 1545 },
  { trimSlug: "4runner-2026-trd-sport-4wd", towRatingLbs: 6000, payloadLbs: 1545 },
  { trimSlug: "4runner-2026-limited-4wd", towRatingLbs: 6000, payloadLbs: 1525 },
  { trimSlug: "4runner-2026-trd-pro-hybrid-4wd", towRatingLbs: 6000, payloadLbs: 1525 },
  { trimSlug: "4runner-2026-trailhunter-hybrid-4wd", towRatingLbs: 6000, payloadLbs: 1525 },

  // ===== Land Cruiser =====
  { trimSlug: "land-cruiser-2025-1958-hybrid-4wd", towRatingLbs: 6000, payloadLbs: 1495 },
  { trimSlug: "land-cruiser-2025-hybrid-4wd", towRatingLbs: 6000, payloadLbs: 1495 },
  { trimSlug: "land-cruiser-2026-1958-hybrid-4wd", towRatingLbs: 6000, payloadLbs: 1495 },
  { trimSlug: "land-cruiser-2026-hybrid-4wd", towRatingLbs: 6000, payloadLbs: 1495 },

  // ===== Highlander / Grand Highlander =====
  { trimSlug: "highlander-2026-le-awd-gas", towRatingLbs: 5000, payloadLbs: 1565 },
  { trimSlug: "highlander-2026-xle-awd-gas", towRatingLbs: 5000, payloadLbs: 1565 },
  { trimSlug: "highlander-2026-limited-awd-gas", towRatingLbs: 5000, payloadLbs: 1565 },
  { trimSlug: "highlander-2026-platinum-awd-gas", towRatingLbs: 5000, payloadLbs: 1565 },
  { trimSlug: "highlander-2026-le-hybrid-awd", towRatingLbs: 3500, payloadLbs: 1370 },
  { trimSlug: "highlander-2026-xle-hybrid-awd", towRatingLbs: 3500, payloadLbs: 1370 },
  { trimSlug: "highlander-2026-limited-hybrid-awd", towRatingLbs: 3500, payloadLbs: 1370 },
  { trimSlug: "highlander-2026-platinum-hybrid-awd", towRatingLbs: 3500, payloadLbs: 1370 },
  { trimSlug: "grand-highlander-2026-xle-hybrid-awd", towRatingLbs: 3500, payloadLbs: 1485 },
  { trimSlug: "grand-highlander-2026-limited-hybrid-awd", towRatingLbs: 3500, payloadLbs: 1485 },
  { trimSlug: "grand-highlander-2026-platinum-hybrid-max-awd", towRatingLbs: 8000, payloadLbs: 1430 },

  // ===== RAV4 =====
  { trimSlug: "rav4-2026-le-hybrid-awd", towRatingLbs: 1750 },
  { trimSlug: "rav4-2026-xle-hybrid-awd", towRatingLbs: 1750 },
  { trimSlug: "rav4-2026-xse-hybrid-awd", towRatingLbs: 1750 },
  { trimSlug: "rav4-2026-woodland-hybrid-awd", towRatingLbs: 1750 },
  { trimSlug: "rav4-2026-limited-hybrid-awd", towRatingLbs: 1750 },
  { trimSlug: "rav4-2026-se-phev-awd", towRatingLbs: 2500 },
  { trimSlug: "rav4-2026-xse-phev-awd", towRatingLbs: 2500 },

  // ===== Lexus GX =====
  { trimSlug: "lexus-gx-2025-550-premium", towRatingLbs: 9063, payloadLbs: 1635 },
  { trimSlug: "lexus-gx-2025-550-overtrail", towRatingLbs: 8000, payloadLbs: 1545 },
  { trimSlug: "lexus-gx-2025-550-overtrail-plus", towRatingLbs: 8000, payloadLbs: 1545 },
  { trimSlug: "lexus-gx-2025-550-executive", towRatingLbs: 9063, payloadLbs: 1635 },
  { trimSlug: "lexus-gx-2026-550-premium", towRatingLbs: 9063, payloadLbs: 1635 },
  { trimSlug: "lexus-gx-2026-550-overtrail", towRatingLbs: 8000, payloadLbs: 1545 },
  { trimSlug: "lexus-gx-2026-550-overtrail-plus", towRatingLbs: 8000, payloadLbs: 1545 },
  { trimSlug: "lexus-gx-2026-550-executive", towRatingLbs: 9063, payloadLbs: 1635 },

  // ===== Lexus LX =====
  { trimSlug: "lexus-lx-2025-600-signature", towRatingLbs: 8000, payloadLbs: 1465 },
  { trimSlug: "lexus-lx-2025-600-fsport3", towRatingLbs: 8000, payloadLbs: 1465 },
  { trimSlug: "lexus-lx-2025-700h-overtrail", towRatingLbs: 8000, payloadLbs: 1395 },
  { trimSlug: "lexus-lx-2026-600-signature", towRatingLbs: 8000, payloadLbs: 1465 },
  { trimSlug: "lexus-lx-2026-700h-overtrail", towRatingLbs: 8000, payloadLbs: 1395 },

  // ===== Lexus TX =====
  { trimSlug: "lexus-tx-2025-350-premium", towRatingLbs: 5000, payloadLbs: 1370 },
  { trimSlug: "lexus-tx-2025-500h-fsport2", towRatingLbs: 5000, payloadLbs: 1370 },
  { trimSlug: "lexus-tx-2025-550h-plus-luxury", towRatingLbs: 5000, payloadLbs: 1370 },
  { trimSlug: "lexus-tx-2026-350-premium", towRatingLbs: 5000, payloadLbs: 1370 },
  { trimSlug: "lexus-tx-2026-500h-fsport2", towRatingLbs: 5000, payloadLbs: 1370 },
  { trimSlug: "lexus-tx-2026-550h-plus-luxury", towRatingLbs: 5000, payloadLbs: 1370 },
];
