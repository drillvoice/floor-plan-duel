import { describe, expect, it } from 'vitest';
import { shuffled } from '../src/sim/rng';

describe('shuffled', () => {
  const items = ['a', 'b', 'c', 'd', 'e', 'f'];

  it('gives the same order for the same seed', () => {
    expect(shuffled(items, 42)).toEqual(shuffled(items, 42));
  });

  it('keeps every item once and leaves the original alone', () => {
    const copy = [...items];
    expect([...shuffled(items, 7)].sort()).toEqual(items);
    expect(items).toEqual(copy);
  });

  it('gives different orders for different seeds', () => {
    const orders = new Set(Array.from({ length: 20 }, (_, seed) => shuffled(items, seed).join('')));
    expect(orders.size).toBeGreaterThan(10);
  });
});
