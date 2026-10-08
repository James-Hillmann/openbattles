# File formats

Game: LEGO Battles (USA), game code `C5SE`, maker `WR`. 3915 NitroFS files.
Findings from M0 (2026-10-08). Run `npm run m0` for the full inventory.

## Summary

| what | files | format | status |
|---|---|---|---|
| Unit/building table | `BP/Entities.ebp` | PMOC > `BPNZ` | layout partly known, see below |
| Faction / mission force setups | `BP/Factions.fbp` | PMOC > `FANZ` | names only |
| Animation table | `BP/Animations.abp` | PMOC > no magic | unknown |
| Tile blueprints | `BP/*Tiles*.tbp` (136) | PMOC > no magic | unknown, likely per-tileset tile properties |
| Maps | `Maps/*.map` (122) | PMOC > `MAPT` | header known, see below |
| Unit sprites | `Sprites/<unit>_<anim><n>.NCBR` | PMOC > `RGCN` (Nitro tile graphics) | standard once unwrapped |
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

## MAPT: maps (`Maps/*.map`, likely)

- Starts `MAP` then a `TERR` section: width byte, height byte, two bytes
  (`03 02` on every map, meaning unknown), then the tileset name as a fixed-size
  NUL-padded string (`KingTileset`, `MarsTileset`, `PirateTileset`, ...).
- Followed by a width x height byte grid of small terrain codes (values like 0, 2, 5 seen).
- Sections appear to be closed by their tag reversed (`RRET` ends `TERR`) and more
  sections follow: `EVNT`, `TRIG`, `MARK`, `MINE`, ending with `!PAM` (`MAP!` reversed).
  `MINE` is probably resource spots; `MARK` probably start positions.
- Sizes: 65 maps are 96x96, 56 are 64x64, 1 is 48x48 (the test map).
- Names: `mp01`..`mp30` (30 maps, very likely skirmish), plus campaign maps
  `ck`/`cw` (King/Wizard), `pp`/`pi` (Pirates/Imperial), `ma`/`mh` (Aliens/Astronauts).

## Unit sprite naming (likely)

`Sprites/<faction>_<role>_<anim><n>.NCBR`, e.g. `k_hrf_a0`..`a4` and `k_hrf_w0`..
Roles match the entity table's sprite paths (`hrm`/`hrf` hero, `eng` builder,
`mel` melee, `rgd` ranged). `a`/`w` are probably attack/walk; `0..4` five facing
directions, with the other three mirrored (common on DS). All units share the
cell/animation layouts in `Sprites/Anim0..7`.

## Template for new sections

### `<ext or name>` (magic `____`)

- **Example file / count:**
- **Purpose:**
- **Confidence:** guess / likely / confirmed
- **Loaded by:** function name from the function map

| offset | type | name | notes |
|---|---|---|---|
