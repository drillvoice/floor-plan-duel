// On-screen touch controls: a joystick that appears wherever the thumb lands
// on the left, and Dodge and Shoot buttons on the right. Used by the phone
// controller (which sends them to the big screen) and by phone-only play
// (which feeds them straight into the game).

import type { PlayerInput } from '../sim/types';
import { el } from '../screens/dom';
import type { InputSource } from './types';

// Joystick: how far the thumb travels, the dead zone in the middle, and
// how far out counts as full speed (so you don't have to push to the rim).
export const STICK_RADIUS = 56; // px
const DEAD_ZONE = 0.12;
const FULL_TILT = 0.75;

// What the controls are doing. One-off presses are counters that only go
// up, so a reader can tell a new press from one it has already acted on.
export interface TouchState {
  x: number; // joystick, -1..1 each way
  y: number;
  shoot: boolean; // held
  shots: number; // each press adds one
  dodges: number;
}

export function emptyTouchState(): TouchState {
  return { x: 0, y: 0, shoot: false, shots: 0, dodges: 0 };
}

export class TouchControls {
  // The left (joystick) and right (buttons) areas, for the page to lay out.
  readonly zone: HTMLElement;
  readonly buttons: HTMLElement;

  private stick: { pointer: number; ox: number; oy: number } | null = null;
  private shootPointer: number | null = null;
  private base: HTMLElement;
  private knob: HTMLElement;
  private shootBtn: HTMLButtonElement;

  // `state` is updated in place, so its counters carry on across rebuilds.
  constructor(
    readonly state: TouchState,
    color: string,
    private onChange: () => void,
  ) {
    const zone = el('div', { className: 'stick-zone' });
    const base = el('div', { className: 'stick-base' });
    const knob = el('div', { className: 'stick-knob' });
    this.base = base;
    this.knob = knob;
    base.append(knob);
    zone.append(base, el('div', { className: 'zone-label', textContent: 'move' }));
    const placeBase = (x: number, y: number) => {
      const r = zone.getBoundingClientRect();
      base.style.left = `${x - r.left}px`;
      base.style.top = `${y - r.top}px`;
    };
    zone.addEventListener('pointerdown', (e) => {
      if (this.stick) return;
      zone.setPointerCapture(e.pointerId);
      this.stick = { pointer: e.pointerId, ox: e.clientX, oy: e.clientY };
      placeBase(e.clientX, e.clientY);
      base.classList.add('active');
      this.setKnob(0, 0);
    });
    zone.addEventListener('pointermove', (e) => {
      const stick = this.stick;
      if (!stick || e.pointerId !== stick.pointer) return;
      let dx = e.clientX - stick.ox;
      let dy = e.clientY - stick.oy;
      const d = Math.hypot(dx, dy);
      if (d > STICK_RADIUS) {
        // Past the rim, the stick follows the thumb so reversing is instant.
        stick.ox += (dx * (d - STICK_RADIUS)) / d;
        stick.oy += (dy * (d - STICK_RADIUS)) / d;
        placeBase(stick.ox, stick.oy);
        dx = e.clientX - stick.ox;
        dy = e.clientY - stick.oy;
      }
      this.setKnob(dx, dy);
      const tilt = Math.min(1, Math.hypot(dx, dy) / STICK_RADIUS);
      const speed = tilt < DEAD_ZONE ? 0 : Math.min(1, (tilt - DEAD_ZONE) / (FULL_TILT - DEAD_ZONE));
      const len = Math.hypot(dx, dy) || 1;
      const nx = (dx / len) * speed;
      const ny = (dy / len) * speed;
      if (nx !== state.x || ny !== state.y) {
        state.x = nx;
        state.y = ny;
        this.onChange();
      }
    });
    const endStick = (e: PointerEvent) => {
      if (!this.stick || e.pointerId !== this.stick.pointer) return;
      this.endStick();
      this.onChange();
    };
    zone.addEventListener('pointerup', endStick);
    zone.addEventListener('pointercancel', endStick);

    const dodge = el('button', { className: 'btn dodge', type: 'button', textContent: 'Dodge' });
    dodge.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      state.dodges++;
      this.onChange();
      dodge.classList.add('down');
      navigator.vibrate?.(10);
    });
    const shoot = el('button', { className: 'btn shoot', type: 'button', textContent: 'Shoot' });
    this.shootBtn = shoot;
    shoot.style.background = color;
    shoot.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      shoot.setPointerCapture(e.pointerId);
      this.shootPointer = e.pointerId;
      state.shoot = true;
      state.shots++;
      this.onChange();
      shoot.classList.add('down');
    });
    const endShoot = (e: PointerEvent) => {
      if (e.pointerId !== this.shootPointer) return;
      this.endShoot();
      this.onChange();
    };
    shoot.addEventListener('pointerup', endShoot);
    shoot.addEventListener('pointercancel', endShoot);
    for (const t of ['pointerup', 'pointercancel', 'pointerleave'] as const) dodge.addEventListener(t, () => dodge.classList.remove('down'));

    this.zone = zone;
    this.buttons = el('div', { className: 'buttons' }, [dodge, shoot]);
  }

  // Lets go of everything, e.g. when the page is hidden mid-press.
  release(): void {
    this.endStick();
    this.endShoot();
  }

  private setKnob(dx: number, dy: number): void {
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  private endStick(): void {
    this.stick = null;
    this.base.classList.remove('active');
    this.base.style.left = '';
    this.base.style.top = '';
    this.setKnob(0, 0);
    this.state.x = 0;
    this.state.y = 0;
  }

  private endShoot(): void {
    this.shootPointer = null;
    this.state.shoot = false;
    this.shootBtn.classList.remove('down');
  }
}

// Drives a player from touch controls on this device.
export class TouchPlayer implements InputSource {
  readonly kind = 'human';
  private usedShots: number;
  private usedDodges: number;

  constructor(private state: TouchState) {
    this.usedShots = state.shots;
    this.usedDodges = state.dodges;
  }

  // Forget presses made before now, e.g. taps on the menu before a match.
  reset(): void {
    this.usedShots = this.state.shots;
    this.usedDodges = this.state.dodges;
  }

  sample(): PlayerInput {
    const s = this.state;
    const dodge = s.dodges > this.usedDodges;
    const tapped = s.shots > this.usedShots;
    this.usedDodges = s.dodges;
    this.usedShots = s.shots;
    // A tap counts even if press and release both landed between ticks.
    return { move: { x: s.x, y: s.y }, dodge, shoot: s.shoot || tapped };
  }
}

// Styles for the controls, under `scope` (the element that holds them).
export function touchCss(scope: string): string {
  return `
${scope} .stick-zone {
  position: relative;
  touch-action: none;
}
${scope} .zone-label {
  position: absolute;
  left: 50%;
  bottom: 14px;
  transform: translateX(-50%);
  color: #8b90a0;
  font-size: 13px;
  pointer-events: none;
}
${scope} .stick-base {
  position: absolute;
  left: 50%;
  top: 55%;
  width: ${STICK_RADIUS * 2}px;
  height: ${STICK_RADIUS * 2}px;
  margin: -${STICK_RADIUS}px 0 0 -${STICK_RADIUS}px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.04);
  opacity: 0.5;
  pointer-events: none;
}
${scope} .stick-base.active {
  opacity: 1;
}
${scope} .stick-knob {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 56px;
  height: 56px;
  margin: -28px 0 0 -28px;
  border-radius: 50%;
  background: var(--player);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.4);
}
${scope} .buttons {
  position: relative;
  touch-action: none;
}
${scope} .btn {
  position: absolute;
  border-radius: 50%;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  touch-action: none;
  padding: 0;
}
${scope} .btn.shoot {
  right: 8%;
  bottom: 14%;
  width: min(36vmin, 170px);
  height: min(36vmin, 170px);
  color: #16181f;
  font-size: 20px;
  border: none;
}
${scope} .btn.dodge {
  right: calc(8% + min(36vmin, 170px) + 4%);
  bottom: calc(14% + min(18vmin, 85px));
  width: min(26vmin, 120px);
  height: min(26vmin, 120px);
  font-size: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
}
@media (orientation: portrait) {
  ${scope} .btn.dodge {
    right: calc(8% + min(5vmin, 24px));
    bottom: calc(14% + min(36vmin, 170px) + 5vmin);
  }
}
${scope} .btn.down {
  transform: scale(0.92);
  filter: brightness(1.25);
}
`;
}
