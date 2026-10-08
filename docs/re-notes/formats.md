# File formats

Game: LEGO Battles (USA), game code `C5SE`, maker `WR`. 3915 NitroFS files.
Findings from M0 (2026-10-08). Run `npm run m0` for the full inventory.

## Summary

| what | files | format | status |
|---|---|---|---|
| Unit/building table | `BP/Entities.ebp` | PMOC > `BPNZ` | layout partly known, see below |
| Faction / mission force setups | `BP/Factions.fbp` | PMOC > `FANZ` | names only |
| Animation table | `BP/Animations.abp` | PMOC > no magic | unknown |
| Metatiles | `BP/*Tiles*.tbp` (136) | PMOC > u16 count + 3x2 screen entries | confirmed |
| Maps | `Maps/*.map` (122) | PMOC > `MAPT` | ground layer renders; objects open |
| Unit sprites | `Sprites/<unit>_<n>.NCBR` | PMOC > `RGCN`, linear 4bpp bitmap | 24x24 frames decoded |
| Sprite cells/animations | `Sprites/Anim0..7.NCER/.NANR` | Nitro `RECN`/`RNAN` | standard, shared by all units |
| Map tilesets | `KingTileset.NCGR` etc. | Nitro `RGCN` + `RLCN` palettes | standard |
| Minimaps | `<map>mini.NCGR/.NCBR` | PMOC > `RGCN` | standard |
| Big units (ballista, dragon, ships, giant...) | `Models/*.nsbmd/.nsbca` + 4 in root | Nitro 3D `BMD0` / `BCA0` | standard, hard to render |
| Text | `LOC/*.lng` (8 languages) | `LANG` | unknown |
| Sound | `Sound/sound_data.sdat` | Nitro `SDAT` | standard (sseq/swar), low priority |
| Cutscenes | `Movies/*.mods` | Mobiclip `MODS` | skip |

Takeaway: once PMOC is unwrapped, graphics are **standard Nitro SDK formats**.
The custom work is the `BP/` blueprint files and maps.

## PMOC container (confirmed)

The game's own compression wrapper. Every one of the 2178 PMOC files decodes
to exactly its stated size. Decoder: `extract/src/pmoc.ts`.

| offset | type | meaning |
|---|---|---|
| 0x00 | char[4] | `PMOC` ("COMP" as a little-endian u32) |
| 0x04 | u32 | total decompressed size |
| 0x08 | u32 | chunk count N |
| 0x0C | u32 | largest chunk size in the file (buffer hint) |
| 0x10 | i32[N] | each chunk's size in the file; **negative = stored raw** |
| 0x10+4N | | chunks back to back |

Each chunk is a Nintendo LZ11 stream that decodes to at most 0x1000 bytes
(`extract/src/lz.ts`). Raw chunks show up on data that doesn't compress, e.g.
`BP/KingTiles.tbp` is one raw 0xF002-byte chunk.

## BPNZ: entity blueprints (`BP/Entities.ebp`, likely)

The unit and building table. 75,195 bytes decompressed.

- `BPNZ` magic, then 0x227 records starting at offset 4. **Record size depends on the kind byte at +0x08**:
  0x7C for kind 0 (units and buildings), 0x74 for kind 1 (projectiles), 0x70 for kind 2 (pickups and
  mission items). Confirmed by the loader's switch (`Bp_buildEntities`); the walk ends exactly at the
  string table (0xFA08). Parser: `extract/src/entities.ts`.
- Records contain many `0xA1` / `0xA2A2` filler bytes, likely "unset" markers from
  the export tool. Treat as padding until proven otherwise.
- **+0x00 u16: offset of the entity's name** in the string table at 0xFA08 (confirmed). Each name is
  followed by its sprite or model path, e.g. `K_King` then `Sprites/k_hrm`.
- +0x04 u16: entity index (confirmed; keys the combat bonus tables). +0x06 u16: a global id (0x182 for `K_King`).
- **+0x0C u16: move speed** (confirmed). 410 for King, Engineer and Swordsman, 478 Archer, 614 Knight,
  819 Gryphon. A unit moves exactly speed/4096 cells per game update, as a straight line in cell
  units (24x16 px). The ~3% extra seen in the emulator comes from the update rate, not the speed;
  see "Movement speed and update rate" below.
- +0x5E u16 cost in bricks (King 500, Engineer 50, Swordsman 100), confirmed for the King against the
  in-game hero card (500). +0x62 u16 hit points (King 1000), confirmed in the emulator.
  +0x60 u16 maybe build time (600, 150, 270), guess.
- **Combat fields +0x66..+0x71** (projectile, damage, random damage, cooldown, range, sight): see
  [combat.md](combat.md). Damage, random damage, cooldown and HP are confirmed in the emulator.
- +0x14 u8 looks like a unit class (guess): 2 builder, 3 melee and heroes, 4 ranged, 5 siege/flying,
  6 transport ship, 7 production buildings, 4 towers, 8 mine. +0x15 u8 is 3 for melee, 2 ranged,
  1 builder, 4 siege; 0 for buildings. Neither selects the animation set (below).
- The sim now uses +0x0C directly as `Unit.speed` (see `sim/src/world.ts`).

### Factions found in the name table

Six playable factions, 20 entities each, all with the same shape:
hero (+ `_F` variant), builder, melee, ranged, mounted, three special/siege units,
transport ship, and 10 buildings (base, two resource buildings, a support building,
barracks, special production, a tower with two upgrade levels, shipyard).

| prefix | faction | hero |
|---|---|---|
| `K_` | King | King |
| `W_` | Wizard | Wizard |
| `P_` | Pirates | Captain |
| `I_` | Imperial | Governor |
| `E_` | Astronauts (Earth) | Commander |
| `A_` | Aliens | Alien King |

Plus ~40 campaign/neutral entities (bridges, walls, gates, Space Police,
Islanders, Ninjas, sharks, shipwrecks, mission objects).

## MAPT: maps (`Maps/*.map`)

Decoder: `extract/src/map.ts`, renderer `extract/src/render.ts`.

| offset | size | meaning | confidence |
|---|---|---|---|
| 0x00 | 3 | `MAP` | confirmed |
| 0x03 | 4 | `TERR` section start | confirmed |
| 0x07 | 1 | width in cells (48 / 64 / 96) | confirmed |
| 0x08 | 1 | height in cells | confirmed |
| 0x09 | 2 | `03 02` on every map: probably the cell size in tiles (3 wide, 2 high) | likely |
| 0x0B | 32 | tileset name, NUL-padded (`KingTileset`, `MarsTileset`, `PirateTileset`) | confirmed |
| 0x2B | W*H | **terrain grid**, one byte per cell | confirmed layout, meanings guessed |
| 0x2B+W*H | W*H | **edges**: 8-neighbour bitmask of rough-ground borders (bit 0 NW, 1 N, 2 NE, 3 W, 4 E, 5 SW, 6 S, 7 SE) | confirmed (the game reads it when picking tree tiles) |
| 0x2B+2*W*H | W*H | **regions**: small ids grouping areas (rough patches, cliffs); meaning open | open |
| 0x2B+3*W*H | 2+n | **tree mask**, run-length coded: u16 byte count n, then n run lengths alternating open / tree, starting with open; runs sum to W*H | confirmed (all 122 maps) |
| `RRET`-2*W*H | 2*W*H | **ground layer**: u16 metatile index per cell | confirmed (renders correctly) |
| `RRET`-2*W*H | 2*W*H | **ground layer**: u16 metatile index per cell | confirmed (renders correctly) |
| | 4 | `RRET` closes TERR | confirmed |

Then sections `EVNT`, `TRIG`, `MARK`, `MINE`, each closed by its reversed tag, and `!PAM`.

- `MINE` (confirmed layout, all 122 maps): four lists, each `L`, u8 count, then count x (u8 x, u8 y).
  Only the second list is ever non-empty: the cells where a Mine can be built. The marking on the
  ground (cracked earth) is already part of the ground tiles; the emulator shows nothing else drawn there
  before a Mine is built. That each site is the top-left of a 2x2 footprint is likely, from where the crack sits.
- `MARK` (guess): lists of `L`, u8 type, u8 count, count x (x, y, 0). mp01 has type 0 points along the map
  edges and type 3 points scattered inland. Possibly AI or pickup spots; nothing is drawn at them on load.

- **Cells are 24x16 pixels** (3x2 tiles of 8x8), so a 64x64 map is 1536x1024 px. confirmed.
- Terrain codes in files: 0 open ground, 2 rough ground, 3 water, 5 cliff/plateau. At load the
  game adds **1 = tree** (see Trees). 0 and 3 confirmed from the emulator; 2 and 5 likely, from
  where they sit on the rendered maps. On mp01, 2 is the sandy ground around the lake and 5 the
  raised rock plateaus.
- **Walking (confirmed in the emulator, mp01):** the King was ordered into a forest, onto a plateau
  and into the lake. Each time he stopped on the nearest open cell next to it (forest edge, the
  plateau's near side, the shore). He walks on 0 and 2. So 1, 3 and 5 block walking. When the
  target can't be reached, the unit goes to the closest reachable spot instead of refusing.
  Building placement rules are still open. How the game picks its path is not decoded; the sim
  uses its own A* (`sim/src/terrain.ts`), which matches the stopping behaviour above.
- Ground ids >= 440 are **per-map detail metatiles**: id N reads entry N-440 of
  `BP/DetailTiles_<map>.tbp` (confirmed: with this rule mp01 and mp12 render with zero transparent
  pixels, and seams line up). In the tileset table, entries from 440 up are transparent filler.
- Mars maps have LEGO-brick tiles in some cells; whether those are decoration or object markers is open.
- 41 maps use KingTileset, 41 PirateTileset, 40 MarsTileset.

## Trees (confirmed)

Trees are not sprites. They are ground metatiles that the game writes over the map at load.
Checked against the running game in an emulator: the baked ground and terrain layers match
our output cell for cell on mp01 (King), mp02 (Mars) and mp03 (Pirate). The only differences
on mp03 were two trees an AI builder had already started chopping.

What the game does at load:

1. Decode the tree mask. For each tree cell whose terrain is 0, set terrain to 1. A tree on any
   other terrain is dropped (mp03 has one on water).
2. For every terrain-1 cell, build a key from its 3x3 neighbourhood. Each of the 9 cells
   (row-major, NW first) gets 2 bits:
   - 2 if the centre cell's edges bit for that neighbour is set,
   - else 0 if the neighbour is on the map and its terrain is 0,
   - else 1 (tree, water, cliff, or off the map).
   The centre cell is always 1.
3. Look the key up in a range table: 230 sorted start keys, a u16 length each, and a byte array
   each. The result is the metatile id; `0xFF` or an out-of-range key gives a fallback id.
4. Write that id into the ground layer.

The same table serves all three tilesets, which share their layout for tree tiles. The tables live
in ARM9 (USA addresses in `extract/src/trees.ts`). We read them from the player's ROM at load and
never copy them into the repo.

## Tilesets (confirmed)

- Graphics: `<Name>Tileset.NCGR` (PMOC > standard NCGR, 8bpp, 1024 tiles) + `<Name>Tileset.NCLR` (256 colors).
- Metatiles: `BP/<Name>Tiles.tbp` (PMOC). u16 count (5120), then count x 6 u16 **BG screen entries**
  in row order (3 across, 2 down). Screen entry bits: 0-9 tile, 10 h-flip, 11 v-flip, 12-15 palette (unused at 8bpp).
- `BP/DetailTiles_<map>.tbp`: same layout (u16 count + 6-entry metatiles), one per map (133 files,
  incl. mp01..mp30). Indexed by ground id - 440 (confirmed, see Maps above).

## Unit sprites (confirmed)

- `Sprites/<faction>_<role>_N.NCBR` are PMOC > NCGR-format data holding a **linear 4bpp bitmap**
  (not 8x8 tiles), 128 or 256 px wide.
- Palette: `KingFaction.NCLR` for **every** faction (the only unit palette in the ROM), 16 banks of 16
  colors. **Banks are team colors**: 0 red, 2 blue, 4 green, 6 orange, 8 magenta, 10 grey; each odd bank
  is the same color with a selection outline. 12 and 14 look like build-preview ghosts. On screen the
  game swaps the outline color (cyan in the file) for yellow on your own selected units.
- Each entity's sprite comes from the asset path after its name in `Entities.ebp`. The six playable
  factions have six sprite units each (36 total); their other four movers are 3D models (below).
  Sprite file prefixes don't always match the entity prefix: Astronauts (`E_`) use `h_`.

| layout | asset suffix | files | frames | confidence |
|---|---|---|---|---|
| hero | `_hrm`, `_hrf` | `_w0..4` walk, `_a0..4` attack, one file per facing | 6 x 24 px in a row; idle = walk frame 0 | confirmed (King, emulator) |
| infantry | `_eng`, `_mel`, `_rgd` | `_0` idle strip (one frame per facing), `_1` walk, `_2` attack | 5 facing rows x 5 frames of 24 px | confirmed (King builder, emulator) |
| mounted | `_bld_mtd` (shared with the buildings) | the faction's building sheet | 32 px frames, facing rows from y = 96; cols 0-2 walk, 3-7 attack, idle = col 1 | likely (from the animation table; all six sheets line up) |

Facing rows are back, back-right, right, front-right, front; left facings are the right ones mirrored
(confirmed: a builder walking down-left showed the front-right row flipped).

Units drawn from 3D models: see "3D models" below.

### Where sprites sit (emulator, C5SE)

Measured by reading unit positions (unit +0xEC/+0xF0, 20.12 px) next to the sprite frames found on
screen with `track.py`, for idle units on one screen:

- A 24 px frame (King builder, King hero) is drawn with its left edge 12 px and its top 15 px from the
  point the position maps to. Both units gave the same offset. confirmed (relative).
- A 32 px mounted frame (King knight) sits 4 px further left and 8 px further up than a 24 px frame
  for the same position. confirmed. The client's anchors (12, 19) and (16, 27) keep that difference.
- A ballista's model origin lands on that same point (fitted to within about 1 px). likely.
- Units at rest sat on multiples of 24 x 16 px (cell corners in our tile grid), e.g. (264, 240) and
  (192, 288). How that lines up with our sim's cell centres is open (open-questions.md).

## 3D models (`Models/*.nsbmd` + `.nsbca`)

The siege units, flyers, ships and the Giant are Nitro 3D models (`BMD0`) with one joint animation
each (`BCA0`). Decoders: `extract/src/nsbmd.ts`, `extract/src/nsbca.ts`; renderer
`extract/src/raster.ts`, `extract/src/modelSprites.ts`. Both formats are the standard Nintendo SDK
ones; what's specific to this game:

| finding | confidence |
|---|---|
| Each `.nsbca` holds **one long animation** per model (e.g. 91 frames for the King ballista, 99 for the dragon); the game plays sub-ranges of it (next section). | confirmed |
| The model's **size comes from the animation**: it scales the top object (ballista 11.96, catapult 0.45, dragon 0.42 on the body...). The bind pose alone gives sizes from 3 to 80 units. With the animation applied every unit model lands on one world scale. | confirmed |
| Camera: orthographic, looking down **45°**, **1 px per world unit**. Fitted against the King ballista, catapult and dragon (silhouette overlap 0.74-0.87 against the emulator, pitch 40/45/50 and scale 0.95/1/1.05 tried; 45° and 1.0 won for all three). | confirmed |
| Facing: models turn to their direction of travel **measured in map cells** (24 x 16 px), with the model's +Z axis pointing that way. Ballista moving left fitted yaw 260°, catapult 250°, dragon 270° (direction in cells: about 255°). | confirmed |
| Team colors: texture palette entries 0-15 hold `KingFaction.NCLR` bank 2 (blue); the game swaps in the owner's bank (a red King ballista on screen). | confirmed |
| A selected model gets a 1 px outline in the selection color (yellow for your own units). | confirmed (seen); exact pixels guess |
| Joint animation rotations come as either a pivot-compressed matrix (same scheme as model objects) or a "basis" matrix in 10 bytes: five cells in the top 13 bits of five s16, a sixth cell (13-bit signed) spread over their low 3 bits (word 4's first, then words 0-3), the last row from a cross product. All 4389 basis entries the unit animations use come out orthonormal. | confirmed |
| Animation frames advance **one per 2 VBlanks** (30 fps; the controller's frame counter in RAM, with the odd repeated frame when the game lags). | confirmed |

The game turns models smoothly; the client draws 32 facings and renders each pose on first use.

## Model animation clips (ARM9, confirmed)

Found by watching the model's animation object in RAM (frame counter as 20.12 at its +0) and the
write that sets it (`0x0203B720`: frame = controller base + local counter):

- Each model unit has three animation controllers: **0 idle, 1 move, 2 attack** (built at
  `0x0200D584`/`0x0200D5B8`/`0x0200D5EC` with clip numbers 0, 1, 2).
- A clip is 3 bytes: first frame, end frame (exclusive), and a byte that is always 1. `first == end`
  holds one pose (the King ballista's idle is frame 0, its attack stance frame 60).
- `0x0200D188` gets a clip: `0x0200CE5C` maps the entity index (`Entities.ebp` +0x04) to a clip-set
  number with a compare tree (unknown indices get set 0), then a pointer table at `0x02142864` gives
  that set's 5 clips (only the first 3 are used).
- Seen: the King dragon plays frames 50-87 hovering (idle), 0-39 flying (move), 50-87 again while
  attacking (the fire comes from a particle effect). The ballista's controllers sat on 0 and 60.
- The client reads the table from the user's ARM9 at load (`extract/src/modelClips.ts`, which runs
  the compare tree with a tiny ARM interpreter) rather than shipping the numbers.

## Animations (`BP/Animations.abp`, likely)

PMOC > 2580 bytes of back-to-back records, no header. Parses exactly to 180 records:
12 animation sets (ids 0-5 and 17-22, the second group repeats the first) x 3 animations x 5 facings.

| offset | size | meaning | confidence |
|---|---|---|---|
| 0 | 1 | animation set id | confirmed (structure) |
| 1 | 1 | animation: 0 idle, 1 walk, 2 attack | likely |
| 2 | 1 | play mode: 0 loop, 1 ping-pong?, 2 once? | guess |
| 3 | 1 | facing 0-4 (back, back-right, right, front-right, front) | likely |
| 4 | 1 | frame count n | confirmed |
| 5 | 1 | always `0xA1` | confirmed |
| 6 | 2n | per frame: u16 start tile in the sheet (8x8 tiles, row-major). Bits 14/15 look like a frame-size class (0x8000 frames step 4 tiles = 32 px; others step 3 = 24 px) | guess |

### Which animation set a unit uses (likely)

No entity field picks the set; it follows from the sprite kind. The six base sets match the six
sprite layouts:

| set | frames | layout | used by (sprite path suffix) |
|---|---|---|---|
| 0, 1 | idle 1, walk 6, attack 6 | one file per facing, 6 frames of 24 px in a row | heroes (`_hrm`, `_hrf`) |
| 2, 3, 4 | idle 1, walk 5+1, attack 5+1 | `_0` idle row, `_1` walk sheet, `_2` attack sheet | builder, melee, ranged (`_eng`, `_mel`, `_rgd`); which is which is a guess, they differ only in VRAM position |
| 5 | idle 1, walk 3 ping-pong, attack 5+1 | 32 px frames (`0x8000` flag) | mounted unit |

The start tiles index some VRAM layout we haven't reproduced; the client cuts frames from the sheets
instead (rows = facings, columns = frames), which matches the emulator for the King hero and builder.
Two entries look off by one tile (set 2 back-right walk frame 3 is `0x424a` where the pattern says
`0x4249`; set 4 back-right walk frames 2-4 are one tile early). The King builder's back-right walk in
the emulator is clean, so either it isn't set 2 or the game doesn't use these as plain offsets. open.

"5+1" means the 5 sheet frames followed by the idle pose as a 6th frame. In sets 2-4 the walk frames
carry bit `0x4000` and the trailing idle frame doesn't, which fits "bit 14 = walk/attack sheet,
clear = idle sheet". The client plays walk as frames 0-4 then the idle pose, looped.

## Unit animation timing (confirmed, emulator)

Measured frame by frame with `tools/emu/burst.py` + `track.py` on the King builder and King hero:

- Every walk frame shows for 4 VBlanks (15 fps). Builder: walk frames 0-4 then the idle pose, looped.
  Hero: walk frames 0-5, looped.
- The cycle keeps counting when the facing changes mid-walk.
- On arrival the unit **finishes the current pass** of the walk cycle (up to 5 more frames) before it
  shows the idle pose. Client: `client/src/unitAnim.ts`.
- The mounted ping-pong walk comes from the animation table and is not yet checked frame by frame.

## Timing seen in the emulator (likely)

- The battlefield usually updates every 2nd VBlank (30 per second), but not always; see below.
- A walking unit changes animation frame every 4 VBlanks (15 fps). The King hero's 6-frame walk
  loops in about 24 VBlanks (0.4 s).
- The sim runs at 30 Hz (`TICK_HZ`), and units move speed/4096 cells per tick, measured
  as a straight line in cell units (so 24 px across counts the same as 16 px down).
- Units and buildings are drawn by the 3D engine (main BG0); fog of war is main BG2.

## Movement speed and update rate

**Per-update step (confirmed).** A unit's position is two s32 values in 20.12 pixels (1/4096 px).
For the King (speed 410) on mp01, each update moved it by exactly:

| direction | dx | dy | length in cells |
|---|---|---|---|
| right | 9840 | 0 | 9840/24 = 410 |
| down | 0 | 6560 | 6560/16 = 410 |
| down-right, 1:1 in cells | 6957 | 4638 | 410.0 |
| up-left, 3:5 in cells | -5062 | -5625 | 410.0 |

So the step is speed/4096 cells per update, isotropic in cell space, with no hidden multiplier.
`tests/sim/movement.test.ts` checks the sim against these numbers.

**Update rate (likely).** The game has no fixed tick. Its main loop (`Game_mainLoop`, see
function-map.md) does:

1. `t0` = milliseconds now.
2. Wait for the next VBlank.
3. Run one game update (`Game_frame`): units move one step.
4. If less than 20 ms passed since `t0`, wait for one more VBlank.

The 20 ms check is meant to hold the game at 30 updates a second. But `t0` is taken before the
first wait, so when an update ends just before a VBlank, the next iteration's first wait is short,
the 20 ms is already used up, and the update after it comes only 1 VBlank later. When an update runs
long, the gap is 3 VBlanks. Over 1,850 frames of the King walking on mp01 in DeSmuME, the gaps
between updates were 2 VBlanks 80% of the time, 1 VBlank 13%, and 3 VBlanks 7%: 30.7 updates per
second on average. That is the ~3% "faster than the table" seen before. (The 66 px/s figure noted
earlier was a rough screen measurement and is superseded by the RAM values above.)

How often the short gap happens depends on how long each update takes, which depends on how much
is on screen and how fast the CPU is. DeSmuME's ARM9 timing is not cycle-exact, so the real DS may
land on a different average. (guess: real hardware is slower per frame, so closer to 30.)

**What we do.** The sim keeps a fixed 30 Hz tick: lockstep needs a fixed rate, and 30 Hz is the
rate the game's loop aims for. Each tick moves exactly what one game update moves.

## Template for new sections

### `<ext or name>` (magic `____`)

- **Example file / count:**
- **Purpose:**
- **Confidence:** guess / likely / confirmed
- **Loaded by:** function name from the function map

| offset | type | name | notes |
|---|---|---|---|
