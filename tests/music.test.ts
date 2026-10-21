import { describe, expect, it } from 'vitest';
import { chordTones, HALF_BAR_CHORDS, MELODY_BARS, MELODY_STEPS, midi, STEPS_PER_BAR, TOTAL_STEPS } from '../src/render/musicScore';

describe('music score', () => {
  it('every bar fills exactly one bar', () => {
    MELODY_BARS.forEach((bar, i) => {
      expect(bar.reduce((sum, [, len]) => sum + len, 0), `bar ${i + 1}`).toBe(STEPS_PER_BAR);
    });
  });

  it('has two chords per bar and a note on the first step', () => {
    expect(HALF_BAR_CHORDS).toHaveLength(MELODY_BARS.length * 2);
    expect(MELODY_STEPS).toHaveLength(TOTAL_STEPS);
    expect(MELODY_STEPS[0]).not.toBeNull();
  });

  it('reads note and chord names', () => {
    expect(midi('A4')).toBe(69);
    expect(midi('C5')).toBe(72);
    expect(midi('F#4')).toBe(66);
    expect(chordTones('Am').triad).toEqual([45, 48, 52]);
    expect(chordTones('C').triad).toEqual([36, 40, 43]);
  });
});
