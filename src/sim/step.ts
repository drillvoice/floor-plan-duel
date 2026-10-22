// The simulation core. Fixed tick, no DOM, no Math.random, no wall-clock time:
// the same seed and inputs always produce the same match.
//
// `step` updates the state it is given in place (keeps headless sims fast) and
// reads nothing outside its arguments.

import { CONFIG, type Config } from '../config';
import { configFor, MODIFIERS, pickModifier } from './modifiers';
import { buildArena, ghostArena, hasLineOfSight, moveCircle, resolveCircle } from './arena';
import {
  aimLeadFor,
  bulletLifetimeFor,
  bulletSpeedFactor,
  fireCooldownFor,
  hitRadiusFor,
  maxDodgeCharges,
  moveSpeedFor,
  noEffects,
  scheduleNextPowerUp,
  updatePowerUps,
} from './powerups';
import { MAX_PLAYERS, NO_INPUT, type Bullet, type GameState, type MapData, type PlayerIndex, type PlayerInput, type PlayerState } from './types';
import { add, closestPointOnSegment, dist, distPointSegment, dot, len, normalize, scale, sub, type Vec2 } from './vec';

const EPS = 1e-9;

// Given several maps, the match plays them in turn, one per round. Each map
// needs a spawn point per player.
export function createGame(
  maps: MapData | readonly MapData[],
  seed: number,
  cfg: Config = CONFIG,
  playerCount = 2,
): GameState {
  if (!Number.isInteger(playerCount) || playerCount < 2 || playerCount > MAX_PLAYERS) {
    throw new Error(`A match needs 2 to ${MAX_PLAYERS} players, not ${playerCount}.`);
  }
  const arenas = (Array.isArray(maps) ? maps : [maps]).map((m: MapData) => {
    if (m.spawns.length < playerCount) throw new Error(`${m.name} has ${m.spawns.length} spawn points, too few for ${playerCount} players.`);
    return buildArena(m, cfg);
  });
  const state: GameState = {
    cfg,
    baseCfg: cfg,
    modifier: null,
    arena: arenas[0],
    arenas,
    tick: 0,
    phase: 'countdown',
    phaseTime: 0,
    roundIndex: 0,
    roundTime: 0,
    players: Array.from({ length: playerCount }, newPlayer),
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
    target: null,
    lastMove: { x: 0, y: 0 },
    hits: 0,
    out: false,
    roundWins: 0,
    nearMisses: 0,
    fireCooldown: 0,
    dodgeCharges: 1,
    dodgeCooldown: 0,
    dash: null,
    lineOfSight: false,
    effects: noEffects(),
  };
}

// A match uses the map's first spawn points, one per player, and players move
// round them by one each round so no slot keeps a spawn advantage. With two
// players they simply swap.
export function spawnFor(state: GameState, player: PlayerIndex): Vec2 {
  const n = state.players.length;
  return state.arena.spawns[(player + state.roundIndex) % n];
}

function startRound(state: GameState): void {
  state.arena = state.arenas[state.roundIndex % state.arenas.length];
  state.modifier = pickModifier(state);
  state.cfg = configFor(state.baseCfg, state.modifier);
  state.phase = 'countdown';
  state.phaseTime = 0;
  state.roundTime = 0;
  state.bullets = [];
  state.powerUps = [];
  scheduleNextPowerUp(state);
  state.players.forEach((p, i) => {
    p.pos = { ...spawnFor(state, i) };
    p.vel = { x: 0, y: 0 };
    p.hits = 0;
    p.out = false;
    p.fireCooldown = 0;
    p.dodgeCharges = 1;
    p.dodgeCooldown = 0;
    p.dash = null;
    p.lastMove = { x: 0, y: 0 };
    p.effects = noEffects(); // round-long upgrades reset each round
    if (state.modifier) Object.assign(p.effects, MODIFIERS[state.modifier].effects);
  });
  updateFacing(state);
  state.events.push({ type: 'roundStart', round: state.roundIndex, modifier: state.modifier });
}

export function suddenDeathMultiplier(state: GameState): number {
  const r = state.cfg.round;
  const over = state.roundTime - r.timeLimit;
  if (over < 0) return 1;
  const steps = 1 + Math.floor(over / r.suddenDeathInterval + EPS);
  return Math.pow(1 + r.suddenDeathSpeedup, steps);
}

// One input per player, in player order.
export function step(state: GameState, inputs: readonly PlayerInput[]): GameState {
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
      state.players.forEach((p, i) => {
        if (!p.out) updatePlayer(state, i, inputs[i] ?? NO_INPUT, dt);
      });
      updateFacing(state);
      state.players.forEach((p, i) => {
        if (!p.out) tryFire(state, i, inputs[i] ?? NO_INPUT);
      });
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

  // Dodge charges come back one at a time.
  const maxCharges = maxDodgeCharges(p.effects);
  if (p.dodgeCharges < maxCharges) {
    p.dodgeCooldown -= dt;
    if (p.dodgeCooldown <= EPS) {
      p.dodgeCharges++;
      p.dodgeCooldown = p.dodgeCharges < maxCharges ? cfg.dodge.cooldown : 0;
    }
  } else {
    p.dodgeCooldown = 0;
  }

  // Topsy-Turvy reverses movement, and so the direction of dodges too.
  const moveInput = p.effects.topsyTurvy > EPS ? scale(input.move, -1) : input.move;
  if (len(moveInput) > EPS) p.lastMove = normalize(moveInput);
  if (!p.dash && p.dodgeCharges > 0 && input.dodge) {
    const dir = dodgeDirection(p);
    p.dash = { dir, remaining: cfg.dodge.duration };
    p.dodgeCharges--;
    if (p.dodgeCooldown <= EPS) p.dodgeCooldown = cfg.dodge.cooldown;
    state.events.push({ type: 'dodge', player: i, from: { ...p.pos }, dir });
  }

  // A Ghost only bumps into the outer walls.
  const arena = p.effects.ghost > EPS ? ghostArena(state.arena) : state.arena;

  const before = { ...p.pos };
  if (p.dash) {
    // Movement input is ignored while dashing; hitting a wall ends the dash.
    const t = Math.min(dt, p.dash.remaining);
    const speed = cfg.dodge.distance / cfg.dodge.duration;
    const hitWall = moveCircle(p.pos, scale(p.dash.dir, speed * t), cfg.player.radius, arena, cfg);
    p.dash.remaining -= t;
    if (hitWall || p.dash.remaining <= EPS) p.dash = null;
    p.vel = { x: 0, y: 0 };
    return;
  }

  let move = moveInput;
  const l = len(move);
  if (l > 1) move = scale(move, 1 / l); // diagonals aren't faster
  moveCircle(p.pos, scale(move, moveSpeedFor(p.effects, state) * dt), cfg.player.radius, arena, cfg);
  p.vel = scale(sub(p.pos, before), 1 / dt);
}

// A dodge dashes the way the player is moving; standing still, the way they
// last moved; before they've moved at all, toward their target.
export function dodgeDirection(p: PlayerState): Vec2 {
  return len(p.lastMove) > EPS ? p.lastMove : p.facing;
}

// Auto-aim targets the nearest opponent still in the round (ties go to the
// lower-numbered player, so it never depends on anything but the state).
export function nearestOpponent(state: GameState, i: PlayerIndex): PlayerIndex | null {
  const me = state.players[i];
  let best: PlayerIndex | null = null;
  let bestD = Infinity;
  state.players.forEach((p, j) => {
    if (j === i || p.out) return;
    const d = dist(me.pos, p.pos);
    if (d < bestD - EPS) {
      bestD = d;
      best = j;
    }
  });
  return best;
}

function updateFacing(state: GameState): void {
  state.players.forEach((p, i) => {
    if (p.out) return;
    p.target = nearestOpponent(state, i);
    if (p.target === null) return;
    const t = state.players[p.target];
    const d = normalize(sub(t.pos, p.pos));
    if (d.x !== 0 || d.y !== 0) p.facing = d;
    p.lineOfSight = hasLineOfSight(p.pos, t.pos, state.arena, state.cfg);
  });
}

// Where auto-aim points: the target's position, led along their current
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
  if (!input.shoot || p.fireCooldown > EPS || p.target === null) return;
  const target = p.target;
  const opp = state.players[target];
  const speed = cfg.bullet.speed * bulletSpeedFactor(p.effects, state) * suddenDeathMultiplier(state);
  let dir = normalize(sub(aimPoint(p.pos, opp, speed, aimLeadFor(p.effects, cfg)), p.pos));
  if (dir.x === 0 && dir.y === 0) dir = p.facing;
  const start = add(p.pos, scale(dir, cfg.player.radius + cfg.bullet.radius));
  const bullet: Bullet = {
    id: state.nextId++,
    owner: i,
    target,
    pos: start,
    vel: scale(dir, speed),
    age: 0,
    lifetime: bulletLifetimeFor(p.effects, state),
    radius: cfg.bullet.radius,
    bounces: p.effects.bouncer > EPS ? cfg.powerUps.bouncer.bounces : 0,
    closestGap: Infinity,
    nearMissed: false,
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
    // Near misses are judged against the player it was aimed at, but it hits
    // whichever opponent it touches first.
    const targetIndex = b.target;
    const target = state.players[targetIndex];
    // Sub-step along the path so fast bullets can't skip past walls or players.
    const steps = Math.max(1, Math.ceil((len(b.vel) * dt) / 0.1));
    let alive = true;
    for (let s = 0; s < steps && alive; s++) {
      b.pos = add(b.pos, scale(b.vel, dt / steps));
      const wall = state.arena.walls.find((w) => distPointSegment(b.pos, w.a, w.b) < b.radius + wallClear);
      const gap = dist(b.pos, target.pos) - hitRadiusFor(target, cfg) - b.radius;
      const struck = state.players.findIndex(
        (p, j) => j !== b.owner && !p.out && dist(b.pos, p.pos) < hitRadiusFor(p, cfg) + b.radius,
      );
      if (struck >= 0) {
        const victim = state.players[struck];
        if (victim.effects.shield > EPS) {
          victim.effects.shield = 0;
          state.events.push({ type: 'shieldBlock', player: struck, pos: { ...b.pos } });
        } else {
          victim.hits++;
          state.events.push({ type: 'hit', player: struck, pos: { ...b.pos }, hits: victim.hits });
          // Out of the round; a knockout still in flight can't land twice.
          if (victim.hits >= cfg.round.hitsToLose) knockOut(victim);
        }
        alive = false;
      } else if (wall && b.bounces > 0) {
        // Reflect off the wall's surface (its end caps are round).
        const c = closestPointOnSegment(b.pos, wall.a, wall.b);
        let n = normalize(sub(b.pos, c));
        if (n.x === 0 && n.y === 0) n = normalize({ x: wall.a.y - wall.b.y, y: wall.b.x - wall.a.x });
        if (dot(b.vel, n) < 0) b.vel = sub(b.vel, scale(n, 2 * dot(b.vel, n)));
        b.pos = add(c, scale(n, b.radius + wallClear + 0.01));
        b.bounces--;
        state.events.push({ type: 'bounce', owner: b.owner, pos: { ...b.pos } });
      } else if (wall) {
        state.events.push({ type: 'wallHit', owner: b.owner, pos: { ...b.pos } });
        alive = false;
        checkNearMiss(state, b, targetIndex);
      } else if (gap < b.closestGap) {
        b.closestGap = gap;
      } else {
        // Moving away again: it has passed its target.
        checkNearMiss(state, b, targetIndex);
      }
    }
    b.age += dt;
    if (alive && b.age < b.lifetime - EPS) survivors.push(b);
    else if (alive) checkNearMiss(state, b, targetIndex);
  }
  state.bullets = survivors;
}

// A bullet that came within the near-miss margin of its target and didn't hit
// counts once, when it passes them or dies.
function checkNearMiss(state: GameState, b: Bullet, target: PlayerIndex): void {
  if (b.nearMissed || b.closestGap >= state.cfg.nearMiss.margin || state.players[target].out) return;
  b.nearMissed = true;
  state.players[target].nearMisses++;
  state.events.push({ type: 'nearMiss', player: target, pos: { ...b.pos } });
}

function knockOut(p: PlayerState): void {
  p.out = true;
  p.dash = null;
  p.vel = { x: 0, y: 0 };
  p.target = null;
  p.lineOfSight = false;
}

// The round ends when one player is left standing. If the last ones are
// knocked out on the same tick, it's a draw and is replayed.
function checkRoundEnd(state: GameState): void {
  const cfg = state.cfg;
  for (const p of state.players) if (!p.out && p.hits >= cfg.round.hitsToLose) knockOut(p);
  const standing = state.players.flatMap((p, i) => (p.out ? [] : [i]));
  if (standing.length > 1) return;
  const winner: PlayerIndex | null = standing.length === 1 ? standing[0] : null;
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
