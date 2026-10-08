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

- `BPNZ` magic, then fixed-size records of **0x7C bytes** starting at offset 4.
  Confirmed by the loader in ARM9 walking the buffer in 0x7C steps (function map: `Bp_buildEntities`).
- Record byte **+0x08 is an entity kind**: the loader switches on values 0, 1 and 2,
  creating a different object type for each (probably unit / building / other).
- Records contain many `0xA1` / `0xA2A2` filler bytes, likely "unset" markers from
  the export tool. Treat as padding until proven otherwise.
- **+0x00 u16: offset of the entity's name** in the string table at 0xFA08 (confirmed). Each name is
  followed by its sprite or model path, e.g. `K_King` then `Sprites/k_hrm`.
- +0x04 u16: index within the table. +0x06 u16: a global id (0x182 for `K_King`).
- **+0x0C u16: move speed** (likely). 410 for King, Engineer and Swordsman, 478 Archer, 614 Knight,
  819 Gryphon. In the emulator the King and a 410-speed unit both covered about 3.1 cells per second,
  measured in cells (24x16 px), not pixels. So movement is isotropic in cell space. At 30 updates a
  second, 410/4096 cells per update gives 3.0 cells/s; the measured 3.1 leaves a 3% gap to explain.
- +0x5E u16 cost in bricks (King 500, Engineer 50, Swordsman 100), confirmed for the King against the
  in-game hero card (500). +0x62 u16 hit points (King 1000), confirmed the same way.
  +0x60 u16 maybe build time (600, 150, 270). +0x66 u16 projectile id (0xFFFF = melee). guess.
- +0x6F u8 attack range in cells? (1 melee, 5 Archer, 7 Ballista). +0x70 u8 damage? guess.
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
  (not 8x8 tiles), 128 px wide for most units.
- Frames are **24x24**. Walk sheets (`*_1`) are 5x5 frames: rows are facings (back, back-right, right,
  front-right, front), columns the walk cycle. Left-facing is the right-facing row mirrored.
  `*_0` is a single 5-frame strip, `*_2` larger frames (probably attack). Heroes split per facing:
  `k_hrm_w0..w4` walk, `a0..a4` attack, 10 frames each.
- Palette: `<Faction>Faction.NCLR`, 16 banks of 16 colors. **Banks are team colors**: 0 red, 2 blue,
  4 green, 6 orange, 8 magenta, 10 grey; each odd bank is the same color with a selection outline.
  12 and 14 look like build-preview ghosts.
- `Sprites/Anim0..7.NCER/.NANR` hold one small cell ("Idle") each; not needed to cut frames.

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

"5+1" means the 5 sheet frames followed by the idle pose as a 6th frame. In sets 2-4 the walk frames
carry bit `0x4000` and the trailing idle frame doesn't, which fits "bit 14 = walk/attack sheet,
clear = idle sheet". The client plays walk as frames 0-4 then the idle pose, looped.

## Timing seen in the emulator (likely)

- The battlefield redraws every 2nd VBlank: 30 updates per second.
- A walking unit changes animation frame every 4 VBlanks (15 fps). The King hero's 6-frame walk
  loops in about 24 VBlanks (0.4 s).
- The King hero walks about 66 px/s (132 px in 120 VBlanks), about 2.2 px per update.
- The sim runs at this 30 Hz rate (`TICK_HZ`), and units move speed/4096 cells per tick, measured
  as a straight line in cell units (so 24 px across counts the same as 16 px down).
- Units and buildings are drawn by the 3D engine (main BG0); fog of war is main BG2.

## Template for new sections

### `<ext or name>` (magic `____`)

- **Example file / count:**
- **Purpose:**
- **Confidence:** guess / likely / confirmed
- **Loaded by:** function name from the function map

| offset | type | name | notes |
|---|---|---|---|
