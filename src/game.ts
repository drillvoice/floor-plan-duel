import { BotPlayer } from './bot/bot';
import { emptyTouchState, TouchPlayer } from './input/touch';
import { CONFIG, KEY_BINDINGS, PHONE_LOBBY } from './config';
import { Keyboard, KeyboardPlayer } from './input/keyboard';
import { cameraRelative } from './input/relative';
import type { InputSource } from './input/types';
import { lastEditedMap, listSavedMaps } from './maps/storage';
import { PhoneHost } from './net/host';
import { PhonePlayer, StartCountdown, type HostScreen } from './net/protocol';
import { BUILT_IN_MAPS, copyOfBuiltIn } from './maps/builtin';
import { Sound } from './render/audio';
import { cycleLook, loadLooks, saveLooks } from './render/looks';
import { Music } from './render/music';
import { FirstPersonCamera } from './render/firstPerson/camera';
import { modifierReel } from './render/overlay';
import { Renderer } from './render/renderer';
import { COLORS } from './render/theme';
import { Editor } from './screens/editor';
import { HotseatLobby } from './screens/hotseat';
import { MatchOverlay, MobileMenu, prefersTouch, type OverlayMode } from './screens/mobile';
import { PhoneLobby, ReadyBanner } from './screens/phones';
import { Settings, type Slot } from './settings';
import { shuffled } from './sim/rng';
import { createGame, step } from './sim/step';
import type { GameState, MapData, PlayerIndex, PlayerInput } from './sim/types';

type MatchFrom = 'title' | 'editor' | 'hotseat' | 'phones' | 'mobile';
type Screen =
  | { kind: 'title' }
  | { kind: 'mobile' }
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

const settings = new Settings();
const slots = settings.slots;

// Phones as controllers. The room opens the first time the phone screen is
// shown; after that, a side with a phone on it is played from the phone.
const clock = () => performance.now() / 1000;
const phones = new PhoneHost(clock);
const phonePlayer = new PhonePlayer(phones.room, clock);
// Phones start a match by all tapping Ready, then a short countdown.
const startCountdown = new StartCountdown(PHONE_LOBBY.readyCountdown);
const readyBanner = new ReadyBanner();
let lastCountShown: number | null = null;

let inputs: [InputSource, InputSource] = makeInputs(0);

// The first-person test view, opened with ?fp. People see through their own
// eyes, side by side when two play, and their keys turn with their camera.
// With only bots playing, it follows P1.
const firstPerson = new URLSearchParams(location.search).has('fp');
const cameras = [new FirstPersonCamera(), new FirstPersonCamera()] as const;

function firstPersonViews(): PlayerIndex[] {
  const people = ([0, 1] as const).filter((i) => inputs[i].kind === 'human');
  return people.length ? people : [0];
}

function sampleInput(state: GameState, i: PlayerIndex): PlayerInput {
  const input = inputs[i].sample(state, i);
  return renderer.firstPerson && inputs[i].kind === 'human' ? cameraRelative(input, cameras[i].forward) : input;
}

function makeInputs(seed: number): [InputSource, InputSource] {
  const make = (slot: Slot, i: 0 | 1): InputSource =>
    phones.room.phoneIn(i)
      ? phonePlayer
      : slot === 'human'
        ? new KeyboardPlayer(keyboard, i === 0 ? KEY_BINDINGS.p1 : KEY_BINDINGS.p2)
        : new BotPlayer(slot, seed * 2 + i + 1);
  return [make(slots[0], 0), make(slots[1], 1)];
}

// Each side's look and name, from its phone when it has one.
function sideLooks(): [string, string] {
  return [phones.room.phoneIn(0)?.look ?? looks[0], phones.room.phoneIn(1)?.look ?? looks[1]];
}
function sideNames(): [string, string] {
  return [phones.room.phoneIn(0)?.name || 'P1', phones.room.phoneIn(1)?.name || 'P2'];
}

// The maps a match plays, one per round: the chosen map first, then the other
// built-in maps in an order set by the match's seed, so the seed alone says
// how a match went. Test play from the editor sticks to its map.
function matchMaps(first: MapData, from: MatchFrom, seed: number): MapData[] {
  if (!settings.rotation || from === 'editor') return [first];
  return [first, ...shuffled(BUILT_IN_MAPS.filter((m) => m !== first), seed)];
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
    // With a phone on each side, only their Ready buttons start the match.
    if (phones.room.phonesOnBothSides()) return;
    phoneLobby.close();
    startMatch(selectedMap(), 'phones');
  },
  onExit: () => {
    phoneLobby.close();
    screen = { kind: 'title' };
  },
  fallback: (i) => (slots[i] === 'human' ? 'Human (keyboard)' : `Bot · ${slots[i][0].toUpperCase()}${slots[i].slice(1)}`),
  colors: COLORS.players,
  countdown: () => startCountdown.left(clock()),
});

function openPhoneLobby(): void {
  screen = { kind: 'phones' };
  phoneLobby.open();
  keyboard.clear();
}

// Phone-only play: on a touch-only device the game opens on a touch menu
// instead of the keyboard title screen, and you play a bot on the phone.
let mobile = prefersTouch();

const touchState = emptyTouchState();
const touchPlayer = new TouchPlayer(touchState);

const mobileMenu = new MobileMenu({
  settings: () => ({
    look: looks[0],
    name: settings.mobileName,
    bot: settings.mobileBot,
    mapName: selectedMap().name,
    mapCount: availableMaps().length,
    rotation: settings.rotation,
    modifiers: settings.modifiers,
    sound: !sound.muted,
    music: music.enabled,
  }),
  cycleLook: (step) => {
    looks[0] = cycleLook(looks[0], step);
    saveLooks(looks);
  },
  setName: (name) => settings.setMobileName(name),
  setBot: (bot) => settings.setMobileBot(bot),
  cycleMap: (step) => {
    const count = availableMaps().length;
    mapIndex = (mapIndex + step + count) % count;
  },
  toggleRotation: () => settings.toggleRotation(),
  toggleModifiers: () => settings.toggleModifiers(),
  toggleSound: () => sound.toggleMute(),
  toggleMusic: () => music.toggle(),
  onPlay: () => {
    // Full screen hides the browser bar, and Android can then hold the
    // phone sideways. Where neither works, the overlay asks them to rotate.
    void document.documentElement
      .requestFullscreen?.()
      .then(() => (window.screen.orientation as { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
      .catch(() => {});
    mobileMenu.close();
    startMatch(selectedMap(), 'mobile');
  },
  color: COLORS.players[0],
});

const matchOverlay = new MatchOverlay(touchState, COLORS.players[0], {
  onPause: () => {
    if (screen.kind === 'match' && screen.state.phase !== 'matchOver') screen.paused = true;
  },
  onResume: () => {
    if (screen.kind === 'match' && !inPortrait()) screen.paused = false;
  },
  onQuit: () => {
    if (screen.kind === 'match') leaveMatch(screen);
  },
  onRematch: () => {
    if (screen.kind === 'match') startMatch(screen.map, 'mobile');
  },
});

function openMobileMenu(): void {
  screen = { kind: 'mobile' };
  mobileMenu.open();
}

const inPortrait = () => window.innerHeight > window.innerWidth;

function overlayMode(): OverlayMode {
  if (screen.kind !== 'match' || screen.from !== 'mobile') return 'hidden';
  if (screen.state.phase === 'matchOver') return 'over';
  return screen.paused ? 'paused' : 'playing';
}

function enterMobileMode(): void {
  mobile = true;
  // A game screen should never zoom on a double tap.
  document.querySelector('meta[name=viewport]')?.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
  // Phones only allow sound after a touch.
  document.addEventListener('pointerup', () => sound.unlock(), { capture: true });
  openMobileMenu();
}

if (mobile) enterMobileMode();

// A phone that slipped through to the keyboard title screen would be stuck
// there, so a finger tap on it switches to the phone menu.
canvas.addEventListener('pointerdown', (e) => {
  if (screen.kind === 'title' && e.pointerType === 'touch') enterMobileMode();
});

// One-off actions from the phones.
phones.onEvent = (e) => {
  sound.unlock();
  if (screen.kind === 'match' && screen.state.phase !== 'matchOver') {
    // A pause button, or a phone dropping out mid-match: pause until it's back.
    if (e.type === 'pause') screen.paused = !screen.paused;
    else if (inputs[e.slot] === phonePlayer) screen.paused = true;
  }
};

// Every phone is ready and the countdown has run out. Only called while
// phonesCanStart() says the phones may start a match.
function startFromPhones(): void {
  sound.unlock();
  if (screen.kind === 'phones') phoneLobby.close();
  if (screen.kind === 'match') startMatch(screen.map, screen.from === 'title' ? 'phones' : screen.from);
  else startMatch(selectedMap(), 'phones');
}

// Keeps the phones' ready-up and countdown going, and shows it on the big
// screen. Returns the seconds left in the countdown, if there is one.
function updateReadyUp(): number | null {
  const canStart = phonesCanStart();
  if (startCountdown.update(canStart && phones.room.everyoneReady(), clock())) startFromPhones();
  const left = startCountdown.left(clock());
  const count = left === null ? null : Math.max(1, Math.ceil(left));
  if (count !== null && count !== lastCountShown) sound.tick(count);
  lastCountShown = count;
  // The phone screen shows this itself; the title and results screens get a banner.
  const banner = screen.kind === 'title' || (screen.kind === 'match' && screen.state.phase === 'matchOver');
  if (!banner || !phonesCanStart()) readyBanner.show(null, null);
  else if (count !== null) readyBanner.show('Get ready!', count);
  else if (phones.room.phonesOnBothSides()) {
    const names = sideNames();
    const who = ([0, 1] as const).map((i) => `${names[i]} ${phones.room.isReady(i) ? '✓' : '…'}`).join('   ');
    readyBanner.show(`${who}   ·   Tap Ready on both phones`, null);
  } else readyBanner.show(null, null);
  return left;
}

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
  looks: [string, string];
  names: [string, string];
}

function startMatch(map: MapData, from: MatchFrom = 'title', hotseat?: HotseatMatch): void {
  // The seed is picked here, outside the sim; the sim itself never reads the clock.
  const seed = (Date.now() ^ (performance.now() * 1000)) >>> 0;
  let cfg = { ...CONFIG, modifiers: { ...CONFIG.modifiers, enabled: settings.modifiers } };
  if (hotseat) {
    // Hotseat is always two people on the keyboard, with their own names and looks.
    inputs = [new KeyboardPlayer(keyboard, KEY_BINDINGS.p1), new KeyboardPlayer(keyboard, KEY_BINDINGS.p2)];
    cfg = { ...cfg, round: { ...cfg.round, roundsToWin: hotseat.roundsToWin } };
    renderer.looks = hotseat.looks;
    renderer.names = hotseat.names;
    renderer.matchOverHint = 'Enter or Esc: back to the hotseat line-up';
  } else if (from === 'mobile') {
    touchPlayer.reset();
    inputs = [touchPlayer, new BotPlayer(settings.mobileBot, seed * 2 + 2)];
    renderer.looks = [looks[0], looks[1]];
    renderer.names = [settings.mobileName || 'You', 'Bot'];
    renderer.matchOverHint = '';
  } else {
    inputs = makeInputs(seed);
    renderer.looks = sideLooks();
    renderer.names = sideNames();
    renderer.matchOverHint = 'Enter for a rematch · Esc for title';
  }
  renderer.compact = from === 'mobile';
  renderer.firstPerson = firstPerson ? { views: firstPersonViews(), cameras } : null;
  renderer.pausedHint = from === 'mobile' ? '' : 'Esc to resume · Q to quit to title';
  screen = { kind: 'match', state: createGame(matchMaps(map, from, seed), seed, cfg), map, paused: false, from, recorded: false };
  keyboard.clear();
  music.start(screen.state.arena.music);
}

function leaveMatch(match: Extract<Screen, { kind: 'match' }>): void {
  music.stop();
  if (match.from === 'editor') openEditor(editor.currentMap());
  else if (match.from === 'hotseat') openLobby();
  else if (match.from === 'phones') openPhoneLobby();
  else if (match.from === 'mobile') openMobileMenu();
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
    if (music.enabled && screen.kind === 'match' && screen.state.phase !== 'matchOver') music.start(screen.state.arena.music);
    return;
  }
  if (screen.kind === 'editor' || screen.kind === 'hotseat' || screen.kind === 'phones' || screen.kind === 'mobile') return; // they handle their own keys
  if (screen.kind === 'title') {
    if (code === 'Enter' || code === 'Space') {
      // With a phone on each side, only their Ready buttons start the match.
      if (!phones.room.phonesOnBothSides()) startMatch(selectedMap());
    }
    else if (code === 'Digit1') settings.cycleSlot(0);
    else if (code === 'Digit2') settings.cycleSlot(1);
    else if (code === KEY_BINDINGS.p1.dodge || code === KEY_BINDINGS.p2.dodge) {
      const i = code === KEY_BINDINGS.p1.dodge ? 0 : 1;
      looks[i] = cycleLook(looks[i], 1);
      saveLooks(looks);
    } else if (code === 'KeyH') openLobby();
    else if (code === 'KeyP') openPhoneLobby();
    else if (code === 'KeyR') settings.toggleModifiers();
    else if (code === 'KeyT') settings.toggleRotation();
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
    } else if (code === 'Enter') {
      if (!phones.room.phonesOnBothSides()) startMatch(match.map, match.from);
    }
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
// On a phone, also when the app is switched away from.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && screen.kind === 'match' && screen.state.phase !== 'matchOver') screen.paused = true;
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
    mobile || !document.fullscreenEnabled || (screen.kind !== 'title' && screen.kind !== 'hotseat' && screen.kind !== 'phones');
  const countdown = updateReadyUp();
  phones.update(hostScreen(), phonesCanStart(), COLORS.players, countdown);
  // Held upright, a phone-only match waits (the overlay asks them to rotate).
  if (screen.kind === 'match' && screen.from === 'mobile' && screen.state.phase !== 'matchOver' && inPortrait()) screen.paused = true;
  matchOverlay.setMode(overlayMode());

  if (screen.kind === 'title') {
    accumulator = 0;
    renderer.looks = sideLooks();
    const labels = ([0, 1] as const).map((i) => {
      const phone = phones.room.phoneIn(i);
      return phone ? `📱 ${phone.name || 'Phone'}` : slots[i];
    });
    renderer.drawTitle((code) => keyboard.isHeld(code), labels, selectedMap().name, availableMaps().length, settings.modifiers, settings.rotation);
  } else if (screen.kind === 'editor') {
    accumulator = 0;
    editor.draw();
  } else if (screen.kind === 'hotseat' || screen.kind === 'phones' || screen.kind === 'mobile') {
    accumulator = 0;
    renderer.drawBackdrop();
  } else {
    const match = screen;
    if (match.from !== 'hotseat' && match.from !== 'mobile') {
      // A phone that joins mid-match (say, after the first player readied up
      // alone) takes its side over from the keyboard or bot straight away,
      // rather than holding a joystick that does nothing until the next match.
      if (match.state.phase !== 'matchOver' && ([0, 1] as const).some((i) => phones.room.phoneIn(i) && inputs[i] !== phonePlayer)) {
        inputs = [phones.room.phoneIn(0) ? phonePlayer : inputs[0], phones.room.phoneIn(1) ? phonePlayer : inputs[1]];
        renderer.looks = sideLooks();
        renderer.names = sideNames();
      }
      renderer.matchOverHint = phones.room.phonesOnBothSides() ? 'Tap Ready on both phones for a rematch · Esc for title' : 'Enter for a rematch · Esc for title';
    }
    music.setPaused(match.paused);
    if (renderer.firstPerson) for (const i of [0, 1] as const) cameras[i].update(match.state, i, elapsed);
    if (!match.paused && hitstop > 0) {
      hitstop = Math.max(0, hitstop - elapsed);
    } else if (!match.paused) {
      accumulator += slowmo > 0 ? elapsed * SLOWMO_SCALE : elapsed;
      slowmo = Math.max(0, slowmo - elapsed);
      while (accumulator >= TICK) {
        accumulator -= TICK;
        const s = match.state;
        step(s, [sampleInput(s, 0), sampleInput(s, 1)]);
        renderer.handleEvents(s.events, s);
        for (const e of s.events) {
          if (e.type === 'hit' && inputs[e.player] === phonePlayer) {
            phones.room.buzz(e.player);
            phones.nudge();
          }
          if (e.type === 'hit' && inputs[e.player] === touchPlayer) navigator.vibrate?.(160);
        }
        sound.handleEvents(s.events, s);
        if (s.events.some((e) => e.type === 'hit' && e.hits >= s.cfg.round.hitsToLose)) slowmo = SLOWMO_DURATION;
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
          const w = s.matchWinner;
          lobby.record(w, [s.players[w].roundWins, s.players[w === 0 ? 1 : 0].roundWins]);
          match.recorded = true;
        }
      }
      else {
        const over = s.roundTime - s.cfg.round.timeLimit;
        const suddenSteps = over < 0 ? 0 : 1 + Math.floor(over / s.cfg.round.suddenDeathInterval);
        // Each map has its own tune: switch when the next round moves to a new one.
        if (music.playing && music.current !== s.arena.music) music.start(s.arena.music);
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
