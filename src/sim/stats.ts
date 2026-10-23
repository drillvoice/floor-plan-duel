// Match stats for the results screen. Nearly all are counted from each
// step's events, so the rules only have to say what happened, not keep
// score. Distance run is the exception: it's added where players move.

import type { GameState, PlayerIndex } from './types';

export interface PlayerStats {
  shots: number; // bullets fired and lasers charged
  hits: number; // hits landed on the opponent (a shield block doesn't count)
  hitsTaken: number;
  longestHit: number; // furthest a shot that hit had travelled, in units
  dodges: number;
  clutchDodges: number; // near misses: bullets and lasers that only just missed
  powerUps: number; // power-ups and health crates picked up
  flawlessRounds: number; // rounds won without taking a hit
  distance: number; // units moved by walking and dodging
  hitThisRound: boolean; // whether this round can still be flawless
}

export const noStats = (): PlayerStats => ({
  shots: 0,
  hits: 0,
  hitsTaken: 0,
  longestHit: 0,
  dodges: 0,
  clutchDodges: 0,
  powerUps: 0,
  flawlessRounds: 0,
  distance: 0,
  hitThisRound: false,
});

const other = (i: PlayerIndex): PlayerIndex => (i === 0 ? 1 : 0);

// Called at the end of every step with that step's events.
export function tallyStats(state: GameState): void {
  const stats = state.players.map((p) => p.stats);
  for (const e of state.events) {
    switch (e.type) {
      case 'fire':
      case 'laserCharge':
        stats[e.player].shots++;
        break;
      case 'hit': {
        const shooter = stats[other(e.player)];
        shooter.hits++;
        shooter.longestHit = Math.max(shooter.longestHit, e.range);
        stats[e.player].hitsTaken++;
        stats[e.player].hitThisRound = true;
        break;
      }
      case 'dodge':
        stats[e.player].dodges++;
        break;
      case 'nearMiss':
        stats[e.player].clutchDodges++;
        break;
      case 'pickup':
      case 'healthCrate':
        stats[e.player].powerUps++;
        break;
      case 'roundEnd':
        // A health crate can undo a hit, so this goes by hits taken rather
        // than the health left.
        if (e.winner !== null && !stats[e.winner].hitThisRound) stats[e.winner].flawlessRounds++;
        break;
      case 'roundStart':
        for (const s of stats) s.hitThisRound = false;
        break;
    }
  }
}
