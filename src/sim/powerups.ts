import { cellCenter } from './grid';
import { nextRandom, randomRange } from './rng';
import type { Effects, GameState, PlayerIndex, PowerUpKind } from './types';
import { dist } from './vec';

const EPS = 1e-9;

export const noEffects = (): Effects => ({ swiftShot: 0, triggerHappy: 0, shield: 0, molasses: 0 });

export function scheduleNextPowerUp(state: GameState): void {
  const pc = state.cfg.powerUps;
  state.nextPowerUpIn = randomRange(state, pc.spawnIntervalMin, pc.spawnIntervalMax);
}

export function bulletSpeedFactor(effects: Effects, state: GameState): number {
  return 1 + state.cfg.powerUps.swiftShot.bulletSpeedBonus * effects.swiftShot;
}

export function fireCooldownFor(effects: Effects, state: GameState): number {
  const pc = state.cfg.powerUps;
  return state.cfg.fire.cooldown * Math.pow(1 - pc.triggerHappy.cooldownReduction, effects.triggerHappy);
}

export function moveSpeedFor(effects: Effects, state: GameState): number {
  const slow = effects.molasses > EPS ? state.cfg.powerUps.molasses.speedMultiplier : 1;
  return state.cfg.player.moveSpeed * slow;
}

// Spawn, age, and collect power-ups. Called once per playing tick.
export function updatePowerUps(state: GameState, dt: number): void {
  const pc = state.cfg.powerUps;

  for (const p of state.players) {
    p.effects.shield = Math.max(0, p.effects.shield - dt);
    p.effects.molasses = Math.max(0, p.effects.molasses - dt);
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
  const me = state.players[player].effects;
  const opponent = state.players[player === 0 ? 1 : 0].effects;
  switch (kind) {
    case 'swiftShot':
      me.swiftShot = Math.min(pc.swiftShot.maxStacks, me.swiftShot + 1);
      break;
    case 'triggerHappy':
      me.triggerHappy = Math.min(pc.triggerHappy.maxStacks, me.triggerHappy + 1);
      break;
    case 'shield':
      me.shield = pc.shield.duration;
      break;
    case 'molasses':
      opponent.molasses = pc.molasses.duration;
      break;
  }
}
