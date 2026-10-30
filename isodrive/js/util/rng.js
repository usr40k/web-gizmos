// Deterministic hashing + value noise. Everything in the world is a pure function of (seed, coords).
export function hash(seed, x = 0, y = 0, z = 0) {
  let h = (seed | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (x | 0), 0x85ebca6b); h ^= h >>> 13;
  h = Math.imul(h ^ (y | 0), 0xc2b2ae35); h ^= h >>> 16;
  h = Math.imul(h ^ (z | 0), 0x27d4eb2f); h ^= h >>> 15;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h ^= h >>> 12;
  return h >>> 0;
}
export const rand01 = (seed, x, y, z) => hash(seed, x, y, z) / 4294967296;

// smooth 1-D value noise, returns -1..1
export function noise1(seed, t) {
  const i = Math.floor(t), f = t - i, u = f * f * (3 - 2 * f);
  const a = rand01(seed, i) * 2 - 1, b = rand01(seed, i + 1) * 2 - 1;
  return a + (b - a) * u;
}

// FNV-1a string -> int
export function strHash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h | 0;
}
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
