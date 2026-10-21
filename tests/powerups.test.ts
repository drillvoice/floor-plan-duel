import { describe, expect, it } from 'vitest';
import { CONFIG, type Config } from '../src/config';
import { THE_FLAT } from '../src/maps/theFlat';
import { buildGrid, cellCenter, cellIndex } from '../src/sim/grid';
import { applyPowerUp, pickLifespan } from '../src/sim/powerups';
import { createGame, placePlayer, step } from '../src/sim/step';
import type { GameState, MapData, PlayerInput, PowerUpKind } from '../src/sim/types';
import { NO_INPUT } from '../src/sim/types';
import { dist } from '../src/sim/vec';

const DT = 1 / CONFIG.tickRate;

const BOX: MapData = {
  name: 'Box',
  width: 24,
  height: 16,
  walls: [],
  spawns: [
    { x: 4, y: 8 },
    { x: 20, y: 8 },
  ],
};

function cfgWith(pool: PowerUpKind[], extra: Partial<Config['powerUps']> = {}): Config {
  return { ...CONFIG, powerUps: { ...CONFIG.powerUps, pool, ...extra } };
}

function playing(cfg: Config = CONFIG, map: MapData = BOX, seed = 3): GameState {
  const s = createGame(map, seed, cfg);
  while (s.phase !== 'playing') step(s, [NO_INPUT, NO_INPUT]);
  return s;
}

const shoot: PlayerInput = { ...NO_INPUT, shoot: true };

function run(s: GameState, ticks: number, a: PlayerInput = NO_INPUT, b: PlayerInput = NO_INPUT) {
  for (let i = 0; i < ticks; i++) step(s, [a, b]);
}

describe('walkable grid', () => {
  it('excludes cells near walls and sealed-off pockets', () => {
    const map: MapData = {
      ...BOX,
      // A sealed 4x4 box in the corner.
      walls: [
        { a: { x: 18, y: 0 }, b: { x: 18, y: 4 } },
        { a: { x: 18, y: 4 }, b: { x: 24, y: 4 } },
      ],
    };
    const g = buildGrid(map.width, map.height, [...createGame(map, 1).arena.walls], map.spawns[0], CONFIG);
    expect(g.open[cellIndex(g, { x: 21, y: 2 })]).toBe(false); // inside the pocket
    expect(g.open[cellIndex(g, { x: 0.25, y: 8 })]).toBe(false); // against the outer wall
    expect(g.open[cellIndex(g, { x: 10, y: 8 })]).toBe(true);
  });
});

describe('spawning', () => {
  it('spawns every 4-9 s, at most 3 at once, in valid spots', () => {
    const cfg = cfgWith(['shield'], { lifespans: [{ seconds: 30, weight: 1 }] });
    const s = playing(cfg, THE_FLAT);
    const spawnTimes: number[] = [];
    for (let t = 0; t < 60 * 40; t++) {
      step(s, [NO_INPUT, NO_INPUT]);
      for (const e of s.events) if (e.type === 'powerUpTelegraph') spawnTimes.push(s.roundTime);
      expect(s.powerUps.length).toBeLessThanOrEqual(3);
    }
    expect(spawnTimes[0]).toBeGreaterThanOrEqual(4 - 1e-6);
    expect(spawnTimes[0]).toBeLessThanOrEqual(9 + 1e-6);
    expect(spawnTimes.length).toBeGreaterThanOrEqual(3);
    for (const pu of s.powerUps) {
      expect(s.arena.grid.clearance[cellIndex(s.arena.grid, pu.pos)]).toBeGreaterThanOrEqual(1.5);
      for (const p of s.players) expect(dist(p.pos, pu.pos)).toBeGreaterThanOrEqual(1.5);
    }
  });

  it('picks lifespans with the configured weights', () => {
    const s = playing();
    const counts = new Map<number, number>();
    for (let i = 0; i < 4000; i++) {
      const l = pickLifespan(s);
      counts.set(l, (counts.get(l) ?? 0) + 1);
    }
    for (const o of CONFIG.powerUps.lifespans) {
      expect((counts.get(o.seconds) ?? 0) / 4000).toBeCloseTo(o.weight, 1);
    }
  });
});

describe('lifecycle', () => {
  function withOne(kind: PowerUpKind, lifespan = 3): GameState {
    const s = playing(cfgWith([kind], { spawnIntervalMin: 100, spawnIntervalMax: 100 }));
    s.powerUps.push({ id: 999, kind, pos: { x: 12, y: 8 }, telegraph: CONFIG.powerUps.telegraph, remaining: lifespan, lifespan });
    return s;
  }

  it('cannot be picked up during the telegraph', () => {
    const s = withOne('shield');
    placePlayer(s, 0, { x: 12, y: 8 });
    run(s, Math.floor(CONFIG.powerUps.telegraph / DT) - 2);
    expect(s.players[0].effects.shield).toBe(0);
    run(s, 4);
    expect(s.players[0].effects.shield).toBeGreaterThan(0);
    expect(s.powerUps).toHaveLength(0);
  });

  it('expires after its lifespan', () => {
    const s = withOne('shield', 1);
    run(s, Math.round((CONFIG.powerUps.telegraph + 1) / DT) - 3);
    expect(s.powerUps).toHaveLength(1);
    run(s, 6);
    expect(s.powerUps).toHaveLength(0);
  });
});

describe('effects', () => {
  it('Swift Shot speeds bullets up and caps at 3 stacks', () => {
    const s = playing(cfgWith(['shield'], { spawnIntervalMin: 100, spawnIntervalMax: 100 }));
    for (let i = 0; i < 5; i++) applyPowerUp(s, 0, 'swiftShot');
    expect(s.players[0].effects.swiftShot).toBe(3);
    step(s, [shoot, NO_INPUT]);
    expect(Math.hypot(s.bullets[0].vel.x, s.bullets[0].vel.y)).toBeCloseTo(CONFIG.bullet.speed * 1.75);
  });

  it('Trigger Happy shortens the fire cooldown', () => {
    const s = playing(cfgWith(['shield'], { spawnIntervalMin: 100, spawnIntervalMax: 100 }));
    applyPowerUp(s, 0, 'triggerHappy');
    step(s, [shoot, NO_INPUT]);
    expect(s.players[0].fireCooldown).toBeCloseTo(CONFIG.fire.cooldown * 0.8);
  });

  it('Shield absorbs one hit', () => {
    const s = playing(cfgWith(['shield'], { spawnIntervalMin: 100, spawnIntervalMax: 100 }));
    applyPowerUp(s, 1, 'shield');
    placePlayer(s, 0, { x: 10, y: 8 });
    placePlayer(s, 1, { x: 13, y: 8 });
    step(s, [shoot, NO_INPUT]);
    run(s, 30);
    expect(s.players[1].hits).toBe(0);
    expect(s.players[1].effects.shield).toBe(0);
    run(s, 10, shoot);
    run(s, 30);
    expect(s.players[1].hits).toBe(1);
  });

  it('Shield wears off after its duration', () => {
    const s = playing(cfgWith(['shield'], { spawnIntervalMin: 100, spawnIntervalMax: 100 }));
    applyPowerUp(s, 1, 'shield');
    run(s, Math.round(CONFIG.powerUps.shield.duration / DT) + 1);
    expect(s.players[1].effects.shield).toBe(0);
  });

  it('Molasses slows the opponent, then wears off', () => {
    const s = playing(cfgWith(['shield'], { spawnIntervalMin: 100, spawnIntervalMax: 100 }));
    applyPowerUp(s, 0, 'molasses');
    expect(s.players[0].effects.molasses).toBe(0);
    const right: PlayerInput = { ...NO_INPUT, move: { x: -1, y: 0 } };
    const x0 = s.players[1].pos.x;
    run(s, 60, NO_INPUT, right);
    expect(x0 - s.players[1].pos.x).toBeCloseTo(CONFIG.player.moveSpeed * CONFIG.powerUps.molasses.speedMultiplier, 1);
    run(s, Math.round(3 / DT) + 1);
    const x1 = s.players[1].pos.x;
    run(s, 60, NO_INPUT, right);
    expect(x1 - s.players[1].pos.x).toBeCloseTo(CONFIG.player.moveSpeed, 1);
  });

  it('upgrades and items reset at the start of each round', () => {
    const s = playing(cfgWith(['shield'], { spawnIntervalMin: 100, spawnIntervalMax: 100 }));
    applyPowerUp(s, 0, 'swiftShot');
    applyPowerUp(s, 0, 'triggerHappy');
    s.powerUps.push({ id: 999, kind: 'shield', pos: cellCenter(s.arena.grid, 500), telegraph: 0, remaining: 30, lifespan: 30 });
    s.players[1].hits = 2;
    placePlayer(s, 0, { x: 10, y: 8 });
    placePlayer(s, 1, { x: 13, y: 8 });
    step(s, [shoot, NO_INPUT]);
    while (s.phase !== 'countdown') step(s, [NO_INPUT, NO_INPUT]);
    expect(s.players[0].effects).toEqual({ swiftShot: 0, triggerHappy: 0, shield: 0, molasses: 0 });
    expect(s.powerUps).toHaveLength(0);
  });
});
