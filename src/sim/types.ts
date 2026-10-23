import type { Config, ModifierId, PowerUpKind } from '../config';
import type { Grid } from './grid';
import type { Vec2 } from './vec';

export type PlayerIndex = 0 | 1;

// What every input source (keyboard, touch, phone, bot) produces per tick.
export interface PlayerInput {
  move: Vec2; // any length; normalised to at most 1 by the sim
  dodge: boolean; // dash in the direction of `move` (or the last direction moved)
  shoot: boolean;
}

export const NO_INPUT: PlayerInput = {
  move: { x: 0, y: 0 },
  dodge: false,
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
  dark?: boolean; // lights out: only what's near a player or glowing is visible
  music?: MusicStyle; // background music while it's played; see musicStyle()
}

export const MUSIC_STYLES = ['bouncy', 'spooky', 'muzak', 'lofi', 'surf'] as const;
export type MusicStyle = (typeof MUSIC_STYLES)[number];

// The music a map plays: its own pick, else spooky in the dark, else bouncy.
export function musicStyle(map: { music?: MusicStyle; dark?: boolean }): MusicStyle {
  return map.music ?? (map.dark ? 'spooky' : 'bouncy');
}

// A map prepared for play: includes the outer boundary walls.
export interface Arena {
  name: string;
  width: number;
  height: number;
  walls: Wall[];
  spawns: [Vec2, Vec2];
  dark: boolean;
  music: MusicStyle;
  grid: Grid;
}

export type { PowerUpKind };

// gold = round-long upgrade, blue = temporary buff, red = curse on the opponent
export type PowerUpCategory = 'upgrade' | 'buff' | 'curse';

export const POWER_UP_CATEGORY: Record<PowerUpKind, PowerUpCategory> = {
  swiftShot: 'upgrade',
  longShot: 'upgrade',
  triggerHappy: 'upgrade',
  fleetFoot: 'upgrade',
  spareDodge: 'upgrade',
  shield: 'buff',
  rapidFire: 'buff',
  bouncer: 'buff',
  ghost: 'buff',
  leadShot: 'buff',
  laser: 'buff',
  molasses: 'curse',
  topsyTurvy: 'curse',
  bigTarget: 'curse',
};

// Anything that can be picked up: a power-up, or the health crate (which is
// spawned by its own rule rather than from the pool).
export type ItemKind = PowerUpKind | 'healthCrate';

export interface PowerUp {
  id: number;
  kind: ItemKind;
  pos: Vec2;
  telegraph: number; // seconds until it appears; can't be picked up before then
  remaining: number; // seconds left once it has appeared
  lifespan: number;
}

// Per power-up: stacks for round-long upgrades, seconds left for the rest
// (0 = none).
export type Effects = Record<PowerUpKind, number>;

export interface Dash {
  dir: Vec2;
  remaining: number; // seconds
}

export interface PlayerState {
  pos: Vec2;
  vel: Vec2; // walking velocity achieved last tick (excludes dashes)
  facing: Vec2; // unit vector toward the opponent
  lastMove: Vec2; // unit vector of the last movement input; where a dodge goes when standing still
  hits: number; // hits taken this round
  roundWins: number;
  nearMisses: number; // bullets that just missed this player, over the whole match
  fireCooldown: number;
  dodgeCharges: number;
  dodgeCooldown: number; // time until the next charge comes back
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
  bounces: number; // wall bounces left (Bouncer)
  closestGap: number; // nearest it has come to its target's edge so far
  nearMissed: boolean; // already counted as a near miss
}

// A laser zap (Laser power-up): locked onto a line when shot, fired along it
// once `age` reaches `chargeTime`, then shown briefly before it's removed.
export interface Laser {
  id: number;
  owner: PlayerIndex;
  from: Vec2;
  to: Vec2; // where the beam ends: its range or the first wall
  age: number; // seconds since it locked on
  chargeTime: number;
  fired: boolean;
}

export type Phase = 'countdown' | 'playing' | 'roundOver' | 'matchOver';

export type GameEvent =
  | { type: 'fire'; player: PlayerIndex; pos: Vec2 }
  | { type: 'laserCharge'; player: PlayerIndex; from: Vec2; to: Vec2 }
  | { type: 'laserFire'; player: PlayerIndex; from: Vec2; to: Vec2; hit: boolean }
  | { type: 'hit'; player: PlayerIndex; pos: Vec2; hits: number }
  | { type: 'nearMiss'; player: PlayerIndex; pos: Vec2 }
  | { type: 'wallHit'; owner: PlayerIndex; pos: Vec2 }
  | { type: 'bounce'; owner: PlayerIndex; pos: Vec2 }
  | { type: 'dodge'; player: PlayerIndex; from: Vec2; dir: Vec2 }
  | { type: 'roundStart'; round: number; modifier: ModifierId | null }
  | { type: 'roundEnd'; winner: PlayerIndex | null }
  | { type: 'matchEnd'; winner: PlayerIndex }
  | { type: 'suddenDeath' }
  | { type: 'powerUpTelegraph'; kind: ItemKind; pos: Vec2 }
  | { type: 'healthCrate'; player: PlayerIndex; pos: Vec2; healed: boolean } // picked up; healed = false at full health
  | { type: 'pickup'; player: PlayerIndex; kind: PowerUpKind; pos: Vec2 }
  | { type: 'powerUpExpired'; pos: Vec2 }
  | { type: 'effectEnded'; player: PlayerIndex; kind: PowerUpKind } // a timed power-up ran out
  | { type: 'shieldBlock'; player: PlayerIndex; pos: Vec2 };

export interface GameState {
  cfg: Config; // rules for the current round: baseCfg plus its modifier
  baseCfg: Config; // rules for the match
  modifier: ModifierId | null; // this round's modifier
  arena: Arena; // this round's
  arenas: Arena[]; // the match's maps, played in turn one per round
  tick: number;
  phase: Phase;
  phaseTime: number; // seconds spent in the current phase
  roundIndex: number; // rounds started so far, including drawn rounds
  roundTime: number; // seconds of play in the current round
  players: [PlayerState, PlayerState];
  bullets: Bullet[];
  lasers: Laser[];
  powerUps: PowerUp[];
  nextPowerUpIn: number;
  cratesThisRound: number; // health crates spawned this round
  nextId: number;
  rng: number;
  lastRoundWinner: PlayerIndex | null; // null = draw
  matchWinner: PlayerIndex | null;
  events: GameEvent[]; // events produced by the most recent step only
}
