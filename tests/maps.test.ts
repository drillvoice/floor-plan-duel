import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { BUILT_IN_MAPS, copyOfBuiltIn, LIGHTS_OUT } from '../src/maps/builtin';
import { THE_FLAT } from '../src/maps/theFlat';
import { buildArena } from '../src/sim/arena';
import { createGame, step } from '../src/sim/step';
import { NO_INPUT } from '../src/sim/types';
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

describe('built-in maps', () => {
  it.each(BUILT_IN_MAPS.map((m) => [m.name, m] as const))('%s is valid and has room for power-ups', (_name, map) => {
    expect(validateMap(map)).toEqual([]);
    const g = buildArena(map, CONFIG).grid;
    const roomy = g.clearance.filter((c, i) => g.open[i] && c >= CONFIG.powerUps.minWallDistance).length;
    expect(roomy).toBeGreaterThan(20);
    // Power-ups do turn up.
    const s = createGame(map, 4);
    let telegraphs = 0;
    for (let t = 0; t < 60 * 20; t++) {
      step(s, [NO_INPUT, NO_INPUT]);
      telegraphs += s.events.filter((e) => e.type === 'powerUpTelegraph').length;
    }
    expect(telegraphs).toBeGreaterThan(2);
  });

  it('a match given several maps plays a different one each round, in turn', () => {
    const maps = [THE_FLAT, LIGHTS_OUT];
    const s = createGame(maps, 3, { ...CONFIG, round: { ...CONFIG.round, roundsToWin: 5 } });
    const played: string[] = [];
    for (let r = 0; r < 3; r++) {
      while (s.phase !== 'playing') step(s, [NO_INPUT, NO_INPUT]);
      played.push(s.arena.name);
      // Each player starts on the new map's spawn points.
      expect(s.players[r % 2].pos).toEqual(maps[r % 2].spawns[0]);
      s.players[1].hits = CONFIG.round.hitsToLose;
      step(s, [NO_INPUT, NO_INPUT]);
    }
    expect(played).toEqual(['The Flat', 'Lights Out', 'The Flat']);
  });

  it('have distinct names', () => {
    expect(new Set(BUILT_IN_MAPS.map((m) => m.name)).size).toBe(BUILT_IN_MAPS.length);
  });

  it('copies for the editor get their own name and keep Lights Out dark', () => {
    expect(copyOfBuiltIn(THE_FLAT).name).toBe('My flat');
    const copy = copyOfBuiltIn(LIGHTS_OUT);
    expect(copy.dark).toBe(true);
    copy.walls.push({ a: { x: 1, y: 1 }, b: { x: 2, y: 2 } });
    expect(LIGHTS_OUT.walls).toHaveLength(copy.walls.length - 1);
  });

  it('a dark map stays dark through export and import', () => {
    expect(parseMapJson(JSON.stringify(LIGHTS_OUT)).dark).toBe(true);
    expect(parseMapJson(JSON.stringify(THE_FLAT)).dark).toBeUndefined();
    expect(buildArena(LIGHTS_OUT, CONFIG).dark).toBe(true);
  });
});
