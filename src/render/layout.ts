// Where things go on screen during a match: the arena, scaled to fit between
// the players' status columns (or the whole width on a phone), and the HUD.

import type { Vec2 } from '../sim/vec';

const HUD_HEIGHT = 64;
const MARGIN = 24;
// Each player's status sits in a column beside the arena. The arena leaves at
// least this much room; on wide screens the columns take whatever is spare.
const SIDE_MIN = 150;
const SIDE_MAX = 260;
const SIDE_GAP = 16;
// Phone-only play: a slim HUD along the top and the arena filling the rest.
export const COMPACT_HUD = 34;
const COMPACT_MARGIN = 6;
// Overlay text is sized for this window height and shrinks on shorter ones.
const COMPACT_UI_HEIGHT = 560;

export interface ArenaLayout {
  scale: number; // pixels per unit
  origin: Vec2; // the arena's top-left corner on screen
  sideW: number; // width of each player's status column (none when compact)
}

// Where the arena goes in a window. Normally it sits between the two
// players' status columns; compact (phone-only) gives it the whole width.
export function arenaLayout(width: number, height: number, arena: { width: number; height: number }, compact: boolean): ArenaLayout {
  const { width: aw, height: ah } = arena;
  if (compact) {
    const availW = width - COMPACT_MARGIN * 2;
    const availH = height - COMPACT_HUD - COMPACT_MARGIN * 2;
    const scale = Math.max(4, Math.min(availW / aw, availH / ah));
    return {
      scale,
      origin: { x: (width - aw * scale) / 2, y: COMPACT_HUD + COMPACT_MARGIN + (availH - ah * scale) / 2 },
      sideW: 0,
    };
  }
  const availW = width - (SIDE_MIN + SIDE_GAP * 2) * 2;
  const availH = height - HUD_HEIGHT - MARGIN * 2;
  const scale = Math.max(4, Math.min(availW / aw, availH / ah));
  const origin = { x: (width - aw * scale) / 2, y: HUD_HEIGHT + MARGIN + (availH - ah * scale) / 2 };
  return { scale, origin, sideW: Math.max(SIDE_MIN * 0.75, Math.min(SIDE_MAX, origin.x - SIDE_GAP * 2)) };
}

// Everything the match drawing needs to know about the screen and players.
export interface MatchView extends ArenaLayout {
  width: number; // window size in CSS pixels
  height: number;
  compact: boolean; // phone-only play: slim HUD, arena as big as the screen allows
  looks: readonly [string, string];
  names: readonly [string, string];
}

export function toScreen(view: MatchView, p: Vec2): Vec2 {
  return { x: view.origin.x + p.x * view.scale, y: view.origin.y + p.y * view.scale };
}

// How much to shrink overlay text: 1 except on a short phone screen.
export function uiScale(view: MatchView): number {
  return view.compact ? Math.min(1, view.height / COMPACT_UI_HEIGHT) : 1;
}
