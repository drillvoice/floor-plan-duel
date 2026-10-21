import { describe, expect, it } from 'vitest';
import { BotPlayer } from '../src/bot/bot';
import { findPath } from '../src/bot/pathfind';
import { CONFIG, type Config } from '../src/config';
import { THE_FLAT } from '../src/maps/theFlat';
import { hasLineOfSight } from '../src/sim/arena';
import { createGame, placePlayer, step } from '../src/sim/step';
import type { GameState, PlayerInput } from '../src/sim/types';
import { NO_INPUT } from '../src/sim/types';
import { distPointSegment } from '../src/sim/vec';

// No power-ups, so they can't interfere with what's being tested.
const QUIET: Config = { ...CONFIG, powerUps: { ...CONFIG.powerUps, spawnIntervalMin: 1000, spawnIntervalMax: 1000 } };

function playing(cfg: Config = QUIET): GameState {
  const s = createGame(THE_FLAT, 5, cfg);
  while (s.phase !== 'playing') step(s, [NO_INPUT, NO_INPUT]);
  return s;
}

describe('pathfinding', () => {
  it('finds a path between the rooms, clear of walls', () => {
    const s = playing();
    const path = findPath(s.arena.grid, THE_FLAT.spawns[0], THE_FLAT.spawns[1])!;
    expect(path).not.toBeNull();
    // The shortest route is the doorway near the top of the dividing wall.
    expect(path.some((p) => Math.abs(p.x - 12) < 0.5 && p.y > 2 && p.y < 4.5)).toBe(true);
    for (const p of path.slice(0, -1)) {
      for (const w of s.arena.walls) {
        expect(distPointSegment(p, w.a, w.b)).toBeGreaterThanOrEqual(CONFIG.player.radius + CONFIG.map.wallThickness / 2 - 1e-6);
      }
    }
  });
});

describe('bot', () => {
  function incomingShot(missChance: number): PlayerInput {
    const cfg: Config = {
      ...QUIET,
      bot: { ...QUIET.bot, difficulty: { ...QUIET.bot.difficulty, hard: { reactionDelay: 0.08, missChance } } },
    };
    const s = playing(cfg);
    placePlayer(s, 0, { x: 4, y: 2 });
    placePlayer(s, 1, { x: 4, y: 7 });
    // A bullet already in flight, coming straight down at the bot.
    s.bullets.push({ id: 77, owner: 0, pos: { x: 4, y: 5 }, vel: { x: 0, y: 8 }, age: 0.1, lifetime: 1, radius: 0.15 });
    return new BotPlayer('hard', 3).sample(s, 1);
  }

  it('dodges a shot that is about to hit it', () => {
    const input = incomingShot(0);
    expect(input.dodgeLeft || input.dodgeRight).toBe(true);
    // And walks off the bullet's line too.
    expect(Math.abs(input.move.x)).toBeGreaterThan(0.5);
  });

  it('sometimes misses the dodge, per difficulty', () => {
    const input = incomingShot(1);
    expect(input.dodgeLeft || input.dodgeRight).toBe(false);
  });

  it('finds the opponent from the spawns', () => {
    const s = playing();
    const bot = new BotPlayer('normal', 1);
    let sawThem = -1;
    for (let t = 0; t < 60 * 10 && sawThem < 0; t++) {
      step(s, [bot.sample(s, 0), NO_INPUT]);
      if (hasLineOfSight(s.players[0].pos, s.players[1].pos, s.arena, s.cfg)) sawThem = t;
    }
    expect(sawThem).toBeGreaterThan(0);
  });

  it('bot vs bot matches finish and are reproducible', () => {
    const play = () => {
      const s = createGame(THE_FLAT, 11);
      const bots = [new BotPlayer('normal', 1), new BotPlayer('normal', 2)];
      let ticks = 0;
      while (s.phase !== 'matchOver' && ticks < 60 * 60 * 15) {
        step(s, [bots[0].sample(s, 0), bots[1].sample(s, 1)]);
        ticks++;
      }
      return { winner: s.matchWinner, ticks };
    };
    const a = play();
    expect(a.winner).not.toBeNull();
    expect(play()).toEqual(a);
  });
});
