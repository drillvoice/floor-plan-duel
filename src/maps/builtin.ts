import type { MapData } from '../sim/types';
import { THE_FLAT } from './theFlat';

// "Studio Apartment": one open room with the furniture as cover, a bed nook
// in one corner and a bathroom closet in the other. Smaller than The Flat,
// so fights start sooner.
export const STUDIO_APARTMENT: MapData = {
  name: 'Studio Apartment',
  music: 'lofi',
  width: 18,
  height: 12,
  walls: [
    // Bathroom closet (top right), door on its left side.
    { a: { x: 13, y: 0 }, b: { x: 13, y: 1.5 } },
    { a: { x: 13, y: 4 }, b: { x: 18, y: 4 } },
    // Bed (bottom left), open along the left wall.
    { a: { x: 3, y: 8 }, b: { x: 6.5, y: 8 } },
    { a: { x: 6.5, y: 8 }, b: { x: 6.5, y: 12 } },
    // Kitchen counter and island.
    { a: { x: 3.5, y: 2.5 }, b: { x: 3.5, y: 5 } },
    { a: { x: 8, y: 4.5 }, b: { x: 10.5, y: 4.5 } },
    // Couch.
    { a: { x: 10.5, y: 8 }, b: { x: 14, y: 8 } },
  ],
  spawns: [
    { x: 1.5, y: 5.5 },
    { x: 16.5, y: 6 },
  ],
};

// "Bathroom Brawl": tiny and cluttered. A shower stall and a bathtub in
// opposite corners, a vanity, a toilet and two laundry baskets leave little
// room, so rounds are close-range and frantic. Each half mirrors the other
// (turned around), so neither spawn has better cover.
export const BATHROOM_BRAWL: MapData = {
  name: 'Bathroom Brawl',
  music: 'surf',
  width: 13,
  height: 9,
  walls: [
    // Shower stall (top right), opening on its bottom side.
    { a: { x: 9, y: 0 }, b: { x: 9, y: 3 } },
    { a: { x: 9, y: 3 }, b: { x: 10.5, y: 3 } },
    // Bathtub (bottom left), the same shape turned around.
    { a: { x: 4, y: 9 }, b: { x: 4, y: 6 } },
    { a: { x: 4, y: 6 }, b: { x: 2.5, y: 6 } },
    // Vanity and toilet.
    { a: { x: 7, y: 9 }, b: { x: 7, y: 7 } },
    { a: { x: 6, y: 0 }, b: { x: 6, y: 2 } },
    // Laundry baskets.
    { a: { x: 5.5, y: 3.5 }, b: { x: 7, y: 3.5 } },
    { a: { x: 6, y: 5.5 }, b: { x: 7.5, y: 5.5 } },
  ],
  spawns: [
    { x: 1.5, y: 3 },
    { x: 11.5, y: 6 },
  ],
};

// "The Office": a meeting room and a manager's office in opposite corners,
// with cubicle partitions across the open-plan floor between them.
export const THE_OFFICE: MapData = {
  name: 'The Office',
  music: 'muzak',
  width: 26,
  height: 16,
  walls: [
    // Meeting room (top left), door in its bottom wall.
    { a: { x: 8, y: 0 }, b: { x: 8, y: 5 } },
    { a: { x: 0, y: 5 }, b: { x: 4, y: 5 } },
    { a: { x: 6.5, y: 5 }, b: { x: 8, y: 5 } },
    // Manager's office (bottom right), door in its top wall.
    { a: { x: 18, y: 11 }, b: { x: 18, y: 16 } },
    { a: { x: 18, y: 11 }, b: { x: 19.5, y: 11 } },
    { a: { x: 22, y: 11 }, b: { x: 26, y: 11 } },
    // Cubicle partitions: crosses across the floor.
    { a: { x: 10.5, y: 4 }, b: { x: 13.5, y: 4 } },
    { a: { x: 12, y: 2.5 }, b: { x: 12, y: 5.5 } },
    { a: { x: 10.5, y: 11 }, b: { x: 13.5, y: 11 } },
    { a: { x: 12, y: 9.5 }, b: { x: 12, y: 12.5 } },
    { a: { x: 15.5, y: 7.5 }, b: { x: 18.5, y: 7.5 } },
    { a: { x: 17, y: 6 }, b: { x: 17, y: 9 } },
    { a: { x: 5.5, y: 10 }, b: { x: 8.5, y: 10 } },
    { a: { x: 7, y: 8.5 }, b: { x: 7, y: 11.5 } },
    // Water cooler.
    { a: { x: 22, y: 3 }, b: { x: 22, y: 6 } },
  ],
  spawns: [
    { x: 2, y: 13.5 },
    { x: 24, y: 2 },
  ],
};

// "Lights Out": a basement lined with storage shelves, in the dark. Each
// player carries a small pool of light; beyond it you only see bullets,
// power-ups and muzzle flashes.
export const LIGHTS_OUT: MapData = {
  name: 'Lights Out',
  width: 24,
  height: 16,
  dark: true,
  walls: [
    // Shelf rows.
    { a: { x: 3.5, y: 4 }, b: { x: 9, y: 4 } },
    { a: { x: 15, y: 4 }, b: { x: 20.5, y: 4 } },
    { a: { x: 7, y: 8 }, b: { x: 17, y: 8 } },
    { a: { x: 3.5, y: 12 }, b: { x: 9, y: 12 } },
    { a: { x: 15, y: 12 }, b: { x: 20.5, y: 12 } },
    // Furnace and boiler, against the top and bottom walls.
    { a: { x: 12, y: 0 }, b: { x: 12, y: 2.5 } },
    { a: { x: 12, y: 13.5 }, b: { x: 12, y: 16 } },
  ],
  spawns: [
    { x: 1.5, y: 8 },
    { x: 22.5, y: 8 },
  ],
};

// The maps that ship with the game, in title-screen order.
export const BUILT_IN_MAPS: readonly MapData[] = [THE_FLAT, STUDIO_APARTMENT, BATHROOM_BRAWL, THE_OFFICE, LIGHTS_OUT];

// An editable copy of a built-in map, e.g. "My flat" from "The Flat".
export function copyOfBuiltIn(map: MapData): MapData {
  return { ...structuredClone(map), name: `My ${map.name.replace(/^The /, '').toLowerCase()}` };
}
