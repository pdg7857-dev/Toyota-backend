// Toyota Canada commonly available body colors as of 2025/2026.
// Premium charges vary; reps should verify exact upcharges from the dealer
// pricing tool before quoting. Values here are reasonable defaults.

import { BodyColorType } from "@prisma/client";

export type BodyColorSeed = {
  slug: string;
  name: string;
  hex?: string;
  type: BodyColorType;
  notesMd?: string;
};

export const BODY_COLORS: BodyColorSeed[] = [
  // White family
  { slug: "super-white", name: "Super White", hex: "#FFFFFF", type: BodyColorType.STANDARD },
  { slug: "wind-chill-pearl", name: "Wind Chill Pearl", hex: "#F1F0EC", type: BodyColorType.PEARL,
    notesMd: "Premium pearl — usually $255 upcharge on most models." },
  { slug: "ice-cap", name: "Ice Cap", hex: "#FFFFFF", type: BodyColorType.STANDARD,
    notesMd: "RAV4 / Highlander 'Ice Cap' is functionally a white with slight blue undertone." },
  { slug: "blizzard-pearl", name: "Blizzard Pearl", hex: "#F2F0EB", type: BodyColorType.PEARL,
    notesMd: "Premium pearl variant." },

  // Silver / gray
  { slug: "celestial-silver-metallic", name: "Celestial Silver Metallic", hex: "#B9BFC4", type: BodyColorType.METALLIC },
  { slug: "magnetic-gray-metallic", name: "Magnetic Gray Metallic", hex: "#3C3F46", type: BodyColorType.METALLIC },
  { slug: "underground", name: "Underground", hex: "#4A4F53", type: BodyColorType.METALLIC,
    notesMd: "Tacoma / 4Runner trim-restricted." },
  { slug: "lunar-rock", name: "Lunar Rock", hex: "#7A7B79", type: BodyColorType.METALLIC,
    notesMd: "TRD Pro / Trailhunter trim-restricted greenish-gray." },

  // Black
  { slug: "midnight-black-metallic", name: "Midnight Black Metallic", hex: "#0A0A0A", type: BodyColorType.METALLIC },
  { slug: "black", name: "Black", hex: "#000000", type: BodyColorType.STANDARD },

  // Red
  { slug: "ruby-flare-pearl", name: "Ruby Flare Pearl", hex: "#9F1A20", type: BodyColorType.PEARL,
    notesMd: "Pearl premium — typically $255 upcharge." },
  { slug: "supersonic-red", name: "Supersonic Red", hex: "#B00C13", type: BodyColorType.STANDARD,
    notesMd: "RAV4 / Camry. Vibrant — popular pick." },
  { slug: "barcelona-red-metallic", name: "Barcelona Red Metallic", hex: "#811A20", type: BodyColorType.METALLIC },

  // Blue
  { slug: "blueprint", name: "Blueprint", hex: "#3F5C77", type: BodyColorType.STANDARD,
    notesMd: "Common on RAV4, Highlander. Discontinued on some MY26 models." },
  { slug: "cavalry-blue", name: "Cavalry Blue", hex: "#374B65", type: BodyColorType.STANDARD,
    notesMd: "Tacoma / 4Runner only." },
  { slug: "blue-crush-metallic", name: "Blue Crush Metallic", hex: "#1F4F8C", type: BodyColorType.METALLIC },
  { slug: "reservoir-blue", name: "Reservoir Blue", hex: "#0B2D52", type: BodyColorType.STANDARD,
    notesMd: "Crown / Crown Signia." },
  { slug: "sea-glass-pearl", name: "Sea Glass Pearl", hex: "#A8BFC6", type: BodyColorType.PEARL,
    notesMd: "Premium pearl. Available on select sedans." },

  // Green
  { slug: "army-green", name: "Army Green", hex: "#5A6347", type: BodyColorType.STANDARD,
    notesMd: "Tacoma / 4Runner / RAV4 Woodland." },

  // Two-tone (Crown family, TRD Pro, RAV4 XSE)
  { slug: "supersonic-red-two-tone", name: "Supersonic Red w/ Midnight Black Roof", hex: "#B00C13", type: BodyColorType.TWO_TONE,
    notesMd: "Common two-tone on RAV4 XSE / Limited. Premium $500–$700 typical." },
  { slug: "bronze-age-two-tone", name: "Bronze Age w/ Black Roof", hex: "#7A5A3A", type: BodyColorType.TWO_TONE,
    notesMd: "Crown two-tone signature combo." },
];
