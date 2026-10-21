// The simulation core. Fixed tick, no DOM, no Math.random, no wall-clock time:
// the same seed and inputs always produce the same match.
//
// `step` updates the state it is given in place (keeps headless sims fast) and
// reads nothing outside its arguments.

import { CONFIG, type Config } from '../config';
import { buildArena, hasLineOfSight, moveCircle, resolveCircle } from './arena';
import { bulletSpeedFactor, fireCooldownFor, moveSpeedFor, noEffects, scheduleNextPowerUp, updatePowerUps } from './powerups';
import type { Bullet, GameState, MapData, PlayerIndex, PlayerInput, PlayerState } from './types';
import { add, dist, distPointSegment, dot, leftOf, len, normalize, rightOf, scale, sub, type Vec2 } from './vec';

const EPS = 1e-9;

export function createGame(map: MapData, seed: number, cfg: Config = CONFIG): GameState {
  const arena = buildArena(map, cfg);
  const state: GameState = {
    cfg,
    arena,
    tick: 0,
    phase: 'countdown',
    phaseTime: 0,
    roundIndex: 0,
    roundTime: 0,
    players: [newPlayer(), newPlayer()],
    bullets: [],
    powerUps: [],
    nextPowerUpIn: 0,
    nextId: 1,
    rng: seed >>> 0,
    lastRoundWinner: null,
    matchWinner: null,
    events: [],
  };
  startRound(state);
  return state;
}

function newPlayer(): PlayerState {
  return {
    pos: { x: 0, y: 0 },
    vel: { x: 0, y: 0 },
    facing: { x: 1, y: 0 },
    hits: 0,
    roundWins: 0,
    fireCooldown: 0,
    dodgeCooldown: 0,
    dash: null,
    lineOfSight: false,
    effects: noEffects(),
  };
}

// Players swap spawn points every round so neither slot keeps a spawn advantage.
export function spawnFor(state: GameState, player: PlayerIndex): Vec2 {
  const swap = state.roundIndex % 2 === 1;
  return state.arena.spawns[(player === 0) !== swap ? 0 : 1];
}

function startRound(state: GameState): void {
  state.phase = 'countdown';
  state.phaseTime = 0;
  state.roundTime = 0;
  state.bullets = [];
  state.powerUps = [];
  scheduleNextPowerUp(state);
  for (const i of [0, 1] as const) {
    const p = state.players[i];
    p.pos = { ...spawnFor(state, i) };
    p.vel = { x: 0, y: 0 };
    p.hits = 0;
    p.fireCooldown = 0;
    p.dodgeCooldown = 0;
    p.dash = null;
    p.effects = noEffects(); // round-long upgrades reset each round
  }
  updateFacing(state);
  state.events.push({ type: 'roundStart', round: state.roundIndex });
}

export function suddenDeathMultiplier(state: GameState): number {
  const r = state.cfg.round;
  const over = state.roundTime - r.timeLimit;
  if (over < 0) return 1;
  const steps = 1 + Math.floor(over / r.suddenDeathInterval + EPS);
  return Math.pow(1 + r.suddenDeathSpeedup, steps);
}

export function step(state: GameState, inputs: [PlayerInput, PlayerInput]): GameState {
  const cfg = state.cfg;
  const dt = 1 / cfg.tickRate;
  state.events = [];
  state.tick++;
  state.phaseTime += dt;

  switch (state.phase) {
    case 'countdown':
      if (state.phaseTime >= cfg.round.countdown - EPS) {
        state.phase = 'playing';
        state.phaseTime = 0;
      }
      break;

    case 'playing': {
      const wasSuddenDeath = state.roundTime >= cfg.round.timeLimit;
      state.roundTime += dt;
      if (!wasSuddenDeath && state.roundTime >= cfg.round.timeLimit - EPS) {
        state.events.push({ type: 'suddenDeath' });
      }
      for (const i of [0, 1] as const) updatePlayer(state, i, inputs[i], dt);
      updateFacing(state);
      for (const i of [0, 1] as const) tryFire(state, i, inputs[i]);
      updateBullets(state, dt);
      updatePowerUps(state, dt);
      checkRoundEnd(state);
      break;
    }

    case 'roundOver':
      if (state.phaseTime >= cfg.round.endDelay - EPS) {
        state.roundIndex++;
        startRound(state);
      }
      break;

    case 'matchOver':
      break;
  }
  return state;
}

function updatePlayer(state: GameState, i: PlayerIndex, input: PlayerInput, dt: number): void {
  const cfg = state.cfg;
  const p = state.players[i];
  p.fireCooldown = Math.max(0, p.fireCooldown - dt);
  p.dodgeCooldown = Math.max(0, p.dodgeCooldown - dt);

  if (!p.dash && p.dodgeCooldown <= EPS && (input.dodgeLeft || input.dodgeRight)) {
    // Dodge sideways relative to facing; if both are pressed, left wins.
    const dir = input.dodgeLeft ? leftOf(p.facing) : rightOf(p.facing);
    p.dash = { dir, remaining: cfg.dodge.duration };
    p.dodgeCooldown = cfg.dodge.cooldown;
    state.events.push({ type: 'dodge', player: i, from: { ...p.pos }, dir });
  }

  const before = { ...p.pos };
  if (p.dash) {
    // Movement input is ignored while dashing; hitting a wall ends the dash.
    const t = Math.min(dt, p.dash.remaining);
    const speed = cfg.dodge.distance / cfg.dodge.duration;
    const hitWall = moveCircle(p.pos, scale(p.dash.dir, speed * t), cfg.player.radius, state.arena, cfg);
    p.dash.remaining -= t;
    if (hitWall || p.dash.remaining <= EPS) p.dash = null;
    p.vel = { x: 0, y: 0 };
    return;
  }

  let move = input.move;
  const l = len(move);
  if (l > 1) move = scale(move, 1 / l); // diagonals aren't faster
  moveCircle(p.pos, scale(move, moveSpeedFor(p.effects, state) * dt), cfg.player.radius, state.arena, cfg);
  p.vel = scale(sub(p.pos, before), 1 / dt);
}

function updateFacing(state: GameState): void {
  const [a, b] = state.players;
  const d = normalize(sub(b.pos, a.pos));
  if (d.x !== 0 || d.y !== 0) {
    a.facing = d;
    b.facing = scale(d, -1);
  }
  const los = hasLineOfSight(a.pos, b.pos, state.arena, state.cfg);
  a.lineOfSight = b.lineOfSight = los;
}

// Where auto-aim points: the opponent's position, led along their current
// velocity by `aimLead` of the time a bullet takes to intercept them.
export function aimPoint(shooterPos: Vec2, target: PlayerState, bulletSpeed: number, lead: number): Vec2 {
  if (lead <= 0) return target.pos;
  // Solve |rel + vel*t| = speed*t for the earliest positive t.
  const rel = sub(target.pos, shooterPos);
  const v = target.vel;
  const a = dot(v, v) - bulletSpeed * bulletSpeed;
  const b = 2 * dot(rel, v);
  const c = dot(rel, rel);
  let t = len(rel) / bulletSpeed;
  if (Math.abs(a) < EPS) {
    if (Math.abs(b) > EPS && -c / b > 0) t = -c / b;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const r = Math.sqrt(disc);
      const t1 = (-b - r) / (2 * a);
      const t2 = (-b + r) / (2 * a);
      const best = Math.min(t1 > 0 ? t1 : Infinity, t2 > 0 ? t2 : Infinity);
      if (best < Infinity) t = best;
    }
  }
  return add(target.pos, scale(v, t * lead));
}

function tryFire(state: GameState, i: PlayerIndex, input: PlayerInput): void {
  const cfg = state.cfg;
  const p = state.players[i];
  if (!input.shoot || p.fireCooldown > EPS) return;
  const opp = state.players[i === 0 ? 1 : 0];
  const speed = cfg.bullet.speed * bulletSpeedFactor(p.effects, state) * suddenDeathMultiplier(state);
  let dir = normalize(sub(aimPoint(p.pos, opp, speed, cfg.bullet.aimLead), p.pos));
  if (dir.x === 0 && dir.y === 0) dir = p.facing;
  const start = add(p.pos, scale(dir, cfg.player.radius + cfg.bullet.radius));
  const bullet: Bullet = {
    id: state.nextId++,
    owner: i,
    pos: start,
    vel: scale(dir, speed),
    age: 0,
    lifetime: cfg.bullet.lifetime,
    radius: cfg.bullet.radius,
  };
  state.bullets.push(bullet);
  p.fireCooldown = fireCooldownFor(p.effects, state);
  state.events.push({ type: 'fire', player: i, pos: { ...start } });
}

function updateBullets(state: GameState, dt: number): void {
  const cfg = state.cfg;
  const wallClear = cfg.map.wallThickness / 2;
  const survivors: Bullet[] = [];
  for (const b of state.bullets) {
    const target = state.players[b.owner === 0 ? 1 : 0];
    const targetIndex: PlayerIndex = b.owner === 0 ? 1 : 0;
    const travel = scale(b.vel, dt);
    // Sub-step along the path so fast bullets can't skip past walls or players.
    const steps = Math.max(1, Math.ceil(len(travel) / 0.1));
    let alive = true;
    for (let s = 0; s < steps && alive; s++) {
      b.pos = add(b.pos, scale(travel, 1 / steps));
      if (dist(b.pos, target.pos) < cfg.player.radius + b.radius) {
        if (target.effects.shield > EPS) {
          target.effects.shield = 0;
          state.events.push({ type: 'shieldBlock', player: targetIndex, pos: { ...b.pos } });
        } else {
          target.hits++;
          state.events.push({ type: 'hit', player: targetIndex, pos: { ...b.pos }, hits: target.hits });
        }
        alive = false;
      } else if (state.arena.walls.some((w) => distPointSegment(b.pos, w.a, w.b) < b.radius + wallClear)) {
        state.events.push({ type: 'wallHit', pos: { ...b.pos } });
        alive = false;
      }
    }
    b.age += dt;
    if (alive && b.age < b.lifetime - EPS) survivors.push(b);
  }
  state.bullets = survivors;
}

function checkRoundEnd(state: GameState): void {
  const cfg = state.cfg;
  const out = state.players.map((p) => p.hits >= cfg.round.hitsToLose);
  if (!out[0] && !out[1]) return;
  // Both knocked out on the same tick: the round is a draw and is replayed.
  const winner: PlayerIndex | null = out[0] && out[1] ? null : out[0] ? 1 : 0;
  state.lastRoundWinner = winner;
  state.events.push({ type: 'roundEnd', winner });
  state.phaseTime = 0;
  if (winner !== null) {
    state.players[winner].roundWins++;
    if (state.players[winner].roundWins >= cfg.round.roundsToWin) {
      state.matchWinner = winner;
      state.phase = 'matchOver';
      state.events.push({ type: 'matchEnd', winner });
      return;
    }
  }
  state.phase = 'roundOver';
}

// Exposed for tests and tools that place players directly.
export function placePlayer(state: GameState, i: PlayerIndex, pos: Vec2): void {
  const p = state.players[i];
  p.pos = { ...pos };
  resolveCircle(p.pos, state.cfg.player.radius, state.arena, state.cfg);
  updateFacing(state);
}
