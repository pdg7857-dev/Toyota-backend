/**
 * Zone themes: what a zone looks and feels like.
 *
 * This is pure data plus pure maths — no three.js, no DOM. `render/scene.ts`
 * reads it and builds the actual geometry, which means a zone can be
 * re-skinned entirely from here, and the height field can be unit-tested
 * without a browser.
 *
 * The terrain is deliberately **renderer-only**. The sim is 2D: positions are
 * (x, z), distances are flat, and nothing in `sim/` samples a height. Making
 * ground height authoritative would mean line-of-sight, slope costs and a
 * heightmap both sides have to agree on — a large amount of new surface for a
 * visual that a fixed camera barely sells. So terrain moves the *view* of an
 * entity up and down and nothing else. If real terrain ever becomes gameplay,
 * `HeightField` is the thing to move into `sim/`, and it is already pure.
 */

/** Shape of the ground itself. */
export interface TerrainSpec {
  /** Peak displacement in world units, up and down from zero. */
  amplitude: number;
  /** Feature size: bigger means broader, lazier hills. */
  featureSize: number;
  /** Weight of the fine second octave — broken, rocky ground. 0..1. */
  roughness: number;
  /**
   * Number of steps to quantise height into. 0 leaves the ground smooth;
   * higher values read as shelves and crags rather than rolling moor.
   */
  terrace?: number;
}

export type PropKind =
  | 'broadleaf'
  | 'conifer'
  | 'deadTree'
  | 'rock'
  | 'boulder'
  | 'standingStone'
  | 'reed'
  | 'mushroom'
  | 'crystal';

export interface PropSpec {
  kind: PropKind;
  /** How many to *attempt*; anything landing in a clearing is skipped. */
  count: number;
  /** Base size multiplier. */
  scale: number;
  /** Random size spread as a fraction of `scale`. */
  jitter?: number;
  /** Primary colour (trunk, stone, stalk). */
  color: number;
  /** Secondary colour (foliage, cap, crystal core). */
  accent?: number;
  /** 0..1 emissive strength on the accent, for anything that should glow. */
  glow?: number;
}

export interface ZoneTheme {
  id: string;
  /** One line, shown on the zone banner — this is the pitch for the place. */
  blurb: string;
  sky: number;
  fog: { color: number; near: number; far: number };
  /** The two colours the ground lerps between. */
  ground: { dry: number; damp: number };
  hemisphere: { sky: number; ground: number; intensity: number };
  sun: { color: number; intensity: number; position: [number, number, number] };
  boundary: number;
  terrain: TerrainSpec;
  props: PropSpec[];
  /** Drifting particles. The Otherworld's whole atmosphere, basically. */
  motes?: { count: number; color: number; size: number; height: number };
}

/**
 * Layered sine height. Deterministic, cheap, and continuous everywhere, so the
 * renderer can sample it per-vertex and per-entity every frame without a cache.
 *
 * It is not real noise — sines betray themselves as a grid if you stare at a
 * flyover — but at player camera height, under fog, with scatter on top, the
 * difference is invisible and the cost is a handful of multiplies.
 */
export function terrainHeight(x: number, z: number, t: TerrainSpec): number {
  const f = 1 / Math.max(1, t.featureSize);
  let h =
    Math.sin(x * f) * Math.cos(z * f * 0.9) * 0.6 +
    Math.sin((x + z) * f * 1.7 + 1.3) * 0.25 +
    Math.cos((x - z) * f * 2.6 + 0.7) * 0.15;
  h += Math.sin(x * f * 5.1 + 2.1) * Math.cos(z * f * 4.3 - 1.1) * t.roughness * 0.35;
  if (t.terrace && t.terrace > 0) {
    // Blend the stepped version with the smooth one: pure quantisation reads as
    // a staircase, a blend reads as shelves worn down by weather.
    const stepped = Math.round(h * t.terrace) / t.terrace;
    h = stepped * 0.7 + h * 0.3;
  }
  return h * t.amplitude;
}

/** Fraction of a clearing's radius that is dead flat before the blend starts. */
const CLEARING_CORE = 0.6;

/** Somewhere that must be level: a spawn point, a boss arena, a shopfront. */
export interface Clearing {
  x: number;
  z: number;
  r: number;
}

/**
 * The height field for one zone: the theme's terrain, flattened out under every
 * clearing.
 *
 * Flattening is not decoration. A boss telegraph is a flat circle drawn on the
 * ground, and the whole fight is decided by reading it — draped over a slope it
 * either clips into the hill or floats above it, and either way the player
 * cannot tell where the edge is. Arenas are level for the same reason a real
 * arena is.
 */
export class HeightField {
  constructor(
    private readonly spec: TerrainSpec,
    private readonly clearings: Clearing[] = [],
  ) {}

  at(x: number, z: number): number {
    const raw = terrainHeight(x, z, this.spec);
    let out = raw;
    for (const c of this.clearings) {
      const d = Math.hypot(x - c.x, z - c.z);
      if (d >= c.r) continue;
      // Genuinely flat across the inner core, then smoothstepped out to
      // untouched at the rim.
      //
      // A blend that starts easing from the centre is not good enough: a boss
      // telegraph is up to 7m across and you dodge it by running further than
      // that, so anything less than a real plateau leaves the fight happening
      // on a slope no matter how gentle the curve is.
      const core = c.r * CLEARING_CORE;
      const t = Math.max(0, Math.min(1, (d - core) / (c.r - core)));
      const blend = t * t * (3 - 2 * t);
      const level = terrainHeight(c.x, c.z, this.spec);
      // Pull TOWARDS the clearing's level, in both directions. Only ever
      // lowering the ground leaves the hollows untouched, which is how half of
      // Aonghus's arena ended up as a pit with a flat floor around it.
      out = level + (out - level) * blend;
    }
    return out;
  }
}

export const THEMES: Record<string, ZoneTheme> = {
  /** The Fenmarch: ordinary country. Open moor, low hills, wet in the hollows. */
  plains: {
    id: 'plains',
    blurb: 'Open moor and low hills, wet underfoot.',
    sky: 0x8fa9b8,
    fog: { color: 0x8fa9b8, near: 45, far: 130 },
    ground: { dry: 0x6d854a, damp: 0x3f5a33 },
    hemisphere: { sky: 0xbcd6e8, ground: 0x4a5a3a, intensity: 0.85 },
    sun: { color: 0xfff0d0, intensity: 1.5, position: [30, 55, 20] },
    boundary: 0x3d4a33,
    terrain: { amplitude: 2.4, featureSize: 44, roughness: 0.22 },
    props: [
      { kind: 'broadleaf', count: 110, scale: 1, jitter: 0.6, color: 0x4a3a2a, accent: 0x35562f },
      { kind: 'rock', count: 70, scale: 1, jitter: 0.9, color: 0x6d6d68 },
      { kind: 'standingStone', count: 12, scale: 1.1, jitter: 0.4, color: 0x7d7c74 },
      { kind: 'reed', count: 55, scale: 1, jitter: 0.5, color: 0x6f7a42 },
    ],
  },

  /** Ardmoor: the high country. Crags, shelves, thin soil, colder light. */
  crags: {
    id: 'crags',
    blurb: 'High crags and broken shelves. Thin soil, colder wind.',
    sky: 0x9aa5ac,
    fog: { color: 0x9aa5ac, near: 38, far: 118 },
    ground: { dry: 0x7a7256, damp: 0x474a38 },
    hemisphere: { sky: 0xc4cdd4, ground: 0x51503f, intensity: 0.8 },
    sun: { color: 0xe8ecf0, intensity: 1.25, position: [-24, 48, 26] },
    boundary: 0x4b4a41,
    terrain: { amplitude: 7.5, featureSize: 34, roughness: 0.55, terrace: 5 },
    props: [
      { kind: 'boulder', count: 95, scale: 1.2, jitter: 1, color: 0x74736a },
      { kind: 'rock', count: 85, scale: 1, jitter: 0.9, color: 0x6a6960 },
      { kind: 'conifer', count: 65, scale: 0.9, jitter: 0.5, color: 0x453626, accent: 0x2c4630 },
      { kind: 'deadTree', count: 28, scale: 1, jitter: 0.5, color: 0x5b5145 },
      { kind: 'standingStone', count: 18, scale: 1.3, jitter: 0.5, color: 0x807e73 },
    ],
  },

  /**
   * The Sunken Wood: a drowned forest gone strange. Dense canopy, standing
   * water, fungus that gives off its own light.
   *
   * The glow is the *place*, not the bestiary — what lives here is still eels,
   * pike, herons and people hiding from the law. The grounded rule holds.
   */
  wyldwood: {
    id: 'wyldwood',
    blurb: 'A drowned wood gone strange. Close canopy, standing water, cold light.',
    sky: 0x24413c,
    fog: { color: 0x24413c, near: 24, far: 92 },
    ground: { dry: 0x4a7c52, damp: 0x264536 },
    hemisphere: { sky: 0x8fd0b4, ground: 0x24382d, intensity: 1.1 },
    sun: { color: 0xdcf3cc, intensity: 1.3, position: [18, 60, -22] },
    boundary: 0x2b4033,
    terrain: { amplitude: 3.6, featureSize: 26, roughness: 0.5 },
    props: [
      { kind: 'broadleaf', count: 210, scale: 1.25, jitter: 0.7, color: 0x33291f, accent: 0x1f4433 },
      { kind: 'conifer', count: 80, scale: 1.15, jitter: 0.6, color: 0x2e2519, accent: 0x1a3b2c },
      { kind: 'mushroom', count: 130, scale: 1, jitter: 0.8, color: 0xd6cbb0, accent: 0x6fe8c8, glow: 0.9 },
      { kind: 'reed', count: 90, scale: 1.2, jitter: 0.6, color: 0x4d6b44 },
      { kind: 'deadTree', count: 35, scale: 1.2, jitter: 0.6, color: 0x3d3529 },
      { kind: 'rock', count: 30, scale: 1, jitter: 0.8, color: 0x4c5750 },
    ],
    motes: { count: 260, color: 0x9ff0d0, size: 0.16, height: 6 },
  },

  /**
   * Caer Dubh: the Otherworld side of the black fort. Violet twilight that
   * never turns into night, glass shelves of rock, standing stones lit from
   * somewhere that is not the sky.
   */
  otherworld: {
    id: 'otherworld',
    blurb: 'Twilight that never breaks. Glass shelves, lit stones, no sun to speak of.',
    sky: 0x1b1533,
    fog: { color: 0x1b1533, near: 22, far: 96 },
    ground: { dry: 0x554379, damp: 0x241a3f },
    hemisphere: { sky: 0xb094f0, ground: 0x2a2145, intensity: 1.35 },
    sun: { color: 0xe4d6ff, intensity: 1.2, position: [-30, 40, -30] },
    boundary: 0x2a2145,
    terrain: { amplitude: 5.8, featureSize: 30, roughness: 0.5, terrace: 3 },
    props: [
      { kind: 'crystal', count: 95, scale: 1.1, jitter: 0.9, color: 0x4a3f78, accent: 0xb08cff, glow: 1 },
      { kind: 'standingStone', count: 34, scale: 1.4, jitter: 0.5, color: 0x3a3358, accent: 0x9d7dff, glow: 0.55 },
      { kind: 'deadTree', count: 60, scale: 1.15, jitter: 0.6, color: 0x2c2440 },
      { kind: 'boulder', count: 45, scale: 1.2, jitter: 0.9, color: 0x342c52 },
      { kind: 'mushroom', count: 45, scale: 1.1, jitter: 0.8, color: 0x51466f, accent: 0xff9ae0, glow: 0.8 },
    ],
    motes: { count: 420, color: 0xc9aaff, size: 0.2, height: 9 },
  },
};

export function getTheme(id: string | undefined): ZoneTheme {
  const theme = THEMES[id ?? 'plains'];
  if (!theme) throw new Error(`Unknown zone theme: ${id}`);
  return theme;
}
