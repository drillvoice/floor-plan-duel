// Saved maps live in this browser's localStorage, keyed by map id. The editor
// saves on every change, so there is no unsaved state to lose. Storage can be
// unavailable (see prefs.ts), in which case there are no saved maps.

import type { MapData } from '../sim/types';
import { readPref, removePref, writeJsonPref, writePref } from '../prefs';
import { parseMapJson } from './validate';

const MAPS_KEY = 'fpd.maps';
const LAST_EDITED_KEY = 'fpd.lastEditedMap';
// Before autosave, the editor kept one unsaved draft here. Adopted on first load.
const LEGACY_DRAFT_KEY = 'fpd.editorDraft';

export type SavedMap = MapData & { id: string };

export function newMapId(): string {
  return `map-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// The last list read, and the stored text it came from. The title screen
// asks for the list every frame, so it's only parsed and validated again
// when the stored text changes (a save, a delete, another tab).
let cache: { raw: string | null; maps: SavedMap[] } | null = null;

function readAll(): SavedMap[] {
  const raw = readPref(MAPS_KEY);
  if (cache?.raw !== raw) cache = { raw, maps: parseAll(raw) };
  return [...cache.maps];
}

function parseAll(raw: string | null): SavedMap[] {
  let list: unknown;
  try {
    list = JSON.parse(raw ?? '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  return list.flatMap((m) => {
    try {
      const map = parseMapJson(JSON.stringify(m));
      // Maps saved before ids existed are keyed by name.
      return [{ ...map, id: map.id ?? `named-${map.name}` }];
    } catch {
      return [];
    }
  });
}

function writeAll(maps: SavedMap[]): boolean {
  return writeJsonPref(MAPS_KEY, maps);
}

export function listSavedMaps(): SavedMap[] {
  const maps = readAll();
  const draft = readPref(LEGACY_DRAFT_KEY);
  if (draft) {
    try {
      const map = { ...parseMapJson(draft), id: newMapId() };
      map.name = `${map.name} (recovered)`;
      maps.push(map);
      if (writeAll(maps)) removePref(LEGACY_DRAFT_KEY);
    } catch {
      // Unreadable draft: leave it.
    }
  }
  return maps;
}

// Saves (or replaces) the map with this id. Returns false if storage failed.
export function saveMap(map: SavedMap): boolean {
  const maps = readAll();
  const i = maps.findIndex((m) => m.id === map.id);
  if (i >= 0) maps[i] = map;
  else maps.push(map);
  const ok = writeAll(maps);
  // Only affects which map the editor reopens.
  if (ok) writePref(LAST_EDITED_KEY, map.id);
  return ok;
}

export function deleteMap(id: string): void {
  writeAll(readAll().filter((m) => m.id !== id));
}

export function lastEditedMap(): SavedMap | null {
  const id = readPref(LAST_EDITED_KEY);
  return listSavedMaps().find((m) => m.id === id) ?? null;
}
