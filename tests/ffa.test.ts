import { describe, expect, it } from 'vitest';
import { BotPlayer } from '../src/bot/bot';
import { CONFIG, type Config } from '../src/config';
import { BUILT_IN_MAPS } from '../src/maps/builtin';
import { applyPowerUp } from '../src/sim/powerups';
import { chooseTarget, createGame, placePlayer, spawnFor, step } from '../src/sim/step';
import type { GameState, MapData, PlayerInput } from '../src/sim/types';
import type { Vec2 } from '../src/sim/vec';
import { NO_INPUT } from '../src/sim/types';

// An open 24x16 box with a spawn near each corner.
const BOX4: MapData = {
  name: 'Box',
  width: 24,
  height: 16,
  walls: [],
  spawns: [
    { x: 3, y: 3 },
    { x: 21, y: 13 },
    { x: 21, y: 3 },
    { x: 3, y: 13 },
  ],
};

// No power-ups turning up mid-test.
const QUIET: Config = { ...CONFIG, powerUps: { ...CONFIG.powerUps, spawnIntervalMin: 1e6, spawnIntervalMax: 1e6 } };

const shoot: PlayerInput = { ...NO_INPUT, shoot: true };

function playing(players: number, cfg: Config = QUIET): GameState {
  const s = createGame(BOX4, 7, cfg, players);
  while (s.phase !== 'playing') step(s, []);
  return s;
}

describe('free-for-all setup', () => {
  it('makes one player per seat, each on their own spawn', () => {
    for (const n of [2, 3, 4]) {
      const s = createGame(BOX4, 1, QUIET, n);
      expect(s.players).toHaveLength(n);
      expect(s.players.map((p) => p.pos)).toEqual(BOX4.spawns.slice(0, n));
    }
  });

  it('needs 2 to 4 players and a spawn for each', () => {
    expect(() => createGame(BOX4, 1, QUIET, 1)).toThrow();
    expect(() => createGame(BOX4, 1, QUIET, 5)).toThrow();
    expect(() => createGame({ ...BOX4, spawns: BOX4.spawns.slice(0, 3) }, 1, QUIET, 4)).toThrow(/too few/);
  });

  it('moves everyone round the spawns by one each round', () => {
    const s = playing(4, { ...QUIET, round: { ...QUIET.round, roundsToWin: 10 } });
    for (let round = 0; round < 4; round++) {
      s.players.forEach((p, i) => expect(p.pos).toEqual(BOX4.spawns[(i + round) % 4]));
      expect(spawnFor(s, 0)).toEqual(BOX4.spawns[round % 4]);
      // Knock out all but player 1.
      for (const i of [0, 2, 3]) s.players[i].hits = QUIET.round.hitsToLose;
      step(s, []);
      while (s.phase !== 'playing') step(s, []);
    }
  });

  it('every built-in map has four spawns and plays four players', () => {
    for (const map of BUILT_IN_MAPS) {
      expect(map.spawns).toHaveLength(4);
      expect(createGame(map, 1, QUIET, 4).players).toHaveLength(4);
    }
  });
});

describe('auto-targeting', () => {
  it('aims at the nearest opponent', () => {
    const s = playing(3);
    arrange(s, [{ x: 10, y: 8 }, { x: 16, y: 8 }, { x: 10, y: 4 }]);
    placePlayer(s, 0, { x: 10, y: 8 }); // picks targets afresh
    expect(s.players[0].target).toBe(2);
    expect(s.players[1].target).toBe(0);
    expect(s.players[2].target).toBe(0);
    expect(s.players[0].facing).toEqual({ x: 0, y: -1 });

    // Player 1 walks closer: player 0 switches to them.
    placePlayer(s, 1, { x: 12, y: 8 });
    expect(s.players[0].target).toBe(1);
  });

  // Puts players straight where they're wanted, with no target picked yet.
  function arrange(s: GameState, positions: Vec2[]): void {
    positions.forEach((pos, i) => {
      s.players[i].pos = { ...pos };
      s.players[i].target = null;
    });
  }

  it('prefers an opponent it has a clear shot at over a nearer one behind a wall', () => {
    const walled: MapData = { ...BOX4, walls: [{ a: { x: 8, y: 6 }, b: { x: 8, y: 10 } }] };
    const s = createGame(walled, 7, QUIET, 3);
    arrange(s, [{ x: 6, y: 8 }, { x: 10, y: 8 }, { x: 6, y: 14 }]);
    expect(chooseTarget(s, 0)).toBe(2);
    // With nobody in the clear, the nearest it is.
    arrange(s, [{ x: 6, y: 8 }, { x: 10, y: 8 }, { x: 10, y: 9 }]);
    expect(chooseTarget(s, 0)).toBe(1);
    // A target that ducks behind the wall is kept for a moment, then dropped
    // for one in the open.
    arrange(s, [{ x: 6, y: 8 }, { x: 6, y: 11 }, { x: 6, y: 14 }]);
    s.players[0].target = chooseTarget(s, 0);
    expect(s.players[0].target).toBe(1);
    s.players[1].pos = { x: 10, y: 8 };
    expect(chooseTarget(s, 0)).toBe(1);
    s.players[0].blockedFor = QUIET.targeting.blockedGrace;
    expect(chooseTarget(s, 0)).toBe(2);
  });

  it('counts how long the target has been behind a wall, and resets on a new target', () => {
    const walled: MapData = { ...BOX4, walls: [{ a: { x: 8, y: 6 }, b: { x: 8, y: 10 } }] };
    const s = createGame(walled, 7, QUIET, 2);
    while (s.phase !== 'playing') step(s, []);
    s.players[0].pos = { x: 6, y: 8 };
    s.players[1].pos = { x: 10, y: 8 };
    for (let t = 0; t < 30; t++) step(s, []);
    expect(s.players[0].blockedFor).toBeCloseTo(0.5, 1);
    s.players[1].pos = { x: 10, y: 14 };
    step(s, []);
    expect(s.players[0].blockedFor).toBe(0);
  });

  it('keeps its target until another is clearly closer', () => {
    const s = playing(3);
    arrange(s, [{ x: 4, y: 8 }, { x: 10, y: 8 }, { x: 4, y: 2 }]);
    s.players[0].target = 1; // 6 away
    s.players[2].pos = { x: 4, y: 3 }; // 5 away: not enough closer
    expect(chooseTarget(s, 0)).toBe(1);
    s.players[2].pos = { x: 4, y: 4 }; // 4 away: more than 25% closer
    expect(chooseTarget(s, 0)).toBe(2);
    // A fresh pick (no target yet) just takes the nearest.
    s.players[0].target = null;
    s.players[2].pos = { x: 4, y: 3 };
    expect(chooseTarget(s, 0)).toBe(2);
  });

  it('breaks a tie toward whoever is doing better', () => {
    const s = playing(3);
    arrange(s, [{ x: 12, y: 8 }, { x: 12, y: 12 }, { x: 12, y: 4 }]);
    // Level on everything: the lower-numbered player.
    expect(chooseTarget(s, 0)).toBe(1);
    // Player 1 has taken a hit this round: player 2 is doing better.
    s.players[1].hits = 1;
    expect(chooseTarget(s, 0)).toBe(2);
    // Level this round, but player 1 has won more rounds.
    s.players[1].hits = 0;
    s.players[1].roundWins = 1;
    expect(chooseTarget(s, 0)).toBe(1);
    // The round counts before the series.
    s.players[1].hits = 1;
    expect(chooseTarget(s, 0)).toBe(2);
  });

  it('counts opponents within half a unit of each other as tied', () => {
    const s = playing(3);
    s.players[1].roundWins = 2; // player 1 is doing better
    arrange(s, [{ x: 12, y: 8 }, { x: 12, y: 12.4 }, { x: 12, y: 4 }]);
    expect(chooseTarget(s, 0)).toBe(1); // 4.4 vs 4: tied
    arrange(s, [{ x: 12, y: 8 }, { x: 12, y: 13 }, { x: 12, y: 4 }]);
    expect(chooseTarget(s, 0)).toBe(2); // 5 vs 4: the nearer one
  });

  it('fires at the target, and the bullet hits whoever is in the way', () => {
    const s = playing(3);
    placePlayer(s, 0, { x: 4, y: 8 });
    placePlayer(s, 1, { x: 12, y: 8 }); // nearest: the target
    placePlayer(s, 2, { x: 20, y: 8 });
    step(s, [shoot, NO_INPUT, NO_INPUT]);
    expect(s.bullets[0]).toMatchObject({ owner: 0, target: 1 });
    expect(s.bullets[0].vel.y).toBeCloseTo(0);

    // Step player 1 aside and put player 2 in the line of fire.
    s.players[1].pos = { x: 12, y: 13 };
    s.players[2].pos = { x: 8, y: 8 };
    for (let t = 0; t < 60 && s.bullets.some((b) => b.owner === 0); t++) step(s, []);
    expect(s.players[2].hits).toBe(1);
    expect(s.players[1].hits).toBe(0);
  });

  it('never targets or hits a knocked-out player', () => {
    const s = playing(3);
    placePlayer(s, 0, { x: 4, y: 8 });
    placePlayer(s, 1, { x: 8, y: 8 });
    placePlayer(s, 2, { x: 20, y: 8 });
    s.players[1].hits = QUIET.round.hitsToLose;
    step(s, []); // knocked out at the end of this tick
    step(s, []);
    expect(s.players[1].out).toBe(true);
    expect(s.players[0].target).toBe(2);
    // Shots go straight through where player 1 fell.
    step(s, [shoot, NO_INPUT, NO_INPUT]);
    for (let t = 0; t < 30; t++) step(s, []);
    expect(s.players[1].hits).toBe(QUIET.round.hitsToLose);
  });
});

describe('knockouts', () => {
  it('a knocked-out player sits out while the rest play on', () => {
    const s = playing(4);
    s.players[3].hits = QUIET.round.hitsToLose;
    step(s, []); // knocked out at the end of this tick
    const before = { ...s.players[3].pos };
    const go: PlayerInput = { move: { x: 1, y: 0 }, dodge: true, shoot: true };
    for (let t = 0; t < 30; t++) step(s, [NO_INPUT, NO_INPUT, NO_INPUT, go]);
    expect(s.phase).toBe('playing');
    expect(s.players[3].out).toBe(true);
    expect(s.players[3].pos).toEqual(before);
    expect(s.bullets.some((b) => b.owner === 3)).toBe(false);
  });

  it('the last player standing wins the round', () => {
    const s = playing(4);
    for (const i of [0, 3]) s.players[i].hits = QUIET.round.hitsToLose;
    step(s, []);
    expect(s.phase).toBe('playing');
    s.players[1].hits = QUIET.round.hitsToLose;
    step(s, []);
    expect(s.phase).toBe('roundOver');
    expect(s.lastRoundWinner).toBe(2);
    expect(s.players.map((p) => p.roundWins)).toEqual([0, 0, 1, 0]);
    // Everyone is back in for the next round.
    while (s.phase !== 'playing') step(s, []);
    expect(s.players.every((p) => !p.out && p.hits === 0)).toBe(true);
  });

  it('is a draw if the last ones go down together', () => {
    const s = playing(3);
    s.players[0].hits = QUIET.round.hitsToLose;
    step(s, []);
    for (const i of [1, 2]) s.players[i].hits = QUIET.round.hitsToLose;
    step(s, []);
    expect(s.phase).toBe('roundOver');
    expect(s.lastRoundWinner).toBeNull();
  });
});

describe('power-ups with more than two players', () => {
  it('a curse lands on every opponent still in the round', () => {
    const s = playing(4);
    s.players[3].hits = QUIET.round.hitsToLose;
    step(s, []);
    applyPowerUp(s, 0, 'molasses');
    expect(s.players.map((p) => p.effects.molasses > 0)).toEqual([false, true, true, false]);
  });
});

describe('four bots', () => {
  it('play a match to the end', () => {
    const cfg = { ...CONFIG, round: { ...CONFIG.round, roundsToWin: 1 } };
    const s = createGame(BUILT_IN_MAPS[2], 11, cfg, 4);
    const bots = [0, 1, 2, 3].map((i) => new BotPlayer('hard', 100 + i));
    for (let t = 0; t < 60 * 60 * 4 && s.phase !== 'matchOver'; t++) step(s, bots.map((b, i) => b.sample(s, i)));
    expect(s.phase).toBe('matchOver');
    expect(s.matchWinner).not.toBeNull();
  });
});
