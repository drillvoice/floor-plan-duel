// The background tunes, one per music style, each written on a 16th-note grid
// as a melody plus two chords per bar. Pure data, so it can be tested.

import type { MusicStyle } from '../sim/types';

export const STEPS_PER_BAR = 16;

type Note = [pitch: string | null, sixteenths: number]; // null = rest

export interface Score {
  bars: Note[][]; // melody, one array per bar; each bar's lengths add up to 16
  chords: string[]; // two per bar (one per half bar)
  steps: ({ midi: number; steps: number } | null)[]; // at each step, the note starting there (if any)
  totalSteps: number;
}

// "Bouncy": an original, bouncy 16-bar loop (section A then B) in C major.
const BOUNCY_A: Note[][] = [
  [['E5', 2], ['G5', 2], ['C6', 3], ['G5', 1], ['A5', 2], ['G5', 2], ['E5', 2], ['D5', 2]],
  [['E5', 2], ['C5', 2], ['A4', 4], [null, 2], ['C5', 1], ['D5', 1], ['E5', 4]],
  [['F5', 2], ['A5', 2], ['C6', 3], ['A5', 1], ['G5', 2], ['F5', 2], ['E5', 2], ['F5', 2]],
  [['G5', 6], [null, 2], ['D5', 2], ['E5', 2], ['F5', 2], ['G5', 2]],
  [['A5', 2], ['A5', 1], ['A5', 1], ['G5', 2], ['F5', 2], ['E5', 2], ['F5', 2], ['G5', 4]],
  [['B5', 2], ['B5', 1], ['B5', 1], ['A5', 2], ['G5', 2], ['F5', 2], ['G5', 2], ['A5', 4]],
  [['G5', 2], ['E5', 2], ['B4', 2], ['E5', 2], ['A5', 2], ['E5', 2], ['C6', 2], ['B5', 2]],
  [['D6', 3], ['C6', 1], ['B5', 2], ['A5', 2], ['G5', 4], [null, 4]],
];

const BOUNCY_B: Note[][] = [
  [['A4', 1], [null, 1], ['A4', 1], ['C5', 1], ['E5', 2], ['A5', 2], ['G5', 2], ['E5', 2], ['C5', 2], ['E5', 2]],
  [['F5', 3], ['E5', 1], ['D5', 2], ['C5', 2], ['A4', 4], ['C5', 2], ['D5', 2]],
  [['E5', 1], [null, 1], ['E5', 1], ['G5', 1], ['C6', 2], ['G5', 2], ['E5', 2], ['G5', 2], ['C6', 4]],
  [['D6', 2], ['B5', 2], ['G5', 2], ['D5', 2], ['G5', 4], [null, 4]],
  [['A5', 2], ['G5', 1], ['A5', 1], ['C6', 2], ['A5', 2], ['E5', 2], ['A5', 2], ['G5', 2], ['E5', 2]],
  [['F5', 2], ['E5', 1], ['F5', 1], ['A5', 2], ['F5', 2], ['C5', 2], ['F5', 2], ['E5', 2], ['D5', 2]],
  [['B4', 2], ['D5', 2], ['G5', 2], ['B5', 2], ['D6', 2], ['B5', 2], ['G5', 2], ['D5', 2]],
  [['G5', 2], ['A5', 2], ['B5', 2], ['C6', 2], ['D6', 6], [null, 2]],
];

const BOUNCY_CHORDS = [
  ...['C', 'C', 'Am', 'Am', 'F', 'F', 'G', 'G', 'F', 'F', 'G', 'G', 'Em', 'Am', 'Dm', 'G'],
  ...['Am', 'Am', 'F', 'F', 'C', 'C', 'G', 'G', 'Am', 'Am', 'F', 'F', 'G', 'G', 'G', 'G'],
];

// "Spooky": a slow, wavering theremin line in D minor that creeps down by
// semitones, then climbs into a music-box section.
const SPOOKY_A: Note[][] = [
  [['D5', 6], ['F5', 2], ['E5', 4], ['D5', 4]],
  [['A4', 12], [null, 4]],
  [['Bb4', 4], ['D5', 4], ['F5', 6], ['E5', 2]],
  [['C#5', 12], [null, 4]],
  [['G5', 6], ['F5', 2], ['E5', 4], ['D5', 4]],
  [['F5', 4], ['E5', 4], ['D5', 8]],
  [['Bb4', 4], ['A4', 4], ['G#4', 4], ['A4', 4]],
  [['A4', 8], [null, 8]],
];

const SPOOKY_B: Note[][] = [
  [['D6', 2], ['A5', 2], ['F5', 2], ['A5', 2], ['D6', 4], ['C#6', 4]],
  [['D6', 2], ['Bb5', 2], ['F5', 2], ['Bb5', 2], ['D6', 4], ['F6', 4]],
  [['G5', 4], ['Bb5', 4], ['D6', 6], ['C6', 2]],
  [['C#6', 8], ['A5', 4], [null, 4]],
  [['F6', 4], ['E6', 2], ['D6', 2], ['C#6', 4], ['D6', 4]],
  [['Bb5', 4], ['A5', 2], ['G5', 2], ['A5', 8]],
  [['F5', 4], ['E5', 4], ['Eb5', 4], ['E5', 4]],
  [['A4', 12], [null, 4]],
];

const SPOOKY_CHORDS = [
  ...['Dm', 'Dm', 'Dm', 'Dm', 'Bb', 'Bb', 'A', 'A', 'Gm', 'Gm', 'Dm', 'Dm', 'Bb', 'A', 'A', 'A'],
  ...['Dm', 'Dm', 'Bb', 'Bb', 'Gm', 'Gm', 'A', 'A', 'Dm', 'Dm', 'Gm', 'Gm', 'Bb', 'Bb', 'A', 'A'],
];

// "Muzak": easy-listening bossa nova in F major, the kind you hear on hold.
// A is a lazy I-vi-ii-V; B wanders off through Bb and D7 and comes home.
const MUZAK_A: Note[][] = [
  [['A5', 6], ['G5', 2], ['E5', 6], [null, 2]],
  [['F5', 2], ['E5', 2], ['D5', 2], ['C5', 6], [null, 4]],
  [['D5', 4], ['F5', 2], ['A5', 4], ['G5', 2], ['F5', 4]],
  [['E5', 8], ['Bb4', 4], [null, 4]],
  [['A5', 6], ['G5', 2], ['E5', 4], ['F5', 2], ['G5', 2]],
  [['A5', 4], ['C6', 4], ['A5', 4], ['F5', 4]],
  [['Bb5', 4], ['A5', 2], ['G5', 2], ['F5', 4], ['E5', 4]],
  [['G5', 8], [null, 8]],
];

const MUZAK_B: Note[][] = [
  [['D6', 6], ['C6', 2], ['A5', 8]],
  [['Db6', 6], ['C6', 2], ['Ab5', 8]],
  [['C6', 4], ['A5', 2], ['G5', 2], ['E5', 8]],
  [['F#5', 6], ['A5', 2], ['C6', 8]],
  [['Bb5', 4], ['A5', 2], ['G5', 2], ['D5', 8]],
  [['E5', 2], ['F5', 2], ['G5', 2], ['Bb5', 2], ['A5', 4], ['G5', 4]],
  [['F5', 12], [null, 4]],
  [['C5', 2], ['D5', 2], ['E5', 2], ['G5', 2], ['Bb5', 4], [null, 4]],
];

const MUZAK_CHORDS = [
  ...['Fmaj7', 'Fmaj7', 'Dm7', 'Dm7', 'Gm7', 'Gm7', 'C7', 'C7', 'Fmaj7', 'Fmaj7', 'Dm7', 'Dm7', 'Gm7', 'Gm7', 'C7', 'C7'],
  ...['Bbmaj7', 'Bbmaj7', 'Bbm7', 'Bbm7', 'Am7', 'Am7', 'D7', 'D7', 'Gm7', 'Gm7', 'C7', 'C7', 'Fmaj7', 'Fmaj7', 'C7', 'C7'],
];

// "Lo-fi": a lazy, swung lo-fi hip-hop loop in C, a muffled keys melody over
// descending seventh chords, for the studio flat.
const LOFI_A: Note[][] = [
  [['E6', 2], ['A5', 2], ['C6', 2], ['E6', 4], ['C6', 2], [null, 4]],
  [['D6', 3], ['B5', 1], ['G5', 4], [null, 8]],
  [[null, 2], ['F5', 2], ['A5', 2], ['C6', 4], ['A5', 2], ['F5', 2], ['A5', 2]],
  [['G5', 6], ['E5', 2], [null, 8]],
  [[null, 2], ['A5', 2], ['C6', 2], ['E6', 2], ['G6', 4], ['E6', 4]],
  [['D6', 4], ['B5', 2], ['D6', 2], ['E6', 8]],
  [['C6', 3], ['A5', 1], ['F5', 4], ['A5', 2], ['C6', 2], ['D6', 4]],
  [['B5', 8], ['G5', 4], [null, 4]],
];

const LOFI_B: Note[][] = [
  [['C6', 2], ['B5', 2], ['A5', 2], ['G5', 2], ['E5', 4], [null, 4]],
  [['F5', 2], ['A5', 2], ['C6', 2], ['D6', 2], ['C6', 4], ['A5', 4]],
  [['B5', 4], ['D6', 2], ['F6', 2], ['D6', 4], ['B5', 4]],
  [['C6', 8], ['G5', 2], ['E5', 2], [null, 4]],
  [['A5', 3], ['C6', 1], ['E6', 4], ['D6', 2], ['C6', 2], ['A5', 4]],
  [['G5', 4], ['B5', 4], ['C6', 4], ['E6', 4]],
  [['F6', 4], ['E6', 2], ['D6', 2], ['C6', 4], ['A5', 4]],
  [['B5', 4], ['D6', 4], ['G5', 4], [null, 4]],
];

const LOFI_CHORDS = [
  ...['Fmaj7', 'Fmaj7', 'Em7', 'Em7', 'Dm7', 'Dm7', 'Cmaj7', 'Cmaj7', 'Fmaj7', 'Fmaj7', 'Em7', 'Em7', 'Dm7', 'Dm7', 'G7', 'G7'],
  ...['Am7', 'Am7', 'Dm7', 'Dm7', 'G7', 'G7', 'Cmaj7', 'Cmaj7', 'Fmaj7', 'Fmaj7', 'Em7', 'Am7', 'Dm7', 'Dm7', 'G7', 'G7'],
];

// "Surf": a twangy, tremolo-picked surf-rock tune in E minor for the bathroom,
// with a raised D# on the B chord for that exotic surf sound.
const SURF_A: Note[][] = [
  [['E5', 4], ['G5', 4], ['B5', 4], ['G5', 4]],
  [['A5', 2], ['G5', 2], ['F#5', 2], ['G5', 2], ['E5', 8]],
  [['E5', 4], ['G5', 4], ['C6', 6], ['B5', 2]],
  [['B5', 8], ['A5', 2], ['G5', 2], ['F#5', 4]],
  [['E6', 4], ['D6', 2], ['B5', 2], ['G5', 4], ['B5', 4]],
  [['A5', 2], ['G5', 2], ['F#5', 2], ['E5', 2], ['D#5', 4], ['E5', 4]],
  [['G5', 4], ['E5', 4], ['F#5', 4], ['A5', 4]],
  [['D#5', 4], ['F#5', 4], ['B5', 8]],
];

const SURF_B: Note[][] = [
  [['A5', 2], ['C6', 2], ['E6', 4], ['C6', 2], ['A5', 2], ['E5', 4]],
  [['G5', 2], ['B5', 2], ['E6', 8], [null, 4]],
  [['A5', 2], ['C6', 2], ['E6', 2], ['A6', 2], ['G6', 2], ['E6', 2], ['C6', 4]],
  [['D#6', 8], ['B5', 4], [null, 4]],
  [['E6', 2], ['D6', 2], ['C6', 2], ['G5', 2], ['E5', 4], ['G5', 4]],
  [['D6', 2], ['B5', 2], ['G5', 2], ['D5', 2], ['G5', 8]],
  [['C6', 4], ['A5', 4], ['B5', 4], ['D#6', 4]],
  [['E6', 12], [null, 4]],
];

const SURF_CHORDS = [
  ...['Em', 'Em', 'Em', 'Em', 'C', 'C', 'B', 'B', 'Em', 'Em', 'Em', 'Em', 'C', 'D', 'B', 'B'],
  ...['Am', 'Am', 'Em', 'Em', 'Am', 'Am', 'B', 'B', 'C', 'C', 'G', 'G', 'Am', 'B', 'Em', 'Em'],
];

const NOTE_INDEX: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// MIDI number for a name like "C5", "F#4" or "Bb3".
export function midi(name: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`Bad note ${name}`);
  return 12 * (Number(m[3]) + 1) + NOTE_INDEX[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

export const freq = (midiNote: number): number => 440 * Math.pow(2, (midiNote - 69) / 12);

const CHORD_SHAPES: Record<string, number[]> = { '': [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10] };

// Root (in octave 2), triad and full chord (with any seventh) of a chord name
// like "Am", "Bb" or "Dm7".
export function chordTones(chord: string): { root: number; triad: number[]; tones: number[] } {
  const m = /^([A-G][#b]?)(maj7|m7|7|m)?$/.exec(chord);
  if (!m) throw new Error(`Bad chord ${chord}`);
  const root = midi(`${m[1]}2`);
  const tones = CHORD_SHAPES[m[2] ?? ''].map((i) => root + i);
  return { root, triad: tones.slice(0, 3), tones };
}

function score(bars: Note[][], chords: string[]): Score {
  const totalSteps = bars.length * STEPS_PER_BAR;
  const steps: Score['steps'] = new Array(totalSteps).fill(null);
  let step = 0;
  for (const bar of bars) {
    for (const [pitch, len] of bar) {
      if (pitch) steps[step] = { midi: midi(pitch), steps: len };
      step += len;
    }
  }
  return { bars, chords, steps, totalSteps };
}

export const SCORES: Record<MusicStyle, Score> = {
  bouncy: score([...BOUNCY_A, ...BOUNCY_B], BOUNCY_CHORDS),
  spooky: score([...SPOOKY_A, ...SPOOKY_B], SPOOKY_CHORDS),
  muzak: score([...MUZAK_A, ...MUZAK_B], MUZAK_CHORDS),
  lofi: score([...LOFI_A, ...LOFI_B], LOFI_CHORDS),
  surf: score([...SURF_A, ...SURF_B], SURF_CHORDS),
};
