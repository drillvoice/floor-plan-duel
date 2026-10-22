// How each player looks: a plain coloured circle, or an icon inside it.
// A look is just a string id so it's easy to save; photos of faces could be
// added later as another kind of look drawn the same way.

import { readJsonPref, writeJsonPref } from '../prefs';

export const LOOKS = ['', '🐱', '🐶', '🦊', '🐼', '🐸', '🐵', '🐧', '🐙', '🦄', '🐯', '🐷', '🐻', '🤖', '👽', '👻', '🎃'];

const LOOKS_KEY = 'fpd.looks';
const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

export function cycleLook(current: string, step: 1 | -1 = 1): string {
  const i = Math.max(0, LOOKS.indexOf(current));
  return LOOKS[(i + step + LOOKS.length) % LOOKS.length];
}

// Draws the look inside a player circle of radius r already filled with the
// player's colour. A plain look draws nothing.
export function drawLook(ctx: CanvasRenderingContext2D, look: string, x: number, y: number, r: number): void {
  if (!look) return;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.round(r * 1.45)}px ${EMOJI_FONT}`;
  // Emoji sit slightly high on the middle baseline in most fonts.
  ctx.fillText(look, x, y + r * 0.1);
  ctx.restore();
}

export function loadLooks(): [string, string] {
  const saved = readJsonPref(LOOKS_KEY);
  if (Array.isArray(saved) && saved.length === 2 && saved.every((l) => LOOKS.includes(l))) return saved as [string, string];
  return ['🐱', '🐶'];
}

export function saveLooks(looks: [string, string]): void {
  writeJsonPref(LOOKS_KEY, looks);
}
