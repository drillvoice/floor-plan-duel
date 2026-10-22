// Text over the whole match: the countdown (with the round-modifier reel),
// round and match results, pause, and the sudden-death banner.

import { MODIFIER_IDS } from '../config';
import { MODIFIERS } from '../sim/modifiers';
import type { GameState, PlayerIndex } from '../sim/types';
import { uiScale, type MatchView } from './layout';
import { COLORS, hexAlpha, MODIFIER_COLOR, NEAR_MISS_COLOR, TIMER_RED } from './theme';

// The round-modifier reel spins through names, slowing down, and lands on
// the round's modifier. These are the times (s into the countdown) at which
// it moves on to the next name; the last one is where it lands.
const REEL_STEPS: number[] = (() => {
  const times: number[] = [];
  let t = 0;
  for (let gap = 0.05; t < 1.3; gap *= 1.17) times.push((t += gap));
  return times;
})();

// Where the reel is `t` seconds into the countdown: how many names it has
// moved through, and whether it has landed.
export function modifierReel(t: number): { step: number; landed: boolean } {
  let step = 0;
  while (step < REEL_STEPS.length && t >= REEL_STEPS[step]) step++;
  return { step, landed: step === REEL_STEPS.length };
}

// What the overlay says under the title when paused or the match is over.
export interface OverlayHints {
  paused: string;
  matchOver: string;
}

// `banner` is the seconds left on the sudden-death banner (0 = none).
export function drawSuddenDeathBanner(ctx: CanvasRenderingContext2D, view: MatchView, state: GameState, banner: number): void {
  if (banner <= 0 || state.phase !== 'playing') return;
  const a = Math.min(1, banner / 0.5);
  const u = uiScale(view);
  ctx.fillStyle = `rgba(10,11,15,${0.6 * a})`;
  ctx.fillRect(0, view.height / 2 - 60 * u, view.width, 124 * u);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = hexAlpha(TIMER_RED, a);
  ctx.font = `900 ${64 * u}px system-ui, sans-serif`;
  ctx.fillText('SUDDEN DEATH', view.width / 2, view.height / 2 - 10 * u);
  ctx.fillStyle = `rgba(242,239,232,${a})`;
  ctx.font = `600 ${20 * u}px system-ui, sans-serif`;
  ctx.fillText(`Bullets speed up every ${state.cfg.round.suddenDeathInterval} seconds`, view.width / 2, view.height / 2 + 36 * u);
}

const label = (view: MatchView, i: PlayerIndex) => `${view.looks[i]} ${view.names[i]}`.trim();

export function drawOverlay(ctx: CanvasRenderingContext2D, view: MatchView, state: GameState, paused: boolean, hints: OverlayHints): void {
  let title = '';
  let sub = '';
  if (paused) {
    title = 'Paused';
    sub = hints.paused;
  } else if (state.phase === 'countdown' && state.modifier) {
    drawModifierReel(ctx, view, state);
    return;
  } else if (state.phase === 'countdown') {
    title = `Round ${state.roundIndex + 1}`;
    sub = state.arenas.length > 1 ? `${state.arena.name}  ·  Get ready` : 'Get ready';
  } else if (state.phase === 'roundOver') {
    const w = state.lastRoundWinner;
    title = w === null ? 'Draw' : `${label(view, w)} takes the round`;
    sub = w === null ? 'Replaying the round' : '';
  } else if (state.phase === 'matchOver' && state.matchWinner !== null) {
    title = `${label(view, state.matchWinner)} wins!`;
    sub = hints.matchOver;
  } else return;

  ctx.fillStyle = 'rgba(10,11,15,0.55)';
  ctx.fillRect(0, 0, view.width, view.height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const winner = state.phase === 'matchOver' ? state.matchWinner : state.phase === 'roundOver' ? state.lastRoundWinner : null;
  ctx.fillStyle = winner !== null && !paused ? COLORS.players[winner] : COLORS.text;
  const u = uiScale(view);
  // On a phone the buttons go under the text, so lift it.
  const cy = view.height / 2 - (view.compact ? 40 * u : 0);
  ctx.font = `800 ${52 * u}px system-ui, sans-serif`;
  ctx.fillText(title, view.width / 2, cy - 16 * u);
  ctx.fillStyle = COLORS.text;
  ctx.font = `500 ${18 * u}px system-ui, sans-serif`;
  ctx.fillText(sub, view.width / 2, cy + 32 * u);
  if (state.phase === 'matchOver' && !paused) {
    const [a, b] = state.players.map((p) => p.nearMisses);
    ctx.fillStyle = NEAR_MISS_COLOR;
    ctx.font = `600 ${16 * u}px system-ui, sans-serif`;
    ctx.fillText(`Clutch dodges: ${view.names[0]} ${a} · ${view.names[1]} ${b}`, view.width / 2, cy + (sub ? 68 : 36) * u);
  }
}

// Countdown with a modifier: a slot-machine reel of modifier names that
// slows down and lands on this round's, then says what it does.
function drawModifierReel(ctx: CanvasRenderingContext2D, view: MatchView, state: GameState): void {
  const id = state.modifier!;
  const { step, landed } = modifierReel(state.phaseTime);
  // Count back from the landing so the last name shown is the real one.
  const order = MODIFIER_IDS;
  const at = order.indexOf(id) - (REEL_STEPS.length - step);
  const shown = order[((at % order.length) + order.length) % order.length];
  const cx = view.width / 2;
  const cy = view.height / 2;
  ctx.fillStyle = 'rgba(10,11,15,0.6)';
  ctx.fillRect(0, 0, view.width, view.height);
  // Shrunk as a whole on a short phone screen.
  const u = uiScale(view);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(u, u);
  ctx.translate(-cx, -cy);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COLORS.text;
  ctx.font = '800 28px system-ui, sans-serif';
  ctx.fillText(`Round ${state.roundIndex + 1}`, cx, cy - 110);
  if (state.arenas.length > 1) {
    ctx.fillStyle = COLORS.muted;
    ctx.font = '600 16px system-ui, sans-serif';
    ctx.fillText(state.arena.name, cx, cy - 80);
  }

  // The reel window.
  const w = Math.min(560, (view.width - 40) / u);
  const h = 96;
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.strokeStyle = landed ? MODIFIER_COLOR : 'rgba(255,255,255,0.3)';
  ctx.lineWidth = landed ? 4 : 2;
  ctx.beginPath();
  ctx.roundRect(cx - w / 2, cy - h / 2 - 10, w, h, 14);
  ctx.fill();
  ctx.stroke();
  ctx.clip();
  // Between steps each name drifts up through the window and fades; once
  // landed it pops.
  const prev = step === 0 ? 0 : REEL_STEPS[step - 1];
  const next = REEL_STEPS[step] ?? prev;
  const slide = landed ? 0.5 : (state.phaseTime - prev) / Math.max(0.001, next - prev);
  const sinceLand = state.phaseTime - REEL_STEPS[REEL_STEPS.length - 1];
  const pop = landed ? 1 + 0.25 * Math.max(0, 1 - sinceLand / 0.2) : 1;
  ctx.translate(cx, cy - 10 + (0.5 - slide) * h * 0.4);
  ctx.scale(pop, pop);
  ctx.globalAlpha = landed ? 1 : 1 - Math.abs(slide - 0.5);
  ctx.fillStyle = landed ? MODIFIER_COLOR : COLORS.text;
  ctx.font = '900 48px system-ui, sans-serif';
  ctx.fillText(MODIFIERS[shown].name, 0, 0);
  ctx.restore();

  if (landed) {
    const a = Math.min(1, sinceLand / 0.25);
    ctx.fillStyle = hexAlpha(COLORS.text, a);
    ctx.font = '600 22px system-ui, sans-serif';
    ctx.fillText(MODIFIERS[id].blurb, cx, cy + 70);
    ctx.fillStyle = hexAlpha(COLORS.muted, a);
    ctx.font = '500 16px system-ui, sans-serif';
    ctx.fillText('Get ready', cx, cy + 104);
  }
  ctx.restore();
}
