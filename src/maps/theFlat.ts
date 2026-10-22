import type { MapData } from '../sim/types';

// "The Flat": a living room (left) and bedroom (right) side by side, joined
// by a doorway near the top and by a hallway along the bottom, so there are
// two routes between them. A kitchen island and a couch give cover.
export const THE_FLAT: MapData = {
  name: 'The Flat',
  width: 24,
  height: 16,
  walls: [
    // Dividing wall between the two rooms, with a doorway near the top.
    { a: { x: 12, y: 0 }, b: { x: 12, y: 2 } },
    { a: { x: 12, y: 4.5 }, b: { x: 12, y: 12.5 } },
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
    // Either end of the hallway, for 3 and 4 players.
    { x: 2, y: 14.25 },
    { x: 22, y: 14.25 },
  ],
};
