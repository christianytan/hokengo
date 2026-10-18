/** Deterministic, seedable RNG so tests can reproduce question sets exactly. */
export type Rng = () => number;

/** mulberry32 - small, fast, good enough for shuffling quiz content. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed(): number {
  return (Date.now() ^ (Math.floor(Math.random() * 0xffffffff))) >>> 0;
}

/** Stable string hash (FNV-1a) used to derive per-question seeds. */
export function hashString(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Fisher-Yates shuffle on a copy. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Take up to `count` random items from an already-ordered pool. */
export function sample<T>(items: readonly T[], count: number, rng: Rng): T[] {
  if (items.length <= count) return items.slice();
  return shuffle(items, rng).slice(0, count);
}
