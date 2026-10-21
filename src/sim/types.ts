import type { Config, PowerUpKind } from '../config';
import type { Grid } from './grid';
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
  id?: string; // set once a map is saved in the editor
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
  grid: Grid;
}

export type { PowerUpKind };

// gold = round-long upgrade, blue = temporary buff, red = curse on the opponent
export type PowerUpCategory = 'upgrade' | 'buff' | 'curse';

export const POWER_UP_CATEGORY: Record<PowerUpKind, PowerUpCategory> = {
  swiftShot: 'upgrade',
  triggerHappy: 'upgrade',
  shield: 'buff',
  molasses: 'curse',
};

export interface PowerUp {
  id: number;
  kind: PowerUpKind;
  pos: Vec2;
  telegraph: number; // seconds until it appears; can't be picked up before then
  remaining: number; // seconds left once it has appeared
  lifespan: number;
}

export interface Effects {
  swiftShot: number; // stacks, this round
  triggerHappy: number; // stacks, this round
  shield: number; // seconds left, 0 = none
  molasses: number; // seconds left, 0 = none
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
  effects: Effects;
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
  | { type: 'suddenDeath' }
  | { type: 'powerUpTelegraph'; kind: PowerUpKind; pos: Vec2 }
  | { type: 'pickup'; player: PlayerIndex; kind: PowerUpKind; pos: Vec2 }
  | { type: 'powerUpExpired'; pos: Vec2 }
  | { type: 'shieldBlock'; player: PlayerIndex; pos: Vec2 };

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
  powerUps: PowerUp[];
  nextPowerUpIn: number;
  nextId: number;
  rng: number;
  lastRoundWinner: PlayerIndex | null; // null = draw
  matchWinner: PlayerIndex | null;
  events: GameEvent[]; // events produced by the most recent step only
}
