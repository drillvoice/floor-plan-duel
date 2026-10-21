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

  it('treats a gap narrower than a player as closed', () => {
    // Gap between wall ends is 0.95 units, less than a player's 1 unit width.
    const split: MapData = {
      name: 'Split',
      width: 24,
      height: 16,
      walls: [
        { a: { x: 0, y: 8 }, b: { x: 10.125, y: 8 } },
        { a: { x: 11.375, y: 8 }, b: { x: 24, y: 8 } },
      ],
      spawns: [
        { x: 4, y: 4 },
        { x: 4, y: 12 },
      ],
    };
    expect(validateMap(split)).toContain("The spawns can't reach each other.");
    // A 1.2-unit gap on the editor's half-unit grid opens it up.
    split.walls[0].b.x = 10;
    split.walls[1].a.x = 11.5;
    expect(validateMap(split)).toEqual([]);
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
