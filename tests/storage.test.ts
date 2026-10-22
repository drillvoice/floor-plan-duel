import { beforeEach, describe, expect, it } from 'vitest';
import { deleteMap, lastEditedMap, listSavedMaps, newMapId, saveMap } from '../src/maps/storage';
import { THE_FLAT } from '../src/maps/theFlat';

// A minimal in-memory localStorage for the node test environment.
class MemoryStorage {
  private data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, String(v));
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

beforeEach(() => {
  (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
});

describe('map storage', () => {
  it('saves, replaces by id, and deletes', () => {
    const a = { ...THE_FLAT, id: newMapId(), name: 'A' };
    const b = { ...THE_FLAT, id: newMapId(), name: 'A' }; // same name, different map
    saveMap(a);
    saveMap(b);
    expect(listSavedMaps()).toHaveLength(2);
    saveMap({ ...a, name: 'A renamed' });
    expect(listSavedMaps().map((m) => m.name).sort()).toEqual(['A', 'A renamed']);
    expect(lastEditedMap()?.id).toBe(a.id);
    deleteMap(a.id);
    expect(listSavedMaps().map((m) => m.id)).toEqual([b.id]);
  });

  it('recovers the unsaved draft kept by older versions', () => {
    localStorage.setItem('fpd.editorDraft', JSON.stringify({ ...THE_FLAT, name: 'Lost map' }));
    const maps = listSavedMaps();
    expect(maps).toHaveLength(1);
    expect(maps[0].name).toBe('Lost map (recovered)');
    expect(localStorage.getItem('fpd.editorDraft')).toBeNull();
    expect(listSavedMaps()).toHaveLength(1);
  });

  it('keeps maps saved before ids existed', () => {
    localStorage.setItem('fpd.maps', JSON.stringify([{ ...THE_FLAT, name: 'Old' }]));
    expect(listSavedMaps()[0]).toMatchObject({ name: 'Old', id: 'named-Old' });
  });

  it('sees changes made outside this module, such as another tab', () => {
    saveMap({ ...THE_FLAT, id: 'a', name: 'A' });
    expect(listSavedMaps().map((m) => m.name)).toEqual(['A']);
    localStorage.setItem('fpd.maps', JSON.stringify([{ ...THE_FLAT, id: 'b', name: 'B' }]));
    expect(listSavedMaps().map((m) => m.name)).toEqual(['B']);
  });

  it('hands out a list callers can change without touching the saved one', () => {
    saveMap({ ...THE_FLAT, id: 'a', name: 'A' });
    listSavedMaps().pop();
    expect(listSavedMaps()).toHaveLength(1);
  });

  it('copes with storage being unavailable', () => {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
    };
    expect(listSavedMaps()).toEqual([]);
    expect(saveMap({ ...THE_FLAT, id: 'x' })).toBe(false);
  });
});
