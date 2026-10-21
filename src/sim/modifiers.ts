// Round modifiers: a one-round rule picked at random before each round, such
// as giant bullets or a single hit to lose. Each one rewrites a copy of the
// match's config for that round (scaling the base values, so they combine
// with any other config changes), and can hand both players an effect for
// the whole round.

import type { Config, ModifierId, PowerUpKind } from '../config';
import { nextRandom } from './rng';
import type { GameState } from './types';

export type { ModifierId };

export interface Modifier {
  name: string;
  blurb: string; // one line shown under the name
  apply(cfg: Config): void; // changes a copy of the base config in place
  // Effects both players hold for the whole round (Infinity = never runs out).
  effects?: Partial<Record<PowerUpKind, number>>;
}

export const MODIFIERS: Record<ModifierId, Modifier> = {
  giantBullets: {
    name: 'Giant Bullets',
    blurb: 'Huge, slow shots',
    apply: (c) => {
      c.bullet.radius *= 2;
      c.bullet.speed *= 0.7;
    },
  },
  powerUpStorm: {
    name: 'Power-up Storm',
    blurb: 'Power-ups everywhere',
    apply: (c) => {
      c.powerUps.spawnIntervalMin = 0.8;
      c.powerUps.spawnIntervalMax = 1.6;
      c.powerUps.maxOnMap *= 2;
    },
  },
  oneHitWonder: {
    name: 'One-Hit Wonder',
    blurb: 'First hit wins the round',
    apply: (c) => {
      c.round.hitsToLose = 1;
    },
  },
  speedDemons: {
    name: 'Speed Demons',
    blurb: 'Everything moves faster',
    apply: (c) => {
      c.player.moveSpeed *= 1.4;
      c.bullet.speed *= 1.35;
    },
  },
  bulletHell: {
    name: 'Bullet Hell',
    blurb: 'Fire much, much faster',
    apply: (c) => {
      c.fire.cooldown /= 2.5;
      c.bullet.lifetime *= 0.75;
    },
  },
  sniperDuel: {
    name: 'Sniper Duel',
    blurb: 'Fast, long shots, slow reload',
    apply: (c) => {
      c.bullet.speed *= 1.8;
      c.bullet.lifetime *= 1.2;
      c.fire.cooldown *= 2;
    },
  },
  bouncyCastle: {
    name: 'Bouncy Castle',
    blurb: 'Every shot bounces twice',
    apply: (c) => {
      c.powerUps.bouncer.bounces = 2;
      c.powerUps.pool = c.powerUps.pool.filter((k) => k !== 'bouncer');
    },
    effects: { bouncer: Infinity },
  },
  ghostTown: {
    name: 'Ghost Town',
    blurb: 'Walk through walls (bullets can\'t)',
    apply: (c) => {
      c.powerUps.pool = c.powerUps.pool.filter((k) => k !== 'ghost');
    },
    effects: { ghost: Infinity },
  },
  dodgeFrenzy: {
    name: 'Dodge Frenzy',
    blurb: 'Dodge recharges in a flash',
    apply: (c) => {
      c.dodge.cooldown /= 3;
    },
  },
};

// Picks the next round's modifier, never the same one twice in a row.
export function pickModifier(state: GameState): ModifierId | null {
  const mc = state.baseCfg.modifiers;
  if (!mc.enabled) return null;
  const pool = mc.pool.filter((id) => id !== state.modifier || mc.pool.length === 1);
  return pool[Math.floor(nextRandom(state) * pool.length)];
}

// The config for a round played under `id` (or the base config for none).
export function configFor(base: Config, id: ModifierId | null): Config {
  if (!id) return base;
  const cfg = structuredClone(base);
  MODIFIERS[id].apply(cfg);
  cfg.round.countdown = base.modifiers.countdown;
  return cfg;
}
