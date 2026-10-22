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
        { x: 20, y: 4 },
        { x: 20, y: 12 },
      ],
    };
    expect(validateMap(split)).toContain("The spawns can't reach each other.");
    // A 1.2-unit gap on the editor's half-unit grid opens it up.
    split.walls[0].b.x = 10;
    split.walls[1].a.x = 11.5;
    expect(validateMap(split)).toEqual([]);
  });

  it('rejects a spawn inside a wall', () => {
    const bad: MapData = { ...THE_FLAT, spawns: [{ x: 12, y: 5 }, ...THE_FLAT.spawns.slice(1)] };
    expect(validateMap(bad)[0]).toMatch(/Spawn 1 overlaps a wall/);
  });

  it('needs four spawns, apart from each other, all reachable', () => {
    expect(validateMap({ ...THE_FLAT, spawns: THE_FLAT.spawns.slice(0, 2) })).toEqual(['A map needs 4 spawn points.']);
    const stacked = [...THE_FLAT.spawns.slice(0, 3), { x: THE_FLAT.spawns[0].x + 0.5, y: THE_FLAT.spawns[0].y }];
    expect(validateMap({ ...THE_FLAT, spawns: stacked })).toEqual(['Spawns 1 and 4 overlap.']);
    // Spawn 4 sealed into the hallway's right end.
    const sealed: MapData = { ...THE_FLAT, walls: [...THE_FLAT.walls, { a: { x: 19, y: 12.5 }, b: { x: 19, y: 16 } }] };
    expect(validateMap(sealed)).toContain("The spawns can't reach each other.");
  });
});

describe('auto spawns', () => {
  it('places four spawns far apart and valid', () => {
    const spawns = autoSpawns(THE_FLAT)!;
    expect(spawns).toHaveLength(4);
    expect(dist(spawns[0], spawns[1])).toBeGreaterThan(12);
    for (let i = 0; i < 4; i++) for (let j = 0; j < i; j++) expect(dist(spawns[i], spawns[j])).toBeGreaterThan(5);
    expect(validateMap({ ...THE_FLAT, spawns })).toEqual([]);
  });

  it('adds spawns to the ones a map already has', () => {
    const kept = THE_FLAT.spawns.slice(0, 2);
    const spawns = autoSpawns(THE_FLAT, CONFIG, kept)!;
    expect(spawns.slice(0, 2)).toEqual(kept);
    expect(validateMap({ ...THE_FLAT, spawns })).toEqual([]);
  });
});

describe('import', () => {
  it('gives a two-spawn map from before 4 players the other two spawns', () => {
    const old = parseMapJson(JSON.stringify({ ...THE_FLAT, spawns: THE_FLAT.spawns.slice(0, 2) }));
    expect(old.spawns).toHaveLength(4);
    expect(old.spawns.slice(0, 2)).toEqual(THE_FLAT.spawns.slice(0, 2));
    expect(validateMap(old)).toEqual([]);
  });

  it('round-trips through JSON', () => {
    expect(parseMapJson(JSON.stringify(THE_FLAT))).toEqual(THE_FLAT);
  });

  it('rejects malformed files', () => {
    expect(() => parseMapJson('{"width": 24}')).toThrow();
    expect(() => parseMapJson(JSON.stringify({ ...THE_FLAT, spawns: [THE_FLAT.spawns[0]] }))).toThrow(/two to 4 spawn/);
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
