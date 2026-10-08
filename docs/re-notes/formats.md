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
- The first record has a run of small u16s at +0x5C: 500, 600, 1000, 1000, 0xFFFF, 40, 10.
  These look like stats (cost? HP? range?). **guess**. Cross-check against in-game values in M4.
- A **string table** at the end (from ~0xFA08) holds each entity's name and its
  sprite or model path, e.g. a name followed by `Sprites/k_hrm` or `Models/K_Ballista`.
  How records point into it is not known yet.

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
| ... | 2*W*H + 204 | unknown: looks like two byte planes plus a 204-byte block | open |
| `RRET`-2*W*H | 2*W*H | **ground layer**: u16 metatile index per cell | confirmed (renders correctly) |
| | 4 | `RRET` closes TERR | confirmed |

Then sections `EVNT`, `TRIG`, `MARK`, `MINE`, each closed by its reversed tag, and `!PAM`.

- **Cells are 24x16 pixels** (3x2 tiles of 8x8), so a 64x64 map is 1536x1024 px. confirmed.
- Terrain codes seen: 0 (most common, open ground), 2, 3 (water on lake maps), 5. Exact
  meanings (passable, buildable, shallow?) are open; we need them for M2 pathing.
- Ground ids >= 440 are **per-map detail metatiles**: id N reads entry N-440 of
  `BP/DetailTiles_<map>.tbp` (confirmed: with this rule mp01 and mp12 render with zero transparent
  pixels, and seams line up). In the tileset table, entries from 440 up are transparent filler.
- Mars maps have LEGO-brick tiles in some cells; whether those are decoration or object markers is open.
- 41 maps use KingTileset, 41 PirateTileset, 40 MarsTileset.

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

## Template for new sections

### `<ext or name>` (magic `____`)

- **Example file / count:**
- **Purpose:**
- **Confidence:** guess / likely / confirmed
- **Loaded by:** function name from the function map

| offset | type | name | notes |
|---|---|---|---|
