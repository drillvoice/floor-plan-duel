// Saved maps live in this browser's localStorage, keyed by map id. The editor
// saves on every change, so there is no unsaved state to lose. Every access
// is guarded: storage can be unavailable (private windows, blocked site data).

import type { MapData } from '../sim/types';
import { parseMapJson } from './validate';

const MAPS_KEY = 'fpd.maps';
const LAST_EDITED_KEY = 'fpd.lastEditedMap';
// Before autosave, the editor kept one unsaved draft here. Adopted on first load.
const LEGACY_DRAFT_KEY = 'fpd.editorDraft';

export type SavedMap = MapData & { id: string };

export function newMapId(): string {
  return `map-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function readAll(): SavedMap[] {
  try {
    const raw = JSON.parse(localStorage.getItem(MAPS_KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    let upgraded = false;
    const maps = raw.flatMap((m) => {
      try {
        const map = parseMapJson(JSON.stringify(m));
        // Maps saved before four players get their extra spawns placed here.
        if (map.spawns.length !== m.spawns.length) upgraded = true;
        // Maps saved before ids existed are keyed by name.
        return [{ ...map, id: map.id ?? `named-${map.name}` }];
      } catch {
        return [];
      }
    });
    // Save the placed spawns, so they're worked out only once.
    if (upgraded) writeAll(maps);
    return maps;
  } catch {
    return [];
  }
}

function writeAll(maps: SavedMap[]): boolean {
  try {
    localStorage.setItem(MAPS_KEY, JSON.stringify(maps));
    return true;
  } catch {
    return false;
  }
}

export function listSavedMaps(): SavedMap[] {
  const maps = readAll();
  try {
    const draft = localStorage.getItem(LEGACY_DRAFT_KEY);
    if (draft) {
      const map = { ...parseMapJson(draft), id: newMapId() };
      map.name = `${map.name} (recovered)`;
      maps.push(map);
      if (writeAll(maps)) localStorage.removeItem(LEGACY_DRAFT_KEY);
    }
  } catch {
    // Unreadable draft: leave it.
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
  if (ok) {
    try {
      localStorage.setItem(LAST_EDITED_KEY, map.id);
    } catch {
      // Only affects which map the editor reopens.
    }
  }
  return ok;
}

export function deleteMap(id: string): void {
  writeAll(readAll().filter((m) => m.id !== id));
}

export function lastEditedMap(): SavedMap | null {
  try {
    const id = localStorage.getItem(LAST_EDITED_KEY);
    return listSavedMaps().find((m) => m.id === id) ?? null;
  } catch {
    return null;
  }
}
