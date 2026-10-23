// A title for each player on the results screen, picked from their match
// stats: the first award in the list they beat their opponent at.

import type { Config } from '../config';
import type { PlayerStats } from '../sim/stats';

export interface Award {
  icon: string;
  name: string;
}

interface AwardRule extends Award {
  score: (s: PlayerStats) => number; // higher wins
  qualifies: (s: PlayerStats, cfg: Config['awards']) => boolean;
  also?: (me: PlayerStats, them: PlayerStats) => boolean; // any further condition
}

const accuracy = (s: PlayerStats) => (s.shots > 0 ? s.hits / s.shots : 0);

// In order of how much they're worth having; each player gets their first.
const AWARDS: AwardRule[] = [
  { icon: '✨', name: 'Flawless', score: (s) => s.flawlessRounds, qualifies: (s) => s.flawlessRounds > 0 },
  { icon: '🎯', name: 'Sharpshooter', score: accuracy, qualifies: (s, c) => s.shots >= c.minShots && s.hits > 0 },
  { icon: '😅', name: 'Escape Artist', score: (s) => s.clutchDodges, qualifies: (s, c) => s.clutchDodges >= c.minClutchDodges },
  { icon: '🔭', name: 'Sniper', score: (s) => s.longestHit, qualifies: (s, c) => s.longestHit >= c.minLongestHit },
  { icon: '🎁', name: 'Hoarder', score: (s) => s.powerUps, qualifies: (s, c) => s.powerUps >= c.minPowerUps },
  // Firing more and hitting less, not just firing more.
  { icon: '🔫', name: 'Spray and Pray', score: (s) => s.shots, qualifies: (s, c) => s.shots >= c.minShots, also: (me, them) => accuracy(me) < accuracy(them) },
  { icon: '💨', name: 'Slippery', score: (s) => s.dodges, qualifies: (s) => s.dodges > 0 },
  { icon: '🏃', name: 'Marathon Runner', score: (s) => s.distance, qualifies: (s) => s.distance > 0 },
];

// Everyone leaves with something.
const GOOD_SPORT: Award = { icon: '🤝', name: 'Good Sport' };

export function awards(stats: readonly [PlayerStats, PlayerStats], cfg: Config['awards']): [Award, Award] {
  const pick = (i: 0 | 1): Award => {
    const me = stats[i];
    const them = stats[1 - i];
    const won = AWARDS.find((a) => a.qualifies(me, cfg) && a.score(me) > a.score(them) && (a.also?.(me, them) ?? true));
    return won ? { icon: won.icon, name: won.name } : GOOD_SPORT;
  };
  return [pick(0), pick(1)];
}
