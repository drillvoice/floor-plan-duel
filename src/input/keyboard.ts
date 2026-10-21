import { KEY_BINDINGS, type PlayerKeys } from '../config';
import type { PlayerInput } from '../sim/types';
import type { InputSource } from './types';

const BOUND_CODES = new Set<string>([
  ...Object.values(KEY_BINDINGS.p1),
  ...Object.values(KEY_BINDINGS.p2),
  KEY_BINDINGS.pause,
]);

// Tracks the whole keyboard. Bound keys have their browser defaults blocked
// (arrow keys scroll, "/" opens quick find in Firefox).
export class Keyboard {
  private held = new Set<string>();
  private pressed = new Set<string>();
  private listeners: ((code: string) => void)[] = [];

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (BOUND_CODES.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.held.add(e.code);
      this.pressed.add(e.code);
      for (const l of this.listeners) l(e.code);
    });
    target.addEventListener('keyup', (e) => {
      if (BOUND_CODES.has(e.code)) e.preventDefault();
      this.held.delete(e.code);
    });
    // Keys released while the window is unfocused never send keyup.
    target.addEventListener('blur', () => this.clear());
  }

  isHeld(code: string): boolean {
    return this.held.has(code);
  }

  // True once per physical press, so a held dodge key doesn't repeat.
  consumePress(code: string): boolean {
    const was = this.pressed.has(code);
    this.pressed.delete(code);
    return was;
  }

  onPress(listener: (code: string) => void): void {
    this.listeners.push(listener);
  }

  clear(): void {
    this.held.clear();
    this.pressed.clear();
  }
}

export class KeyboardPlayer implements InputSource {
  readonly kind = 'human';

  constructor(
    private keyboard: Keyboard,
    readonly keys: PlayerKeys,
  ) {}

  sample(): PlayerInput {
    const k = this.keyboard;
    const keys = this.keys;
    return {
      move: {
        x: (k.isHeld(keys.right) ? 1 : 0) - (k.isHeld(keys.left) ? 1 : 0),
        y: (k.isHeld(keys.down) ? 1 : 0) - (k.isHeld(keys.up) ? 1 : 0),
      },
      // A press counts until it's used, so a tap between ticks isn't lost.
      dodgeLeft: k.consumePress(keys.dodgeLeft),
      dodgeRight: k.consumePress(keys.dodgeRight),
      shoot: k.isHeld(keys.shoot) || k.consumePress(keys.shoot),
    };
  }
}
