import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { statRows } from '../src/render/overlay';
import { createGame, placePlayer, step } from '../src/sim/step';
import { noStats } from '../src/sim/stats';
import type { GameState, MapData, PlayerInput } from '../src/sim/types';
import { NO_INPUT } from '../src/sim/types';

// An open box with nothing in the way.
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

const noPowerUps = {
  ...CONFIG,
  modifiers: { ...CONFIG.modifiers, enabled: false },
  powerUps: { ...CONFIG.powerUps, spawnIntervalMin: 1000, spawnIntervalMax: 1000 },
};

function playing(): GameState {
  const s = createGame(BOX, 7, noPowerUps);
  while (s.phase !== 'playing') step(s, [NO_INPUT, NO_INPUT]);
  return s;
}

function run(s: GameState, ticks: number, a: PlayerInput = NO_INPUT, b: PlayerInput = NO_INPUT) {
  for (let i = 0; i < ticks; i++) step(s, [a, b]);
}

describe('match stats', () => {
  it('counts shots, hits, hits taken and how far the hit travelled', () => {
    const s = playing();
    placePlayer(s, 0, { x: 8, y: 8 });
    placePlayer(s, 1, { x: 12, y: 8 });
    step(s, [{ ...NO_INPUT, shoot: true }, NO_INPUT]);
    run(s, 40);
    const [a, b] = s.players.map((p) => p.stats);
    expect(a.shots).toBe(1);
    expect(a.hits).toBe(1);
    expect(b.hitsTaken).toBe(1);
    // From the gun's muzzle to the target's edge.
    const muzzle = CONFIG.player.radius + CONFIG.bullet.radius;
    const edge = CONFIG.player.radius + CONFIG.bullet.radius;
    expect(a.longestHit).toBeGreaterThan(4 - muzzle - edge - 0.15);
    expect(a.longestHit).toBeLessThan(4 - muzzle - edge + 0.15);
  });

  it('counts dodges and the distance moved, dashes included', () => {
    const s = playing();
    placePlayer(s, 0, { x: 4, y: 8 });
    const east = { ...NO_INPUT, move: { x: 1, y: 0 } };
    run(s, 60, east);
    expect(s.players[0].stats.distance).toBeCloseTo(CONFIG.player.moveSpeed, 1);
    step(s, [{ ...east, dodge: true }, NO_INPUT]);
    run(s, 20);
    expect(s.players[0].stats.dodges).toBe(1);
    expect(s.players[0].stats.distance).toBeCloseTo(CONFIG.player.moveSpeed + CONFIG.dodge.distance, 1);
    expect(s.players[1].stats.distance).toBe(0);
  });

  it('counts power-ups picked up', () => {
    const s = playing();
    placePlayer(s, 0, { x: 4, y: 8 });
    s.powerUps.push({ id: 99, kind: 'shield', pos: { x: 4, y: 8 }, telegraph: 0, remaining: 5, lifespan: 5 });
    step(s, [NO_INPUT, NO_INPUT]);
    expect(s.players[0].stats.powerUps).toBe(1);
  });

  it('counts a round won without taking a hit as flawless, even if healed', () => {
    const s = playing();
    s.players[1].hits = CONFIG.round.hitsToLose - 1;
    placePlayer(s, 0, { x: 8, y: 8 });
    placePlayer(s, 1, { x: 11, y: 8 });
    step(s, [{ ...NO_INPUT, shoot: true }, NO_INPUT]);
    run(s, 40);
    expect(s.phase).toBe('roundOver');
    expect(s.players[0].stats.flawlessRounds).toBe(1);

    // Next round P1 takes a hit, so winning it isn't flawless.
    while (s.phase !== 'playing') step(s, [NO_INPUT, NO_INPUT]);
    placePlayer(s, 0, { x: 8, y: 8 });
    placePlayer(s, 1, { x: 11, y: 8 });
    step(s, [NO_INPUT, { ...NO_INPUT, shoot: true }]);
    run(s, 40);
    expect(s.players[0].hits).toBe(1);
    s.players[0].hits = 0; // as a health crate would
    s.players[1].hits = CONFIG.round.hitsToLose - 1;
    step(s, [{ ...NO_INPUT, shoot: true }, NO_INPUT]);
    run(s, 40);
    expect(s.players[0].roundWins).toBe(2);
    expect(s.players[0].stats.flawlessRounds).toBe(1);
  });
});

describe('stat rows', () => {
  it('formats the numbers and picks out who did better', () => {
    const a = { ...noStats(), shots: 10, hits: 4, hitsTaken: 1, longestHit: 6.25, distance: 120.4 };
    const b = { ...noStats(), shots: 0, hitsTaken: 4 };
    const rows = Object.fromEntries(statRows([a, b]).map((r) => [r.label, r]));
    expect(rows['Accuracy'].values).toEqual(['40%', '–']);
    expect(rows['Accuracy'].best).toBe(0);
    expect(rows['Hits taken'].best).toBe(0); // fewer is better
    expect(rows['Longest hit'].values).toEqual(['6.3 m', '–']);
    expect(rows['Distance run'].values).toEqual(['120 m', '0 m']);
    expect(rows['Shots fired'].best).toBeNull(); // more isn't better or worse
    expect(rows['Clutch dodges'].best).toBeNull(); // a tie
  });
});
