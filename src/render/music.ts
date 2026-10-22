// Background music: a small step sequencer playing one of the tunes in
// musicScore.ts with synthesised instruments. Each map picks a style (bouncy
// chiptune, spooky theremin, office muzak, lo-fi hip-hop, surf rock), and
// each style has its own arrangement. Tension (how far through the round we are) raises the tempo
// and adds layers to whichever is playing.

import { readFlag, writeFlag } from '../prefs';
import type { MusicStyle } from '../sim/types';
import type { Sound } from './audio';
import { chordTones, freq, SCORES, STEPS_PER_BAR } from './musicScore';

type Chord = ReturnType<typeof chordTones>;
type ScoreNote = (typeof SCORES)[MusicStyle]['steps'][number];

const MUSIC_KEY = 'fpd.music';
const VOLUME = 0.32;
const LOOKAHEAD = 0.12; // seconds of notes scheduled ahead
const TICK_MS = 25;

interface Tempo {
  base: number;
  perRound: number; // added by the end of normal time
  perSuddenDeathStep: number;
  max: number;
}

const TEMPOS: Record<MusicStyle, Tempo> = {
  bouncy: { base: 138, perRound: 24, perSuddenDeathStep: 6, max: 196 },
  spooky: { base: 96, perRound: 30, perSuddenDeathStep: 8, max: 160 },
  muzak: { base: 112, perRound: 20, perSuddenDeathStep: 8, max: 168 },
  lofi: { base: 86, perRound: 30, perSuddenDeathStep: 8, max: 150 },
  surf: { base: 152, perRound: 20, perSuddenDeathStep: 6, max: 204 },
};

const ECHO_TIME = 0.14; // seconds; a short slapback, like a spring reverb
const ECHO_FEEDBACK = 0.35;
const ECHO_LEVEL = 0.4;
// How late the off-beat sixteenths land in the lo-fi tune, as a fraction of a step.
const LOFI_SWING = 0.3;

// Bossa nova bass, steps into the bar -> semitones above the root.
const BOSSA_BASS: Record<number, number> = { 0: 0, 6: 7, 8: 0, 14: 7 };
// Where the muzak's piano chords and rim clicks land.
const BOSSA_COMP = [0, 3, 6, 10, 12];
const CLAVE = [
  [0, 6, 12],
  [4, 8],
];

interface VoiceOpts {
  attack?: number; // seconds to full volume
  sustain?: number; // fraction of full volume held after the attack
  release?: number; // time constant of the fade after the note ends
  vibrato?: number; // depth, as a fraction of the pitch
  glideFrom?: number; // slide up or down from this pitch
  cutoff?: number; // lowpass filter frequency
  echo?: boolean; // also send through the slapback echo
}

export class Music {
  enabled: boolean;
  private out: GainNode | null = null;
  private echo: GainNode | null = null; // input to the echo, which feeds out
  private timer: ReturnType<typeof setInterval> | null = null;
  private step = 0;
  private nextTime = 0;
  private style: MusicStyle = 'bouncy';
  private bpm = TEMPOS.bouncy.base;
  private targetBpm = TEMPOS.bouncy.base;
  private intensity = 0;
  private paused = false;
  private lastLead: number | undefined; // pitch of the last theremin note, to slide from
  private held: { midi: number; until: number } | null = null; // the surf melody note ringing on, re-picked each step

  constructor(private sound: Sound) {
    this.enabled = readFlag(MUSIC_KEY, true);
  }

  toggle(): void {
    this.enabled = !this.enabled;
    writeFlag(MUSIC_KEY, this.enabled);
    if (!this.enabled) this.stop();
  }

  get playing(): boolean {
    return this.timer !== null;
  }

  // The style playing, or last played.
  get current(): MusicStyle {
    return this.style;
  }

  start(style: MusicStyle = this.style): void {
    this.stop();
    this.style = style;
    const audio = this.sound.output();
    if (!audio || !this.enabled) return;
    const { ctx, master } = audio;
    this.out = ctx.createGain();
    // Fade in, so switching tunes between rounds crossfades with the old one.
    this.out.gain.setValueAtTime(0, ctx.currentTime);
    this.out.gain.setTargetAtTime(VOLUME, ctx.currentTime, 0.08);
    this.out.connect(master);
    this.echo = ctx.createGain();
    this.echo.gain.value = ECHO_LEVEL;
    const delay = ctx.createDelay(1);
    delay.delayTime.value = ECHO_TIME;
    const feedback = ctx.createGain();
    feedback.gain.value = ECHO_FEEDBACK;
    this.echo.connect(delay).connect(this.out);
    delay.connect(feedback).connect(delay);
    this.step = 0;
    this.bpm = this.targetBpm = TEMPOS[style].base;
    this.intensity = 0;
    this.lastLead = undefined;
    this.held = null;
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
      const { out, echo } = this;
      out.gain.setTargetAtTime(0, audio.ctx.currentTime, 0.08);
      setTimeout(() => {
        out.disconnect();
        echo?.disconnect();
      }, 600);
    }
    this.out = null;
    this.echo = null;
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
    const tempo = TEMPOS[this.style];
    this.targetBpm = Math.min(tempo.max, tempo.base + tempo.perRound * p + tempo.perSuddenDeathStep * suddenDeathSteps);
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
      this.step = (this.step + 1) % SCORES[this.style].totalSteps;
    }
  }

  private playStep(step: number, t: number, stepDur: number): void {
    const score = SCORES[this.style];
    const inBar = step % STEPS_PER_BAR;
    const chord = chordTones(score.chords[Math.floor(step / (STEPS_PER_BAR / 2))]);
    const note = score.steps[step];
    switch (this.style) {
      case 'spooky':
        return this.playSpooky(inBar, chord, note, t, stepDur);
      case 'muzak':
        return this.playMuzak(step, inBar, chord, note, t, stepDur);
      case 'lofi':
        return this.playLofi(inBar, chord, note, t, stepDur);
      case 'surf':
        return this.playSurf(step, inBar, chord, note, t, stepDur);
      default:
        return this.playBouncy(inBar, chord, note, t, stepDur);
    }
  }

  // Chiptune: square-wave lead, bouncing bass, a rock beat.
  private playBouncy(inBar: number, chord: Chord, note: ScoreNote, t: number, stepDur: number): void {
    // Lead melody.
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

  // Spooky: a wavering theremin over a muffled drone and a heartbeat.
  private playSpooky(inBar: number, chord: Chord, note: ScoreNote, t: number, stepDur: number): void {
    // Theremin: a sine with vibrato that slides from one note into the next.
    if (note) {
      const f = freq(note.midi);
      this.voice(f, t, note.steps * stepDur, 'sine', 0.14, { attack: 0.08, sustain: 0.85, release: 0.12, vibrato: 0.012, glideFrom: this.lastLead });
      this.lastLead = f;
    }

    // Drone: root and fifth held through each half bar, dark and muffled.
    if (inBar % 8 === 0) {
      const drone: VoiceOpts = { attack: 0.15, sustain: 0.9, release: 0.2, cutoff: 320 };
      this.voice(freq(chord.root), t, 8 * stepDur, 'sawtooth', 0.16, drone);
      this.voice(freq(chord.root + 7), t, 8 * stepDur, 'sawtooth', 0.07, drone);
    }

    // Heartbeat, lub-dub; twice as often when time's nearly up.
    if (inBar === 0 || inBar === 2 || (this.intensity >= 2 && (inBar === 8 || inBar === 10))) this.kick(t, inBar % 8 === 0 ? 0.42 : 0.26);

    // A clock ticking on the beat as time runs down.
    if (this.intensity >= 1 && inBar % 4 === 0) this.noise(t, 0.025, 'bandpass', inBar % 8 === 0 ? 3200 : 2300, 0.09);

    // A music box plinking the chord when time's nearly up.
    if (this.intensity >= 2 && inBar % 2 === 0) {
      const tones = [...chord.triad, chord.triad[0] + 12];
      this.voice(freq(tones[(inBar / 2) % 4] + 36), t, stepDur * 1.5, 'triangle', 0.045, { sustain: 0 });
    }
  }

  // Muzak: bossa nova on hold. Electric piano lead and chords, walking bass,
  // rim clicks and a shaker.
  private playMuzak(step: number, inBar: number, chord: Chord, note: ScoreNote, t: number, stepDur: number): void {
    // Electric piano: a soft sine with a quiet octave on top.
    if (note) {
      const f = freq(note.midi);
      const dur = note.steps * stepDur * 0.9;
      this.voice(f, t, dur, 'sine', 0.12, { attack: 0.01, sustain: 0.45, release: 0.08 });
      this.voice(f * 2, t, dur * 0.5, 'sine', 0.025, { sustain: 0.2 });
    }

    const bass = BOSSA_BASS[inBar];
    if (bass !== undefined) this.voice(freq(chord.root + bass), t, stepDur * (inBar % 8 === 0 ? 5 : 1.8), 'triangle', 0.3);

    // Comping: the whole chord, sevenths and all, an octave or two up.
    if (BOSSA_COMP.includes(inBar)) {
      for (const tone of chord.tones) this.voice(freq(tone + 24), t, stepDur * 1.5, 'sine', 0.035, { sustain: 0.3 });
    }

    // Drums: soft kick, rim clicks on a two-bar clave, a shaker.
    if (inBar === 0 || inBar === 8) this.kick(t, 0.22);
    if (CLAVE[Math.floor(step / STEPS_PER_BAR) % 2].includes(inBar)) this.noise(t, 0.03, 'bandpass', 2600, 0.12);
    if (inBar % 2 === 0 || this.intensity >= 1) this.noise(t, 0.04, 'highpass', 6000, inBar % 4 === 2 ? 0.035 : 0.02);

    // Vibraphone running up and down the chord when time's nearly up.
    if (this.intensity >= 2) {
      const tones = [...chord.tones, chord.tones[0] + 12];
      const i = inBar % (tones.length * 2 - 2);
      this.voice(freq(tones[i < tones.length ? i : tones.length * 2 - 2 - i] + 36), t, stepDur * 0.9, 'sine', 0.03, { sustain: 0.2 });
    }
  }

  // Lo-fi hip-hop: muffled keys and warm seventh chords over a sub bass and a
  // lazy, swung boom-bap beat, with vinyl crackle on top.
  private playLofi(inBar: number, chord: Chord, note: ScoreNote, t: number, stepDur: number): void {
    const at = inBar % 2 ? t + stepDur * LOFI_SWING : t;

    // Keys: a filtered triangle with a slight tape wobble and an echo.
    if (note) this.voice(freq(note.midi), at, note.steps * stepDur * 0.9, 'triangle', 0.13, { sustain: 0.5, release: 0.1, vibrato: 0.004, cutoff: 1600, echo: true });

    // Chords held through each half bar.
    if (inBar === 0 || inBar === 8) {
      for (const tone of chord.tones) this.voice(freq(tone + 24), at, stepDur * 6, 'sine', 0.035, { attack: 0.02, sustain: 0.5, release: 0.15 });
    }

    // Sub bass: root on the one, root again late in the bar, then the fifth.
    if (inBar === 0) this.voice(freq(chord.root), at, stepDur * 6, 'sine', 0.26, { sustain: 0.7 });
    if (inBar === 10) this.voice(freq(chord.root), at, stepDur * 3, 'sine', 0.22, { sustain: 0.7 });
    if (inBar === 14) this.voice(freq(chord.root + 7), at, stepDur * 2, 'sine', 0.2, { sustain: 0.7 });

    // Boom-bap: kick, a late second kick, a dusty snare, swung hats.
    if (inBar === 0 || inBar === 7 || inBar === 10) this.kick(at, 0.45);
    if (inBar === 4 || inBar === 12) this.noise(at, 0.14, 'bandpass', 1200, 0.2);
    if (inBar % 2 === 0 || this.intensity >= 1) this.hat(at, inBar % 4 === 2 ? 0.05 : 0.03);

    // Vinyl crackle: the odd random pop.
    if (Math.random() < 0.3) this.noise(t + Math.random() * stepDur, 0.004, 'highpass', 4000, 0.03);

    // A twinkling run up the chord when time's nearly up.
    if (this.intensity >= 2) {
      const tones = [...chord.tones, chord.tones[0] + 12];
      this.voice(freq(tones[inBar % tones.length] + 36), at, stepDur * 0.8, 'triangle', 0.03, { sustain: 0.2, cutoff: 3000 });
    }
  }

  // Surf rock: a twangy guitar tremolo-picking the melody through a slapback
  // echo, driving bass, a surf beat, and the odd drip from the taps.
  private playSurf(step: number, inBar: number, chord: Chord, note: ScoreNote, t: number, stepDur: number): void {
    // Guitar: long notes are re-picked every step, the surf way.
    if (note) this.held = { midi: note.midi, until: step + note.steps };
    if (this.held && step < this.held.until) {
      this.voice(freq(this.held.midi), t, stepDur * 0.9, 'sawtooth', note ? 0.11 : 0.08, { sustain: 0.3, cutoff: 2400, echo: true });
    } else {
      this.held = null;
    }

    // Bass on eighths: root, root, octave, root.
    if (inBar % 2 === 0) {
      const pattern = [0, 0, 12, 0];
      this.voice(freq(chord.root + pattern[(inBar / 2) % 4]), t, stepDur * 1.6, 'sawtooth', 0.26, { cutoff: 600 });
    }

    // Surf beat: kick and snare, eighth-note hats (sixteenths under pressure).
    if (inBar === 0 || inBar === 8 || (this.intensity >= 2 && (inBar === 6 || inBar === 14))) this.kick(t);
    if (inBar === 4 || inBar === 12) this.snare(t);
    if (inBar % 2 === 0 || this.intensity >= 1) this.hat(t, inBar % 4 === 0 ? 0.06 : 0.035);

    // A tom fill rolling down at the end of every four bars when time's nearly up.
    const bar = Math.floor(step / STEPS_PER_BAR);
    if (this.intensity >= 2 && bar % 4 === 3 && inBar >= 12) this.kick(t, 0.35, 260 - (inBar - 12) * 40, 90);

    // Drip: a little rising bloop every other bar.
    if (bar % 2 === 1 && inBar === 14) this.voice(1400, t, 0.06, 'sine', 0.06, { glideFrom: 600, sustain: 0.5 });
  }

  private voice(f: number, t: number, dur: number, type: OscillatorType, vol: number, opts: VoiceOpts = {}): void {
    const audio = this.sound.output();
    if (!audio || !this.out) return;
    const { ctx } = audio;
    const { attack = 0.005, sustain = 0.6, release = 0.02 } = opts;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    if (opts.glideFrom) {
      osc.frequency.setValueAtTime(opts.glideFrom, t);
      osc.frequency.exponentialRampToValueAtTime(f, t + 0.09);
    } else {
      osc.frequency.setValueAtTime(f, t);
    }
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + attack);
    gain.gain.setTargetAtTime(vol * sustain, t + attack + 0.005, dur * 0.4);
    gain.gain.setTargetAtTime(0, t + dur, release);
    const stopAt = t + dur + release * 6 + 0.1;
    let src: AudioNode = osc;
    if (opts.cutoff) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = opts.cutoff;
      src = osc.connect(filter);
    }
    if (opts.vibrato) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = 5.5;
      depth.gain.value = f * opts.vibrato;
      lfo.connect(depth).connect(osc.frequency);
      lfo.start(t);
      lfo.stop(stopAt);
    }
    src.connect(gain).connect(this.out);
    if (opts.echo && this.echo) gain.connect(this.echo);
    osc.start(t);
    osc.stop(stopAt);
  }

  // A kick drum, or a tom when given a higher pitch to drop from.
  private kick(t: number, vol = 0.5, from = 150, to = 45): void {
    const audio = this.sound.output();
    if (!audio || !this.out) return;
    const osc = audio.ctx.createOscillator();
    const gain = audio.ctx.createGain();
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + 0.12);
    gain.gain.setValueAtTime(vol, t);
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
