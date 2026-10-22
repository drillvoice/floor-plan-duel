// The bot drives a player through the same input interface as a human, so it
// can't cheat and can fill either slot. It reads the game state the way a
// player reads the screen, with a reaction delay and a chance to miss a dodge.

import type { InputSource } from '../input/types';
import { moveCircle } from '../sim/arena';
import { hitRadiusFor, moveSpeedFor } from '../sim/powerups';
import { nextRandom, randomRange } from '../sim/rng';
import type { GameState, PlayerIndex, PlayerInput } from '../sim/types';
import { dist, distPointSegment, distSegmentSegment, dot, leftOf, len, normalize, rightOf, scale, sub, add, type Vec2 } from '../sim/vec';
import { findPath } from './pathfind';

export type Difficulty = 'easy' | 'normal' | 'hard';

// Something about to hit us: a shot travelling from `from` along `dir`, for
// up to `length` units (a bullet's line is open-ended, a laser's isn't).
interface Threat {
  from: Vec2;
  dir: Vec2;
  length: number;
  radius: number;
}

export class BotPlayer implements InputSource {
  readonly kind = 'bot';
  private rng: { rng: number };
  // Per bullet or laser: whether this bot will react to it (rolled once, on first sight).
  private reactions = new Map<number, boolean>();
  private path: Vec2[] | null = null;
  private pathTarget: Vec2 | null = null;
  private repathIn = 0;
  private strafeDir = 1;
  private strafeSwitchIn = 0;
  private round = -1;

  constructor(
    readonly difficulty: Difficulty,
    seed: number,
  ) {
    this.rng = { rng: seed >>> 0 };
  }

  sample(state: GameState, me: PlayerIndex): PlayerInput {
    const input: PlayerInput = { move: { x: 0, y: 0 }, dodge: false, shoot: false };
    if (state.phase !== 'playing') return input;
    if (state.roundIndex !== this.round) {
      this.round = state.roundIndex;
      this.reactions.clear();
      this.path = null;
    }
    const dt = 1 / state.cfg.tickRate;
    this.repathIn -= dt;
    this.strafeSwitchIn -= dt;

    const self = state.players[me];
    const opp = state.players[me === 0 ? 1 : 0];
    // A laser shot out of range is wasted, and its cooldown is long.
    input.shoot = self.lineOfSight && (self.effects.laser <= 0 || dist(self.pos, opp.pos) <= state.cfg.powerUps.laser.range);

    const threat = this.findThreat(state, me);
    if (threat) this.evade(state, me, threat, input);
    else {
      const target = this.powerUpTarget(state, me);
      if (target) input.move = this.navigate(state, me, target);
      else if (!self.lineOfSight) input.move = this.navigate(state, me, opp.pos);
      else input.move = this.fight(state, me);
    }
    // Under Topsy-Turvy the sim reverses our movement, so push the other way.
    if (self.effects.topsyTurvy > 0) input.move = scale(input.move, -1);
    return input;
  }

  // The most urgent shot that will hit us soon, among those we've noticed:
  // a bullet heading our way, or a laser locked onto a line we're standing on.
  private findThreat(state: GameState, me: PlayerIndex): Threat | null {
    const cfg = state.cfg;
    const diff = cfg.bot.difficulty[this.difficulty];
    const self = state.players[me];
    const hitRadius = hitRadiusFor(self, cfg) + cfg.bullet.radius + cfg.bot.threatMargin;
    let best: Threat | null = null;
    let bestT = Infinity;
    const lc = cfg.powerUps.laser;
    for (const l of state.lasers) {
      if (l.owner === me || l.fired || l.age < diff.reactionDelay) continue;
      if (distPointSegment(self.pos, l.from, l.to) >= hitRadiusFor(self, cfg) + lc.width / 2 + cfg.bot.threatMargin) continue;
      if (!this.reacts(l.id, diff.missChance)) continue;
      const t = l.chargeTime - l.age;
      if (t < bestT) {
        bestT = t;
        best = { from: l.from, dir: normalize(sub(l.to, l.from)), length: dist(l.from, l.to), radius: lc.width / 2 };
      }
    }
    for (const b of state.bullets) {
      if (b.owner === me || b.age < diff.reactionDelay) continue;
      const rel = sub(self.pos, b.pos);
      const relV = sub(b.vel, self.vel);
      const v2 = dot(relV, relV);
      if (v2 < 1e-9) continue;
      const horizon = Math.min(cfg.bot.threatHorizon, b.lifetime - b.age);
      const t = Math.max(0, Math.min(horizon, dot(rel, relV) / v2));
      if (len(sub(rel, scale(relV, t))) >= hitRadius) continue;
      // Ignore shots that will hit a wall first.
      const at = add(b.pos, scale(b.vel, t));
      if (state.arena.walls.some((w) => distSegmentSegment(b.pos, at, w.a, w.b) < b.radius + cfg.map.wallThickness / 2))
        continue;
      if (!this.reacts(b.id, diff.missChance)) continue;
      if (t < bestT) {
        bestT = t;
        best = { from: b.pos, dir: normalize(b.vel), length: Infinity, radius: b.radius };
      }
    }
    if (this.reactions.size > 64) {
      const live = new Set([...state.bullets.map((b) => b.id), ...state.lasers.map((l) => l.id)]);
      for (const id of this.reactions.keys()) if (!live.has(id)) this.reactions.delete(id);
    }
    return best;
  }

  private reacts(id: number, missChance: number): boolean {
    if (!this.reactions.has(id)) this.reactions.set(id, nextRandom(this.rng) >= missChance);
    return this.reactions.get(id)!;
  }

  private evade(state: GameState, me: PlayerIndex, threat: Threat, input: PlayerInput): void {
    const cfg = state.cfg;
    const self = state.players[me];
    const { dir } = threat;
    const missDistance = (p: Vec2) => {
      const rel = sub(p, threat.from);
      return len(sub(rel, scale(dir, Math.max(0, Math.min(threat.length, dot(rel, dir))))));
    };
    // Walk sideways off the shot's line.
    let side = leftOf(dir);
    if (dot(sub(self.pos, threat.from), side) < 0) side = scale(side, -1);
    input.move = side;

    if (self.dash || self.dodgeCharges === 0) return;
    // A dodge goes the way we move, so try dashing to either side of the
    // shot's line and take whichever ends furthest off it (walls can stop
    // a dash short), as long as it actually gets clear.
    const options = [side, scale(side, -1)].map((dir) => {
      const end = { ...self.pos };
      moveCircle(end, scale(dir, cfg.dodge.distance), cfg.player.radius, state.arena, cfg);
      return { dir, miss: missDistance(end) };
    });
    options.sort((a, b) => b.miss - a.miss);
    if (options[0].miss > hitRadiusFor(self, cfg) + threat.radius) {
      input.move = options[0].dir;
      input.dodge = true;
    }
  }

  private powerUpTarget(state: GameState, me: PlayerIndex): Vec2 | null {
    const self = state.players[me];
    const opp = state.players[me === 0 ? 1 : 0];
    const speed = moveSpeedFor(self.effects, state);
    let best: Vec2 | null = null;
    let bestD = Infinity;
    for (const pu of state.powerUps) {
      const d = dist(self.pos, pu.pos);
      if (d >= dist(opp.pos, pu.pos)) continue;
      // Straight-line distance underestimates the trip, so allow some slack.
      if ((d * 1.3) / speed > pu.telegraph + pu.remaining) continue;
      if (d < bestD) {
        bestD = d;
        best = pu.pos;
      }
    }
    return best;
  }

  // Keep a preferred distance and strafe sideways.
  private fight(state: GameState, me: PlayerIndex): Vec2 {
    const bc = state.cfg.bot;
    const self = state.players[me];
    const opp = state.players[me === 0 ? 1 : 0];
    if (this.strafeSwitchIn <= 0 || (len(self.vel) < 0.5 && this.strafeSwitchIn < bc.strafeSwitchMin * 0.7)) {
      this.strafeDir = nextRandom(this.rng) < 0.5 ? -1 : 1;
      this.strafeSwitchIn = randomRange(this.rng, bc.strafeSwitchMin, bc.strafeSwitchMax);
    }
    const toOpp = normalize(sub(opp.pos, self.pos));
    const d = dist(opp.pos, self.pos);
    const radial = d > bc.preferredDistance + bc.distanceTolerance ? 0.8 : d < bc.preferredDistance - bc.distanceTolerance ? -0.8 : 0;
    return add(scale(rightOf(toOpp), this.strafeDir), scale(toOpp, radial));
  }

  private navigate(state: GameState, me: PlayerIndex, target: Vec2): Vec2 {
    const self = state.players[me];
    if (this.repathIn <= 0 || !this.path || !this.pathTarget || dist(this.pathTarget, target) > 1) {
      this.path = findPath(state.arena.grid, self.pos, target);
      this.pathTarget = { ...target };
      this.repathIn = state.cfg.bot.repathInterval;
    }
    const path = this.path;
    if (!path || path.length === 0) return normalize(sub(target, self.pos));
    while (path.length > 1 && dist(path[0], self.pos) < 0.35) path.shift();
    // Head for the furthest of the next few waypoints we can walk straight to.
    let aim = path[0];
    for (let i = Math.min(path.length, 8) - 1; i > 0; i--) {
      if (this.clearWalk(state, self.pos, path[i])) {
        aim = path[i];
        break;
      }
    }
    return normalize(sub(aim, self.pos));
  }

  private clearWalk(state: GameState, a: Vec2, b: Vec2): boolean {
    const clearance = state.cfg.player.radius + state.cfg.map.wallThickness / 2 + 0.05;
    return !state.arena.walls.some((w) => distSegmentSegment(a, b, w.a, w.b) < clearance);
  }
}
