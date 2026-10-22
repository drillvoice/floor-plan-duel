import { POWER_UP_KINDS, type Config } from '../config';
import { cellCenter } from './grid';
import { nextRandom, randomRange } from './rng';
import type { Effects, GameState, PlayerIndex, PlayerState, PowerUpKind } from './types';
import { dist } from './vec';

const EPS = 1e-9;

// Round-long upgrades stack; everything else is a timer.
export const STACKING: ReadonlySet<PowerUpKind> = new Set(['swiftShot', 'longShot', 'triggerHappy', 'fleetFoot', 'spareDodge']);
// Curses land on the opponent of whoever picks them up.
export const ON_OPPONENT: ReadonlySet<PowerUpKind> = new Set(['molasses', 'topsyTurvy', 'bigTarget']);

export const noEffects = (): Effects => Object.fromEntries(POWER_UP_KINDS.map((k) => [k, 0])) as Effects;

export function scheduleNextPowerUp(state: GameState): void {
  const pc = state.cfg.powerUps;
  state.nextPowerUpIn = randomRange(state, pc.spawnIntervalMin, pc.spawnIntervalMax);
}

export function bulletSpeedFactor(effects: Effects, state: GameState): number {
  return 1 + state.cfg.powerUps.swiftShot.bulletSpeedBonus * effects.swiftShot;
}

export function bulletLifetimeFor(effects: Effects, state: GameState): number {
  return state.cfg.bullet.lifetime * (1 + state.cfg.powerUps.longShot.lifetimeBonus * effects.longShot);
}

export function fireCooldownFor(effects: Effects, state: GameState): number {
  const pc = state.cfg.powerUps;
  if (effects.laser > EPS) return pc.laser.cooldown;
  const rapid = effects.rapidFire > EPS ? pc.rapidFire.cooldownMultiplier : 1;
  return state.cfg.fire.cooldown * Math.pow(1 - pc.triggerHappy.cooldownReduction, effects.triggerHappy) * rapid;
}

export function moveSpeedFor(effects: Effects, state: GameState): number {
  const pc = state.cfg.powerUps;
  const slow = effects.molasses > EPS ? pc.molasses.speedMultiplier : 1;
  return state.cfg.player.moveSpeed * (1 + pc.fleetFoot.moveSpeedBonus * effects.fleetFoot) * slow;
}

export function aimLeadFor(effects: Effects, cfg: Config): number {
  return effects.leadShot > EPS ? cfg.powerUps.leadShot.aimLead : cfg.bullet.aimLead;
}

export function maxDodgeCharges(effects: Effects): number {
  return 1 + effects.spareDodge;
}

// How big a player is for bullets (Big Target makes it larger).
export function hitRadiusFor(p: PlayerState, cfg: Config): number {
  return cfg.player.radius * (p.effects.bigTarget > EPS ? cfg.powerUps.bigTarget.sizeMultiplier : 1);
}

// Spawn, age, and collect power-ups. Called once per playing tick.
export function updatePowerUps(state: GameState, dt: number): void {
  const pc = state.cfg.powerUps;

  for (const p of state.players) {
    for (const k of POWER_UP_KINDS) if (!STACKING.has(k)) p.effects[k] = Math.max(0, p.effects[k] - dt);
  }

  state.nextPowerUpIn -= dt;
  if (state.nextPowerUpIn <= EPS) {
    scheduleNextPowerUp(state);
    if (state.powerUps.length < pc.maxOnMap) spawnPowerUp(state);
  }

  const kept = [];
  for (const pu of state.powerUps) {
    if (pu.telegraph > EPS) {
      pu.telegraph -= dt;
      kept.push(pu);
      continue;
    }
    const taker = ([0, 1] as const).find(
      (i) => dist(state.players[i].pos, pu.pos) < state.cfg.player.radius + pc.radius,
    );
    if (taker !== undefined) {
      applyPowerUp(state, taker, pu.kind);
      state.events.push({ type: 'pickup', player: taker, kind: pu.kind, pos: { ...pu.pos } });
      continue;
    }
    pu.remaining -= dt;
    if (pu.remaining <= EPS) {
      state.events.push({ type: 'powerUpExpired', pos: { ...pu.pos } });
      continue;
    }
    kept.push(pu);
  }
  state.powerUps = kept;
}

function spawnPowerUp(state: GameState): void {
  const pc = state.cfg.powerUps;
  const grid = state.arena.grid;
  const candidates: number[] = [];
  for (let i = 0; i < grid.open.length; i++) {
    if (!grid.open[i] || grid.clearance[i] < pc.minWallDistance) continue;
    const c = cellCenter(grid, i);
    if (state.players.some((p) => dist(p.pos, c) < pc.minPlayerDistance)) continue;
    if (state.powerUps.some((p) => dist(p.pos, c) < pc.minPowerUpDistance)) continue;
    candidates.push(i);
  }
  if (candidates.length === 0) return;
  const cell = candidates[Math.floor(nextRandom(state) * candidates.length)];
  const kind = pc.pool[Math.floor(nextRandom(state) * pc.pool.length)];
  const lifespan = pickLifespan(state);
  const pos = cellCenter(grid, cell);
  state.powerUps.push({ id: state.nextId++, kind, pos, telegraph: pc.telegraph, remaining: lifespan, lifespan });
  state.events.push({ type: 'powerUpTelegraph', kind, pos: { ...pos } });
}

export function pickLifespan(state: GameState): number {
  const options = state.cfg.powerUps.lifespans;
  const total = options.reduce((sum, o) => sum + o.weight, 0);
  let roll = nextRandom(state) * total;
  for (const o of options) {
    roll -= o.weight;
    if (roll < 0) return o.seconds;
  }
  return options[options.length - 1].seconds;
}

export function applyPowerUp(state: GameState, player: PlayerIndex, kind: PowerUpKind): void {
  const pc = state.cfg.powerUps;
  const me = state.players[player];
  if (STACKING.has(kind)) {
    const max = (pc[kind] as { maxStacks: number }).maxStacks;
    if (me.effects[kind] >= max) return;
    me.effects[kind]++;
    // A spare dodge is ready to use straight away.
    if (kind === 'spareDodge') me.dodgeCharges++;
    return;
  }
  const target = ON_OPPONENT.has(kind) ? state.players[player === 0 ? 1 : 0] : me;
  // Never cuts short an effect that lasts longer (e.g. one a round modifier gave).
  target.effects[kind] = Math.max(target.effects[kind], (pc[kind] as { duration: number }).duration);
}
