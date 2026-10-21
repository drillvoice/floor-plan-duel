import { describe, expect, it } from 'vitest';
import { CONFIG, type Config } from '../src/config';
import { THE_FLAT } from '../src/maps/theFlat';
import { hasLineOfSight } from '../src/sim/arena';
import { aimPoint, createGame, placePlayer, spawnFor, step, suddenDeathMultiplier } from '../src/sim/step';
import type { GameState, MapData, PlayerInput } from '../src/sim/types';
import { NO_INPUT } from '../src/sim/types';
import { dist, distSegmentSegment } from '../src/sim/vec';

const DT = 1 / CONFIG.tickRate;

// An open 24x16 box with one wall at x = 12 from y = 0 to y = 8.
const BOX: MapData = {
  name: 'Box',
  width: 24,
  height: 16,
  walls: [{ a: { x: 12, y: 0 }, b: { x: 12, y: 8 } }],
  spawns: [
    { x: 4, y: 12 },
    { x: 20, y: 12 },
  ],
};

function input(partial: Partial<PlayerInput>): PlayerInput {
  return { ...NO_INPUT, ...partial };
}

function playing(map: MapData = BOX, cfg: Config = CONFIG): GameState {
  const s = createGame(map, 42, cfg);
  while (s.phase !== 'playing') step(s, [NO_INPUT, NO_INPUT]);
  return s;
}

function run(s: GameState, ticks: number, a: PlayerInput = NO_INPUT, b: PlayerInput = NO_INPUT) {
  for (let i = 0; i < ticks; i++) step(s, [a, b]);
}

describe('geometry', () => {
  it('measures segment-segment distance', () => {
    expect(distSegmentSegment({ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 3 })).toBeCloseTo(1);
    expect(distSegmentSegment({ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }, { x: 2, y: 0 })).toBeCloseTo(0);
  });

  it('detects line of sight blocked by a wall', () => {
    const s = playing();
    expect(hasLineOfSight({ x: 4, y: 4 }, { x: 20, y: 4 }, s.arena, s.cfg)).toBe(false);
    expect(hasLineOfSight({ x: 4, y: 12 }, { x: 20, y: 12 }, s.arena, s.cfg)).toBe(true);
  });
});

describe('movement', () => {
  it('moves at move speed and normalises diagonals', () => {
    const s = playing();
    placePlayer(s, 0, { x: 4, y: 12 });
    run(s, 60, input({ move: { x: 1, y: 0 } }));
    expect(s.players[0].pos.x).toBeCloseTo(4 + CONFIG.player.moveSpeed, 1);

    placePlayer(s, 0, { x: 4, y: 12 });
    run(s, 30, input({ move: { x: 1, y: -1 } }));
    expect(dist(s.players[0].pos, { x: 4, y: 12 })).toBeCloseTo(CONFIG.player.moveSpeed / 2, 1);
  });

  it('cannot pass through a wall and slides along it', () => {
    const s = playing();
    placePlayer(s, 0, { x: 10, y: 4 });
    run(s, 120, input({ move: { x: 1, y: 1 } }));
    const p = s.players[0].pos;
    // Blocked at the wall face on x, but slid down past the wall's end.
    expect(p.y).toBeGreaterThan(8);
  });

  it('stays out of walls when pushing straight into them', () => {
    const s = playing();
    placePlayer(s, 0, { x: 10, y: 4 });
    run(s, 120, input({ move: { x: 1, y: 0 } }));
    const minX = 12 - CONFIG.map.wallThickness / 2 - CONFIG.player.radius;
    expect(s.players[0].pos.x).toBeCloseTo(minX, 3);
  });
});

describe('dodging', () => {
  it('dashes the dodge distance in the direction of movement', () => {
    const s = playing();
    placePlayer(s, 0, { x: 18, y: 10 });
    placePlayer(s, 1, { x: 22, y: 14 });
    run(s, 1, input({ move: { x: 0, y: -1 }, dodge: true }));
    run(s, 20);
    // One tick of walking north first, then the dash.
    const walked = CONFIG.player.moveSpeed * DT;
    expect(s.players[0].pos.y).toBeCloseTo(10 - CONFIG.dodge.distance, 1);
    expect(s.players[0].pos.y).toBeGreaterThan(10 - CONFIG.dodge.distance - walked - 1e-6);
    expect(s.players[0].pos.x).toBeCloseTo(18, 3);
  });

  it('dashes diagonally the same distance', () => {
    const s = playing();
    placePlayer(s, 0, { x: 16, y: 10 });
    placePlayer(s, 1, { x: 22, y: 14 });
    run(s, 1, input({ move: { x: 1, y: 1 }, dodge: true }));
    run(s, 20);
    expect(dist(s.players[0].pos, { x: 16, y: 10 })).toBeCloseTo(CONFIG.dodge.distance, 2);
    expect(s.players[0].pos.x - 16).toBeCloseTo(s.players[0].pos.y - 10, 3);
  });

  it('standing still, dashes the way the player last moved', () => {
    const s = playing();
    placePlayer(s, 0, { x: 18, y: 10 });
    placePlayer(s, 1, { x: 22, y: 14 });
    run(s, 5, input({ move: { x: -1, y: 0 } }));
    const x0 = s.players[0].pos.x;
    run(s, 1, input({ dodge: true }));
    run(s, 20);
    expect(s.players[0].pos.x).toBeCloseTo(x0 - CONFIG.dodge.distance, 2);
  });

  it('before moving at all, dashes toward the opponent', () => {
    const s = playing();
    placePlayer(s, 0, { x: 4, y: 12 });
    placePlayer(s, 1, { x: 20, y: 12 });
    run(s, 1, input({ dodge: true }));
    run(s, 20);
    expect(s.players[0].pos.x).toBeCloseTo(4 + CONFIG.dodge.distance, 2);
  });

  it('ignores movement input while dashing', () => {
    const s = playing();
    placePlayer(s, 0, { x: 18, y: 14 });
    placePlayer(s, 1, { x: 18, y: 4 });
    run(s, 1, input({ move: { x: -1, y: 0 }, dodge: true }));
    run(s, 8, input({ move: { x: 0, y: -1 } }));
    expect(s.players[0].pos.y).toBeCloseTo(14, 2);
  });

  it('has a cooldown', () => {
    const s = playing();
    placePlayer(s, 0, { x: 18, y: 14 });
    placePlayer(s, 1, { x: 18, y: 4 });
    let dodges = 0;
    for (let t = 0; t < 60; t++) {
      step(s, [input({ move: { x: t % 20 < 10 ? 1 : -1, y: 0 }, dodge: true }), NO_INPUT]);
      dodges += s.events.filter((e) => e.type === 'dodge').length;
    }
    expect(dodges).toBe(1); // 1 s of mashing, cooldown 1.2 s
    run(s, Math.round((CONFIG.dodge.cooldown - 1) / DT) + 1);
    step(s, [input({ dodge: true }), NO_INPUT]);
    expect(s.events.some((e) => e.type === 'dodge')).toBe(true);
  });

  it('stops at a wall', () => {
    const s = playing();
    placePlayer(s, 0, { x: 11, y: 4 });
    placePlayer(s, 1, { x: 11, y: 14 });
    // Dashing east, into the wall at x = 12.
    run(s, 1, input({ move: { x: 1, y: 0 }, dodge: true }));
    run(s, 3);
    expect(s.players[0].dash).toBeNull();
    expect(s.players[0].pos.x).toBeCloseTo(12 - CONFIG.map.wallThickness / 2 - CONFIG.player.radius, 3);
    expect(s.players[0].pos.y).toBeCloseTo(4, 3);
  });
});

describe('firing', () => {
  it('holding shoot fires as fast as the cooldown allows', () => {
    const s = playing();
    let shots = 0;
    for (let t = 0; t < 180; t++) {
      step(s, [input({ shoot: true }), NO_INPUT]);
      shots += s.events.filter((e) => e.type === 'fire').length;
    }
    expect(shots).toBe(Math.ceil(3 / CONFIG.fire.cooldown));
  });

  it('bullets expire after their lifetime', () => {
    const cfg: Config = { ...CONFIG, bullet: { ...CONFIG.bullet, lifetime: 0.5 } };
    const s = playing(BOX, cfg);
    placePlayer(s, 0, { x: 2, y: 12 });
    placePlayer(s, 1, { x: 22, y: 12 });
    step(s, [input({ shoot: true }), NO_INPUT]);
    expect(s.bullets).toHaveLength(1);
    run(s, 28);
    expect(s.bullets).toHaveLength(1);
    run(s, 3);
    expect(s.bullets).toHaveLength(0);
    expect(s.players[1].hits).toBe(0);
  });

  it('bullets stop at walls', () => {
    const s = playing();
    placePlayer(s, 0, { x: 10, y: 4 });
    placePlayer(s, 1, { x: 14, y: 4 });
    expect(s.players[0].lineOfSight).toBe(false);
    step(s, [input({ shoot: true }), NO_INPUT]);
    let wallHits = 0;
    for (let t = 0; t < 30; t++) {
      step(s, [NO_INPUT, NO_INPUT]);
      wallHits += s.events.filter((e) => e.type === 'wallHit').length;
    }
    expect(wallHits).toBe(1);
    expect(s.players[1].hits).toBe(0);
  });

  it('a stationary target is hit', () => {
    const s = playing();
    placePlayer(s, 0, { x: 10, y: 12 });
    placePlayer(s, 1, { x: 15, y: 12 });
    step(s, [input({ shoot: true }), NO_INPUT]);
    run(s, 60);
    expect(s.players[1].hits).toBe(1);
  });

  it('aim leads a moving target by aimLead', () => {
    const target = { pos: { x: 8, y: 0 }, vel: { x: 0, y: 4 } } as GameState['players'][0];
    expect(aimPoint({ x: 0, y: 0 }, target, 8, 0)).toEqual({ x: 8, y: 0 });
    const full = aimPoint({ x: 0, y: 0 }, target, 8, 1);
    // Fully led: bullet and target arrive at the same point at the same time.
    const t = dist({ x: 0, y: 0 }, full) / 8;
    expect(full.y).toBeCloseTo(4 * t, 2);
  });

  it('a target walking sideways is hit when aim leads fully', () => {
    const cfg: Config = { ...CONFIG, bullet: { ...CONFIG.bullet, aimLead: 1 } };
    const s = playing(BOX, cfg);
    placePlayer(s, 0, { x: 8, y: 9 });
    placePlayer(s, 1, { x: 12, y: 9 });
    const walkSouth = input({ move: { x: 0, y: 1 } });
    run(s, 5, NO_INPUT, walkSouth);
    step(s, [input({ shoot: true }), walkSouth]);
    run(s, 50, NO_INPUT, walkSouth);
    expect(s.players[1].hits).toBe(1);
  });

  it('a target walking sideways dodges when aim does not lead', () => {
    const cfg: Config = { ...CONFIG, bullet: { ...CONFIG.bullet, aimLead: 0 } };
    const s = playing(BOX, cfg);
    placePlayer(s, 0, { x: 8, y: 9 });
    placePlayer(s, 1, { x: 12, y: 9 });
    const walkSouth = input({ move: { x: 0, y: 1 } });
    run(s, 5, NO_INPUT, walkSouth);
    step(s, [input({ shoot: true }), walkSouth]);
    run(s, 50, NO_INPUT, walkSouth);
    expect(s.players[1].hits).toBe(0);
  });
});

describe('rounds and match', () => {
  function knockOut(s: GameState, loser: 0 | 1) {
    s.players[loser].hits = CONFIG.round.hitsToLose - 1;
    const shooter = loser === 0 ? 1 : 0;
    placePlayer(s, shooter, { x: 10, y: 12 });
    placePlayer(s, loser, { x: 13, y: 12 });
    const inputs: [PlayerInput, PlayerInput] = [NO_INPUT, NO_INPUT];
    inputs[shooter] = input({ shoot: true });
    step(s, inputs);
    for (let t = 0; t < 60 && s.phase === 'playing'; t++) step(s, [NO_INPUT, NO_INPUT]);
  }

  it('three hits lose the round', () => {
    const s = playing();
    knockOut(s, 1);
    expect(s.phase).toBe('roundOver');
    expect(s.lastRoundWinner).toBe(0);
    expect(s.players[0].roundWins).toBe(1);
  });

  it('next round resets hits and swaps spawns', () => {
    const s = playing();
    knockOut(s, 1);
    while (s.phase !== 'playing') step(s, [NO_INPUT, NO_INPUT]);
    expect(s.roundIndex).toBe(1);
    expect(s.players[1].hits).toBe(0);
    expect(s.players[0].pos).toEqual(BOX.spawns[1]);
    expect(spawnFor(s, 1)).toEqual(BOX.spawns[0]);
  });

  it('first to three rounds wins the match', () => {
    const s = playing();
    for (let r = 0; r < 3; r++) {
      knockOut(s, 0);
      while (s.phase === 'roundOver' || s.phase === 'countdown') step(s, [NO_INPUT, NO_INPUT]);
    }
    expect(s.phase).toBe('matchOver');
    expect(s.matchWinner).toBe(1);
    expect(s.players[1].roundWins).toBe(3);
  });

  it('simultaneous knockouts draw the round', () => {
    const s = playing();
    s.players[0].hits = s.players[1].hits = CONFIG.round.hitsToLose - 1;
    placePlayer(s, 0, { x: 10, y: 12 });
    placePlayer(s, 1, { x: 14, y: 12 });
    step(s, [input({ shoot: true }), input({ shoot: true })]);
    for (let t = 0; t < 60 && s.phase === 'playing'; t++) step(s, [NO_INPUT, NO_INPUT]);
    expect(s.phase).toBe('roundOver');
    expect(s.lastRoundWinner).toBeNull();
    expect(s.players[0].roundWins + s.players[1].roundWins).toBe(0);
  });

  it('sudden death speeds bullets up after the time limit', () => {
    const s = playing();
    expect(suddenDeathMultiplier(s)).toBe(1);
    s.roundTime = CONFIG.round.timeLimit;
    expect(suddenDeathMultiplier(s)).toBeCloseTo(1.1);
    s.roundTime = CONFIG.round.timeLimit + 10;
    expect(suddenDeathMultiplier(s)).toBeCloseTo(1.1 ** 3);
  });
});

describe('determinism', () => {
  it('same seed and inputs give the same state', () => {
    const play = () => {
      const s = createGame(THE_FLAT, 7);
      for (let t = 0; t < 600; t++) {
        step(s, [
          input({ move: { x: Math.sign(Math.sin(t / 20)), y: 1 }, shoot: t % 3 === 0, dodge: t % 50 === 0 }),
          input({ move: { x: -1, y: Math.sign(Math.cos(t / 15)) }, shoot: true, dodge: t % 70 === 0 }),
        ]);
      }
      const { cfg: _cfg, ...rest } = s;
      return JSON.stringify(rest);
    };
    expect(play()).toBe(play());
  });
});
