// The match HUD: the round timer and each player's status (look, name,
// health, round wins, active power-ups). Beside the arena normally; one slim
// row along the top in phone-only play.

import { POWER_UP_KINDS, type Config } from '../config';
import { MODIFIERS } from '../sim/modifiers';
import { STACKING } from '../sim/powerups';
import { suddenDeathMultiplier } from '../sim/step';
import { POWER_UP_CATEGORY, type GameState, type PlayerIndex, type PowerUpKind } from '../sim/types';
import { CATEGORY_COLORS, drawPowerUpGlyph } from './icons';
import { COMPACT_HUD, type MatchView } from './layout';
import { drawLook } from './looks';
import { COLORS, MODIFIER_COLOR, TIMER_AMBER, TIMER_RED } from './theme';

// Short power-up names for the side columns. Curses are named as the
// player carrying them feels them.
const HUD_NAMES: Record<PowerUpKind, string> = {
  swiftShot: 'Fast bullets',
  longShot: 'Long range',
  triggerHappy: 'Fire rate',
  fleetFoot: 'Speed',
  spareDodge: 'Extra dodge',
  shield: 'Shield',
  rapidFire: 'Rapid fire',
  bouncer: 'Bouncy',
  ghost: 'Ghost',
  leadShot: 'Sharpshooter',
  laser: 'Laser',
  molasses: 'Slowed',
  topsyTurvy: 'Flipped',
  bigTarget: 'Big target',
};

export function drawHud(ctx: CanvasRenderingContext2D, view: MatchView, state: GameState): void {
  if (view.compact) {
    drawCompactHud(ctx, view, state);
    return;
  }
  ctx.textBaseline = 'middle';
  for (const i of [0, 1] as const) drawSidePanel(ctx, view, state, i);

  const { left, sudden, color } = drawTimerBar(ctx, view, state, 14, 6);
  ctx.textAlign = 'center';
  ctx.fillStyle = color;
  ctx.font = '800 30px system-ui, sans-serif';
  const label = sudden ? `SUDDEN DEATH ×${suddenDeathMultiplier(state).toFixed(2)}` : `${Math.ceil(left)}`;
  ctx.fillText(label, view.width / 2, 24);
  ctx.font = '500 13px system-ui, sans-serif';
  ctx.fillStyle = COLORS.muted;
  if (state.modifier && state.phase !== 'countdown') {
    ctx.fillStyle = MODIFIER_COLOR;
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.fillText(`Round ${state.roundIndex + 1} · ${MODIFIERS[state.modifier].name}`, view.width / 2, 50);
  } else {
    ctx.fillText(`Round ${state.roundIndex + 1}`, view.width / 2, 50);
  }
}

// The round timer's bar, `gap` pixels above the arena: it shrinks and turns
// amber, then red, as time runs out, and pulses near the end. Returns the
// time left and the colour, for the number drawn with it.
function drawTimerBar(
  ctx: CanvasRenderingContext2D,
  view: MatchView,
  state: GameState,
  gap: number,
  thickness: number,
): { left: number; sudden: boolean; color: string } {
  const limit = state.cfg.round.timeLimit;
  const left = limit - state.roundTime;
  const sudden = left <= 0;
  const pulse = 0.55 + 0.45 * Math.abs(Math.sin(state.tick * 0.12));
  const color = sudden || left <= 10 ? TIMER_RED : left <= 30 ? TIMER_AMBER : COLORS.text;
  const barY = view.origin.y - gap;
  const barW = state.arena.width * view.scale;
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(view.origin.x, barY, barW, thickness);
  ctx.globalAlpha = sudden || left <= 10 ? pulse : 1;
  ctx.fillStyle = color;
  const frac = sudden ? 1 : Math.max(0, left / limit);
  ctx.fillRect(view.origin.x + (barW * (1 - frac)) / 2, barY, barW * frac, thickness);
  ctx.globalAlpha = 1;
  return { left, sudden, color };
}

// An active power-up's icon: its category colour, its glyph and, for a timed
// one, a ring that drains as it runs out.
function drawEffectIcon(
  ctx: CanvasRenderingContext2D,
  cfg: Config,
  kind: PowerUpKind,
  amount: number,
  x: number,
  y: number,
  r: number,
  ringGap: number,
  ringWidth: number,
): void {
  const color = CATEGORY_COLORS[POWER_UP_CATEGORY[kind]];
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  drawPowerUpGlyph(ctx, kind, x, y, r * 1.2);
  const duration = (cfg.powerUps[kind] as { duration?: number }).duration;
  if (!STACKING.has(kind) && duration) {
    ctx.strokeStyle = color;
    ctx.lineWidth = ringWidth;
    ctx.beginPath();
    ctx.arc(x, y, r + ringGap, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, amount / duration));
    ctx.stroke();
  }
}

// Phone-only HUD: one slim row along the top. The timer sits in the
// middle; each player's look, name, health, round wins and power-ups run
// outwards from it, P2's mirroring P1's.
function drawCompactHud(ctx: CanvasRenderingContext2D, view: MatchView, state: GameState): void {
  const cfg = state.cfg;
  const cx = view.width / 2;
  const mid = COMPACT_HUD / 2 + 1;
  ctx.textBaseline = 'middle';

  const { left, sudden, color } = drawTimerBar(ctx, view, state, 4, 3);
  ctx.textAlign = 'center';
  ctx.fillStyle = color;
  ctx.font = '800 18px system-ui, sans-serif';
  ctx.fillText(sudden ? `SUDDEN ×${suddenDeathMultiplier(state).toFixed(2)}` : `${Math.ceil(left)}`, cx, 12);
  const modifier = state.modifier && state.phase !== 'countdown' ? MODIFIERS[state.modifier].name : '';
  ctx.fillStyle = modifier ? MODIFIER_COLOR : COLORS.muted;
  ctx.font = `${modifier ? 700 : 500} 10px system-ui, sans-serif`;
  const roundLabel = modifier ? `Round ${state.roundIndex + 1} · ${modifier}` : `Round ${state.roundIndex + 1}`;
  ctx.fillText(roundLabel, cx, 28);
  const centreHalf = Math.max(48, ctx.measureText(roundLabel).width / 2 + 10);

  for (const i of [0, 1] as const) {
    const p = state.players[i];
    const dir = i === 0 ? -1 : 1;
    let x = cx + dir * centreHalf;
    // Claims the next `w` pixels outwards and returns their centre.
    const next = (w: number, gap = 8) => {
      const c = x + (dir * w) / 2;
      x += dir * (w + gap);
      return c;
    };

    const wins = cfg.round.roundsToWin;
    const winR = 4;
    const winsW = wins * winR * 2 + (wins - 1) * 4;
    // Won rounds fill in from the middle of the HUD outwards.
    const winsInner = next(winsW) - (dir * winsW) / 2;
    ctx.strokeStyle = COLORS.text;
    ctx.fillStyle = COLORS.text;
    ctx.lineWidth = 1.5;
    for (let n = 0; n < wins; n++) {
      const wx = winsInner + dir * (winR + n * (winR * 2 + 4));
      ctx.beginPath();
      ctx.arc(wx, mid, winR, 0, Math.PI * 2);
      if (n < p.roundWins) ctx.fill();
      else ctx.stroke();
    }

    const hits = cfg.round.hitsToLose;
    const pipD = 12;
    const pipsW = hits * pipD + (hits - 1) * 4;
    const pipsX = next(pipsW);
    for (let h = 0; h < hits; h++) {
      const alive = h < hits - p.hits;
      const px = pipsX - pipsW / 2 + pipD / 2 + h * (pipD + 4);
      ctx.beginPath();
      ctx.arc(px, mid, pipD / 2 - 1, 0, Math.PI * 2);
      if (alive) {
        ctx.fillStyle = COLORS.players[i];
        ctx.fill();
      } else {
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    const name = view.names[i];
    let size = 14;
    ctx.font = `800 ${size}px system-ui, sans-serif`;
    const nameW = Math.min(90, ctx.measureText(name).width);
    size *= nameW / Math.max(1, ctx.measureText(name).width);
    ctx.font = `800 ${size}px system-ui, sans-serif`;
    ctx.fillStyle = COLORS.players[i];
    ctx.textAlign = 'center';
    ctx.fillText(name, next(nameW, 6), mid);

    const r = 11;
    const lookX = next(r * 2, 10);
    ctx.fillStyle = COLORS.players[i];
    ctx.beginPath();
    ctx.arc(lookX, mid, r, 0, Math.PI * 2);
    ctx.fill();
    if (view.looks[i]) drawLook(ctx, view.looks[i], lookX, mid, r);

    // Active power-ups, as far as the screen edge allows. Timed ones drain
    // a ring; stacks show a count.
    const iconR = 9;
    for (const kind of POWER_UP_KINDS) {
      const amount = p.effects[kind];
      if (amount <= 0) continue;
      if (dir < 0 ? x - iconR * 2 < 4 : x + iconR * 2 > view.width - 4) break;
      const ix = next(iconR * 2, 7);
      drawEffectIcon(ctx, cfg, kind, amount, ix, mid, iconR, 3, 2);
      if (STACKING.has(kind) && amount > 1) {
        ctx.fillStyle = COLORS.text;
        ctx.font = '800 9px system-ui, sans-serif';
        ctx.fillText(`×${amount}`, ix + iconR * 0.8, mid + iconR);
      }
    }
  }
}

// One player's status in the column beside the arena, sized to read at a
// glance: name, health, round wins, then active power-ups. P2's column is
// a mirror image of P1's.
function drawSidePanel(ctx: CanvasRenderingContext2D, view: MatchView, state: GameState, i: PlayerIndex): void {
  const cfg = state.cfg;
  const p = state.players[i];
  const left = i === 0;
  const dir = left ? 1 : -1;
  const w = view.sideW;
  const cx = left ? view.origin.x / 2 : view.width - view.origin.x / 2;
  const outer = cx - (dir * w) / 2;
  const u = Math.min(1.8, w / 140);
  let y = view.origin.y;

  // Look and name, shrunk to fit long hotseat names.
  const r = 22 * u;
  ctx.fillStyle = COLORS.players[i];
  ctx.beginPath();
  ctx.arc(cx, y + r, r, 0, Math.PI * 2);
  ctx.fill();
  if (view.looks[i]) drawLook(ctx, view.looks[i], cx, y + r, r);
  y += r * 2 + 22 * u;
  const name = view.names[i];
  let size = 30 * u;
  ctx.font = `800 ${size}px system-ui, sans-serif`;
  const nameW = ctx.measureText(name).width;
  if (nameW > w) size *= w / nameW;
  ctx.font = `800 ${size}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(name, cx, y);
  y += 30 * u;

  // Health: big pips, lost ones hollow.
  const hits = cfg.round.hitsToLose;
  const pipGap = 8 * u;
  const pipD = Math.min(36 * u, (w - pipGap * (hits - 1)) / hits);
  const rowW = hits * pipD + (hits - 1) * pipGap;
  for (let h = 0; h < hits; h++) {
    const alive = h < hits - p.hits;
    const px = cx - rowW / 2 + pipD / 2 + h * (pipD + pipGap);
    ctx.beginPath();
    ctx.arc(px, y + pipD / 2, pipD / 2 - 1.5, 0, Math.PI * 2);
    if (alive) {
      ctx.fillStyle = COLORS.players[i];
      ctx.fill();
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }
  y += pipD + 22 * u;

  // Round wins.
  const wins = cfg.round.roundsToWin;
  const winR = 8 * u;
  const winGap = 10 * u;
  const winsW = wins * winR * 2 + (wins - 1) * winGap;
  ctx.strokeStyle = COLORS.text;
  ctx.fillStyle = COLORS.text;
  ctx.lineWidth = 2;
  for (let n = 0; n < wins; n++) {
    ctx.beginPath();
    ctx.arc(cx - winsW / 2 + winR + n * (winR * 2 + winGap), y, winR, 0, Math.PI * 2);
    if (n < p.roundWins) ctx.fill();
    else ctx.stroke();
  }
  y += winR + 12 * u;
  ctx.fillStyle = COLORS.muted;
  ctx.font = `500 ${12 * u}px system-ui, sans-serif`;
  ctx.fillText('rounds', cx, y);
  y += 30 * u;

  // Active power-ups, one per row: icon at the outer edge, then stacks or
  // seconds left with the name beneath.
  const iconR = 17 * u;
  const rowH = iconR * 2 + 12 * u;
  const iconX = outer + dir * iconR;
  const textX = iconX + dir * (iconR + 10 * u);
  for (const kind of POWER_UP_KINDS) {
    const amount = p.effects[kind];
    if (amount <= 0) continue;
    if (y + rowH > view.height) break;
    const iy = y + iconR;
    drawEffectIcon(ctx, cfg, kind, amount, iconX, iy, iconR, 4 * u, 3 * u);
    ctx.textAlign = left ? 'left' : 'right';
    ctx.fillStyle = COLORS.text;
    ctx.font = `800 ${20 * u}px system-ui, sans-serif`;
    ctx.fillText(STACKING.has(kind) ? `×${amount}` : Number.isFinite(amount) ? `${Math.ceil(amount)}s` : '∞', textX, iy - 7 * u);
    ctx.fillStyle = COLORS.muted;
    ctx.font = `500 ${12 * u}px system-ui, sans-serif`;
    ctx.fillText(HUD_NAMES[kind], textX, iy + 11 * u);
    y += rowH;
  }
}
