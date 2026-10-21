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
    case 'longShot':
      // A long arrow.
      ctx.moveTo(x - 0.7 * s, y);
      ctx.lineTo(x + 0.6 * s, y);
      ctx.moveTo(x + 0.25 * s, y - 0.3 * s);
      ctx.lineTo(x + 0.6 * s, y);
      ctx.lineTo(x + 0.25 * s, y + 0.3 * s);
      ctx.stroke();
      break;
    case 'fleetFoot':
      // Speed lines.
      for (const [off, w] of [
        [-0.4, 0.9],
        [0, 1.2],
        [0.4, 0.7],
      ]) {
        ctx.moveTo(x + (0.6 - w) * s, y + off * s);
        ctx.lineTo(x + 0.6 * s, y + off * s);
      }
      ctx.stroke();
      break;
    case 'spareDodge':
      // Plus sign with a dash chevron.
      ctx.moveTo(x - 0.65 * s, y);
      ctx.lineTo(x - 0.05 * s, y);
      ctx.moveTo(x - 0.35 * s, y - 0.3 * s);
      ctx.lineTo(x - 0.35 * s, y + 0.3 * s);
      ctx.moveTo(x + 0.2 * s, y - 0.4 * s);
      ctx.lineTo(x + 0.6 * s, y);
      ctx.lineTo(x + 0.2 * s, y + 0.4 * s);
      ctx.stroke();
      break;
    case 'rapidFire':
      // Lightning bolt.
      ctx.moveTo(x + 0.15 * s, y - 0.7 * s);
      ctx.lineTo(x - 0.35 * s, y + 0.1 * s);
      ctx.lineTo(x + 0.05 * s, y + 0.1 * s);
      ctx.lineTo(x - 0.15 * s, y + 0.7 * s);
      ctx.lineTo(x + 0.35 * s, y - 0.1 * s);
      ctx.lineTo(x - 0.05 * s, y - 0.1 * s);
      ctx.closePath();
      ctx.fill();
      break;
    case 'bouncer':
      // A path bouncing off a floor.
      ctx.moveTo(x - 0.65 * s, y - 0.45 * s);
      ctx.lineTo(x - 0.1 * s, y + 0.35 * s);
      ctx.lineTo(x + 0.55 * s, y - 0.45 * s);
      ctx.moveTo(x - 0.65 * s, y + 0.6 * s);
      ctx.lineTo(x + 0.65 * s, y + 0.6 * s);
      ctx.stroke();
      break;
    case 'ghost':
      ctx.moveTo(x - 0.5 * s, y + 0.6 * s);
      ctx.lineTo(x - 0.5 * s, y - 0.05 * s);
      ctx.arc(x, y - 0.05 * s, 0.5 * s, Math.PI, 0);
      ctx.lineTo(x + 0.5 * s, y + 0.6 * s);
      ctx.lineTo(x + 0.25 * s, y + 0.4 * s);
      ctx.lineTo(x, y + 0.6 * s);
      ctx.lineTo(x - 0.25 * s, y + 0.4 * s);
      ctx.closePath();
      ctx.fill();
      break;
    case 'leadShot':
      // Crosshair.
      ctx.arc(x, y, 0.45 * s, 0, Math.PI * 2);
      ctx.moveTo(x, y - 0.75 * s);
      ctx.lineTo(x, y - 0.2 * s);
      ctx.moveTo(x, y + 0.2 * s);
      ctx.lineTo(x, y + 0.75 * s);
      ctx.moveTo(x - 0.75 * s, y);
      ctx.lineTo(x - 0.2 * s, y);
      ctx.moveTo(x + 0.2 * s, y);
      ctx.lineTo(x + 0.75 * s, y);
      ctx.stroke();
      break;
    case 'topsyTurvy':
      // Two arrows swapping.
      ctx.moveTo(x - 0.6 * s, y - 0.25 * s);
      ctx.lineTo(x + 0.6 * s, y - 0.25 * s);
      ctx.lineTo(x + 0.35 * s, y - 0.5 * s);
      ctx.moveTo(x + 0.6 * s, y + 0.25 * s);
      ctx.lineTo(x - 0.6 * s, y + 0.25 * s);
      ctx.lineTo(x - 0.35 * s, y + 0.5 * s);
      ctx.stroke();
      break;
    case 'bigTarget':
      // Bullseye.
      ctx.arc(x, y, 0.6 * s, 0, Math.PI * 2);
      ctx.moveTo(x + 0.3 * s, y);
      ctx.arc(x, y, 0.3 * s, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, 0.1 * s, 0, Math.PI * 2);
      ctx.fill();
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
