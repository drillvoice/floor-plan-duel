import { describe, expect, it } from 'vitest';
import { THE_FLAT } from '../src/maps/theFlat';
import { autoSpawns, parseMapJson, validateMap } from '../src/maps/validate';
import type { MapData } from '../src/sim/types';
import { dist } from '../src/sim/vec';

describe('map validation', () => {
  it('accepts The Flat', () => {
    expect(validateMap(THE_FLAT)).toEqual([]);
  });

  it('rejects spawns that cannot reach each other', () => {
    const sealed: MapData = {
      ...THE_FLAT,
      walls: [
        ...THE_FLAT.walls,
        { a: { x: 7, y: 12.5 }, b: { x: 9.5, y: 12.5 } },
        { a: { x: 14.5, y: 12.5 }, b: { x: 17, y: 12.5 } },
        { a: { x: 12, y: 2 }, b: { x: 12, y: 4.5 } },
      ],
    };
    expect(validateMap(sealed)).toContain("The spawns can't reach each other.");
  });

  it('rejects a spawn inside a wall', () => {
    const bad: MapData = { ...THE_FLAT, spawns: [{ x: 12, y: 5 }, THE_FLAT.spawns[1]] };
    expect(validateMap(bad)[0]).toMatch(/Spawn 1 overlaps a wall/);
  });
});

describe('auto spawns', () => {
  it('places spawns far apart and valid', () => {
    const spawns = autoSpawns(THE_FLAT)!;
    expect(spawns).not.toBeNull();
    expect(dist(spawns[0], spawns[1])).toBeGreaterThan(12);
    expect(validateMap({ ...THE_FLAT, spawns })).toEqual([]);
  });
});

describe('import', () => {
  it('round-trips through JSON', () => {
    expect(parseMapJson(JSON.stringify(THE_FLAT))).toEqual(THE_FLAT);
  });

  it('rejects malformed files', () => {
    expect(() => parseMapJson('{"width": 24}')).toThrow();
    expect(() => parseMapJson(JSON.stringify({ ...THE_FLAT, spawns: [THE_FLAT.spawns[0]] }))).toThrow(/two spawn/);
    expect(() => parseMapJson('not json')).toThrow();
  });
});
