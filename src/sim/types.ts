import type { Config } from '../config';
import type { Vec2 } from './vec';

export type PlayerIndex = 0 | 1;

// What every input source (keyboard, bot, later gamepad/touch) produces per tick.
export interface PlayerInput {
  move: Vec2; // any length; normalised to at most 1 by the sim
  dodgeLeft: boolean;
  dodgeRight: boolean;
  shoot: boolean;
}

export const NO_INPUT: PlayerInput = {
  move: { x: 0, y: 0 },
  dodgeLeft: false,
  dodgeRight: false,
  shoot: false,
};

export interface Wall {
  a: Vec2;
  b: Vec2;
}

// Saved map format (JSON). Outer walls are implied by width/height.
export interface MapData {
  name: string;
  width: number;
  height: number;
  walls: Wall[];
  spawns: [Vec2, Vec2];
}

// A map prepared for play: includes the outer boundary walls.
export interface Arena {
  name: string;
  width: number;
  height: number;
  walls: Wall[];
  spawns: [Vec2, Vec2];
}

export interface Dash {
  dir: Vec2;
  remaining: number; // seconds
}

export interface PlayerState {
  pos: Vec2;
  vel: Vec2; // walking velocity achieved last tick (excludes dashes)
  facing: Vec2; // unit vector toward the opponent
  hits: number; // hits taken this round
  roundWins: number;
  fireCooldown: number;
  dodgeCooldown: number;
  dash: Dash | null;
  lineOfSight: boolean;
}

export interface Bullet {
  id: number;
  owner: PlayerIndex;
  pos: Vec2;
  vel: Vec2;
  age: number;
  lifetime: number;
  radius: number;
}

export type Phase = 'countdown' | 'playing' | 'roundOver' | 'matchOver';

export type GameEvent =
  | { type: 'fire'; player: PlayerIndex; pos: Vec2 }
  | { type: 'hit'; player: PlayerIndex; pos: Vec2; hits: number }
  | { type: 'wallHit'; pos: Vec2 }
  | { type: 'dodge'; player: PlayerIndex; from: Vec2; dir: Vec2 }
  | { type: 'roundStart'; round: number }
  | { type: 'roundEnd'; winner: PlayerIndex | null }
  | { type: 'matchEnd'; winner: PlayerIndex }
  | { type: 'suddenDeath' };

export interface GameState {
  cfg: Config;
  arena: Arena;
  tick: number;
  phase: Phase;
  phaseTime: number; // seconds spent in the current phase
  roundIndex: number; // rounds started so far, including drawn rounds
  roundTime: number; // seconds of play in the current round
  players: [PlayerState, PlayerState];
  bullets: Bullet[];
  nextId: number;
  rng: number;
  lastRoundWinner: PlayerIndex | null; // null = draw
  matchWinner: PlayerIndex | null;
  events: GameEvent[]; // events produced by the most recent step only
}
