import { describe, expect, it } from 'vitest';
import { BUILT_IN_MAPS } from '../src/maps/builtin';
import { parseMapJson } from '../src/maps/validate';
import { chordTones, midi, SCORES, STEPS_PER_BAR } from '../src/render/musicScore';
import { MUSIC_STYLES, musicStyle } from '../src/sim/types';

describe('music scores', () => {
  for (const style of MUSIC_STYLES) {
    const score = SCORES[style];
    describe(style, () => {
      it('every bar fills exactly one bar', () => {
        score.bars.forEach((bar, i) => {
          expect(bar.reduce((sum, [, len]) => sum + len, 0), `bar ${i + 1}`).toBe(STEPS_PER_BAR);
        });
      });

      it('has two chords per bar and a note on the first step', () => {
        expect(score.chords).toHaveLength(score.bars.length * 2);
        expect(score.steps).toHaveLength(score.totalSteps);
        expect(score.steps[0]).not.toBeNull();
        for (const chord of score.chords) expect(() => chordTones(chord)).not.toThrow();
      });
    });
  }

  it('reads note and chord names', () => {
    expect(midi('A4')).toBe(69);
    expect(midi('C5')).toBe(72);
    expect(midi('F#4')).toBe(66);
    expect(midi('Bb3')).toBe(58);
    expect(chordTones('Am').triad).toEqual([45, 48, 52]);
    expect(chordTones('C').triad).toEqual([36, 40, 43]);
    expect(chordTones('Bb').triad).toEqual([46, 50, 53]);
    expect(chordTones('Dm7').tones).toEqual([38, 41, 45, 48]);
    expect(chordTones('Fmaj7').tones).toEqual([41, 45, 48, 52]);
    expect(chordTones('C7').tones).toEqual([36, 40, 43, 46]);
  });
});

describe('map music', () => {
  it('gives the office muzak and the dark spooky music', () => {
    const style = (name: string) => musicStyle(BUILT_IN_MAPS.find((m) => m.name === name)!);
    expect(style('The Office')).toBe('muzak');
    expect(style('Lights Out')).toBe('spooky');
    expect(style('The Flat')).toBe('bouncy');
    expect(musicStyle({ dark: true, music: 'muzak' })).toBe('muzak');
  });

  it('keeps a valid music style through a map file and drops a bad one', () => {
    const map = { width: 10, height: 10, walls: [], spawns: [{ x: 1, y: 1 }, { x: 9, y: 9 }] };
    expect(parseMapJson(JSON.stringify({ ...map, music: 'muzak' })).music).toBe('muzak');
    expect(parseMapJson(JSON.stringify({ ...map, music: 'polka' })).music).toBeUndefined();
  });
});
