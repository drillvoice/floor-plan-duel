import { describe, expect, it } from 'vitest';
import { CONFIG, MODIFIER_IDS, type Config, type ModifierId } from '../src/config';
import { THE_FLAT } from '../src/maps/theFlat';
import { configFor } from '../src/sim/modifiers';
import { applyPowerUp } from '../src/sim/powerups';
import { createGame, placePlayer, step } from '../src/sim/step';
import type { GameState, MapData, PlayerInput } from '../src/sim/types';
import { NO_INPUT } from '../src/sim/types';

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

function withModifiers(pool: ModifierId[] = [...MODIFIER_IDS]): Config {
  return { ...CONFIG, modifiers: { ...CONFIG.modifiers, enabled: true, pool } };
}

function playing(cfg: Config, seed = 5): GameState {
  const s = createGame(BOX, seed, cfg);
  while (s.phase !== 'playing') step(s, [NO_INPUT, NO_INPUT]);
  return s;
}

const shoot: PlayerInput = { ...NO_INPUT, shoot: true };

describe('round modifiers', () => {
  it('are off unless enabled', () => {
    const s = createGame(BOX, 1);
    expect(s.modifier).toBeNull();
    expect(s.cfg).toBe(s.baseCfg);
  });

  it('pick a different modifier each round and announce it', () => {
    const s = createGame(BOX, 9, withModifiers());
    const seen: (ModifierId | null)[] = [s.modifier];
    for (let r = 1; r < 12; r++) {
      s.phase = 'roundOver';
      s.phaseTime = s.cfg.round.endDelay;
      step(s, [NO_INPUT, NO_INPUT]);
      const start = s.events.find((e) => e.type === 'roundStart');
      expect(start).toMatchObject({ type: 'roundStart', modifier: s.modifier });
      seen.push(s.modifier);
    }
    expect(seen.every((m) => m !== null)).toBe(true);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 1]);
  });

  it('give the spin a longer countdown', () => {
    const s = createGame(BOX, 1, withModifiers(['giantBullets']));
    expect(s.cfg.round.countdown).toBe(CONFIG.modifiers.countdown);
    let ticks = 0;
    while (s.phase === 'countdown') {
      step(s, [NO_INPUT, NO_INPUT]);
      ticks++;
    }
    expect(ticks).toBe(CONFIG.modifiers.countdown * CONFIG.tickRate);
  });

  it('change the rules for the round only, leaving the match config alone', () => {
    const base = withModifiers(['giantBullets']);
    const cfg = configFor(base, 'giantBullets');
    expect(cfg.bullet.radius).toBeGreaterThan(base.bullet.radius);
    expect(base.bullet.radius).toBe(CONFIG.bullet.radius);
    expect(configFor(base, null)).toBe(base);
  });

  it('Giant Bullets are slower but still reach as far', () => {
    const base = withModifiers(['giantBullets']);
    const cfg = configFor(base, 'giantBullets');
    expect(cfg.bullet.speed).toBeLessThan(base.bullet.speed);
    expect(cfg.bullet.speed * cfg.bullet.lifetime).toBeCloseTo(base.bullet.speed * base.bullet.lifetime);
  });

  it('One-Hit Wonder ends the round on the first hit', () => {
    const s = playing(withModifiers(['oneHitWonder']));
    placePlayer(s, 0, { x: 10, y: 12 });
    placePlayer(s, 1, { x: 15, y: 12 });
    step(s, [shoot, NO_INPUT]);
    for (let t = 0; t < 60 && s.phase === 'playing'; t++) step(s, [NO_INPUT, NO_INPUT]);
    expect(s.players[1].hits).toBe(1);
    expect(s.phase).toBe('roundOver');
    expect(s.players[0].roundWins).toBe(1);
  });

  it('Ghost Town lets everyone walk through walls all round, and a Ghost pickup does not cut it short', () => {
    const s = playing(withModifiers(['ghostTown']));
    expect(s.players[0].effects.ghost).toBe(Infinity);
    expect(s.cfg.powerUps.pool).not.toContain('ghost');
    applyPowerUp(s, 0, 'ghost');
    expect(s.players[0].effects.ghost).toBe(Infinity);
    placePlayer(s, 0, { x: 11, y: 4 });
    for (let t = 0; t < 30; t++) step(s, [{ ...NO_INPUT, move: { x: 1, y: 0 } }, NO_INPUT]);
    expect(s.players[0].pos.x).toBeGreaterThan(12.5);
  });

  it('every modifier produces a playable round', () => {
    for (const id of MODIFIER_IDS) {
      const s = createGame(THE_FLAT, 3, withModifiers([id]));
      expect(s.modifier).toBe(id);
      for (let t = 0; t < 600; t++) step(s, [shoot, shoot]);
      expect(Number.isFinite(s.players[0].pos.x) && Number.isFinite(s.players[1].pos.x)).toBe(true);
    }
  });

  it('are deterministic', () => {
    const play = () => {
      const s = createGame(THE_FLAT, 11, withModifiers());
      const picks: (ModifierId | null)[] = [];
      for (let t = 0; t < 4000; t++) {
        step(s, [
          { move: { x: Math.sign(Math.sin(t / 20)), y: 1 }, shoot: true, dodge: t % 50 === 0 },
          { move: { x: -1, y: Math.sign(Math.cos(t / 15)) }, shoot: true, dodge: t % 70 === 0 },
        ]);
        if (s.events.some((e) => e.type === 'roundStart')) picks.push(s.modifier);
      }
      return JSON.stringify({ picks, players: s.players });
    };
    expect(play()).toBe(play());
  });
});
