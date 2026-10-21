import { KEY_BINDINGS } from './config';
import { Keyboard, KeyboardPlayer } from './input/keyboard';
import type { InputSource } from './input/types';
import { THE_FLAT } from './maps/theFlat';
import { Sound } from './render/audio';
import { Renderer } from './render/renderer';
import { createGame, step } from './sim/step';
import type { GameState, MapData } from './sim/types';

type Screen = { kind: 'title' } | { kind: 'match'; state: GameState; map: MapData; paused: boolean };

const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new Renderer(canvas);
const keyboard = new Keyboard();
const sound = new Sound();
const inputs: [InputSource, InputSource] = [
  new KeyboardPlayer(keyboard, KEY_BINDINGS.p1),
  new KeyboardPlayer(keyboard, KEY_BINDINGS.p2),
];

let screen: Screen = { kind: 'title' };

function startMatch(map: MapData): void {
  // The seed is picked here, outside the sim; the sim itself never reads the clock.
  const seed = (Date.now() ^ (performance.now() * 1000)) >>> 0;
  screen = { kind: 'match', state: createGame(map, seed), map, paused: false };
  keyboard.clear();
}

keyboard.onPress((code) => {
  sound.unlock();
  if (code === 'KeyM') {
    sound.toggleMute();
    return;
  }
  if (screen.kind === 'title') {
    if (code === 'Enter' || code === 'Space') startMatch(THE_FLAT);
    return;
  }
  const match = screen;
  if (match.state.phase === 'matchOver') {
    if (code === 'Enter') startMatch(match.map);
    else if (code === KEY_BINDINGS.pause) screen = { kind: 'title' };
    return;
  }
  if (code === KEY_BINDINGS.pause) {
    match.paused = !match.paused;
    keyboard.clear();
  } else if (match.paused && code === 'KeyQ') {
    screen = { kind: 'title' };
  }
});

// Pause when the window loses focus: keys held at that moment would stick.
window.addEventListener('blur', () => {
  if (screen.kind === 'match' && screen.state.phase !== 'matchOver') screen.paused = true;
});

// Fixed-timestep loop: the sim always advances in 1/60 s ticks regardless of
// display refresh rate.
const TICK = 1 / 60;
// After a knockout the sim runs slowly for a moment (presentation only: the
// sim itself still advances in identical ticks).
const SLOWMO_DURATION = 0.6;
const SLOWMO_SCALE = 0.2;
let slowmo = 0;
let accumulator = 0;
let last = performance.now();

function frame(now: number): void {
  const elapsed = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (screen.kind === 'title') {
    accumulator = 0;
    renderer.drawTitle((code) => keyboard.isHeld(code));
  } else {
    const match = screen;
    if (!match.paused) {
      accumulator += slowmo > 0 ? elapsed * SLOWMO_SCALE : elapsed;
      slowmo = Math.max(0, slowmo - elapsed);
      while (accumulator >= TICK) {
        accumulator -= TICK;
        const s = match.state;
        step(s, [inputs[0].sample(s, 0), inputs[1].sample(s, 1)]);
        renderer.handleEvents(s.events, s);
        sound.handleEvents(s.events, s);
        if (s.events.some((e) => e.type === 'hit' && e.hits >= s.cfg.round.hitsToLose)) slowmo = SLOWMO_DURATION;
      }
      renderer.update(slowmo > 0 ? elapsed * 0.35 : elapsed);
    } else {
      accumulator = 0;
    }
    renderer.drawMatch(match.state, match.paused);
  }
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

// Handy from the browser console when tuning: `fpd.state` is the live match.
(window as unknown as { fpd: object }).fpd = {
  get state() {
    return screen.kind === 'match' ? screen.state : null;
  },
};
