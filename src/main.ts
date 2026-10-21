import { BotPlayer, type Difficulty } from './bot/bot';
import { CONFIG, KEY_BINDINGS } from './config';
import { Keyboard, KeyboardPlayer } from './input/keyboard';
import type { InputSource } from './input/types';
import { lastEditedMap, listSavedMaps } from './maps/storage';
import { THE_FLAT } from './maps/theFlat';
import { Sound } from './render/audio';
import { cycleLook, loadLooks, saveLooks } from './render/looks';
import { Music } from './render/music';
import { Renderer } from './render/renderer';
import { Editor } from './screens/editor';
import { HotseatLobby } from './screens/hotseat';
import { createGame, step } from './sim/step';
import type { GameState, MapData } from './sim/types';

type MatchFrom = 'title' | 'editor' | 'hotseat';
type Screen =
  | { kind: 'title' }
  | { kind: 'editor' }
  | { kind: 'hotseat' }
  | { kind: 'match'; state: GameState; map: MapData; paused: boolean; from: MatchFrom; recorded: boolean };

const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new Renderer(canvas);
const keyboard = new Keyboard();
const sound = new Sound();
const music = new Music(sound);

// Each slot is a human on the keyboard or a bot at some difficulty.
type Slot = 'human' | Difficulty;
const SLOT_ORDER: Slot[] = ['human', 'easy', 'normal', 'hard'];
const SLOTS_KEY = 'fpd.slots';

function loadSlots(): [Slot, Slot] {
  try {
    const saved = JSON.parse(localStorage.getItem(SLOTS_KEY) ?? 'null');
    if (Array.isArray(saved) && saved.length === 2 && saved.every((s) => SLOT_ORDER.includes(s))) return saved as [Slot, Slot];
  } catch {
    // Storage unavailable or corrupt: fall back to two humans.
  }
  return ['human', 'human'];
}

const slots = loadSlots();
let inputs: [InputSource, InputSource] = makeInputs(0);

function makeInputs(seed: number): [InputSource, InputSource] {
  const make = (slot: Slot, i: 0 | 1): InputSource =>
    slot === 'human'
      ? new KeyboardPlayer(keyboard, i === 0 ? KEY_BINDINGS.p1 : KEY_BINDINGS.p2)
      : new BotPlayer(slot, seed * 2 + i + 1);
  return [make(slots[0], 0), make(slots[1], 1)];
}

function cycleSlot(i: 0 | 1): void {
  slots[i] = SLOT_ORDER[(SLOT_ORDER.indexOf(slots[i]) + 1) % SLOT_ORDER.length];
  try {
    localStorage.setItem(SLOTS_KEY, JSON.stringify(slots));
  } catch {
    // Not saved; the choice still applies this session.
  }
}

const looks = loadLooks();
renderer.looks = looks;

let screen: Screen = { kind: 'title' };

// Maps to pick from on the title screen: the built-in one, then saved ones.
let mapIndex = 0;
const availableMaps = (): MapData[] => [THE_FLAT, ...listSavedMaps()];
function selectedMap(): MapData {
  const maps = availableMaps();
  return maps[mapIndex % maps.length];
}

const editor = new Editor(canvas, {
  onTestPlay: (map) => {
    editor.close();
    startMatch(map, 'editor');
  },
  onExit: () => {
    editor.close();
    screen = { kind: 'title' };
  },
});

const lobby = new HotseatLobby({
  onStart: (left, right, roundsToWin) => {
    lobby.close();
    startMatch(selectedMap(), 'hotseat', { roundsToWin, looks: [left.look, right.look], names: [left.name, right.name] });
  },
  onExit: () => {
    lobby.close();
    screen = { kind: 'title' };
  },
});

function openLobby(): void {
  screen = { kind: 'hotseat' };
  lobby.open();
  keyboard.clear();
}

function openEditor(map: MapData): void {
  screen = { kind: 'editor' };
  editor.open(map);
  keyboard.clear();
}

interface HotseatMatch {
  roundsToWin: number;
  looks: [string, string];
  names: [string, string];
}

function startMatch(map: MapData, from: MatchFrom = 'title', hotseat?: HotseatMatch): void {
  // The seed is picked here, outside the sim; the sim itself never reads the clock.
  const seed = (Date.now() ^ (performance.now() * 1000)) >>> 0;
  let cfg = CONFIG;
  if (hotseat) {
    // Hotseat is always two people on the keyboard, with their own names and looks.
    inputs = [new KeyboardPlayer(keyboard, KEY_BINDINGS.p1), new KeyboardPlayer(keyboard, KEY_BINDINGS.p2)];
    cfg = { ...CONFIG, round: { ...CONFIG.round, roundsToWin: hotseat.roundsToWin } };
    renderer.looks = hotseat.looks;
    renderer.names = hotseat.names;
    renderer.matchOverHint = 'Enter or Esc: back to the hotseat line-up';
  } else {
    inputs = makeInputs(seed);
    renderer.looks = looks;
    renderer.names = ['P1', 'P2'];
    renderer.matchOverHint = 'Enter for a rematch · Esc for title';
  }
  screen = { kind: 'match', state: createGame(map, seed, cfg), map, paused: false, from, recorded: false };
  keyboard.clear();
  music.start();
}

function leaveMatch(match: Extract<Screen, { kind: 'match' }>): void {
  music.stop();
  if (match.from === 'editor') openEditor(editor.currentMap());
  else if (match.from === 'hotseat') openLobby();
  else screen = { kind: 'title' };
}

keyboard.onPress((code) => {
  sound.unlock();
  if (code === 'KeyM') {
    sound.toggleMute();
    return;
  }
  if (code === 'KeyN') {
    music.toggle();
    if (music.enabled && screen.kind === 'match' && screen.state.phase !== 'matchOver') music.start();
    return;
  }
  if (screen.kind === 'editor' || screen.kind === 'hotseat') return; // they handle their own keys
  if (screen.kind === 'title') {
    if (code === 'Enter' || code === 'Space') startMatch(selectedMap());
    else if (code === 'Digit1') cycleSlot(0);
    else if (code === 'Digit2') cycleSlot(1);
    else if (code === KEY_BINDINGS.p1.dodge || code === KEY_BINDINGS.p2.dodge) {
      const i = code === KEY_BINDINGS.p1.dodge ? 0 : 1;
      looks[i] = cycleLook(looks[i], 1);
      saveLooks(looks);
    } else if (code === 'KeyH') openLobby();
    else if (code === 'Tab') mapIndex = (mapIndex + 1) % availableMaps().length;
    else if (code === 'KeyE') {
      const map = selectedMap();
      // A saved map opens as itself; from the built-in one, reopen the map
      // edited last, or start from a copy.
      openEditor(map !== THE_FLAT ? map : (lastEditedMap() ?? { ...structuredClone(THE_FLAT), name: 'My flat' }));
    }
    return;
  }
  const match = screen;
  if (match.state.phase === 'matchOver') {
    if (match.from === 'hotseat') {
      if (code === 'Enter' || code === KEY_BINDINGS.pause) leaveMatch(match);
    } else if (code === 'Enter') startMatch(match.map, match.from);
    else if (code === KEY_BINDINGS.pause) leaveMatch(match);
    return;
  }
  if (code === KEY_BINDINGS.pause) {
    match.paused = !match.paused;
    keyboard.clear();
  } else if (match.paused && code === 'KeyQ') {
    leaveMatch(match);
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
let lastSecondShown = 0;
let accumulator = 0;
let last = performance.now();

function frame(now: number): void {
  const elapsed = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (screen.kind === 'title') {
    accumulator = 0;
    renderer.drawTitle((code) => keyboard.isHeld(code), slots, selectedMap().name, availableMaps().length);
  } else if (screen.kind === 'editor') {
    accumulator = 0;
    editor.draw();
  } else if (screen.kind === 'hotseat') {
    accumulator = 0;
    renderer.drawBackdrop();
  } else {
    const match = screen;
    music.setPaused(match.paused);
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
      // Tick through the last ten seconds of a round.
      const s = match.state;
      const secondsLeft = Math.ceil(s.cfg.round.timeLimit - s.roundTime);
      if (s.phase === 'playing' && secondsLeft !== lastSecondShown && secondsLeft > 0 && secondsLeft <= 10) sound.tick(secondsLeft);
      lastSecondShown = secondsLeft;
      if (s.phase === 'matchOver') {
        music.stop();
        // A finished hotseat match goes on the scoreboard (an abandoned one doesn't).
        if (match.from === 'hotseat' && !match.recorded && s.matchWinner !== null) {
          const w = s.matchWinner;
          lobby.record(w, [s.players[w].roundWins, s.players[w === 0 ? 1 : 0].roundWins]);
          match.recorded = true;
        }
      }
      else {
        const over = s.roundTime - s.cfg.round.timeLimit;
        const suddenSteps = over < 0 ? 0 : 1 + Math.floor(over / s.cfg.round.suddenDeathInterval);
        music.setTension(s.roundTime / s.cfg.round.timeLimit, suddenSteps);
      }
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

// Offline support in production builds (the dev server stays uncached).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      // Offline play just won't be available.
    });
  });
}
