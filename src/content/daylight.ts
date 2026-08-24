/**
 * Day, night and weather.
 *
 * Both are functions of **elapsed world time** and nothing else — the same
 * shape as territory drift and the dragons' routine, and for the same reason:
 * they are the parts of the world that happen whether or not you are watching.
 * `World` carries the clock and advances it in `tick` and in `catchUp`, so
 * logging back in after a fortnight puts you down at a different hour under
 * different weather, which is the cheapest possible proof that the world did
 * not pause when you closed the tab.
 *
 * Nothing here reads a real clock, and nothing here draws. Pure functions of a
 * millisecond count, which is what lets the tests assert on a sunset.
 *
 * ## The rule that outranks the atmosphere
 *
 * **Night is a mood, never a legibility problem.** Caer Dubh was once authored
 * at true dusk and shipped with the mobs as black shapes on a black hill; the
 * fix was a per-theme minimum light level and a test that enforces it. A day
 * cycle is a much better way to make that mistake, because it only happens for
 * a few minutes at a time and only to whoever happened to be online. So
 * `NIGHT_FLOOR` is a floor on the *multiplier*, a test walks the whole cycle
 * and fails if it goes under, and the renderer spends the darkness on the
 * *sun* while holding the ambient up.
 */

export type DayPhase = 'dawn' | 'day' | 'dusk' | 'night';

/**
 * How long a full day takes.
 *
 * Twenty-four minutes: long enough that an hour of play is a couple of
 * sunsets rather than a strobe, short enough that a player who only ever
 * plays in one sitting still sees the whole cycle. Tied to the grind rather
 * than to realism — a real-time day would mean most players never see night.
 */
export const DAY_LENGTH_MS = 24 * 60 * 1000;

/**
 * Light multiplier at the bottom of the night.
 *
 * Not lower. Below about this the placeholder capsules stop reading against
 * the ground, and a telegraph circle you cannot see is a mechanic that has
 * been deleted rather than dimmed.
 */
export const NIGHT_FLOOR = 0.52;

/** How much further a hostile creature notices you in the dark. */
export const NIGHT_AGGRO = 1.35;

/** Fraction of the cycle each phase occupies, in order from midnight. */
const PHASE_EDGES: Array<{ until: number; phase: DayPhase }> = [
  { until: 0.22, phase: 'night' },
  { until: 0.3, phase: 'dawn' },
  { until: 0.68, phase: 'day' },
  { until: 0.78, phase: 'dusk' },
  { until: 1, phase: 'night' },
];

export interface Daylight {
  /** Position in the cycle, 0 at midnight, 0.5 at noon. */
  t: number;
  phase: DayPhase;
  /** Multiplier on the theme's light, `NIGHT_FLOOR` to 1. */
  light: number;
  /** How much the sky and fog shift toward night colour, 0 to 1. */
  darkness: number;
  /** True when creatures notice you from further off. */
  dark: boolean;
  /** Hour of a 24-hour clock, for the HUD. */
  hour: number;
  minute: number;
}

/** Smoothstep, so dawn arrives rather than being switched on. */
function ease(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

export function daylightAt(timeMs: number): Daylight {
  const t = ((((timeMs % DAY_LENGTH_MS) + DAY_LENGTH_MS) % DAY_LENGTH_MS) / DAY_LENGTH_MS);

  let phase: DayPhase = 'night';
  for (const edge of PHASE_EDGES) {
    if (t < edge.until) {
      phase = edge.phase;
      break;
    }
  }

  // One smooth curve rather than one per phase: the phase name is for the
  // player, the curve is for the renderer, and having them disagree at the
  // boundary is how a sunset comes with a visible step in it.
  //
  // The exponent is what makes dawn read as dawn. A straight smoothstep here
  // put the light at 99% an hour after sunrise, so the whole cycle was noon
  // with a slightly different sky for two minutes either side of midnight.
  const noon = 1 - Math.abs(t - 0.5) * 2; // 0 at midnight, 1 at noon
  const day = Math.pow(ease(noon), 1.6);

  return {
    t,
    phase,
    light: NIGHT_FLOOR + (1 - NIGHT_FLOOR) * day,
    darkness: 1 - day,
    dark: phase === 'night',
    hour: Math.floor(t * 24),
    minute: Math.floor(((t * 24) % 1) * 60),
  };
}

/** `07:30`, for the corner of the screen. */
export function clockOf(light: Daylight): string {
  return `${String(light.hour).padStart(2, '0')}:${String(light.minute).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- weather

export type WeatherKind = 'clear' | 'overcast' | 'rain' | 'mist' | 'snow';

export interface Weather {
  kind: WeatherKind;
  /** 0 to 1. Ramped in and out at the edges of a spell, never switched. */
  intensity: number;
  /** One line, for the log. */
  blurb: string;
}

/**
 * How long one spell of weather lasts.
 *
 * Deliberately not a multiple of the day length, so weather and time of day
 * drift against each other and a player never learns that it always rains at
 * dawn.
 */
const SPELL_MS = 7 * 60 * 1000;

/** What each zone's sky can do. Ardmoor gets snow; the Fenmarch does not. */
const ZONE_WEATHER: Record<string, WeatherKind[]> = {
  fenmarch: ['clear', 'clear', 'overcast', 'rain', 'mist'],
  ardmoor: ['clear', 'overcast', 'overcast', 'snow', 'mist'],
  reach: ['mist', 'mist', 'rain', 'overcast', 'clear'],
  caer_dubh: ['clear', 'overcast', 'mist', 'mist', 'clear'],
};

const BLURBS: Record<WeatherKind, string> = {
  clear: 'The sky is open.',
  overcast: 'Low cloud, and no wind to move it.',
  rain: 'It is raining, steadily and without much conviction.',
  mist: 'Mist, thick enough to lose a road in.',
  snow: 'Snow, coming down in a slant.',
};

/**
 * A hash rather than a stored roll.
 *
 * Weather is therefore free across a save, free across a catch-up of a
 * fortnight, and — the part that matters — cannot draw from `World.rng`. The
 * roaming creatures learned the same lesson: anything ambient that touches the
 * combat stream turns every balance figure into a measurement of the scenery.
 */
function spellHash(zoneId: string, spell: number): number {
  let h = 2166136261;
  for (let i = 0; i < zoneId.length; i++) {
    h ^= zoneId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // A proper avalanche on the spell number, not just FNV over a string that
  // differs in one digit. The first version hashed the whole `zone:spell`
  // string and the Fenmarch got two kinds of sky in eight days, because
  // consecutive spells landed in the same narrow slice of the range. A test
  // printing the shares is what showed it; an assertion would have said "it
  // varies" and been satisfied.
  let x = Math.imul(h ^ (spell + 0x9e3779b9), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

export function weatherAt(zoneId: string, timeMs: number): Weather {
  const table = ZONE_WEATHER[zoneId] ?? ZONE_WEATHER.fenmarch!;
  const spell = Math.floor(timeMs / SPELL_MS);
  const kind = table[Math.floor(spellHash(zoneId, spell) * table.length)] ?? 'clear';
  const within = (timeMs % SPELL_MS) / SPELL_MS;
  // Ramped in and out over the first and last fifth, so weather arrives and
  // clears rather than being switched on between two frames.
  const ramp = Math.min(1, Math.min(within, 1 - within) / 0.2);
  return {
    kind,
    intensity: kind === 'clear' ? 0 : ease(ramp),
    blurb: BLURBS[kind],
  };
}
