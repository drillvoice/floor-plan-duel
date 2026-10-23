// Every tunable number lives here. Distances are in units (a player is 1 unit
// across), times in seconds, speeds in units per second.

export const POWER_UP_KINDS = [
  // Round-long upgrades (stack).
  'swiftShot',
  'longShot',
  'triggerHappy',
  'fleetFoot',
  'spareDodge',
  // Temporary buffs.
  'shield',
  'rapidFire',
  'bouncer',
  'ghost',
  'leadShot',
  'laser',
  // Curses on the opponent.
  'molasses',
  'topsyTurvy',
  'bigTarget',
] as const;

export type PowerUpKind = (typeof POWER_UP_KINDS)[number];

// One-round rules (see sim/modifiers.ts for what each does).
export const MODIFIER_IDS = [
  'giantBullets',
  'powerUpStorm',
  'oneHitWonder',
  'speedDemons',
  'bulletHell',
  'sniperDuel',
  'bouncyCastle',
  'ghostTown',
  'dodgeFrenzy',
] as const;

export type ModifierId = (typeof MODIFIER_IDS)[number];

export const CONFIG = {
  tickRate: 60,

  player: {
    radius: 0.5,
    moveSpeed: 5,
  },

  bullet: {
    speed: 8,
    radius: 0.15,
    lifetime: 1,
    // Bullets fade over the last part of their life so range is readable.
    fadeTime: 0.2,
    // How much auto-aim leads a moving target: 0 = aim at current position,
    // 1 = full linear prediction of where the opponent will be.
    aimLead: 0.7,
  },

  fire: {
    cooldown: 0.6,
  },

  // A bullet that passes this close to a player's edge without hitting them
  // counts as a near miss (a "Close!" callout and a clutch dodge on the results).
  nearMiss: {
    margin: 0.4,
  },

  dodge: {
    distance: 2.5,
    duration: 0.15,
    // A dodge dashes the way you're moving (or last moved).
    cooldown: 1.2,
  },

  round: {
    hitsToLose: 3,
    roundsToWin: 3, // best of 5
    timeLimit: 90,
    // Sudden death: bullet speed is multiplied by (1 + speedup) every interval.
    suddenDeathInterval: 5,
    suddenDeathSpeedup: 0.1,
    // Pause before a round starts and after it ends.
    countdown: 1.5,
    endDelay: 2,
  },

  powerUps: {
    spawnIntervalMin: 3,
    spawnIntervalMax: 6,
    maxOnMap: 3,
    // Spawn spots must be this far from walls and from players.
    minWallDistance: 1.5,
    minPlayerDistance: 1.5,
    minPowerUpDistance: 2,
    // How long an item stays once it appears, picked per spawn.
    lifespans: [
      { seconds: 1, weight: 0.2 },
      { seconds: 3, weight: 0.2 },
      { seconds: 10, weight: 0.35 },
      { seconds: 30, weight: 0.25 },
    ],
    telegraph: 0.75,
    radius: 0.45,
    // Kinds that can spawn, with equal chance.
    pool: [...POWER_UP_KINDS] as PowerUpKind[],
    swiftShot: { bulletSpeedBonus: 0.25, maxStacks: 3 },
    // More range at the same speed.
    longShot: { lifetimeBonus: 0.4, maxStacks: 3 },
    // Each stack multiplies the fire cooldown by (1 - reduction).
    triggerHappy: { cooldownReduction: 0.2, maxStacks: 3 },
    fleetFoot: { moveSpeedBonus: 0.15, maxStacks: 3 },
    // Each stack is one extra dodge charge.
    spareDodge: { maxStacks: 1 },
    shield: { duration: 10 },
    rapidFire: { cooldownMultiplier: 0.5, duration: 5 },
    bouncer: { bounces: 1, duration: 8 },
    // Walk through inner walls (never out of the map).
    ghost: { duration: 4 },
    // Auto-aim fully predicts the opponent's movement.
    leadShot: { aimLead: 1, duration: 6 },
    // Shots become laser zaps. A shot first locks a thin line onto where the
    // opponent is now; `chargeTime` later the zap fires instantly along that
    // line, so the defender dodges the line rather than a bullet. The beam
    // stops at the first wall or after `range`. `cooldown` replaces the fire
    // cooldown (other fire-rate power-ups don't change it), `width` is how
    // thick the beam is for hits, and `flashTime` is how long it stays on
    // screen after firing.
    laser: { duration: 5, chargeTime: 0.4, range: 10, cooldown: 1, width: 0.2, flashTime: 0.15 },
    molasses: { speedMultiplier: 0.6, duration: 4 },
    // Opponent's movement (and so their dodges) reversed.
    topsyTurvy: { duration: 3 },
    // Opponent is easier to hit; walls still treat them as normal size.
    bigTarget: { sizeMultiplier: 1.5, duration: 5 },
    // Health crate: a comeback item, outside the pool above. Taking it undoes
    // one hit (never past full health). It only spawns for a player who is
    // behind on rounds, has taken a hit this round and isn't ahead on hits this
    // round, so never in a tied match. The chance each second is
    // `chancePerSecond` × rounds behind × hits taken, up to
    // `maxChancePerSecond`. It appears `minDistance`–`maxDistance` units from
    // that player, nearer them than their opponent, but either player can take it.
    healthCrate: {
      enabled: true,
      chancePerSecond: 0.06,
      maxChancePerSecond: 0.3,
      maxPerRound: 1,
      minDistance: 3,
      maxDistance: 7,
      lifespan: 10,
    },
  },

  // Round modifiers: before each round a spin picks a one-round rule. Off by
  // default here; the title screen turns them on (R).
  modifiers: {
    enabled: false,
    // A longer countdown so there's time to read the spin.
    countdown: 3,
    // Modifiers that can be picked, with equal chance.
    pool: [...MODIFIER_IDS] as ModifierId[],
  },

  bot: {
    difficulty: {
      easy: { reactionDelay: 0.35, missChance: 0.4 },
      normal: { reactionDelay: 0.2, missChance: 0.2 },
      hard: { reactionDelay: 0.08, missChance: 0.05 },
    },
    // Dodge a bullet that will pass within this margin in the next `threatHorizon` s.
    threatHorizon: 0.4,
    threatMargin: 0.2,
    preferredDistance: 7,
    distanceTolerance: 1.5,
    strafeSwitchMin: 0.8,
    strafeSwitchMax: 2.2,
    repathInterval: 0.25,
  },

  map: {
    wallThickness: 0.3,
    defaultWidth: 24,
    defaultHeight: 16,
    gridCell: 0.5,
  },
};

export type Config = typeof CONFIG;

// Physical key codes (KeyboardEvent.code), so layouts like AZERTY still map
// to the same physical positions. Shoot sits under the index finger and dodge
// under the middle finger: F/G for the left hand, / and . for the right.
export const KEY_BINDINGS = {
  p1: {
    up: 'KeyW',
    down: 'KeyS',
    left: 'KeyA',
    right: 'KeyD',
    shoot: 'KeyF',
    dodge: 'KeyG',
  },
  p2: {
    up: 'ArrowUp',
    down: 'ArrowDown',
    left: 'ArrowLeft',
    right: 'ArrowRight',
    dodge: 'Period',
    shoot: 'Slash',
  },
  pause: 'Escape',
};

export type PlayerKeys = typeof KEY_BINDINGS.p1;
