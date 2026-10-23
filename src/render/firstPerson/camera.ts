// Each player's first-person camera. It sits on the player and turns to face
// the opponent (the sim's `facing`), smoothed so a dash past you doesn't snap
// the view round. View-only state, like the renderer's shake and trails: the
// game reads it to turn keys into world directions, but the sim never sees it.

import type { GameState, PlayerIndex } from '../../sim/types';
import type { Vec2 } from '../../sim/vec';
import type { Camera } from './project';

export class FirstPersonCamera implements Camera {
  pos: Vec2 = { x: 0, y: 0 };
  private angle = 0;
  private placed = false;

  get forward(): Vec2 {
    return { x: Math.cos(this.angle), y: Math.sin(this.angle) };
  }

  // Follow the player for `dt` seconds of real time. Before a round starts
  // the camera snaps, so each round opens already facing the opponent.
  update(state: GameState, player: PlayerIndex, dt: number): void {
    const p = state.players[player];
    this.pos = { ...p.pos };
    const target = Math.atan2(p.facing.y, p.facing.x);
    if (!this.placed || state.phase === 'countdown') {
      this.angle = target;
      this.placed = true;
      return;
    }
    this.angle = turnToward(this.angle, target, 1 - Math.exp(-state.cfg.firstPerson.turnRate * dt));
  }
}

// Turn `angle` the fraction `t` of the way to `target`, the short way round.
export function turnToward(angle: number, target: number, t: number): number {
  let d = (target - angle) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return angle + d * t;
}
