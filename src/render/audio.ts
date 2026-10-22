// Synthesised sound effects with Web Audio: no audio files.

import type { GameEvent, GameState } from '../sim/types';

// Each player's shots have their own pitch, so you can hear who's firing.
const FIRE_PITCH = [660, 520, 590, 470];

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  muted = false;

  // Browsers only allow audio after a user gesture, so call this from a key press.
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(ctx.destination);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }

  // The audio graph, once unlocked, for other players such as the music.
  output(): { ctx: AudioContext; master: GainNode; noise: AudioBuffer } | null {
    return this.ctx && this.master && this.noise ? { ctx: this.ctx, master: this.master, noise: this.noise } : null;
  }

  toggleMute(): void {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
  }

  handleEvents(events: GameEvent[], state: GameState): void {
    for (const e of events) {
      switch (e.type) {
        case 'fire':
          this.tone(FIRE_PITCH[e.player % FIRE_PITCH.length], 0.06, 'square', 0.08, 0.6);
          break;
        case 'hit': {
          const final = e.hits >= state.cfg.round.hitsToLose;
          this.noiseBurst(final ? 0.45 : 0.22, 900, 0.5);
          this.tone(final ? 90 : 140, final ? 0.5 : 0.25, 'sine', 0.5, 0.4);
          break;
        }
        case 'nearMiss':
          // A fast falling whoosh, like a bullet zipping past an ear.
          this.sweepNoise(0.12, 5000, 900, 0.18);
          this.tone(1800, 0.1, 'sine', 0.05, 0.5);
          break;
        case 'shieldBlock':
          this.tone(1400, 0.25, 'triangle', 0.25, 0.7);
          this.tone(2100, 0.2, 'sine', 0.12, 0.8);
          break;
        case 'bounce':
          this.tone(880, 0.08, 'triangle', 0.12, 1.6);
          break;
        case 'wallHit':
          this.noiseBurst(0.03, 2500, 0.05);
          break;
        case 'dodge':
          this.sweepNoise(0.15, 600, 3500, 0.25);
          break;
        case 'pickup':
          [523, 659, 784].forEach((f, n) => this.tone(f, 0.12, 'triangle', 0.18, 1, n * 0.06));
          break;
        case 'powerUpTelegraph':
          this.tone(1200, 0.3, 'sine', 0.05, 1.3);
          break;
        case 'roundStart':
          this.tone(440, 0.12, 'square', 0.08, 1);
          break;
        case 'roundEnd':
          [392, 494, 587].forEach((f) => this.tone(f, 0.6, 'triangle', 0.12, 1, 0.15));
          break;
        case 'matchEnd':
          [523, 659, 784, 1047].forEach((f, n) => this.tone(f, 0.35, 'square', 0.1, 1, 0.2 + n * 0.12));
          break;
        case 'suddenDeath':
          [0, 0.25, 0.5].forEach((d) => this.tone(880, 0.15, 'sawtooth', 0.1, 0.8, d));
          break;
      }
    }
  }

  // The round-modifier reel: a click per name, then a ding as it lands.
  reelTick(): void {
    this.tone(1600, 0.03, 'square', 0.05, 0.8);
  }

  reelLand(): void {
    [784, 1175, 1568].forEach((f, n) => this.tone(f, 0.25, 'triangle', 0.14, 1, n * 0.05));
  }

  // Countdown tick for the last seconds of a round; higher when it's closer.
  tick(secondsLeft: number): void {
    this.tone(secondsLeft <= 3 ? 1320 : 990, 0.07, 'square', 0.07, 1);
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, bend: number, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * bend, t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noiseBurst(dur: number, cutoff: number, vol: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise || this.muted) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  private sweepNoise(dur: number, from: number, to: number, vol: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise || this.muted) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 2;
    filter.frequency.setValueAtTime(from, t);
    filter.frequency.exponentialRampToValueAtTime(to, t + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }
}
