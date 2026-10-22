// Colours shared by everything drawn on the canvas.

export const COLORS = {
  background: '#16181f',
  floor: '#262a35',
  grid: 'rgba(255,255,255,0.035)',
  wall: '#e9e4d8',
  text: '#f2efe8',
  muted: '#8b90a0',
  players: ['#7ed957', '#c084fc'] as const,
};

export const TIMER_AMBER = '#ffb020';
export const TIMER_RED = '#ff4d4d';
export const MODIFIER_COLOR = '#ffd23f';
export const NEAR_MISS_COLOR = '#ffe066';

export function hexAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
