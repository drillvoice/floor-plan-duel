// Map editor: draw walls on a snapping grid, select and delete them, move the
// spawns, undo/redo, export/import JSON, and test play. Every change is saved
// to this browser straight away.

import { CONFIG } from '../config';
import { isTextField } from '../input/keyboard';
import { deleteMap, listSavedMaps, newMapId, saveMap, type SavedMap } from '../maps/storage';
import { BUILT_IN_MAPS, copyOfBuiltIn } from '../maps/builtin';
import { autoSpawns, parseMapJson, validateMap } from '../maps/validate';
import { COLORS } from '../render/renderer';
import type { MapData } from '../sim/types';
import { dist, distPointSegment, type Vec2 } from '../sim/vec';

const TOOLBAR_HEIGHT = 64;
const MARGIN = 24;
const STATUS_HEIGHT = 36;
const SNAP = CONFIG.map.gridCell;
const ENDPOINT_SNAP = 0.4;
const PICK_DISTANCE = 0.35;
const CLICK_SLOP = 0.25; // a drag shorter than this counts as a click

type Drag =
  | { kind: 'pending'; down: Vec2 }
  | { kind: 'wall'; from: Vec2; to: Vec2 }
  | { kind: 'spawn'; index: 0 | 1; pos: Vec2 };

export interface EditorCallbacks {
  onTestPlay(map: MapData): void;
  onExit(): void;
}

export function blankMap(): MapData {
  const w = CONFIG.map.defaultWidth;
  const h = CONFIG.map.defaultHeight;
  return { name: 'My map', width: w, height: h, walls: [], spawns: [{ x: 3, y: h / 2 }, { x: w - 3, y: h / 2 }] };
}

export class Editor {
  private ctx: CanvasRenderingContext2D;
  private map: SavedMap = { ...blankMap(), id: newMapId() };
  private saveState: 'unsaved' | 'saved' | 'failed' = 'unsaved';
  private saveStatus: HTMLSpanElement;
  private selected: number | null = null;
  private drag: Drag | null = null;
  private cursor: Vec2 | null = null;
  private shift = false;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private active = false;
  private message = '';
  private messageUntil = 0;
  private scale = 1;
  private origin = { x: 0, y: 0 };
  private toolbar: HTMLElement;
  private nameInput: HTMLInputElement;
  private loadSelect: HTMLSelectElement;
  private fileInput: HTMLInputElement;
  private validation = { key: '', errors: [] as string[] };

  constructor(
    private canvas: HTMLCanvasElement,
    private callbacks: EditorCallbacks,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.toolbar = document.createElement('div');
    this.toolbar.id = 'editor-toolbar';
    this.toolbar.hidden = true;
    this.nameInput = el('input', { type: 'text', maxLength: 40, title: 'Map name', ariaLabel: 'Map name' });
    this.nameInput.addEventListener('input', () => {
      this.map.name = this.nameInput.value.trim() || 'Untitled';
      this.changed();
    });
    this.saveStatus = el('span', { className: 'save-status' });
    this.loadSelect = el('select', { title: 'Load a map', ariaLabel: 'Load a map' });
    this.loadSelect.addEventListener('change', () => this.loadChoice());
    this.fileInput = el('input', { type: 'file', accept: '.json,application/json', hidden: true });
    this.fileInput.addEventListener('change', () => void this.importFile());
    const button = (label: string, title: string, action: () => void) => {
      const b = el('button', { textContent: label, title, type: 'button' });
      b.addEventListener('click', () => {
        action();
        b.blur(); // so Space/Enter don't re-trigger it
      });
      return b;
    };
    this.toolbar.append(
      this.nameInput,
      this.loadSelect,
      button('New', 'Start a blank map', () => this.switchTo(blankMap(), 'New map. It saves as soon as you change it.')),
      button('Delete', 'Delete this map from this browser', () => this.deleteCurrent()),
      button('Auto spawns', 'Place spawns as far apart as possible', () => this.placeAutoSpawns()),
      button('Export', 'Download as a .json file', () => this.exportFile()),
      button('Import', 'Load a .json map file', () => this.fileInput.click()),
      this.fileInput,
      button('Test play ▶', 'Play a match on this map (T)', () => this.testPlay()),
      button('Back', 'Back to the title screen (Esc)', () => this.callbacks.onExit()),
      this.saveStatus,
    );
    document.body.append(this.toolbar);

    canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    window.addEventListener('mousemove', (e) => this.onMouseMove(e));
    window.addEventListener('mouseup', (e) => this.onMouseUp(e));
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => {
      if (e.key === 'Shift') this.shift = false;
    });
  }

  // A map without an id (the built-in one, a new one) gets one here, and is
  // saved as soon as it's changed.
  open(map: MapData): void {
    this.active = true;
    this.toolbar.hidden = false;
    this.drag = null;
    this.setMap(map);
  }

  private setMap(map: MapData): void {
    const known = map.id !== undefined && listSavedMaps().some((m) => m.id === map.id);
    this.map = { ...structuredClone(map), id: map.id ?? newMapId() };
    this.saveState = known ? 'saved' : 'unsaved';
    this.selected = null;
    this.undoStack = [];
    this.redoStack = [];
    this.nameInput.value = this.map.name;
    this.refreshLoadList();
    this.updateSaveStatus();
  }

  close(): void {
    this.active = false;
    this.toolbar.hidden = true;
    this.drag = null;
  }

  currentMap(): SavedMap {
    return structuredClone(this.map);
  }

  // ---- editing -----------------------------------------------------------

  private snapshot(): void {
    this.undoStack.push(JSON.stringify(this.map));
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
  }

  private changed(): void {
    this.saveState = saveMap(this.currentMap()) ? 'saved' : 'failed';
    this.refreshLoadList();
    this.updateSaveStatus();
  }

  private updateSaveStatus(): void {
    const text = {
      saved: '✓ Saved in this browser',
      unsaved: 'Saves when you make a change',
      failed: "⚠ Can't save in this browser: use Export",
    }[this.saveState];
    this.saveStatus.textContent = text;
    this.saveStatus.dataset.state = this.saveState;
  }

  private undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(JSON.stringify(this.map));
    this.map = JSON.parse(prev);
    this.nameInput.value = this.map.name;
    this.selected = null;
    this.changed();
  }

  private redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(JSON.stringify(this.map));
    this.map = JSON.parse(next);
    this.nameInput.value = this.map.name;
    this.selected = null;
    this.changed();
  }

  private switchTo(map: MapData, message: string): void {
    this.setMap(map);
    this.flash(message);
  }

  private deleteCurrent(): void {
    if (this.saveState === 'saved' && !confirm(`Delete “${this.map.name}” from this browser? This can't be undone.`)) return;
    deleteMap(this.map.id);
    this.switchTo(blankMap(), `Deleted “${this.map.name}”.`);
  }

  private deleteSelected(): void {
    if (this.selected === null) return;
    this.snapshot();
    this.map.walls.splice(this.selected, 1);
    this.selected = null;
    this.changed();
  }

  private placeAutoSpawns(): void {
    const spawns = autoSpawns(this.map);
    if (!spawns) return this.flash('No open floor to place spawns on.');
    this.snapshot();
    this.map.spawns = spawns;
    this.changed();
    this.flash('Spawns placed as far apart as possible.');
  }

  private refreshLoadList(): void {
    this.loadSelect.replaceChildren(
      el('option', { textContent: 'Load…', value: '' }),
      ...BUILT_IN_MAPS.map((m, i) => el('option', { textContent: `${m.name} (built-in)`, value: `__builtin${i}` })),
      ...listSavedMaps().map((m) => el('option', { textContent: m.name, value: m.id })),
    );
  }

  private loadChoice(): void {
    const v = this.loadSelect.value;
    this.loadSelect.value = '';
    this.loadSelect.blur();
    if (!v) return;
    const builtIn = v.startsWith('__builtin') ? BUILT_IN_MAPS[Number(v.slice('__builtin'.length))] : undefined;
    const map = builtIn ? copyOfBuiltIn(builtIn) : listSavedMaps().find((m) => m.id === v);
    if (map) this.switchTo(map, `Loaded “${map.name}”.`);
  }

  private exportFile(): void {
    const blob = new Blob([JSON.stringify(this.map, null, 2)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `${slug(this.map.name)}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  private async importFile(): Promise<void> {
    const file = this.fileInput.files?.[0];
    this.fileInput.value = '';
    if (!file) return;
    try {
      // An import is always a new map, even if it came from this browser.
      this.switchTo({ ...parseMapJson(await file.text()), id: newMapId() }, `Imported “${file.name}”.`);
      this.changed();
    } catch (err) {
      this.flash(`Couldn't import: ${(err as Error).message}`);
    }
  }

  private testPlay(): void {
    const errors = validateMap(this.map);
    if (errors.length) return this.flash(errors.join(' '));
    this.callbacks.onTestPlay(this.currentMap());
  }

  // Validation builds the walkable grid, so only redo it when the map changes.
  private errors(): string[] {
    const key = JSON.stringify(this.map);
    if (key !== this.validation.key) this.validation = { key, errors: validateMap(this.map) };
    return this.validation.errors;
  }

  private flash(message: string): void {
    this.message = message;
    this.messageUntil = performance.now() + 4000;
  }

  // ---- input -------------------------------------------------------------

  private toWorld(e: MouseEvent): Vec2 {
    const r = this.canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left - this.origin.x) / this.scale, y: (e.clientY - r.top - this.origin.y) / this.scale };
  }

  private snap(p: Vec2): Vec2 {
    const endpoints: Vec2[] = [
      { x: 0, y: 0 },
      { x: this.map.width, y: 0 },
      { x: 0, y: this.map.height },
      { x: this.map.width, y: this.map.height },
      ...this.map.walls.flatMap((w) => [w.a, w.b]),
    ];
    let best: Vec2 | null = null;
    for (const e of endpoints) if (dist(e, p) < ENDPOINT_SNAP && (!best || dist(e, p) < dist(best, p))) best = e;
    if (best) return { ...best };
    return {
      x: Math.max(0, Math.min(this.map.width, Math.round(p.x / SNAP) * SNAP)),
      y: Math.max(0, Math.min(this.map.height, Math.round(p.y / SNAP) * SNAP)),
    };
  }

  private wallEnd(from: Vec2, raw: Vec2): Vec2 {
    const to = this.snap(raw);
    if (!this.shift) return to;
    // Shift: lock to horizontal or vertical.
    return Math.abs(to.x - from.x) >= Math.abs(to.y - from.y) ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
  }

  private wallAt(p: Vec2): number | null {
    let best: number | null = null;
    let bestD = PICK_DISTANCE;
    this.map.walls.forEach((w, i) => {
      const d = distPointSegment(p, w.a, w.b);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  private onMouseDown(e: MouseEvent): void {
    if (!this.active || e.button !== 0) return;
    const p = this.toWorld(e);
    this.shift = e.shiftKey;
    const spawn = this.map.spawns.findIndex((s) => dist(s, p) < CONFIG.player.radius + 0.2);
    if (spawn >= 0) {
      this.drag = { kind: 'spawn', index: spawn as 0 | 1, pos: { ...this.map.spawns[spawn] } };
      return;
    }
    this.drag = { kind: 'pending', down: p };
  }

  private onMouseMove(e: MouseEvent): void {
    if (!this.active) return;
    const p = this.toWorld(e);
    this.cursor = p;
    this.shift = e.shiftKey;
    const d = this.drag;
    if (!d) return;
    if (d.kind === 'pending' && dist(p, d.down) > CLICK_SLOP) {
      const from = this.snap(d.down);
      this.drag = { kind: 'wall', from, to: this.wallEnd(from, p) };
    } else if (d.kind === 'wall') {
      d.to = this.wallEnd(d.from, p);
    } else if (d.kind === 'spawn') {
      d.pos = { x: Math.round(p.x / SNAP) * SNAP, y: Math.round(p.y / SNAP) * SNAP };
    }
  }

  private onMouseUp(e: MouseEvent): void {
    if (!this.active || !this.drag) return;
    const d = this.drag;
    this.drag = null;
    if (d.kind === 'pending') {
      this.selected = this.wallAt(this.toWorld(e));
    } else if (d.kind === 'wall') {
      if (dist(d.from, d.to) >= SNAP - 1e-9) {
        this.snapshot();
        this.map.walls.push({ a: d.from, b: d.to });
        this.selected = null;
        this.changed();
      }
    } else if (d.kind === 'spawn') {
      const s = this.map.spawns[d.index];
      if (s.x !== d.pos.x || s.y !== d.pos.y) {
        this.snapshot();
        this.map.spawns[d.index] = d.pos;
        this.changed();
      }
    }
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (!this.active) return;
    if (e.key === 'Shift') this.shift = true;
    if (isTextField(e.target)) {
      if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLElement).blur();
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.code === 'KeyZ') {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
    } else if (mod && e.code === 'KeyY') {
      e.preventDefault();
      this.redo();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      this.deleteSelected();
    } else if (e.key === 'Escape') {
      if (this.drag) this.drag = null;
      else if (this.selected !== null) this.selected = null;
      else this.callbacks.onExit();
    } else if (e.code === 'KeyT' && !mod) {
      this.testPlay();
    }
  }

  // ---- drawing -----------------------------------------------------------

  draw(): void {
    const ctx = this.ctx;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const map = this.map;
    const availW = w - MARGIN * 2;
    const availH = h - TOOLBAR_HEIGHT - STATUS_HEIGHT - MARGIN * 2;
    this.scale = Math.max(4, Math.min(availW / map.width, availH / map.height));
    this.origin = {
      x: (w - map.width * this.scale) / 2,
      y: TOOLBAR_HEIGHT + MARGIN + (availH - map.height * this.scale) / 2,
    };
    const s = this.scale;
    const P = (p: Vec2) => ({ x: this.origin.x + p.x * s, y: this.origin.y + p.y * s });

    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = COLORS.floor;
    ctx.fillRect(this.origin.x, this.origin.y, map.width * s, map.height * s);

    // Grid: faint half-units, stronger whole units.
    ctx.lineWidth = 1;
    for (let x = 0; x <= map.width; x += SNAP) {
      ctx.strokeStyle = Number.isInteger(x) ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)';
      ctx.beginPath();
      ctx.moveTo(this.origin.x + x * s, this.origin.y);
      ctx.lineTo(this.origin.x + x * s, this.origin.y + map.height * s);
      ctx.stroke();
    }
    for (let y = 0; y <= map.height; y += SNAP) {
      ctx.strokeStyle = Number.isInteger(y) ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)';
      ctx.beginPath();
      ctx.moveTo(this.origin.x, this.origin.y + y * s);
      ctx.lineTo(this.origin.x + map.width * s, this.origin.y + y * s);
      ctx.stroke();
    }

    const drawWall = (a: Vec2, b: Vec2, color: string, dashed = false) => {
      const pa = P(a);
      const pb = P(b);
      ctx.strokeStyle = color;
      ctx.lineWidth = CONFIG.map.wallThickness * s;
      ctx.lineCap = 'round';
      ctx.setLineDash(dashed ? [8, 8] : []);
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
      ctx.setLineDash([]);
    };
    // Outer boundary (implied, not editable).
    const corners = [
      { x: 0, y: 0 },
      { x: map.width, y: 0 },
      { x: map.width, y: map.height },
      { x: 0, y: map.height },
    ];
    corners.forEach((c, i) => drawWall(c, corners[(i + 1) % 4], 'rgba(233,228,216,0.5)'));
    const hovered = this.cursor && !this.drag ? this.wallAt(this.cursor) : null;
    map.walls.forEach((wl, i) => {
      const color = i === this.selected ? '#ffcc33' : i === hovered ? '#ffffff' : COLORS.wall;
      drawWall(wl.a, wl.b, color);
    });
    if (this.drag?.kind === 'wall') drawWall(this.drag.from, this.drag.to, '#ffcc33', true);

    // Spawns.
    map.spawns.forEach((sp, i) => {
      const pos = this.drag?.kind === 'spawn' && this.drag.index === i ? this.drag.pos : sp;
      const c = P(pos);
      ctx.fillStyle = COLORS.players[i];
      ctx.beginPath();
      ctx.arc(c.x, c.y, CONFIG.player.radius * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#111';
      ctx.font = `800 ${Math.round(s * 0.6)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), c.x, c.y + 1);
    });

    // Snap cursor.
    if (this.cursor && this.drag?.kind !== 'spawn') {
      const sp = this.drag?.kind === 'wall' ? this.drag.to : this.snap(this.cursor);
      const inside = this.cursor.x >= -0.5 && this.cursor.y >= -0.5 && this.cursor.x <= map.width + 0.5 && this.cursor.y <= map.height + 0.5;
      if (inside) {
        const c = P(sp);
        ctx.strokeStyle = '#ffcc33';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(c.x, c.y, 5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Status line: a recent message, else validation problems, else help.
    const errors = this.errors();
    let text: string;
    let color: string = COLORS.muted;
    if (performance.now() < this.messageUntil) {
      text = this.message;
      color = COLORS.text;
    } else if (errors.length) {
      text = `⚠ ${errors.join(' ')}`;
      color = '#ff4d4d';
    } else {
      text =
        'Drag to draw a wall (Shift: straight) · click a wall to select, Delete to remove · drag 1 / 2 to move spawns · Ctrl+Z / Ctrl+Shift+Z · T to test play';
    }
    ctx.fillStyle = color;
    ctx.font = '400 14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h - STATUS_HEIGHT / 2 - 4);
  }
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'map';
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}): HTMLElementTagNameMap[K] {
  return Object.assign(document.createElement(tag), props);
}
