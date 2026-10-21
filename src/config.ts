// Every tunable number lives here. Distances are in units (a player is 1 unit
// across), times in seconds, speeds in units per second.

export type PowerUpKind = 'swiftShot' | 'triggerHappy' | 'shield' | 'molasses';

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

  dodge: {
    distance: 2.5,
    duration: 0.15,
    // Shared by both directions.
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
    spawnIntervalMin: 4,
    spawnIntervalMax: 9,
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
    pool: ['swiftShot', 'triggerHappy', 'shield', 'molasses'] as PowerUpKind[],
    swiftShot: { bulletSpeedBonus: 0.25, maxStacks: 3 },
    // Each stack multiplies the fire cooldown by (1 - reduction).
    triggerHappy: { cooldownReduction: 0.2, maxStacks: 3 },
    shield: { duration: 10 },
    molasses: { speedMultiplier: 0.6, duration: 4 },
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
// to the same physical positions.
export const KEY_BINDINGS = {
  p1: {
    up: 'KeyW',
    down: 'KeyS',
    left: 'KeyA',
    right: 'KeyD',
    dodgeLeft: 'KeyF',
    shoot: 'KeyG',
    dodgeRight: 'KeyH',
  },
  p2: {
    up: 'ArrowUp',
    down: 'ArrowDown',
    left: 'ArrowLeft',
    right: 'ArrowRight',
    dodgeLeft: 'Comma',
    shoot: 'Period',
    dodgeRight: 'Slash',
  },
  pause: 'Escape',
};

export type PlayerKeys = typeof KEY_BINDINGS.p1;
