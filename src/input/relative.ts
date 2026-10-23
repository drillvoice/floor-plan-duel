import type { PlayerInput } from '../sim/types';
import { rightOf, type Vec2 } from '../sim/vec';

// In the first-person view the keys and joystick are relative to where the
// camera looks: up walks forward, right strafes right. This turns such an
// input into the world directions the sim expects. Dodge follows `move`, so
// dodges go the way the keys say too.
export function cameraRelative(input: PlayerInput, forward: Vec2): PlayerInput {
  const ahead = -input.move.y;
  const side = input.move.x;
  const right = rightOf(forward);
  return {
    ...input,
    move: { x: forward.x * ahead + right.x * side, y: forward.y * ahead + right.y * side },
  };
}
