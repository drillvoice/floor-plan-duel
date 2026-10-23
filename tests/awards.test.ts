import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { awards } from '../src/render/awards';
import { noStats, type PlayerStats } from '../src/sim/stats';

const names = (a: Partial<PlayerStats>, b: Partial<PlayerStats>) =>
  awards([{ ...noStats(), ...a }, { ...noStats(), ...b }], CONFIG.awards).map((w) => w.name);

describe('awards', () => {
  it('gives each player the first award they beat their opponent at', () => {
    expect(names({ flawlessRounds: 1, shots: 10, hits: 5 }, { shots: 10, hits: 2, clutchDodges: 4 })).toEqual(['Flawless', 'Escape Artist']);
  });

  it('needs enough to go on, so one lucky shot is not Sharpshooter', () => {
    expect(names({ shots: 1, hits: 1 }, { shots: 1 })).toEqual(['Good Sport', 'Good Sport']);
    expect(names({ shots: 6, hits: 3 }, { shots: 6, hits: 1 })[0]).toBe('Sharpshooter');
  });

  it('gives nothing for a tie', () => {
    expect(names({ dodges: 4 }, { dodges: 4 })).toEqual(['Good Sport', 'Good Sport']);
  });

  it('keeps Spray and Pray for firing more and hitting less', () => {
    // Fires more but aims better: Sharpshooter goes to them, not Spray and Pray to the other.
    expect(names({ shots: 20, hits: 10 }, { shots: 10, hits: 2, dodges: 3 })).toEqual(['Sharpshooter', 'Slippery']);
    expect(names({ shots: 20, hits: 2 }, { shots: 10, hits: 5 })).toEqual(['Spray and Pray', 'Sharpshooter']);
  });
});
