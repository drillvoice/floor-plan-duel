import type { GameState, PlayerIndex, PlayerInput } from '../sim/types';

// Anything that can drive a player: keyboard, touch, a phone controller, bot.
// Called once per simulation tick.
export interface InputSource {
  readonly kind: 'human' | 'bot';
  sample(state: GameState, player: PlayerIndex): PlayerInput;
}
