import { POWER_UP_CATEGORY, type PowerUpCategory, type PowerUpKind } from '../sim/types';

export const CATEGORY_COLORS: Record<PowerUpCategory, string> = {
  upgrade: '#ffcc33', // gold: round-long
  buff: '#3d9bff', // blue: temporary
  curse: '#ff4d4d', // red: hits the opponent
};

export const powerUpColor = (kind: PowerUpKind): string => CATEGORY_COLORS[POWER_UP_CATEGORY[kind]];

// A small white glyph for each power-up, centred on (x, y), about `size` across.
export function drawPowerUpGlyph(ctx: CanvasRenderingContext2D, kind: PowerUpKind, x: number, y: number, size: number) {
  const s = size / 2;
  ctx.save();
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#ffffff';
  ctx.lineWidth = Math.max(1.5, size * 0.13);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  switch (kind) {
    case 'swiftShot':
      // Double chevron.
      for (const off of [-0.35, 0.25]) {
        ctx.moveTo(x + (off - 0.2) * s, y - 0.5 * s);
        ctx.lineTo(x + (off + 0.2) * s, y);
        ctx.lineTo(x + (off - 0.2) * s, y + 0.5 * s);
      }
      ctx.stroke();
      break;
    case 'triggerHappy':
      // Three bullets in a row.
      for (const off of [-0.55, 0, 0.55]) {
        ctx.moveTo(x + off * s + 0.18 * s, y);
        ctx.arc(x + off * s, y, 0.18 * s, 0, Math.PI * 2);
      }
      ctx.fill();
      break;
    case 'shield':
      ctx.moveTo(x, y - 0.6 * s);
      ctx.lineTo(x + 0.5 * s, y - 0.4 * s);
      ctx.quadraticCurveTo(x + 0.5 * s, y + 0.3 * s, x, y + 0.6 * s);
      ctx.quadraticCurveTo(x - 0.5 * s, y + 0.3 * s, x - 0.5 * s, y - 0.4 * s);
      ctx.closePath();
      ctx.stroke();
      break;
    case 'molasses':
      // A drip.
      ctx.moveTo(x, y - 0.6 * s);
      ctx.quadraticCurveTo(x + 0.5 * s, y + 0.05 * s, x + 0.42 * s, y + 0.25 * s);
      ctx.arc(x, y + 0.2 * s, 0.42 * s, 0.1, Math.PI - 0.1);
      ctx.quadraticCurveTo(x - 0.5 * s, y + 0.05 * s, x, y - 0.6 * s);
      ctx.fill();
      break;
  }
  ctx.restore();
}
