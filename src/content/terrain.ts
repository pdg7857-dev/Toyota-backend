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
  /** Peak displacement of the rolling ground, up and down from zero. */
  amplitude: number;
  /** Feature size: bigger means broader, lazier hills. */
  featureSize: number;
  /** Weight of the fine octaves — broken, rocky ground. 0..1. */
  roughness: number;
  /**
   * Number of steps to quantise height into. 0 leaves the ground smooth;
   * higher values read as shelves and crags rather than rolling moor.
   */
  terrace?: number;
  /**
   * The high ground.
   *
   * Separate from `amplitude` because mountains are not just louder hills: they
   * come in ranges with ridgelines and passes, they only occupy part of a map,
   * and the ground between them has to stay walkable. `mask` is how much of the
   * zone they claim — the rest of it never sees them.
   */
  mountains?: {
    amplitude: number;
    featureSize: number;
    /** How much of the map is high country, 0..1. */
    mask: number;
  };
  /**
   * Where the water sits, in world units.
   *
   * Anything below this is under it. The ground is *carved* toward it rather
   * than merely covered, so lakes have beds and rivers have banks instead of a
   * sheet of blue laid over a hillside.
   */
  waterLevel?: number;
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
  /**
   * How the water reads. Present only where the terrain has a `waterLevel`.
   *
   * Colour rather than shader: at this art level water is a flat translucent
   * sheet, and what sells it is the ground being carved away underneath and
   * the shore tint on the bank — not the surface.
   */
  water?: { color: number; opacity: number };
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
 * Value noise, and the fractal sum of it.
 *
 * The ground used to be layered sines. That is cheap and continuous, and on a
 * three-hundred-metre map under fog nobody could tell — but a zone is ten times
 * that across now, and sines betray themselves as a grid the moment you can see
 * far enough to notice one. This is a hashed lattice with smoothstep
 * interpolation: the same cost bracket, no grid, and still a pure function of
 * (x, z) so the renderer can sample it per-vertex every frame without a cache.
 */
function lattice(ix: number, iz: number, seed: number): number {
  let h = ix * 374761393 + iz * 668265263 + seed * 1442695040888963407;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = lattice(ix, iz, seed);
  const b = lattice(ix + 1, iz, seed);
  const c = lattice(ix, iz + 1, seed);
  const d = lattice(ix + 1, iz + 1, seed);
  return (a + (b - a) * sx) * (1 - sz) + (c + (d - c) * sx) * sz;
}

/** Fractal sum: broad shapes first, finer detail on top. */
function fbm(x: number, z: number, octaves: number, seed: number, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, z * freq, seed + i * 101) * amp;
    norm += amp;
    amp *= gain;
    freq *= 2.03;
  }
  return sum / norm;
}

/**
 * Ridged noise: what makes a mountain a mountain.
 *
 * Ordinary noise gives rounded lumps. Folding it about its midpoint turns the
 * zero crossings into creases, and those creases are ridgelines — so a range
 * has spines and passes instead of being a big smooth dome.
 */
function ridged(x: number, z: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(valueNoise(x * freq, z * freq, seed + i * 313) * 2 - 1);
    sum += n * n * amp;
    norm += amp;
    amp *= 0.52;
    freq *= 2.07;
  }
  return sum / norm;
}

/**
 * The ground at a point: rolling country, high country on top of it, and water
 * cut into the low places.
 *
 * Three layers, each doing a job the others cannot:
 *
 *  - **hills** — the fractal base. Always present, walkable everywhere.
 *  - **mountains** — ridged noise, gated behind a slow mask so a range occupies
 *    part of a zone rather than all of it. A map that is mountains everywhere
 *    is as flat, in the sense that matters, as one that is mountains nowhere.
 *  - **water** — the low ground is pulled *down* toward the water line rather
 *    than the water being laid over it, so a lake has a bed and a shore. Laying
 *    a blue plane over untouched terrain gives you puddles on hillsides.
 */
export function terrainHeight(x: number, z: number, t: TerrainSpec): number {
  const f = 1 / Math.max(1, t.featureSize);
  const base = fbm(x * f, z * f, 4, 1, 0.5 + t.roughness * 0.22) * 2 - 1;
  let h = base * t.amplitude;

  if (t.mountains) {
    const mf = 1 / Math.max(1, t.mountains.featureSize);
    // A slow mask decides where the high country is at all. Smoothstepped, so
    // a range rises out of the hills instead of starting at a cliff.
    const region = fbm(x * mf * 0.42, z * mf * 0.42, 2, 77);
    const cut = 1 - t.mountains.mask;
    const m = Math.max(0, Math.min(1, (region - cut) / Math.max(0.08, 1 - cut)));
    const shaped = m * m * (3 - 2 * m);
    h += ridged(x * mf, z * mf, 4, 909) * shaped * t.mountains.amplitude;
  }

  if (t.terrace && t.terrace > 0) {
    // Blend the stepped version with the smooth one: pure quantisation reads as
    // a staircase, a blend reads as shelves worn down by weather.
    const stepped = Math.round(h * t.terrace) / t.terrace;
    h = stepped * 0.7 + h * 0.3;
  }

  if (t.waterLevel !== undefined) {
    const depth = t.waterLevel - h;
    // Only the ground already heading below the line gets carved, and the
    // carve eases in, so a shoreline is a beach rather than a step.
    if (depth > 0) {
      const bite = Math.min(1, depth / WATER_CARVE);
      h -= bite * bite * WATER_CARVE * 0.85;
    }
  }
  return h;
}

/** How deep the ground is cut below the water line at its deepest. */
const WATER_CARVE = 9;

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
      // Never level a clearing to the bottom of a lake: a shopfront or a boss
      // arena is somewhere you stand, so it comes up out of the water if the
      // ground it was authored on turned out to be under it.
      const level = this.levelAt(c.x, c.z);
      // Pull TOWARDS the clearing's level, in both directions. Only ever
      // lowering the ground leaves the hollows untouched, which is how half of
      // Aonghus's arena ended up as a pit with a flat floor around it.
      out = level + (out - level) * blend;
    }
    return out;
  }

  /** The height a clearing flattens to: its own ground, or dry land. */
  private levelAt(x: number, z: number): number {
    const raw = terrainHeight(x, z, this.spec);
    const water = this.spec.waterLevel;
    return water === undefined ? raw : Math.max(raw, water + SHORE_CLEARANCE);
  }

  /** True if this point is under water. */
  underwater(x: number, z: number): boolean {
    const water = this.spec.waterLevel;
    return water !== undefined && this.at(x, z) < water;
  }

  /**
   * The height something *standing* here should be drawn at.
   *
   * The sim is flat and stays flat — nothing in `sim/` samples a height, and a
   * test enforces it — so a creature chased across a tarn keeps walking in a
   * straight line through it. What it must not do is walk along the *bottom*,
   * which is what drawing it at ground height does: a wolf strolling four
   * metres under the surface of a lake is the single most broken-looking thing
   * a flat simulation can produce.
   *
   * Wading is the renderer's answer, and it is entirely the renderer's
   * business: draw it at the water line, a little sunk. It costs nothing, it
   * needs no agreement from the sim, and it turns the one visible consequence
   * of flat movement into something that reads as deliberate.
   */
  standHeight(x: number, z: number): number {
    const ground = this.at(x, z);
    const water = this.spec.waterLevel;
    if (water === undefined || ground >= water) return ground;
    // Deeper water does not mean a deeper wade — past a certain point things
    // are swimming, and swimming is level with the surface.
    return water - Math.min(WADE_DEPTH, water - ground) * 0.45;
  }

  /**
   * The height nothing should ever be *below*: the ground, or the surface of
   * whatever is lying on it.
   *
   * The camera clamps to this. It used to clamp to `at()` — the lake **bed** —
   * so wading into a tarn put the camera under the surface and the whole
   * screen went the colour of the water plane, with the world behind it. There
   * is no swimming in this game and nothing to look at down there; the one
   * thing a player does in water is walk through it, and they have to be able
   * to see while they do.
   */
  clearHeight(x: number, z: number): number {
    const water = this.spec.waterLevel;
    const ground = this.at(x, z);
    return water === undefined ? ground : Math.max(ground, water);
  }
}

/** How far into the water a wading creature sits, at most. */
const WADE_DEPTH = 1.1;

/** How far above the water line anything walkable is levelled to. */
export const SHORE_CLEARANCE = 1.6;

export const THEMES: Record<string, ZoneTheme> = {
  /** The Fenmarch: ordinary country. Open moor, low hills, wet in the hollows. */
  plains: {
    id: 'plains',
    blurb: 'Open moor and low hills, wet underfoot.',
    sky: 0x8fa9b8,
    fog: { color: 0x8fa9b8, near: 200, far: 425 },
    water: { color: 0x2f4a5c, opacity: 0.78 },
    ground: { dry: 0x6d854a, damp: 0x3f5a33 },
    hemisphere: { sky: 0xbcd6e8, ground: 0x4a5a3a, intensity: 0.85 },
    sun: { color: 0xfff0d0, intensity: 1.5, position: [30, 55, 20] },
    boundary: 0x3d4a33,
    // Open moor: broad, gentle, wet in the hollows. One line of hills along
    // part of it so the horizon is not a ruler, and tarns in the low ground —
    // this is the zone a player learns the game in, so it stays walkable.
    terrain: {
      amplitude: 11,
      featureSize: 320,
      roughness: 0.24,
      mountains: { amplitude: 42, featureSize: 620, mask: 0.3 },
      waterLevel: -4.2,
    },
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
    fog: { color: 0x9aa5ac, near: 175, far: 410 },
    water: { color: 0x2a3b4a, opacity: 0.8 },
    ground: { dry: 0x7a7256, damp: 0x474a38 },
    hemisphere: { sky: 0xc4cdd4, ground: 0x51503f, intensity: 0.8 },
    sun: { color: 0xe8ecf0, intensity: 1.25, position: [-24, 48, 26] },
    boundary: 0x4b4a41,
    // The high country, and it should read as high: terraced shelves under a
    // proper range that claims half the map. The passes between the ridges are
    // where the road goes.
    terrain: {
      amplitude: 22,
      featureSize: 260,
      roughness: 0.55,
      terrace: 5,
      mountains: { amplitude: 115, featureSize: 700, mask: 0.5 },
      waterLevel: -8,
    },
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
    fog: { color: 0x24413c, near: 95, far: 300 },
    water: { color: 0x1d3a33, opacity: 0.72 },
    ground: { dry: 0x4a7c52, damp: 0x264536 },
    hemisphere: { sky: 0x8fd0b4, ground: 0x24382d, intensity: 1.1 },
    sun: { color: 0xdcf3cc, intensity: 1.3, position: [18, 60, -22] },
    boundary: 0x2b4033,
    // A drowned forest, so the water line sits high and most of the low ground
    // is under it: standing water between the trees, islands of dry root, and
    // a few wooded ridges that never went under.
    terrain: {
      amplitude: 13,
      featureSize: 230,
      roughness: 0.5,
      mountains: { amplitude: 38, featureSize: 520, mask: 0.26 },
      waterLevel: -1.5,
    },
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
    fog: { color: 0x1b1533, near: 110, far: 340 },
    water: { color: 0x241a4a, opacity: 0.82 },
    ground: { dry: 0x554379, damp: 0x241a3f },
    hemisphere: { sky: 0xb094f0, ground: 0x2a2145, intensity: 1.35 },
    sun: { color: 0xe4d6ff, intensity: 1.2, position: [-30, 40, -30] },
    boundary: 0x2a2145,
    // Otherworld country: shelved violet rock under peaks that have no business
    // being that steep, and black meres in the hollows between them.
    terrain: {
      amplitude: 19,
      featureSize: 250,
      roughness: 0.5,
      terrace: 3,
      mountains: { amplitude: 130, featureSize: 660, mask: 0.42 },
      waterLevel: -7,
    },
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

/**
 * The nearest spot to (x, z) that is not in a lake.
 *
 * Lives here rather than in `content/zone.ts` because three different things
 * now need it — the road, the settlements and the strays — and two of them
 * must not import the zone module. It is pure arithmetic over a `TerrainSpec`,
 * which is exactly what this file is for.
 *
 * A spiral rather than a gradient walk: the ground is noise, so "uphill" is
 * not reliably "towards dry land", and the Sunken Wood is a drowned forest
 * where the nearest dry ground is sometimes a hundred metres away.
 */
export function dryGround(
  x: number,
  z: number,
  themeId: string | undefined,
  limit: number,
  rings = 14,
  step = 34,
): { x: number; z: number } {
  const spec = getTheme(themeId).terrain;
  const water = spec.waterLevel;
  const clamp = (v: number): number => Math.max(-limit, Math.min(limit, v));
  if (water === undefined) return { x: clamp(x), z: clamp(z) };

  for (let ring = 0; ring < rings; ring++) {
    const r = ring * step;
    const steps = ring === 0 ? 1 : 8;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2 + ring;
      const px = clamp(x + Math.cos(a) * r);
      const pz = clamp(z + Math.sin(a) * r);
      if (terrainHeight(px, pz, spec) > water + SHORE_CLEARANCE) return { x: px, z: pz };
    }
  }
  return { x: clamp(x), z: clamp(z) };
}
