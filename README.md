# Floor Plan Duel

A top-down 1v1 shooter for two people sharing one laptop keyboard, or using their phones as controllers, or one person against a bot on a phone. Shots auto-aim at the opponent but travel slowly, so the game is about moving and dodging. Power-ups appear at random to swing rounds. See [DESIGN.md](DESIGN.md) for the full design.

## Run

Needs Node.js 22 or newer.

```sh
npm install
npm run dev      # play at http://localhost:5173
npm test         # unit tests: sim, stats, awards, power-ups, modifiers, bot, maps, hotseat, phones, touch, music
npm run typecheck
npm run build    # typecheck, then a static site in dist/ (works from any folder, e.g. GitHub Pages)
npm run preview  # serve the build locally
```

The built site works offline after the first visit and can be installed as an app from the browser.

### Deploy to Vercel

`vercel.json` holds the settings. In the Vercel dashboard choose **Add New → Project**, import this GitHub repo and click **Deploy**; no environment variables are needed. Every push to `main` then updates the live site, and other branches get preview URLs.

## Play

On the title screen:

- **Enter** starts a match, best of 5 rounds, 3 hits to lose a round.
- **1 / 2** switch each player between Human and Bot (Easy, Normal, Hard). Two bots will play each other.
- Each player's **dodge key** cycles their look: a plain circle or a cute icon inside it.
- **H** opens hotseat mode, for a group taking turns (see below).
- **P** lets players use their phones as controllers (see below).
- **R** turns round modifiers on or off (see below). They start on.
- **Tab** changes the map; **E** opens the map editor (on a saved map, or the one you edited last).
- **T** turns map rotation on or off. With it on (the default), a match starts on the chosen map and plays a different built-in map each round, in a random order; the countdown names the next map. With it off, the whole match stays on the chosen map. Test play from the editor always stays on the map being edited.
- Built-in maps: **The Flat** (two rooms and a hallway), **Studio Apartment** (one open room, quick to the fight), **Bathroom Brawl** (tiny and cramped), **The Office** (cubicles between a meeting room and the boss's office) and **Lights Out** (a dark basement: you see what's near each player, plus bullets, power-ups and muzzle flashes).
- **M** mutes all sound; **N** turns the music on or off (also works mid-match). The music speeds up as the round goes on and gets busier near the end. Each map has its own tune: chiptune in The Flat, lo-fi hip-hop in Studio Apartment, twangy surf rock in Bathroom Brawl, office muzak in The Office, and a spooky theremin with a heartbeat in Lights Out (and any dark map). With map rotation on, the music changes with the map each round.
- **B** toggles full screen (also works mid-match), or use the button in the top-right corner of the menus. Esc leaves full screen too.
- The key caps light up while held: use this to check your keyboard can register everyone's keys at once.

| Action | Player 1 | Player 2 |
| --- | --- | --- |
| Move | W A S D | Arrow keys |
| Shoot (hold) | F | / (slash) |
| Dodge | G | . (full stop) |
| Pause | Esc | Esc |

Dodge is a quick dash in the direction you're moving, diagonals included; standing still, it goes the way you last moved. It has a 1.2 s cooldown: the little arrow beside your player shows where a dodge will go, and dims while it recharges. After 90 s a round goes to sudden death and bullets speed up every 5 s.

A bullet that only just misses you pops up a "Close!" and counts as a clutch dodge. At the end of a match the results screen shows both players' stats side by side: shots fired, hits, accuracy, hits taken, longest hit, dodges, clutch dodges, power-ups picked up, flawless rounds (won without taking a hit) and distance run, with the better number in each row in that player's colour. Each player also gets an award for the first of these they beat their opponent at: ✨ Flawless (more flawless rounds), 🎯 Sharpshooter (better accuracy), 😅 Escape Artist (more clutch dodges), 🔭 Sniper (longer longest hit), 🎁 Hoarder (more power-ups), 🔫 Spray and Pray (more shots but worse aim), 💨 Slippery (more dodges) or 🏃 Marathon Runner (further run). Anyone who wins none of them is a 🤝 Good Sport. Bullets that hit a wall leave a splash of the shooter's colour on it, so the walls slowly fill with paint over a match.

Power-ups flash a ring where they're about to appear, and a ring around each one shrinks as it expires:

- **Gold** (lasts the round, stacks): Swift Shot (faster bullets), Long Shot (more range), Trigger Happy (faster firing), Fleet Foot (faster movement), Spare Dodge (a second dodge charge).
- **Blue** (temporary): Shield (absorbs the next hit), Rapid Fire (fire twice as fast), Bouncer (bullets bounce off a wall once), Ghost (walk through walls), Lead Shot (aim predicts where your opponent is going), Laser (shots become instant zaps: a dotted line locks onto your opponent and fires 0.4 s later, so they have a moment to get off it; shorter range and a slower reload than bullets).
- **Red** (curse on your opponent): Molasses (slows them), Topsy-Turvy (reverses their controls), Big Target (makes them easier to hit).

A label pops up saying what each one did, and the icons under each player's health show what's active. Each blue or red effect also puts a ring of its colour round the player that drains as it wears off and blinks just before it ends, with a little blip when it's over.

**Health crate:** a white crate with a red cross that gives back one life (never more than you started with). It's a comeback item: it only turns up for a player who is behind on rounds and has taken a hit this round, near them, and more often the further behind they are. Either player can grab it, so the leader can rush over to deny it.

## Round modifiers

With modifiers on, a slot-machine reel spins before each round and picks a rule for that round only, never the same one twice in a row:

| Modifier | What changes |
| --- | --- |
| Giant Bullets | Bullets twice the size, but slower |
| Power-up Storm | A power-up every 1-2 s, twice as many on the map |
| One-Hit Wonder | The first hit wins the round |
| Speed Demons | Players and bullets move faster |
| Bullet Hell | Fire 2.5 times as fast, slightly shorter range |
| Sniper Duel | Fast, long-range shots with a slow reload |
| Bouncy Castle | Every shot bounces twice |
| Ghost Town | Everyone walks through walls; bullets still stop at them |
| Dodge Frenzy | Dodge recharges three times as fast |

The modifier's name stays under the round number while you play.

## Hotseat

For a group sharing one laptop. Press **H** on the title screen, add everyone's names (and click a look to change it), choose how many rounds each match is, and press Enter.

- Two players are up at a time: the first on the left keys, the second on the right keys.
- The winner stays on their side. The loser goes to the back of the line and the next person takes their keys.
- The table tracks everyone's wins, losses and best winning streak, with a 🏆 for the leader. Players can be added or removed between matches.
- The session is saved in the browser, so a reload doesn't lose the scores. **Reset scores** starts afresh with the same people.

## Phone controllers

Players can join on their phones instead of sharing the keyboard. Press **P** on the title screen: the screen shows a room code and a QR code.

- Each player scans the QR code (or opens the site with `?join` and types the code). The phone takes a free side, P1 or P2; tap the other side to swap if it's free. Pick a look and a name on the phone.
- Press **Start** on a phone, or Enter on the big screen. During the match the phone shows a joystick (put your thumb down anywhere on the left half), **Dodge** and **Shoot**, and a pause button. It buzzes when you're hit (on phones that support vibration).
- A side with no phone is played from the keyboard or by a bot, as set on the title screen, so one phone player can take on a keyboard player or a bot.
- Phones stay connected between matches, and **Rematch** on a phone starts the next one. If a phone drops out mid-match the game pauses, and the phone rejoins the same side when it reconnects.

Phones connect straight to the computer with WebRTC. The free [PeerJS](https://peerjs.com) server introduces them, so both need internet access to join; after that the controls go directly between them, over the local network when they share one. The phones must be able to open the same address as the computer, so use the deployed site, or for local testing run `npm run dev -- --host` and open the network address it prints rather than `localhost`.

## Play on a phone

Open the site on a phone and it shows a touch menu instead of the keyboard title screen: you play against a bot, with everything on the phone's own screen.

- Pick a look, a name, the bot's difficulty (Easy, Normal, Hard) and the map, and turn map rotation, round modifiers, sound and music on or off. Then tap **Play** and turn the phone sideways.
- The whole arena fills the screen under a slim score bar. Put your thumb down anywhere on the left half for a joystick; **Dodge** and **Shoot** sit see-through in the bottom right. The phone buzzes when you're hit.
- **❚❚** in the top-left corner pauses, with Resume and Quit. Holding the phone upright or switching apps pauses too. At the end of a match, **Rematch** or **Menu**.
- It works offline once the site has been opened. To use the phone as a controller for a big screen instead, tap the link under Play.

Only devices whose main input is a finger get this menu; computers, including ones with a touch screen, get the usual title screen. Add `?mobile` to the address to try it on a computer, or `?desktop` to get the keyboard screen on a phone. If a phone ever shows the keyboard screen, tapping it switches to the phone menu.

## Map editor

Press **E** on the title screen.

- Drag to draw a wall. Ends snap to a half-unit grid and to existing wall ends; hold Shift for straight lines.
- Click a wall to select it, Delete or Backspace to remove it. Ctrl+Z / Ctrl+Shift+Z undo and redo.
- Drag the 1 and 2 markers to move the spawns, or use **Auto spawns** to place them as far apart as possible.
- Every change is saved in this browser straight away (the toolbar shows ✓ Saved), and saved maps appear on the title screen (Tab). **Delete** removes the current map. **Export** / **Import** move maps around as `.json` files.
- **Test play** (or T) starts a match on the map; leaving the match brings you back to the editor.

The status line at the bottom warns if a spawn overlaps a wall or the spawns can't reach each other.

## Balancing with the simulator

```sh
npm run sim -- --matches 500 --difficulty normal --seed 1
```

Runs bot-vs-bot matches headlessly, much faster than real time, and prints win rates by slot and spawn, round length, hits, shots and dodges per round (and laser zaps, with how often they hit), rounds per match, how often the player behind on rounds comes back, health crates, and how often each power-up's picker goes on to win the round, checked against the targets in DESIGN.md.

- `--p1 hard --p2 easy` sets each bot separately.
- `--set path=value` tries a config change without editing any files, and can be repeated: `--set round.hitsToLose=5 --set fire.cooldown=0.9`.
- `--map 'Bathroom Brawl'` runs on another built-in map (default The Flat).
- `--modifiers` plays every round under a random modifier and adds a table of round length, hits, shots and sudden-death rate per modifier. Narrow it down with `--set 'modifiers.pool=["giantBullets"]'`.
- `--json` prints machine-readable output.

All tunable numbers live in `src/config.ts`.

## Code layout

- `src/main.ts`: the entry point. Loads the phone controller for `?join` links, otherwise the game.
- `src/game.ts`: the game shell. Screens, starting and leaving matches, and the fixed-timestep loop that drives the sim, renderer and sound.
- `src/config.ts`: every tunable number, the power-up and modifier ids, and the key bindings.
- `src/settings.ts`: the choices made on the title screen and phone menu. `src/prefs.ts`: guarded access to the browser's storage, used for everything the game saves.
- `src/sim/`: the game rules. A pure fixed 60 Hz `step(state, inputs)` with a seeded RNG and no DOM or clock, so a match is reproducible from its seed, maps and inputs. Power-ups and round modifiers live here too.
- `src/input/`: keyboard and touch input (`touch.ts` is shared by phone controllers and phone play). `src/bot/`: the bot and A* pathfinding. All produce the same `{ move, dodge, shoot }` input.
- `src/render/`: canvas drawing, effects, player looks, and synthesised sound and music. Never changes game state. `renderer.ts` draws the arena and effects; `hud.ts`, `overlay.ts` and `title.ts` draw the HUD, the countdown and results, and the title screen; `layout.ts` places the arena on screen.
- `src/maps/`: the built-in maps, validation and saved-map storage.
- `src/screens/`: the DOM screens: map editor, hotseat lobby, phone lobby, and the phone menu and in-match touch overlay.
- `src/hotseat/`: the hotseat queue and scoreboard, with no DOM.
- `src/net/`: phone controllers. `protocol.ts` is the message format and room logic with no networking (unit tested); `host.ts` wires it to PeerJS. `src/phone/controller.ts` is the phone side.
- `scripts/sim.ts`: the headless simulator. `tests/`: Vitest unit tests.
- `public/`: the PWA manifest and icon. `src/sw.js`: the service worker for offline play; the build (`vite.config.ts`) adds the list of files to cache.

For tuning in the browser, `fpd.state` in the developer console is the live match state.

Settings and saved data live in the browser's `localStorage` under `fpd.*` keys (slots, looks, music, modifiers, map rotation, saved maps, the hotseat session, the phone-play bot level, and the phone's name and look).
