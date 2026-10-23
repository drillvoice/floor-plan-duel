# First-person mode: plan

Oct 23, 2026 · decisions settled, ready for the test version

A view option, not a new game. The same match, maps, bot, power-ups and rules, drawn Wolfenstein-style from each shooter's eyes instead of from above. DESIGN.md lists it under v3 ("maybe a first-person mode rendered from the same walls"); this is the plan for building it.

## The big idea: change the camera, not the game

The foundation makes this unusually cheap, because almost nothing below the renderer has to change:

- **The sim stays exactly as it is.** First person is a way of drawing `GameState` and a way of turning keys into a `PlayerInput`. Matches stay reproducible, the bot and the balance sim keep working, and a first-person player can face a bot or a phone.
- **Auto-aim is a gift here.** The hard part of a shooter in first person is aiming, and this game doesn't have any. You still only move, dodge and shoot, which suits a shared keyboard with no mouse.
- **The camera locks onto your opponent.** The sim already keeps `PlayerState.facing` as a unit vector toward the opponent, so the camera looks along it. Nobody needs turn keys: W walks toward your opponent, S backs off, and A and D strafe, which circles them, the natural way to dodge. The four movement keys stay the same as today.
- **Walls come from the arena.** `Arena.walls` (outer boundary included) is already a list of segments with a known thickness (`map.wallThickness`), so every map, built-in or drawn in the editor, works in first person with no extra data.

## Design choices

These are the calls that change what gets built. 1, 2 and 5 were settled on Oct 23; 3 and 4 are recommendations to confirm in the test version.

1. **Camera: lock-on (decided).** Lock-on keeps the controls and the "you only dodge" pillar, and you always see the bullets coming. Free turning (turn keys, or Q/E) gives hide-and-seek and peeking round corners, but needs two more keys per player on a keyboard that already ghosts, and bullets from behind become unreadable. Lock-on it is for now; it may be tricky when players are close (see Risks), and a "turn to face" variant is the thing to try if it feels like being on rails.
2. **Two players on one laptop: split screen, side by side (recommended).** Left half is P1's view, right half P2's, matching which side of the keyboard they're on. Against a bot, on phone play, or with one side on a phone, the human gets the full screen. Screen-peeking is part of the charm, as in GoldenEye.
3. **Look: chunky retro (recommended) or smooth.** Rendering each view at a low internal resolution (around 320 columns) and scaling it up with smoothing off looks deliberately Wolfenstein, runs fast on old laptops and phones, and hides how simple the art is. Flat-shaded walls with a faint grid, flat floor and ceiling, emoji looks on billboard sprites.
4. **Rules: unchanged at first.** Judging a bullet's distance head-on is harder than seeing it from above, so first-person dodging may be harder. Don't guess: playtest with the default rules, and only if it's clearly too hard, add first-person rule tweaks as a config copy applied at match start, the same way round modifiers work (`sim/modifiers.ts`). Never special cases in `step`.
5. **No mixed views (decided).** Both players see the same kind of view, so the view is one setting for the match, not one per player.

## What makes dodging readable in first person

Dodging is the skill, so the view has to make incoming bullets easy to judge. Each of these is cheap:

- **Floor shadows** under every bullet. The shadow's position on the floor says how far away it is far better than the bullet's size does.
- **A projected floor grid** (lines every 2 units), so distance and your own movement are easy to read, and the walls get a faint grid along their length for the same reason.
- **Bullets at chest height, slightly below eye level**, with a short trail, glowing in the shooter's colour.
- **A minimap** in the corner of each view: the existing top-down renderer drawn small. It shows walls, bullets and power-ups, but your opponent only while you have line of sight to them (`PlayerState.lineOfSight`), so walls stay real cover.
- **Edge arrows** for threats outside the field of view: Bouncer shots off a wall, a bullet from a ghosting opponent.
- **The laser's lock-on line** drawn as a dotted beam in 3D, so you see the lane you must leave.

## How it fits the code

New code, kept apart from the top-down renderer:

| File | What it does | DOM? |
| --- | --- | --- |
| `src/render/firstPerson/raycast.ts` | For a camera (position, angle, field of view) and an arena, casts one ray per column and returns the distance to the nearest wall, which wall, and where along it (for the grid and paint splats). Walls are cast as thin rectangles of `wallThickness`, built once per arena and cached, as `ghostArena` does. Corrects fisheye. | No, unit tested |
| `src/render/firstPerson/project.ts` | Projects world points (bullets, players, power-ups, laser ends) into a view: screen x, scale, depth, and whether it's in front of the camera. Clips lines against the near plane. | No, unit tested |
| `src/render/firstPerson/camera.ts` | One camera per player: follows that player's position and `facing`, with a little smoothing so a dash past you doesn't snap the view, and a bob while walking. View-only state, like the renderer's shake and trails. | No, unit tested |
| `src/render/firstPerson/view.ts` | The canvas drawing for one view: ceiling and floor, wall columns (shaded by angle to a fixed light and by distance), then sprites far to near, each clipped against the per-column depth buffer. | Yes |
| `src/render/firstPerson/renderer.ts` | Lays out one or two views, adds each player's HUD, minimap, hit flash and shake, and reacts to `state.events` (muzzle flashes, splats, callouts). | Yes |
| `src/input/relative.ts` | Wraps any `InputSource` and rotates its `move` from "forward/strafe" into world space using that player's camera. Dodge follows `move`, so dodges go the way you'd expect too. | No, unit tested |

Changes to existing code:

- `src/settings.ts`: the match's view, `'topDown' | 'firstPerson'`, saved as `fpd.view`.
- `src/game.ts`: when a match starts, wrap first-person players' inputs in the relative input (keyboard, touch and phone alike, never the bot) and pick the renderer. The loop otherwise stays as it is.
- Title screen (`render/title.ts`): **V** switches the view between Top-down and First person. The phone menu (`screens/mobile.ts`) gets the same choice; the phone's joystick works unchanged, up meaning forward.
- `src/config.ts`: a `firstPerson` section with every number the view uses, each with a comment: field of view, eye height, wall height, bullet height, sprite sizes, internal resolution, camera smoothing, bob, fog distance on dark maps, minimap size.
- Sound stays as it is. Stereo panning per listener is pointless with two players and one pair of speakers.

### Power-ups and maps in first person

Everything already works in the sim; these are the drawing touches:

- **Ghost** and **Ghost Town:** the camera can end up inside a wall, so walls closer than the near plane are skipped and the view gets a faint wobble while ghosting.
- **Big Target:** the opponent's sprite grows with their radius.
- **Shield, curses, buff rings:** shown as a tinted ring round the opponent's sprite, and as HUD icons and a coloured screen edge for your own.
- **Paint splats:** the renderer already keeps splats at world positions on walls; the wall columns draw any splat near their hit point, so walls still fill with paint.
- **Power-up telegraphs and lifespan rings:** flat rings on the floor, projected like the grid.
- **Lights Out (dark maps):** distance fog to black, the opponent's carried light as a glow, and bullets, power-ups and muzzle flashes ignoring the fog, so the map plays as it does from above.

## Build order

Each step ends with something playable, and the first one decides whether the rest is worth it.

1. **Spike: walls only, one player against a bot (about a day).** `raycast.ts`, `camera.ts` and a bare `view.ts`, plus the relative input, behind a `?fp` URL flag. Walls, floor, ceiling, the opponent as a coloured billboard and bullets as dots. **Go/no-go:** is dodging slow bullets in first person fun, and readable? Try it against Easy and Normal bots on The Flat and Bathroom Brawl. If it isn't, try the floor shadows and grid from step 2 before giving up.
2. **Readability.** Depth-buffered sprites (players with their looks, bullets with trails and shadows, power-ups, health crates), the floor grid, the laser beam, the minimap and off-screen arrows.
3. **Split screen and HUD.** Two views side by side, each with its player's hits, dodge charge and direction, power-up icons with timers, the "blocked" indicator and a small round and score bar shared across the top. Countdown, modifier reel, pause and results reuse the existing overlay over the whole screen.
4. **Juice.** Muzzle flash, hit flash and shake per view, a quick field-of-view kick on dodges, head bob, near-miss "Close!" callouts, slow motion on knockouts (already driven by the game loop).
5. **Maps and power-up touches.** Dark maps, paint splats on walls, Ghost, Big Target and the effect rings, so every map and power-up looks right.
6. **Settings and phones.** The **V** toggle and `fpd.view`, the phone-menu option, phone controllers and hotseat working in first person.
7. **Playtest and tune.** Humans only can judge this; the bot sees the state, not the screen. If dodging is too hard, try in this order: a wider field of view, lower bullet height, then the first-person rule tweaks from choice 4, checked with `npm run sim` against the usual targets.
8. **Docs.** README (how to switch view, what's different) and DESIGN.md's roadmap.

## Testing

- **Unit tests (Vitest)** for the pure parts: rays hitting a wall head-on and at an angle at the right distance, thickness and wall ends, no fisheye on a flat wall, the nearest of overlapping walls winning; projection of points in front, behind and at the edge of the view and near-plane clipping; the relative input mapping forward, back and strafe correctly for several facings, and passing dodge and shoot through; camera smoothing settling on the target angle.
- **The sim's tests and balance numbers must not move**, since the sim isn't touched. `npm run sim -- --matches 300 --seed 1` before and after should print identical output.
- **Screenshots** with the pre-installed Chromium and Playwright: a fixed seed and scripted inputs, one image per built-in map in single and split view, to check by eye and to catch a broken view.
- **Performance:** two views at 320 columns against about 60 walls is around 40,000 ray-rectangle tests a frame, which should be a millisecond or two. Measure on a phone in step 1; if it's slow, cull walls by bounding box or build a coarse grid of walls per cell from `Arena.grid`.

## Risks and open questions

- **Readability is the whole bet.** If a bullet coming straight at you can't be judged, first person is a curiosity rather than a mode. Hence the spike first.
- **Lock-on camera swing.** When players are close and circling, the camera turns fast, which can feel sickening. Smoothing helps, but too much makes your strafing feel wrong because "forward" lags. Tune `firstPerson.cameraSmoothing` in playtests, and rotate the input by the smoothed camera angle, so the keys always match what's on screen.
- **Split screen halves the width** on a laptop, so each view is narrow and tall. A slightly wider field of view in split screen (around 75° instead of 66°) may suit it.
- **Lines of sight look different.** From above you always see your opponent; in first person a wall hides them. That's arguably more fun (walls really are cover). Decided: the minimap shows the opponent only with line of sight. Watch in playtests whether losing them behind a wall is exciting or just confusing.
- **Phones:** raycasting at 320 columns is fine, but sprite drawing with emoji can be slow on older phones; cache each look as a small bitmap.
