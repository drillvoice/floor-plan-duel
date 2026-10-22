// The keyboard title screen: settings, the map, and each player's keys with
// a live key test, so keyboard ghosting shows up before a match.

import { KEY_BINDINGS, type PlayerKeys } from '../config';
import type { PlayerIndex } from '../sim/types';
import { drawLook } from './looks';
import { COLORS, MODIFIER_COLOR } from './theme';

const PLAYER_NAMES = ['P1', 'P2'] as const;
// Smallest window the title screen fits at full size.
const TITLE_MIN_H = 540;
const TITLE_MIN_W = 820;

// Title screen with a live key test, so ghosting shows up before a match.
export function drawTitle(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  looks: readonly [string, string],
  isHeld: (code: string) => boolean,
  slots: readonly string[],
  mapName: string,
  mapCount: number,
  modifiers: boolean,
  rotation: boolean,
): void {
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, width, height);
  // Sections flow down the page so they never overlap, spreading out on
  // tall windows. A window too small for them shrinks the whole screen.
  const s = Math.min(1, height / TITLE_MIN_H, width / TITLE_MIN_W);
  const w = width / s;
  const h = height / s;
  ctx.save();
  ctx.scale(s, s);
  const cx = w / 2;
  const footer = h - 30;
  const head = Math.max(50, Math.min(h * 0.2, footer - 460));
  const top = Math.max(head + 190, Math.min(h * 0.42, footer - 270));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COLORS.text;
  ctx.font = '800 56px system-ui, sans-serif';
  ctx.fillText('Floor Plan Duel', cx, head);
  ctx.font = '500 20px system-ui, sans-serif';
  ctx.fillStyle = COLORS.muted;
  ctx.fillText('Press Enter to start  ·  B for full screen  ·  M to mute  ·  N for music', cx, head + 52);
  ctx.fillStyle = COLORS.text;
  ctx.font = '600 17px system-ui, sans-serif';
  ctx.fillText(rotation ? `Maps: ${mapName}, then a new one each round` : `Map: ${mapName}`, cx, head + 92);
  ctx.fillStyle = COLORS.muted;
  ctx.font = '400 13px system-ui, sans-serif';
  ctx.fillText(
    `${mapCount > 1 ? 'Tab to change map  ·  ' : ''}E to open the map editor  ·  H for hotseat  ·  P to use phones as controllers`,
    cx,
    head + 114,
  );
  ctx.fillStyle = modifiers ? MODIFIER_COLOR : COLORS.muted;
  ctx.font = '600 13px system-ui, sans-serif';
  ctx.fillText(`Round modifiers: ${modifiers ? 'ON' : 'OFF'}  (R to change)`, cx, head + 138);
  ctx.fillStyle = rotation ? COLORS.text : COLORS.muted;
  ctx.fillText(`Map rotation: ${rotation ? 'ON' : 'OFF'}  (T to change)`, cx, head + 158);

  const colW = Math.min(360, w / 2 - 20);
  drawKeyPanel(ctx, looks, KEY_BINDINGS.p1, 0, cx - colW / 2 - 10, top, isHeld, slots[0]);
  drawKeyPanel(ctx, looks, KEY_BINDINGS.p2, 1, cx + colW / 2 + 10, top, isHeld, slots[1]);

  ctx.font = '400 14px system-ui, sans-serif';
  ctx.fillStyle = COLORS.muted;
  ctx.textAlign = 'center';
  ctx.fillText(
    'Key test: hold every key you would use together. If a key fails to light up, your keyboard is ghosting.',
    cx,
    footer,
  );
  // A tap opens the phone menu (see game.ts), for phones that land here.
  if (navigator.maxTouchPoints > 0) {
    ctx.fillStyle = COLORS.players[0];
    ctx.font = '700 15px system-ui, sans-serif';
    ctx.fillText('On a phone? Tap anywhere to play on it.', cx, footer - 26);
  }
  ctx.restore();
}

function drawKeyPanel(
  ctx: CanvasRenderingContext2D,
  looks: readonly [string, string],
  keys: PlayerKeys,
  i: PlayerIndex,
  cx: number,
  top: number,
  isHeld: (code: string) => boolean,
  slot: string,
): void {
  ctx.fillStyle = COLORS.players[i];
  ctx.font = '700 22px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(PLAYER_NAMES[i], cx + 16, top);
  // Look preview, cycled with this player's dodge keys.
  ctx.beginPath();
  ctx.arc(cx - 24, top, 20, 0, Math.PI * 2);
  ctx.fill();
  drawLook(ctx, looks[i], cx - 24, top, 20);
  // A slot is 'human', a bot difficulty, or a phone's label ("📱 Name").
  const phone = slot.startsWith('📱');
  const who = phone ? slot : slot === 'human' ? 'Human' : `Bot · ${slot[0].toUpperCase()}${slot.slice(1)}`;
  ctx.fillStyle = COLORS.text;
  ctx.font = '600 16px system-ui, sans-serif';
  ctx.fillText(who, cx, top + 190);
  ctx.fillStyle = COLORS.muted;
  ctx.font = '400 13px system-ui, sans-serif';
  if (phone) {
    ctx.fillText('playing on a phone', cx, top + 212);
    ctx.fillText('the phone picks the look', cx, top + 232);
  } else {
    ctx.fillText(`press ${i + 1} to change`, cx, top + 212);
    ctx.fillText('dodge key changes your look', cx, top + 232);
  }
  if (slot !== 'human') ctx.globalAlpha = 0.3;
  const k = 42;
  const gap = 6;
  const cap = (code: string, x: number, y: number, caption?: string) => {
    const held = isHeld(code);
    ctx.fillStyle = held ? COLORS.players[i] : 'rgba(255,255,255,0.08)';
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x - k / 2, y - k / 2, k, k, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = held ? '#111' : COLORS.text;
    ctx.font = '600 16px system-ui, sans-serif';
    ctx.fillText(keyLabel(code), x, y + 1);
    if (caption) {
      ctx.fillStyle = COLORS.muted;
      ctx.font = '400 12px system-ui, sans-serif';
      ctx.fillText(caption, x, y + k / 2 + 12);
    }
  };
  const moveX = cx - 80;
  const y0 = top + 50;
  cap(keys.up, moveX, y0);
  cap(keys.left, moveX - k - gap, y0 + k + gap);
  cap(keys.down, moveX, y0 + k + gap);
  cap(keys.right, moveX + k + gap, y0 + k + gap);
  ctx.fillStyle = COLORS.muted;
  ctx.font = '400 12px system-ui, sans-serif';
  ctx.fillText('move', moveX, y0 + 2 * k + gap + 12);
  const ax = cx + 40;
  const step = k + 18;
  // In keyboard order: shoot is under the index finger, so it's on the
  // left for P1 (F G) and on the right for P2 (. /).
  const shootFirst = i === 0;
  cap(keys.shoot, ax + step * (shootFirst ? 0.5 : 1.5), y0 + k + gap, 'shoot');
  cap(keys.dodge, ax + step * (shootFirst ? 1.5 : 0.5), y0 + k + gap, 'dodge');
  ctx.globalAlpha = 1;
}

function keyLabel(code: string): string {
  const named: Record<string, string> = {
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Comma: ',',
    Period: '.',
    Slash: '/',
  };
  if (named[code]) return named[code];
  if (code.startsWith('Key')) return code.slice(3);
  return code;
}
