// The background tune: an original, bouncy 16-bar loop (section A then B) in
// C major, written on a 16th-note grid. Pure data, so it can be tested.

export const STEPS_PER_BAR = 16;

type Note = [pitch: string | null, sixteenths: number]; // null = rest

// Melody, one array per bar; each bar's lengths add up to 16.
const A: Note[][] = [
  [['E5', 2], ['G5', 2], ['C6', 3], ['G5', 1], ['A5', 2], ['G5', 2], ['E5', 2], ['D5', 2]],
  [['E5', 2], ['C5', 2], ['A4', 4], [null, 2], ['C5', 1], ['D5', 1], ['E5', 4]],
  [['F5', 2], ['A5', 2], ['C6', 3], ['A5', 1], ['G5', 2], ['F5', 2], ['E5', 2], ['F5', 2]],
  [['G5', 6], [null, 2], ['D5', 2], ['E5', 2], ['F5', 2], ['G5', 2]],
  [['A5', 2], ['A5', 1], ['A5', 1], ['G5', 2], ['F5', 2], ['E5', 2], ['F5', 2], ['G5', 4]],
  [['B5', 2], ['B5', 1], ['B5', 1], ['A5', 2], ['G5', 2], ['F5', 2], ['G5', 2], ['A5', 4]],
  [['G5', 2], ['E5', 2], ['B4', 2], ['E5', 2], ['A5', 2], ['E5', 2], ['C6', 2], ['B5', 2]],
  [['D6', 3], ['C6', 1], ['B5', 2], ['A5', 2], ['G5', 4], [null, 4]],
];

const B: Note[][] = [
  [['A4', 1], [null, 1], ['A4', 1], ['C5', 1], ['E5', 2], ['A5', 2], ['G5', 2], ['E5', 2], ['C5', 2], ['E5', 2]],
  [['F5', 3], ['E5', 1], ['D5', 2], ['C5', 2], ['A4', 4], ['C5', 2], ['D5', 2]],
  [['E5', 1], [null, 1], ['E5', 1], ['G5', 1], ['C6', 2], ['G5', 2], ['E5', 2], ['G5', 2], ['C6', 4]],
  [['D6', 2], ['B5', 2], ['G5', 2], ['D5', 2], ['G5', 4], [null, 4]],
  [['A5', 2], ['G5', 1], ['A5', 1], ['C6', 2], ['A5', 2], ['E5', 2], ['A5', 2], ['G5', 2], ['E5', 2]],
  [['F5', 2], ['E5', 1], ['F5', 1], ['A5', 2], ['F5', 2], ['C5', 2], ['F5', 2], ['E5', 2], ['D5', 2]],
  [['B4', 2], ['D5', 2], ['G5', 2], ['B5', 2], ['D6', 2], ['B5', 2], ['G5', 2], ['D5', 2]],
  [['G5', 2], ['A5', 2], ['B5', 2], ['C6', 2], ['D6', 6], [null, 2]],
];

// Chords, two per bar (one per half bar).
const A_CHORDS = ['C', 'C', 'Am', 'Am', 'F', 'F', 'G', 'G', 'F', 'F', 'G', 'G', 'Em', 'Am', 'Dm', 'G'];
const B_CHORDS = ['Am', 'Am', 'F', 'F', 'C', 'C', 'G', 'G', 'Am', 'Am', 'F', 'F', 'G', 'G', 'G', 'G'];

export const MELODY_BARS: Note[][] = [...A, ...B];
export const HALF_BAR_CHORDS: string[] = [...A_CHORDS, ...B_CHORDS];
export const TOTAL_STEPS = MELODY_BARS.length * STEPS_PER_BAR;

const NOTE_INDEX: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// MIDI number for a name like "C5" or "F#4".
export function midi(name: string): number {
  const m = /^([A-G])(#?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`Bad note ${name}`);
  return 12 * (Number(m[3]) + 1) + NOTE_INDEX[m[1]] + (m[2] ? 1 : 0);
}

export const freq = (midiNote: number): number => 440 * Math.pow(2, (midiNote - 69) / 12);

// Root (in octave 2) and triad of a chord name like "Am".
export function chordTones(chord: string): { root: number; triad: number[] } {
  const minor = chord.endsWith('m');
  const root = midi(`${chord.replace('m', '')}2`);
  return { root, triad: [0, minor ? 3 : 4, 7].map((i) => root + i) };
}

// Melody flattened to steps: at each step, the note starting there (if any).
export const MELODY_STEPS: ({ midi: number; steps: number } | null)[] = (() => {
  const out: ({ midi: number; steps: number } | null)[] = new Array(TOTAL_STEPS).fill(null);
  let step = 0;
  for (const bar of MELODY_BARS) {
    for (const [pitch, len] of bar) {
      if (pitch) out[step] = { midi: midi(pitch), steps: len };
      step += len;
    }
  }
  return out;
})();
