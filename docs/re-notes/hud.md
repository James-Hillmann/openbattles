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
| Status icons | `UI/GameAnims.NCGR` (24 tiles wide), palette `WorldViewTop_Back.NCLR` bank 14 | 2x3 tiles each. Bricks tile 2 at (8,168), minifig head tile 146 at (88,168), red star tile 74 at (160,168). Head and star animate (frames every 4 tiles); we draw frame 0. |
| Counters | 8x8 glyph tiles in `WorldViewTop_Back.NCGR`, bank 14 | '1'-'5' tiles 27-31, '6'-'9','0' 59-63, '/' 91, '-' 92, '+' 93. One tile per character at y 176, from x 24 / 104 / 176. |
| Portrait | `UI/GamePlayerCards/<entity>.NCER/.NCGR/.NCLR` | One cell of 4 OAM sprites, 8bpp, 96x96, at (24,40). Not animated. The slot behind it is black. |
| HP | same glyph tiles | `hp/max` on the tile grid at y 128, starting column floor(9 - len/2). |
| Name | `Font/MSMincho-12.NFTR` (not `Font/EN/font.NFTR`, which is off by 11 px on "King") | 1 px letter spacing, white, glyph cells top at y 16, x = (216 - width) >> 1. |
| Minimap | `<map>miniNT.NCGR` (4bpp tiles) + `UI/AllInOne/LS_Maps.NCLR` bank 9 | 1:1 at (136,40), 1.5 px per cell. Trees are drawn by the game over tree cells as a repeating 4x4 dark-green pattern (rows 0100/1110/0001/1011, color 0x11E5), so chopped trees vanish: likely (17 of 944 visible pixels differ, all on tree borders). The `mini` file without NT bakes trees in with a different pattern and is not what the game shows. Unexplored area stays panel background (fog of war; we show everything until the sim has fog). View frame: 1 px white, 16x18 for the 256x192 view. Dots: units 1 px, the castle 2x2, red team 0x015F: confirmed. Other teams' dot colors: open. |

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
