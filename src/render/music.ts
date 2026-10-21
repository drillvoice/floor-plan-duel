// Background music: a small step sequencer playing the tune in musicScore.ts
// with synthesised bass, lead and drums. Tension (how far through the round
// we are) raises the tempo and adds layers: hi-hats, then a busy arpeggio.

import type { Sound } from './audio';
import { chordTones, freq, HALF_BAR_CHORDS, MELODY_STEPS, STEPS_PER_BAR, TOTAL_STEPS } from './musicScore';

const MUSIC_KEY = 'fpd.music';
const VOLUME = 0.32;
const BASE_BPM = 138;
const BPM_PER_ROUND = 24; // added by the end of normal time
const BPM_PER_SUDDEN_DEATH_STEP = 6;
const MAX_BPM = 196;
const LOOKAHEAD = 0.12; // seconds of notes scheduled ahead
const TICK_MS = 25;

export class Music {
  enabled: boolean;
  private out: GainNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private step = 0;
  private nextTime = 0;
  private bpm = BASE_BPM;
  private targetBpm = BASE_BPM;
  private intensity = 0;
  private paused = false;

  constructor(private sound: Sound) {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(MUSIC_KEY);
    } catch {
      // Default to on.
    }
    this.enabled = saved !== 'off';
  }

  toggle(): void {
    this.enabled = !this.enabled;
    try {
      localStorage.setItem(MUSIC_KEY, this.enabled ? 'on' : 'off');
    } catch {
      // Applies this session only.
    }
    if (!this.enabled) this.stop();
  }

  get playing(): boolean {
    return this.timer !== null;
  }

  start(): void {
    this.stop();
    const audio = this.sound.output();
    if (!audio || !this.enabled) return;
    const { ctx, master } = audio;
    this.out = ctx.createGain();
    this.out.gain.value = VOLUME;
    this.out.connect(master);
    this.step = 0;
    this.bpm = this.targetBpm = BASE_BPM;
    this.intensity = 0;
    this.paused = false;
    this.nextTime = ctx.currentTime + 0.05;
    this.timer = setInterval(() => this.schedule(), TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const audio = this.sound.output();
    if (this.out && audio) {
      // Quick fade so notes already scheduled don't cut off with a click.
      const out = this.out;
      out.gain.setTargetAtTime(0, audio.ctx.currentTime, 0.08);
      setTimeout(() => out.disconnect(), 600);
    }
    this.out = null;
  }

  setPaused(paused: boolean): void {
    if (paused === this.paused || !this.out) return;
    this.paused = paused;
    const audio = this.sound.output();
    if (!audio) return;
    if (!paused) this.nextTime = audio.ctx.currentTime + 0.05;
    this.out.gain.setTargetAtTime(paused ? 0 : VOLUME, audio.ctx.currentTime, 0.05);
  }

  // progress: 0 at the start of a round, 1 when normal time runs out.
  // suddenDeathSteps: how many times sudden death has sped bullets up.
  setTension(progress: number, suddenDeathSteps: number): void {
    const p = Math.max(0, Math.min(1, progress));
    this.targetBpm = Math.min(MAX_BPM, BASE_BPM + BPM_PER_ROUND * p + BPM_PER_SUDDEN_DEATH_STEP * suddenDeathSteps);
    this.intensity = suddenDeathSteps > 0 || p > 5 / 6 ? 2 : p > 1 / 2 ? 1 : 0;
  }

  private schedule(): void {
    const audio = this.sound.output();
    if (!audio || !this.out || this.paused) return;
    const now = audio.ctx.currentTime;
    if (this.nextTime < now - 0.2) this.nextTime = now + 0.02; // tab was asleep
    while (this.nextTime < now + LOOKAHEAD) {
      // Glide toward the target tempo rather than jumping.
      this.bpm += (this.targetBpm - this.bpm) * 0.05;
      const stepDur = 60 / this.bpm / 4;
      this.playStep(this.step, this.nextTime, stepDur);
      this.nextTime += stepDur;
      this.step = (this.step + 1) % TOTAL_STEPS;
    }
  }

  private playStep(step: number, t: number, stepDur: number): void {
    const inBar = step % STEPS_PER_BAR;
    const chord = chordTones(HALF_BAR_CHORDS[Math.floor(step / (STEPS_PER_BAR / 2))]);

    // Lead melody.
    const note = MELODY_STEPS[step];
    if (note) this.voice(freq(note.midi), t, note.steps * stepDur * 0.85, 'square', 0.07);

    // Bass on eighths: root, octave, fifth, octave.
    if (inBar % 2 === 0) {
      const pattern = [0, 12, 7, 12];
      const n = chord.root + pattern[(inBar / 2) % 4];
      this.voice(freq(n), t, stepDur * 1.6, 'triangle', 0.32);
    }

    // Drums.
    if (inBar === 0 || inBar === 8 || (this.intensity >= 2 && (inBar === 10 || inBar === 14))) this.kick(t);
    if (inBar === 4 || inBar === 12) this.snare(t);
    if (this.intensity >= 1 && (this.intensity >= 2 || inBar % 2 === 0)) this.hat(t, inBar % 4 === 2 ? 0.07 : 0.04);

    // Busy arpeggio when time's nearly up.
    if (this.intensity >= 2) {
      const tones = [...chord.triad, chord.triad[0] + 12];
      this.voice(freq(tones[inBar % 4] + 36), t, stepDur * 0.7, 'square', 0.025);
    }
  }

  private voice(f: number, t: number, dur: number, type: OscillatorType, vol: number): void {
    const audio = this.sound.output();
    if (!audio || !this.out) return;
    const osc = audio.ctx.createOscillator();
    const gain = audio.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f, t);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.005);
    gain.gain.setTargetAtTime(vol * 0.6, t + 0.01, dur * 0.4);
    gain.gain.setTargetAtTime(0, t + dur, 0.02);
    osc.connect(gain).connect(this.out);
    osc.start(t);
    osc.stop(t + dur + 0.15);
  }

  private kick(t: number): void {
    const audio = this.sound.output();
    if (!audio || !this.out) return;
    const osc = audio.ctx.createOscillator();
    const gain = audio.ctx.createGain();
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    gain.gain.setValueAtTime(0.5, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    osc.connect(gain).connect(this.out);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  private snare(t: number): void {
    this.noise(t, 0.12, 'bandpass', 1800, 0.22);
  }

  private hat(t: number, vol: number): void {
    this.noise(t, 0.035, 'highpass', 7000, vol);
  }

  private noise(t: number, dur: number, type: BiquadFilterType, cutoff: number, vol: number): void {
    const audio = this.sound.output();
    if (!audio || !this.out) return;
    const src = audio.ctx.createBufferSource();
    src.buffer = audio.noise;
    const filter = audio.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = cutoff;
    const gain = audio.ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(gain).connect(this.out);
    // Start at a different point in the noise each hit so it doesn't sound looped.
    src.start(t, (t * 7.3) % 0.9);
    src.stop(t + dur + 0.02);
  }
}
