import { BotPlayer, type Difficulty } from './bot/bot';
import { CONFIG, KEY_BINDINGS } from './config';
import { Keyboard, KeyboardPlayer } from './input/keyboard';
import type { InputSource } from './input/types';
import { lastEditedMap, listSavedMaps } from './maps/storage';
import { PhoneHost } from './net/host';
import { PhonePlayer, type HostScreen } from './net/protocol';
import { BUILT_IN_MAPS, copyOfBuiltIn } from './maps/builtin';
import { Sound } from './render/audio';
import { cycleLook, loadLooks, saveLooks } from './render/looks';
import { Music } from './render/music';
import { COLORS, modifierReel, Renderer } from './render/renderer';
import { Editor } from './screens/editor';
import { HotseatLobby } from './screens/hotseat';
import { PhoneLobby } from './screens/phones';
import { createGame, step } from './sim/step';
import type { GameState, MapData } from './sim/types';

type MatchFrom = 'title' | 'editor' | 'hotseat' | 'phones';
type Screen =
  | { kind: 'title' }
  | { kind: 'editor' }
  | { kind: 'hotseat' }
  | { kind: 'phones' }
  | { kind: 'match'; state: GameState; map: MapData; paused: boolean; from: MatchFrom; recorded: boolean };

const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new Renderer(canvas);
const keyboard = new Keyboard();
const sound = new Sound();
const music = new Music(sound);

// Full screen, from B anywhere or the corner button on the menus. Browsers
// only allow it in response to a key press or click.
const fullscreenButton = document.getElementById('fullscreen') as HTMLButtonElement;
function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen().catch(() => {});
}
// Don't take focus, or Enter would press the button instead of starting.
fullscreenButton.addEventListener('mousedown', (e) => e.preventDefault());
fullscreenButton.addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', () => {
  fullscreenButton.classList.toggle('on', !!document.fullscreenElement);
  fullscreenButton.title = document.fullscreenElement ? 'Exit full screen (B)' : 'Full screen (B)';
});

// There are four seats, P1-P4. P1 and P2 are a human on the keyboard or a bot
// at some difficulty; P3 and P4 have no keys, so they're a bot or nobody
// ('off'). A phone in a seat plays it whatever it's set to, so up to four
// people can play on phones.
type Slot = 'human' | 'off' | Difficulty;
const SLOT_ORDERS: Slot[][] = [
  ['human', 'easy', 'normal', 'hard'],
  ['human', 'easy', 'normal', 'hard'],
  ['off', 'easy', 'normal', 'hard'],
  ['off', 'easy', 'normal', 'hard'],
];
const SLOTS_KEY = 'fpd.slots';

// Saves from before four seats hold just P1 and P2.
function loadSlots(): Slot[] {
  const slots = SLOT_ORDERS.map((order) => order[0]);
  try {
    const saved = JSON.parse(localStorage.getItem(SLOTS_KEY) ?? 'null');
    if (Array.isArray(saved)) {
      saved.slice(0, slots.length).forEach((s, i) => {
        if (SLOT_ORDERS[i].includes(s)) slots[i] = s;
      });
    }
  } catch {
    // Storage unavailable or corrupt: fall back to two humans.
  }
  return slots;
}

const slots = loadSlots();

// Phones as controllers. The room opens the first time the phone screen is
// shown; after that, a seat with a phone on it is played from the phone.
const clock = () => performance.now() / 1000;
const phones = new PhoneHost(clock);

// The seats in the next match: P1 and P2 always, P3 and P4 when a bot or a
// phone is in them. Players in the sim are numbered in seat order, so
// `seats[i]` is the seat of player i.
function activeSeats(): number[] {
  return slots.flatMap((slot, seat) => (seat < 2 || slot !== 'off' || phones.room.phoneIn(seat) ? [seat] : []));
}

let seats: number[] = [0, 1];
let inputs: InputSource[] = makeInputs(0);

function makeInputs(seed: number): InputSource[] {
  return seats.map((seat) => {
    if (phones.room.phoneIn(seat)) return new PhonePlayer(phones.room, clock, seat);
    const slot = slots[seat];
    if (slot === 'human') return new KeyboardPlayer(keyboard, seat === 0 ? KEY_BINDINGS.p1 : KEY_BINDINGS.p2);
    return new BotPlayer(slot === 'off' ? 'normal' : slot, seed * 4 + seat + 1);
  });
}

// Each seat's look and name, from its phone when it has one.
function seatLook(seat: number): string {
  return phones.room.phoneIn(seat)?.look ?? looks[seat];
}
function seatName(seat: number): string {
  return phones.room.phoneIn(seat)?.name || `P${seat + 1}`;
}

function cycleSlot(i: number): void {
  const order = SLOT_ORDERS[i];
  slots[i] = order[(order.indexOf(slots[i]) + 1) % order.length];
  try {
    localStorage.setItem(SLOTS_KEY, JSON.stringify(slots));
  } catch {
    // Not saved; the choice still applies this session.
  }
}

// Round modifiers on or off, from R on the title screen. On unless turned off.
const MODIFIERS_KEY = 'fpd.modifiers';
let modifiersOn = true;
try {
  modifiersOn = localStorage.getItem(MODIFIERS_KEY) !== 'off';
} catch {
  // Storage unavailable: keep the default.
}
function toggleModifiers(): void {
  modifiersOn = !modifiersOn;
  try {
    localStorage.setItem(MODIFIERS_KEY, modifiersOn ? 'on' : 'off');
  } catch {
    // Not saved; the choice still applies this session.
  }
}

// Map rotation, from T on the title screen: a match starts on the chosen map
// and plays a different built-in map each round. On unless turned off.
const ROTATION_KEY = 'fpd.mapRotation';
let rotationOn = true;
try {
  rotationOn = localStorage.getItem(ROTATION_KEY) !== 'off';
} catch {
  // Storage unavailable: keep the default.
}
function toggleRotation(): void {
  rotationOn = !rotationOn;
  try {
    localStorage.setItem(ROTATION_KEY, rotationOn ? 'on' : 'off');
  } catch {
    // Not saved; the choice still applies this session.
  }
}

// The maps a match plays, one per round: the chosen map first, then the other
// built-in maps in a random order. Test play from the editor sticks to its map.
function matchMaps(first: MapData, from: MatchFrom): MapData[] {
  if (!rotationOn || from === 'editor') return [first];
  const rest = BUILT_IN_MAPS.filter((m) => m !== first);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return [first, ...rest];
}

const looks = loadLooks();
renderer.looks = looks;

let screen: Screen = { kind: 'title' };

// Maps to pick from on the title screen: the built-in ones, then saved ones.
let mapIndex = 0;
const availableMaps = (): MapData[] => [...BUILT_IN_MAPS, ...listSavedMaps()];
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

const phoneLobby = new PhoneLobby(phones, {
  onStart: () => {
    phoneLobby.close();
    startMatch(selectedMap(), 'phones');
  },
  onExit: () => {
    phoneLobby.close();
    screen = { kind: 'title' };
  },
  fallback: (i) =>
    slots[i] === 'off' ? null : slots[i] === 'human' ? 'Human (keyboard)' : `Bot · ${slots[i][0].toUpperCase()}${slots[i].slice(1)}`,
  colors: COLORS.players,
});

function openPhoneLobby(): void {
  screen = { kind: 'phones' };
  phoneLobby.open();
  keyboard.clear();
}

// One-off actions from the phones.
phones.onEvent = (e) => {
  sound.unlock();
  if (e.type === 'start') {
    if (screen.kind === 'title') startMatch(selectedMap(), 'phones');
    else if (screen.kind === 'phones') {
      phoneLobby.close();
      startMatch(selectedMap(), 'phones');
    } else if (screen.kind === 'match' && screen.state.phase === 'matchOver' && screen.from !== 'hotseat') {
      startMatch(screen.map, screen.from === 'title' ? 'phones' : screen.from);
    }
  } else if (screen.kind === 'match' && screen.state.phase !== 'matchOver') {
    // A pause button, or a phone dropping out mid-match: pause until it's back.
    if (e.type === 'pause') screen.paused = !screen.paused;
    else if (inputs.some((input) => input instanceof PhonePlayer && input.slot === e.slot)) screen.paused = true;
  }
};

// What the phones should show, and whether their start button works.
function hostScreen(): HostScreen {
  if (screen.kind !== 'match') return 'lobby';
  if (screen.state.phase === 'matchOver') return 'over';
  return screen.paused ? 'paused' : 'match';
}
function phonesCanStart(): boolean {
  if (screen.kind === 'title' || screen.kind === 'phones') return true;
  return screen.kind === 'match' && screen.state.phase === 'matchOver' && screen.from !== 'hotseat';
}

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
  looks: string[];
  names: string[];
}

function startMatch(map: MapData, from: MatchFrom = 'title', hotseat?: HotseatMatch): void {
  // The seed is picked here, outside the sim; the sim itself never reads the clock.
  const seed = (Date.now() ^ (performance.now() * 1000)) >>> 0;
  let cfg = { ...CONFIG, modifiers: { ...CONFIG.modifiers, enabled: modifiersOn } };
  if (hotseat) {
    // Hotseat is always two people on the keyboard, with their own names and looks.
    seats = [0, 1];
    inputs = [new KeyboardPlayer(keyboard, KEY_BINDINGS.p1), new KeyboardPlayer(keyboard, KEY_BINDINGS.p2)];
    cfg = { ...cfg, round: { ...cfg.round, roundsToWin: hotseat.roundsToWin } };
    renderer.looks = hotseat.looks;
    renderer.names = hotseat.names;
    renderer.matchOverHint = 'Enter or Esc: back to the hotseat line-up';
  } else {
    seats = activeSeats();
    inputs = makeInputs(seed);
    renderer.looks = seats.map(seatLook);
    renderer.names = seats.map(seatName);
    renderer.matchOverHint = 'Enter for a rematch · Esc for title';
  }
  renderer.colors = seats.map((seat) => COLORS.players[seat]);
  const state = createGame(matchMaps(map, from), seed, cfg, inputs.length);
  screen = { kind: 'match', state, map, paused: false, from, recorded: false };
  keyboard.clear();
  music.start();
}

function leaveMatch(match: Extract<Screen, { kind: 'match' }>): void {
  music.stop();
  if (match.from === 'editor') openEditor(editor.currentMap());
  else if (match.from === 'hotseat') openLobby();
  else if (match.from === 'phones') openPhoneLobby();
  else screen = { kind: 'title' };
}

keyboard.onPress((code) => {
  sound.unlock();
  if (code === 'KeyM') {
    sound.toggleMute();
    return;
  }
  if (code === 'KeyB' && document.fullscreenEnabled) {
    toggleFullscreen();
    return;
  }
  if (code === 'KeyN') {
    music.toggle();
    if (music.enabled && screen.kind === 'match' && screen.state.phase !== 'matchOver') music.start();
    return;
  }
  if (screen.kind === 'editor' || screen.kind === 'hotseat' || screen.kind === 'phones') return; // they handle their own keys
  if (screen.kind === 'title') {
    if (code === 'Enter' || code === 'Space') startMatch(selectedMap());
    else if (code === 'Digit1') cycleSlot(0);
    else if (code === 'Digit2') cycleSlot(1);
    else if (code === 'Digit3') cycleSlot(2);
    else if (code === 'Digit4') cycleSlot(3);
    else if (code === KEY_BINDINGS.p1.dodge || code === KEY_BINDINGS.p2.dodge) {
      const i = code === KEY_BINDINGS.p1.dodge ? 0 : 1;
      looks[i] = cycleLook(looks[i], 1);
      saveLooks(looks);
    } else if (code === 'KeyH') openLobby();
    else if (code === 'KeyP') openPhoneLobby();
    else if (code === 'KeyR') toggleModifiers();
    else if (code === 'KeyT') toggleRotation();
    else if (code === 'Tab') mapIndex = (mapIndex + 1) % availableMaps().length;
    else if (code === 'KeyE') {
      const map = selectedMap();
      // A saved map opens as itself; from a built-in one, reopen the map
      // edited last, or start from a copy.
      openEditor(
        !BUILT_IN_MAPS.includes(map) ? map : (lastEditedMap() ?? copyOfBuiltIn(map)),
      );
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
// Every other hit (and a shield block) freezes the action for a few frames,
// so it lands with a thump. The screen keeps shaking through the freeze.
const HITSTOP = 0.05;
const BLOCKSTOP = 0.035;
let hitstop = 0;
let lastSecondShown = 0;
let lastReelStep = -1;
let accumulator = 0;
let last = performance.now();

function frame(now: number): void {
  const elapsed = Math.min(0.1, (now - last) / 1000);
  last = now;
  fullscreenButton.hidden =
    !document.fullscreenEnabled || (screen.kind !== 'title' && screen.kind !== 'hotseat' && screen.kind !== 'phones');
  phones.update(hostScreen(), phonesCanStart(), COLORS.players);

  if (screen.kind === 'title') {
    accumulator = 0;
    renderer.looks = slots.map((_, seat) => seatLook(seat));
    const labels = slots.map((slot, seat) => {
      const phone = phones.room.phoneIn(seat);
      return phone ? `📱 ${phone.name || 'Phone'}` : slot;
    });
    renderer.drawTitle((code) => keyboard.isHeld(code), labels, selectedMap().name, availableMaps().length, modifiersOn, rotationOn);
  } else if (screen.kind === 'editor') {
    accumulator = 0;
    editor.draw();
  } else if (screen.kind === 'hotseat' || screen.kind === 'phones') {
    accumulator = 0;
    renderer.drawBackdrop();
  } else {
    const match = screen;
    music.setPaused(match.paused);
    if (!match.paused && hitstop > 0) {
      hitstop = Math.max(0, hitstop - elapsed);
    } else if (!match.paused) {
      accumulator += slowmo > 0 ? elapsed * SLOWMO_SCALE : elapsed;
      slowmo = Math.max(0, slowmo - elapsed);
      while (accumulator >= TICK) {
        accumulator -= TICK;
        const s = match.state;
        step(s, inputs.map((input, i) => input.sample(s, i)));
        renderer.handleEvents(s.events, s);
        for (const e of s.events) {
          const input = e.type === 'hit' ? inputs[e.player] : null;
          if (input instanceof PhonePlayer) {
            phones.room.buzz(input.slot);
            phones.nudge();
          }
        }
        sound.handleEvents(s.events, s);
        // Slow motion for the knockout that ends the round; other hits
        // (including knockouts with players still standing) just thump.
        if (s.events.some((e) => e.type === 'roundEnd')) slowmo = SLOWMO_DURATION;
        else if (s.events.some((e) => e.type === 'hit')) hitstop = HITSTOP;
        else if (s.events.some((e) => e.type === 'shieldBlock')) hitstop = BLOCKSTOP;
        if (hitstop > 0) {
          accumulator = 0;
          break;
        }
      }
      renderer.update(slowmo > 0 ? elapsed * 0.35 : elapsed);
      // Tick through the last ten seconds of a round.
      const s = match.state;
      // Click as the modifier reel spins, and ding when it lands.
      const reel = s.phase === 'countdown' && s.modifier ? modifierReel(s.phaseTime) : null;
      if (reel && reel.step !== lastReelStep) {
        if (reel.landed) sound.reelLand();
        else sound.reelTick();
      }
      lastReelStep = reel ? reel.step : -1;
      const secondsLeft = Math.ceil(s.cfg.round.timeLimit - s.roundTime);
      if (s.phase === 'playing' && secondsLeft !== lastSecondShown && secondsLeft > 0 && secondsLeft <= 10) sound.tick(secondsLeft);
      lastSecondShown = secondsLeft;
      if (s.phase === 'matchOver') {
        music.stop();
        // A finished hotseat match goes on the scoreboard (an abandoned one doesn't).
        if (match.from === 'hotseat' && !match.recorded && s.matchWinner !== null) {
          // Hotseat is always 1v1.
          const w = s.matchWinner as 0 | 1;
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
