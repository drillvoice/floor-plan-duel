// Phone-only play: the whole game on one phone, against a bot. The menu
// replaces the keyboard title screen on touch devices, and during a match
// the touch controls sit over the arena with buttons for the things the
// keyboard would do (pause, quit, rematch).

import type { Difficulty } from '../bot/bot';
import { TouchControls, touchCss, type TouchState } from '../input/touch';
import { el } from './dom';

export interface MobileSettings {
  look: string;
  name: string;
  bot: Difficulty;
  mapName: string;
  mapCount: number;
  rotation: boolean;
  modifiers: boolean;
  sound: boolean;
  music: boolean;
}

export interface MobileMenuCallbacks {
  settings(): MobileSettings;
  cycleLook(step: 1 | -1): void;
  setName(name: string): void;
  setBot(bot: Difficulty): void;
  cycleMap(step: 1 | -1): void;
  toggleRotation(): void;
  toggleModifiers(): void;
  toggleSound(): void;
  toggleMusic(): void;
  onPlay(): void;
  color: string;
}

const BOTS: Difficulty[] = ['easy', 'normal', 'hard'];
const label = (d: Difficulty) => d[0].toUpperCase() + d.slice(1);

export class MobileMenu {
  private root: HTMLElement;

  constructor(private callbacks: MobileMenuCallbacks) {
    this.root = el('div', { id: 'mobile', hidden: true });
    document.body.append(this.root);
  }

  open(): void {
    this.root.hidden = false;
    this.render();
  }

  close(): void {
    this.root.hidden = true;
  }

  private render(): void {
    const cb = this.callbacks;
    const s = cb.settings();
    const act = (fn: () => void) => () => {
      fn();
      this.render();
    };
    const button = (text: string, fn: () => void, className = '') => {
      const b = el('button', { type: 'button', className, textContent: text });
      b.addEventListener('click', act(fn));
      return b;
    };
    const toggle = (text: string, on: boolean, fn: () => void) => button(`${text}: ${on ? 'on' : 'off'}`, fn, `toggle${on ? ' on' : ''}`);

    const face = el('div', { className: 'face', textContent: s.look });
    face.style.background = cb.color;
    const name = el('input', { type: 'text', value: s.name, maxLength: 16, placeholder: 'Your name', ariaLabel: 'Your name' });
    name.autocomplete = 'off';
    name.addEventListener('input', () => cb.setName(name.value));
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') name.blur();
    });

    const play = el('button', { type: 'button', className: 'primary play', textContent: 'Play ▶' });
    play.addEventListener('click', () => cb.onPlay());

    this.root.replaceChildren(
      el('div', { className: 'panel' }, [
        el('div', { className: 'col' }, [
          el('h1', { textContent: 'Floor Plan Duel' }),
          el('p', { className: 'sub', textContent: 'You against a bot, on this phone. Turn it sideways to play.' }),
          el('div', { className: 'look-row' }, [button('◀', () => cb.cycleLook(-1), 'arrow'), face, button('▶', () => cb.cycleLook(1), 'arrow'), name]),
          play,
          el('a', { className: 'controller', href: '?join', textContent: 'Or use this phone as a controller for a big screen' }),
        ]),
        el('div', { className: 'col' }, [
          el('div', { className: 'label', textContent: 'Bot' }),
          el('div', { className: 'choices' }, BOTS.map((d) => button(label(d), () => cb.setBot(d), d === s.bot ? 'on' : ''))),
          el('div', { className: 'label', textContent: 'Map' }),
          el('div', { className: 'map-row' }, [
            ...(s.mapCount > 1 ? [button('◀', () => cb.cycleMap(-1), 'arrow')] : []),
            el('div', { className: 'map-name', textContent: s.rotation ? `${s.mapName}, then a new one each round` : s.mapName }),
            ...(s.mapCount > 1 ? [button('▶', () => cb.cycleMap(1), 'arrow')] : []),
          ]),
          el('div', { className: 'choices' }, [
            toggle('Map rotation', s.rotation, cb.toggleRotation),
            toggle('Round modifiers', s.modifiers, cb.toggleModifiers),
          ]),
          el('div', { className: 'choices' }, [toggle('Sound', s.sound, cb.toggleSound), toggle('Music', s.music, cb.toggleMusic)]),
        ]),
      ]),
    );
  }
}

export type OverlayMode = 'hidden' | 'playing' | 'paused' | 'over';

export interface MatchOverlayCallbacks {
  onPause(): void;
  onResume(): void;
  onQuit(): void;
  onRematch(): void;
}

// The controls and buttons over the arena during a phone-only match.
export class MatchOverlay {
  readonly controls: TouchControls;
  private root: HTMLElement;
  private pad: HTMLElement;
  private actions: HTMLElement;
  private mode: OverlayMode = 'hidden';

  constructor(
    state: TouchState,
    color: string,
    private callbacks: MatchOverlayCallbacks,
  ) {
    document.head.append(el('style', { textContent: touchCss('#touch') }));
    this.controls = new TouchControls(state, color, () => {});
    const pause = el('button', { type: 'button', className: 'pause', textContent: '❚❚', ariaLabel: 'Pause' });
    pause.addEventListener('click', () => callbacks.onPause());
    this.pad = el('div', { className: 'pad' }, [this.controls.zone, this.controls.buttons, pause]);
    this.actions = el('div', { className: 'actions' });
    this.root = el('div', { id: 'touch', hidden: true }, [
      this.pad,
      this.actions,
      el('div', { className: 'rotate' }, [el('div', { className: 'rotate-icon', textContent: '📱↻' }), el('p', { textContent: 'Turn your phone sideways to play' })]),
    ]);
    this.root.style.setProperty('--player', color);
    document.body.append(this.root);
  }

  // Called every frame; only touches the page when the mode changes.
  setMode(mode: OverlayMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.root.hidden = mode === 'hidden';
    this.pad.hidden = mode !== 'playing';
    if (mode !== 'playing') this.controls.release();
    const button = (text: string, fn: () => void, className = '') => {
      const b = el('button', { type: 'button', className, textContent: text });
      b.addEventListener('click', fn);
      return b;
    };
    const cb = this.callbacks;
    this.actions.replaceChildren(
      ...(mode === 'paused'
        ? [button('Resume ▶', cb.onResume, 'primary'), button('Quit', cb.onQuit)]
        : mode === 'over'
          ? [button('Rematch ▶', cb.onRematch, 'primary'), button('Menu', cb.onQuit)]
          : []),
    );
  }
}

// Phone-only play is for touch-only devices (a laptop with a touch screen
// still has a keyboard). `?mobile` turns it on anywhere, for testing.
export function isTouchOnly(): boolean {
  if (new URLSearchParams(location.search).has('mobile')) return true;
  return matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
}
