// Seeded RNG (mulberry32). The state is a single uint32 stored in GameState,
// so a match is fully reproducible from its seed and inputs.

export function nextRandom(state: { rng: number }): number {
  let t = (state.rng = (state.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randomRange(state: { rng: number }, min: number, max: number): number {
  return min + (max - min) * nextRandom(state);
}

// A copy of `items` in a random order fixed by `seed` (Fisher-Yates), using
// its own generator so it doesn't use up a game's random numbers.
export function shuffled<T>(items: readonly T[], seed: number): T[] {
  const rng = { rng: seed >>> 0 };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(nextRandom(rng) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
