// Deterministic pseudo-randomness seeded from the GEOID so that seeded
// layouts (the vacancy scatter, mark jitter) are stable across visits.

export function seedFromGeoid(geoid, salt = 0) {
  let h = 2166136261 ^ salt;
  for (const ch of String(geoid)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// mulberry32 — small, fast, good enough for layout jitter.
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fisher-Yates with a seeded rng; returns a new shuffled index array.
export function seededShuffle(n, seed) {
  const idx = Array.from({ length: n }, (_, i) => i);
  const rand = rng(seed);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx;
}
