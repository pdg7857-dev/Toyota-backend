/**
 * Deterministic, serializable PRNG (mulberry32).
 *
 * Every random decision in the sim MUST go through a Rng instance owned by the
 * World. That is what makes a tick reproducible from (state, commands) alone —
 * which is what lets us replay bugs, write balance tests, and later run this
 * same module as an authoritative server that clients can be checked against.
 */
export class Rng {
  private s: number;

  constructor(seed: number) {
    // Force to uint32 so behaviour is identical across platforms.
    this.s = seed >>> 0;
  }

  /** Raw uint32 state, for save files. */
  get state(): number {
    return this.s >>> 0;
  }

  static fromState(state: number): Rng {
    return new Rng(state);
  }

  /** Float in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick on empty array');
    return items[this.int(0, items.length - 1)]!;
  }
}
