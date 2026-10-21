// Saved maps live in this browser's localStorage. Every access is guarded:
// storage can be unavailable (private windows, blocked site data).

import type { MapData } from '../sim/types';
import { parseMapJson } from './validate';

const MAPS_KEY = 'fpd.maps';
const DRAFT_KEY = 'fpd.editorDraft';

export function listSavedMaps(): MapData[] {
  try {
    const raw = JSON.parse(localStorage.getItem(MAPS_KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((m) => {
      try {
        return [parseMapJson(JSON.stringify(m))];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

// Saves by name, replacing a map with the same name. Returns false if storage failed.
export function saveMap(map: MapData): boolean {
  const maps = listSavedMaps().filter((m) => m.name !== map.name);
  maps.push(map);
  try {
    localStorage.setItem(MAPS_KEY, JSON.stringify(maps));
    return true;
  } catch {
    return false;
  }
}

export function deleteMap(name: string): void {
  try {
    localStorage.setItem(MAPS_KEY, JSON.stringify(listSavedMaps().filter((m) => m.name !== name)));
  } catch {
    // Nothing to do.
  }
}

export function loadDraft(): MapData | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? parseMapJson(raw) : null;
  } catch {
    return null;
  }
}

export function saveDraft(map: MapData): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(map));
  } catch {
    // The draft just won't survive a reload.
  }
}
