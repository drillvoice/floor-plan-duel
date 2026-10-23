import { describe, expect, it } from 'vitest';
import { CONFIG, type Config } from '../src/config';
import { THE_FLAT } from '../src/maps/theFlat';
import { buildGrid, cellCenter, cellIndex } from '../src/sim/grid';
import { applyPowerUp, healthCrateOdds, noEffects, pickLifespan } from '../src/sim/powerups';
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
  it('spawns at the configured interval, at most 3 at once, in valid spots', () => {
    const cfg = cfgWith(['shield'], { lifespans: [{ seconds: 30, weight: 1 }] });
    const s = playing(cfg, THE_FLAT);
    const spawnTimes: number[] = [];
    for (let t = 0; t < 60 * 40; t++) {
      step(s, [NO_INPUT, NO_INPUT]);
      for (const e of s.events) if (e.type === 'powerUpTelegraph') spawnTimes.push(s.roundTime);
      expect(s.powerUps.length).toBeLessThanOrEqual(3);
    }
    expect(spawnTimes[0]).toBeGreaterThanOrEqual(CONFIG.powerUps.spawnIntervalMin - 1e-6);
    expect(spawnTimes[0]).toBeLessThanOrEqual(CONFIG.powerUps.spawnIntervalMax + 1e-6);
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
    expect(s.players[0].effects).toEqual(noEffects());
    expect(s.powerUps).toHaveLength(0);
  });
});

describe('v2 power-ups', () => {
  const quiet = () => playing(cfgWith(['shield'], { spawnIntervalMin: 100, spawnIntervalMax: 100 }));
  const walk = (x: number, y: number): PlayerInput => ({ ...NO_INPUT, move: { x, y } });

  it('Long Shot makes bullets live longer, at the same speed', () => {
    const s = quiet();
    applyPowerUp(s, 0, 'longShot');
    applyPowerUp(s, 0, 'longShot');
    step(s, [shoot, NO_INPUT]);
    expect(s.bullets[0].lifetime).toBeCloseTo(CONFIG.bullet.lifetime * 1.8);
    expect(Math.hypot(s.bullets[0].vel.x, s.bullets[0].vel.y)).toBeCloseTo(CONFIG.bullet.speed);
  });

  it('Fleet Foot speeds up movement', () => {
    const s = quiet();
    applyPowerUp(s, 1, 'fleetFoot');
    const x0 = s.players[1].pos.x;
    run(s, 60, NO_INPUT, walk(-1, 0));
    expect(x0 - s.players[1].pos.x).toBeCloseTo(CONFIG.player.moveSpeed * 1.15, 1);
  });

  it('Spare Dodge gives a second dodge before the cooldown ends', () => {
    const s = quiet();
    applyPowerUp(s, 0, 'spareDodge');
    expect(s.players[0].dodgeCharges).toBe(2);
    let dodges = 0;
    for (let t = 0; t < 40; t++) {
      step(s, [{ ...walk(0, t < 20 ? -1 : 1), dodge: t === 0 || t === 20 }, NO_INPUT]);
      dodges += s.events.filter((e) => e.type === 'dodge').length;
    }
    expect(dodges).toBe(2);
    // Both charges come back, one cooldown apart.
    run(s, Math.round((2 * CONFIG.dodge.cooldown) / DT) + 2);
    expect(s.players[0].dodgeCharges).toBe(2);
  });

  it('Rapid Fire halves the fire cooldown while it lasts', () => {
    const s = quiet();
    applyPowerUp(s, 0, 'rapidFire');
    step(s, [shoot, NO_INPUT]);
    expect(s.players[0].fireCooldown).toBeCloseTo(CONFIG.fire.cooldown * 0.5);
    run(s, Math.round(CONFIG.powerUps.rapidFire.duration / DT) + 1);
    expect(s.players[0].effects.rapidFire).toBe(0);
  });

  it('Bouncer bullets bounce off a wall once, then stop at the next', () => {
    const s = quiet();
    // A bouncing bullet heading for the left outer wall, players well clear.
    placePlayer(s, 0, { x: 12, y: 2 });
    placePlayer(s, 1, { x: 12, y: 14 });
    s.bullets.push({ id: 500, owner: 0, pos: { x: 2, y: 8 }, vel: { x: -8, y: 0 }, age: 0, lifetime: 5, radius: 0.15, bounces: 1, closestGap: Infinity, nearMissed: false });
    let bounces = 0;
    let wallHits = 0;
    for (let t = 0; t < 60 * 4; t++) {
      step(s, [NO_INPUT, NO_INPUT]);
      bounces += s.events.filter((e) => e.type === 'bounce').length;
      wallHits += s.events.filter((e) => e.type === 'wallHit').length;
    }
    expect(bounces).toBe(1);
    expect(wallHits).toBe(1);
  });

  it('bullets fired with Bouncer carry a bounce', () => {
    const s = quiet();
    applyPowerUp(s, 0, 'bouncer');
    step(s, [shoot, NO_INPUT]);
    expect(s.bullets[0].bounces).toBe(1);
  });

  it('Ghost walks through inner walls but not out of the map', () => {
    const map: MapData = { ...BOX, walls: [{ a: { x: 10, y: 0 }, b: { x: 10, y: 16 } }] };
    const s = playing(cfgWith(['shield'], { spawnIntervalMin: 100, spawnIntervalMax: 100 }), map);
    placePlayer(s, 0, { x: 8, y: 8 });
    applyPowerUp(s, 0, 'ghost');
    run(s, 40, walk(1, 0));
    expect(s.players[0].pos.x).toBeGreaterThan(10.5);
    // Without Ghost, the same wall stops you.
    s.players[0].effects.ghost = 0;
    placePlayer(s, 0, { x: 8, y: 8 });
    run(s, 40, walk(1, 0));
    expect(s.players[0].pos.x).toBeLessThan(10);
    // And Ghost never leaves the map.
    applyPowerUp(s, 0, 'ghost');
    run(s, 200, walk(-1, 0));
    expect(s.players[0].pos.x).toBeGreaterThan(0);
  });

  it('Lead Shot aims with full prediction', () => {
    const s = quiet();
    placePlayer(s, 0, { x: 8, y: 9 });
    placePlayer(s, 1, { x: 12, y: 9 });
    applyPowerUp(s, 0, 'leadShot');
    run(s, 5, NO_INPUT, walk(0, 1));
    step(s, [shoot, walk(0, 1)]);
    const withLead = s.bullets[0].vel.y;
    const s2 = quiet();
    placePlayer(s2, 0, { x: 8, y: 9 });
    placePlayer(s2, 1, { x: 12, y: 9 });
    run(s2, 5, NO_INPUT, walk(0, 1));
    step(s2, [shoot, walk(0, 1)]);
    expect(withLead).toBeGreaterThan(s2.bullets[0].vel.y);
  });

  it('Topsy-Turvy reverses the opponent\'s movement', () => {
    const s = quiet();
    applyPowerUp(s, 0, 'topsyTurvy');
    expect(s.players[0].effects.topsyTurvy).toBe(0);
    const x0 = s.players[1].pos.x;
    run(s, 30, NO_INPUT, walk(-1, 0));
    expect(s.players[1].pos.x).toBeGreaterThan(x0);
  });

  it('Big Target makes the opponent easier to hit', () => {
    const s = quiet();
    placePlayer(s, 0, { x: 6, y: 8 });
    placePlayer(s, 1, { x: 12, y: 8 });
    // A shot that passes 0.8 units from their centre: a miss normally.
    s.bullets.push({ id: 600, owner: 0, pos: { x: 8, y: 8.8 }, vel: { x: 8, y: 0 }, age: 0, lifetime: 1, radius: 0.15, bounces: 0, closestGap: Infinity, nearMissed: false });
    run(s, 60);
    expect(s.players[1].hits).toBe(0);
    applyPowerUp(s, 0, 'bigTarget');
    s.bullets.push({ id: 601, owner: 0, pos: { x: 8, y: 8.8 }, vel: { x: 8, y: 0 }, age: 0, lifetime: 1, radius: 0.15, bounces: 0, closestGap: Infinity, nearMissed: false });
    run(s, 60);
    expect(s.players[1].hits).toBe(1);
  });

  describe('Laser', () => {
    const lc = CONFIG.powerUps.laser;
    const chargeTicks = Math.round(lc.chargeTime / DT);
    const armed = (map: MapData = BOX) => {
      const s = map === BOX ? quiet() : playing(cfgWith(['shield'], { spawnIntervalMin: 100, spawnIntervalMax: 100 }), map);
      placePlayer(s, 0, { x: 6, y: 8 });
      placePlayer(s, 1, { x: 12, y: 8 });
      applyPowerUp(s, 0, 'laser');
      return s;
    };

    it('locks on, then hits instantly if the target stays on the line', () => {
      const s = armed();
      step(s, [shoot, NO_INPUT]);
      expect(s.bullets).toHaveLength(0);
      expect(s.lasers).toHaveLength(1);
      expect(s.players[0].fireCooldown).toBeCloseTo(lc.cooldown);
      run(s, chargeTicks - 2);
      expect(s.players[1].hits).toBe(0);
      run(s, 2);
      expect(s.players[1].hits).toBe(1);
    });

    it('misses a target that steps off the line before it fires', () => {
      const s = armed();
      step(s, [shoot, NO_INPUT]);
      run(s, chargeTicks, NO_INPUT, walk(0, 1));
      expect(s.players[1].hits).toBe(0);
    });

    it('stops at the first wall and at its range', () => {
      const walled = armed({ ...BOX, walls: [{ a: { x: 9, y: 6 }, b: { x: 9, y: 10 } }] });
      step(walled, [shoot, NO_INPUT]);
      expect(walled.lasers[0].to.x).toBeLessThan(9);
      run(walled, chargeTicks);
      expect(walled.players[1].hits).toBe(0);

      const far = armed();
      placePlayer(far, 1, { x: 6 + lc.range + 2, y: 8 });
      step(far, [shoot, NO_INPUT]);
      expect(far.lasers[0].to.x).toBeCloseTo(6 + lc.range);
      run(far, chargeTicks);
      expect(far.players[1].hits).toBe(0);
    });

    it('is blocked by a Shield', () => {
      const s = armed();
      applyPowerUp(s, 1, 'shield');
      step(s, [shoot, NO_INPUT]);
      run(s, chargeTicks);
      expect(s.players[1].hits).toBe(0);
      expect(s.players[1].effects.shield).toBe(0);
    });

    it('goes back to bullets when it wears off', () => {
      const s = armed();
      run(s, Math.round(lc.duration / DT) + 1);
      step(s, [shoot, NO_INPUT]);
      expect(s.lasers).toHaveLength(0);
      expect(s.bullets).toHaveLength(1);
    });
  });

  describe('Health crate', () => {
    const hc = CONFIG.powerUps.healthCrate;
    // Player 0 is a round down and has taken a hit; crates come quickly.
    const behind = (extra: Partial<Config['powerUps']['healthCrate']> = {}) => {
      const s = playing(cfgWith(['shield'], { spawnIntervalMin: 100, spawnIntervalMax: 100, healthCrate: { ...hc, ...extra } }));
      s.players[1].roundWins = 1;
      s.players[0].hits = 1;
      return s;
    };

    it('only comes for the player behind on rounds, hurt and not ahead this round', () => {
      const s = behind();
      expect(healthCrateOdds(s)).toEqual({ player: 0, chancePerSecond: hc.chancePerSecond });
      s.players[1].roundWins = 2;
      s.players[0].hits = 2;
      expect(healthCrateOdds(s)!.chancePerSecond).toBeCloseTo(Math.min(hc.maxChancePerSecond, hc.chancePerSecond * 4));
      s.players[1].hits = 2;
      expect(healthCrateOdds(s)).not.toBeNull(); // level on hits still counts
      s.players[1].hits = 3;
      expect(healthCrateOdds(s)).toBeNull(); // ahead on hits this round
      s.players[1].hits = 0;
      s.players[0].hits = 0;
      expect(healthCrateOdds(s)).toBeNull(); // not hurt
      s.players[0].hits = 1;
      s.players[0].roundWins = 2;
      expect(healthCrateOdds(s)).toBeNull(); // level on rounds, as in round 1
    });

    it('never spawns in a tied match', () => {
      const s = playing(cfgWith(['shield'], { spawnIntervalMin: 100, spawnIntervalMax: 100, healthCrate: { ...hc, chancePerSecond: 1000, maxChancePerSecond: 1000 } }));
      s.players[0].hits = 2;
      run(s, 300);
      expect(s.powerUps).toHaveLength(0);
    });

    it('spawns near the player behind, nearer them than their opponent, once a round', () => {
      const s = behind({ chancePerSecond: 1000, maxChancePerSecond: 1000, lifespan: 0.5 });
      run(s, 1);
      expect(s.powerUps).toHaveLength(1);
      const crate = s.powerUps[0];
      expect(crate.kind).toBe('healthCrate');
      const d = dist(crate.pos, s.players[0].pos);
      expect(d).toBeGreaterThanOrEqual(hc.minDistance - 1e-6);
      expect(d).toBeLessThanOrEqual(hc.maxDistance + 1e-6);
      expect(d).toBeLessThan(dist(crate.pos, s.players[1].pos));
      // Once it expires, no second crate this round.
      run(s, 120);
      expect(s.powerUps).toHaveLength(0);
    });

    it('undoes one hit for whoever takes it, and does nothing at full health', () => {
      const s = behind({ enabled: false });
      s.players[0].hits = 2;
      s.powerUps.push({ id: 900, kind: 'healthCrate', pos: { ...s.players[0].pos }, telegraph: 0, remaining: 5, lifespan: 5 });
      step(s, [NO_INPUT, NO_INPUT]);
      expect(s.players[0].hits).toBe(1);
      expect(s.events).toContainEqual(expect.objectContaining({ type: 'healthCrate', player: 0, healed: true }));
      // The other player, unhurt, just denies it.
      s.powerUps.push({ id: 901, kind: 'healthCrate', pos: { ...s.players[1].pos }, telegraph: 0, remaining: 5, lifespan: 5 });
      step(s, [NO_INPUT, NO_INPUT]);
      expect(s.players[1].hits).toBe(0);
      expect(s.powerUps).toHaveLength(0);
      expect(s.events).toContainEqual(expect.objectContaining({ type: 'healthCrate', player: 1, healed: false }));
    });

    it('is never drawn from the power-up pool', () => {
      expect(CONFIG.powerUps.pool as string[]).not.toContain('healthCrate');
    });
  });

  it('every kind in the pool can spawn', () => {
    const s = playing(cfgWith(CONFIG.powerUps.pool, { spawnIntervalMin: 0.05, spawnIntervalMax: 0.05, maxOnMap: 400, minPowerUpDistance: 0 }));
    s.players[0].pos = { x: -50, y: -50 };
    s.players[1].pos = { x: -50, y: -50 };
    const seen = new Set<string>();
    for (let t = 0; t < 600; t++) {
      step(s, [NO_INPUT, NO_INPUT]);
      for (const e of s.events) if (e.type === 'powerUpTelegraph') seen.add(e.kind);
    }
    expect([...seen].sort()).toEqual([...CONFIG.powerUps.pool].sort());
  });
});

describe('effect timers', () => {
  it('says once when a timed effect runs out', () => {
    const s = playing(cfgWith([]));
    applyPowerUp(s, 0, 'topsyTurvy');
    const ended: number[] = [];
    for (let i = 0; i < (CONFIG.powerUps.topsyTurvy.duration + 1) / DT; i++) {
      step(s, [NO_INPUT, NO_INPUT]);
      for (const e of s.events) if (e.type === 'effectEnded') ended.push(s.tick);
      if (s.phase !== 'playing') break;
    }
    expect(s.players[1].effects.topsyTurvy).toBe(0);
    expect(ended).toHaveLength(1);
  });
});
