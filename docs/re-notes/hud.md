# HUD, selection and unit bars

Game code `C5SE`. Checked against DeSmuME screenshots and savestates (2026-10-08) with the
King and the Builder selected on The Pond. Renderer: `extract/src/hud.ts` (top screen),
`client/src/bars.ts` + `client/src/hud.ts` (bars), `extract/src/teams.ts` (outline colors).

## Screens

- The **bottom screen** is the battlefield. Its main engine draws **no 2D sprites**: units,
  buildings, selection outlines and bars all go through the 3D engine (BG0 is the 3D layer),
  with unit sheets uploaded as 4bpp textures. confirmed (OAM empty in a savestate).
- The **top screen** is the HUD, on the sub engine: background layers plus 4 sprites for the
  portrait. confirmed.

## Top screen (confirmed: our composition is pixel-exact against the emulator above the status bar)

| element | source | notes |
|---|---|---|
| Frame and panels | `UI/WorldViewTop_0.NSCR` + `UI/WorldViewTop_Back.NCGR` (4bpp) + `.NCLR` | Every entry uses palette bank 6; the game replaces bank 6 with a team ramp from `UI_ExtraColors.NCLR` (banks 0-6: red, blue, green, purple, gold, white, dark grey). Color 0 is opaque on this layer. |
| Status icons | `UI/GameAnims.NCGR` (24 tiles wide), palette `WorldViewTop_Back.NCLR` bank 14 | 2x3 tiles per frame, 12 frames per 24-tile row. Bricks at (8,168), minifig head at (88,168), red star at (160,168). Animations, measured frame by frame in the emulator (confirmed): bricks row 0 frames 0-3 over 500 ms; star row 1 frames 0-11 over 1000 ms; minifig row 2 frames 0,1,2,3,4,5,4,5,8,9,10,11 over 800 ms. |
| Counters | 8x8 glyph tiles in `WorldViewTop_Back.NCGR`, bank 14 | '1'-'5' tiles 27-31, '6'-'9','0' 59-63, '/' 91, '-' 92, '+' 93. One tile per character at y 176, from x 24 / 104 / 176. |
| Portrait | `UI/GamePlayerCards/<entity>.NCER/.NCGR/.NCLR` | One cell of 4 OAM sprites, 8bpp, 96x96, at (24,40). Not animated. The slot behind it is black. |
| HP | same glyph tiles | `hp/max` on the tile grid at y 128, starting column floor(9 - len/2). |
| Name | `Font/MSMincho-12.NFTR` (not `Font/EN/font.NFTR`, which is off by 11 px on "King") | 1 px letter spacing, white, glyph cells top at y 16, x = (216 - width) >> 1. |
| Minimap | `<map>miniNT.NCGR` (4bpp tiles) + a 16-color palette per tileset in ARM9 (C5SE: King 0x0212799C, Pirate 0x021279BC, Mars 0x021279DC) | 1:1 at (136,40), 1.5 px per cell; minimap pixel p covers map cell max(0, floor((2p - 1) / 3)) on each axis. The game draws trees itself over tree cells (terrain 1) as a repeating 4x4 pattern (rows 0100/1110/0001/1011) in palette color 5, so chopped trees vanish; tree cells with rough-ground edge bits 4 (east) or 6 (south) get no pattern. Result against the emulator: mp01 exact, mp02 (Mars) 3 of 863 revealed pixels off, mp03 4 of 839, all on tree/rough borders (likely; the residual cause is open). `LS_Maps.NCLR` is the map-select palette, not this one: it is wrong for Mars. The `mini` file without NT bakes trees in with a different pattern and is not what the game shows. Unexplored area stays panel background (fog of war; we show everything until the sim has fog). View frame: 1 px white, 16x18 for the 256x192 view. Dots: units 1 px, the castle 2x2. Dot colors are an 8-color table at ARM9 0x0212797C: index 4 is red 0x015F (confirmed on the red team), index 5 blue (likely). |

Star counter: special units against their cap; see [economy.md](economy.md) "Population and stars".

Layout record file `UI/Game/WorldViewTopScreen.bin` has the counter and icon positions (likely):
records of u16 id, u16 text id, then s16 top, left, bottom, right.

## Unit names (likely)

`LOC/<Language>.lng`: `LANG`, then a table of u32 absolute string offsets from 0x10 (count =
(first offset - 0x10) / 4), NUL-terminated Latin-1 strings. An entity's display name is string
`globalId - 1` (Entities +0x06): `K_King` -> "King", `K_Swordsman` -> "Guardsman",
`K_Engineer` -> "Builder". Holds for all 20 King-faction records.

## Selection outline (confirmed for the selected King)

Selected units are drawn with the odd palette bank of their team (2t + 1). The game rewrites
color 15 of those banks at load: **yellow 0x03FF for the local player's team**, red 0x001F for
the others (red for others: likely). The file palette has cyan there instead.

The same pass overwrites colors 12-14 of every team's banks from a 6 x 3 BGR555 table in ARM9
(`0x02127E48`), so the file's team colors are not quite what the game shows.

## Bars over units

Drawn by `Unit_drawBars` (`0x0203BED0`) as untextured 3D quads; no bitmap exists.

- Rows of 2x2 cells at a 3 px pitch in a black box, 4 px tall per row. A 24 px unit has
  7 cells (22 px). confirmed. Width rule `cells = w / 3 - ((w - 1) & 1)` with
  `w = min(24 * footprint, 64)`: likely.
- Lit cells = `floor(floor(100 * hp / max) * 7 / 100)`; no minimum. confirmed by poking HP
  (999/1000 shows 6, 143/1000 shows 0).
- Unlit cells are drawn dark (each channel 31 -> 10). confirmed.
- Health color by HP%: >= 40 green 0x03E0, 20-39 orange 0x015F, < 20 red 0x001F. confirmed.
- Heroes get a second row 4 px above: special-ability charge, lit 0x027F. It refills in about
  32 s. confirmed for the King; that it is the ability charge is likely.
- Position: left edge = sprite frame's left edge; health row from frame top - 6 to - 3. confirmed.
- When: units show bars while selected (and when unit +0x1D4 > 0, meaning unknown);
  buildings when HP <= 32%. Damage alone does not show a unit's bar. confirmed.

## Unit struct offsets seen (likely)

`+0x160` -> `[+8]` type record (kind +0x5C, max HP +0x62, max charge +0x64);
`+0x1A0` s16 current HP, `+0x1A2` s16 hero charge.

## Command icons (build / train strips)

Checked 2026-10-08 against savestates with the Builder (build strip open) and the Castle (train strip open).

- **Bottom strip is 3D** (BG0): disabling main BG0 in DeSmuME removes the strip, the deselect button and
  the units; BG1 is the map. No OAM. confirmed.
- **Top "Build Costs" panel is sub BG2** (4bpp, palette bank 7). The game copies each icon's 3x3 tiles
  from `UI/MiniHeadsGame.NCGR` into VRAM slots (tile 7 + 3*col + 0x60*row) and writes the map entries.
  The VRAM tiles are byte-identical to the file. confirmed.
- **Icon sheet** `UI/MiniHeadsGame.NCGR` (also `.NCBR`, the same pixels in linear order): 48x30 tiles, 4bpp,
  1440 tiles. It is a grid of 160 cells of 24x24, 16 per row; icon `i` is at pixel `((i % 16) * 24, (i / 16) * 24)`.
  Palette `UI/WorldViewTop_Back.NCLR` bank 7 (red). `blitTile` masks tiles to 10 bits, so it can't
  draw cells past tile 1023 (rows 7-9 of icons): read `pixels` directly. confirmed.
- Icon indices: Castle 9, LumberMill 10, Mine 11, Farm 12, Barracks 13, Stables 14, Tower 15, Wall 96,
  King (hero) 104, Builder 105, Bridge 149, Shipyard 151. confirmed for these, from both screens.  The
  mapping is the ARM9 icon table at 0x0214E400 (armies.md); the King's hero and builder strip icons are
  their table cells + 104.
- Strip order for the King Builder: Castle, Farm, Lumber Mill, Mine, Barracks, Stables, Shipyard, Tower,
  Wall, Bridge; for the Castle: hero, Builder. Icons are 24x24 at bottom-screen (12 + 24k, 40). confirmed.
- **Bottom-strip texture**: `UI/AllInOne/UI_MainCastle.NCBR` (256x256, 4bpp) sits at texture VRAM 0 and
  `UI_MainCastle.NCLR` at texture palette 0. The strip uses bank 7, which equals WorldViewTop_Back bank 7.
  The game overwrites some 24x24 atlas cells with MiniHeadsGame icons at runtime (Castle/Stables/Tower/
  Farm/Shipyard with the Builder selected, hero/Builder at (0,120)/(24,120) with the Castle selected).
  The other cells keep the file's art; the Bridge comes from the atlas at (120,120), not MiniHeadsGame 149
  (18 px differ). confirmed.
- Deselect (stop) button: atlas (232,24) 24x24, drawn at bottom (4,168) (first row differs). Strip left cap:
  atlas (248,168) 8x24 at (4,40), exact. likely / confirmed.
- The hero icon on the Castle strip is partly drawn in dark red (14,2,0), probably an "unavailable"
  overlay because the King is alive. guess.
