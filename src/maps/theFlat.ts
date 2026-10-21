import type { MapData } from '../sim/types';

// "The Flat": a living room (left) and bedroom (right) side by side, both
// opening onto a hallway along the bottom. A kitchen island and a couch give
// cover inside the rooms.
export const THE_FLAT: MapData = {
  name: 'The Flat',
  width: 24,
  height: 16,
  walls: [
    // Dividing wall between the two rooms.
    { a: { x: 12, y: 0 }, b: { x: 12, y: 12.5 } },
    // Hallway wall, with a doorway into each room.
    { a: { x: 0, y: 12.5 }, b: { x: 7, y: 12.5 } },
    { a: { x: 9.5, y: 12.5 }, b: { x: 14.5, y: 12.5 } },
    { a: { x: 17, y: 12.5 }, b: { x: 24, y: 12.5 } },
    // Kitchen island (living room).
    { a: { x: 4, y: 8.5 }, b: { x: 8, y: 8.5 } },
    { a: { x: 7, y: 3 }, b: { x: 7, y: 5.5 } },
    // Couch (bedroom), an L shape.
    { a: { x: 15.5, y: 6 }, b: { x: 19, y: 6 } },
    { a: { x: 19, y: 6 }, b: { x: 19, y: 8.5 } },
  ],
  spawns: [
    { x: 3, y: 4 },
    { x: 21, y: 4 },
  ],
};
