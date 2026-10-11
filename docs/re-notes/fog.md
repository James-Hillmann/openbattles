# Fog of war

Game code `C5SE`. Ported in `sim/src/fog.ts`; the client draws it in
`client/src/fogView.ts`. Confidence per claim: **confirmed** (seen in DeSmuME),
**likely** (read from the code), **guess**.

## Where it lives (confirmed)

Fog is presentation, not simulation: the classes are in the `User` namespace
(`User::FogCircle`), and only the local player's units have circles (3 circles
on a fresh mp01 game: castle, builder, King). So the lockstep state and its hash
don't include fog; each client keeps its own.

A manager object (on mp01 at `0x02269868`) holds:

| offset | meaning |
|---|---|
| +0x04 / +0x08 | first / last `FogCircle` (linked through circle +0x04) |
| +0x0C | number of circles |
| +0x10 | **explored** grid, a `Battles::BitArray2D` |
| +0x14 | **visible** grid, a `BitArray2D` |
| +0x18 / +0x1C | grid width / height in cells (64 x 64 on mp01) |

`BitArray2D`: +0x04 bytes per row, +0x08 width, +0x0C height, +0x10 data,
+0x14 table of row pointers; one bit per map cell, bit `x & 7` of byte `x >> 3`.
Set/clear `0x020EEB3C`, test `0x020EEB04`. Found by watching writes to the
minimap pixels in the emulator (py-desmume `register_write`), which led to the
bit test, then to the grids.

`FogCircle`: +0x0C cell x (u8), +0x0D cell y (u8), +0x10 radius in cells (u8),
+0x11 moved since the last stamp, +0x12 / +0x13 widen flags (below).

## Update (`0x020A15B8`, likely; result confirmed)

Runs about every second frame (807 clears of the visible grid in about 1550
frames, confirmed):

1. Clear the visible grid.
2. For every circle with radius > 0: stamp it into the visible grid. If it moved,
   also stamp it into the explored grid and clear its moved flag.

Explored cells stay explored. **Confirmed**: moving the castle's circle in RAM
to (40, 40) and back left the (40, 40) disc set in the explored grid while the
visible grid only had the start area.

## Radius (confirmed)

Entity record byte +0x71 (already read as `sight`). Castle 11, King 7, builder
5 match the three live circles. Other values: towers 7 / 9 / 11, farms 6,
most other buildings and siege 8, foot soldiers 5 or 7, transport ships 6.

## Circle shape (confirmed)

`0x020A1694` is a filled midpoint circle on cells: x = r, y = 0, err = 2(1 - r);
each step fills rows cy ± x from cx - y to cx + y, and rows cy ± y from cx - x
to cx + x, clipped to the map (`0x020A1650`); then x-- when err + x > 0, then
y++ when y > err. The port reproduces the RAM grid of a fresh mp01 game cell
for cell (`tests/sim/fog.test.ts`).

The +0x12 / +0x13 flags add one cell on the right of the cy ± x and cy ± y
rows. Which units set them is not traced (probably buildings with an even
footprint); the port always passes 0. **open**

## Drawing

### Main view (confirmed)

Fog is main BG2 (8bpp, priority 1, over the 3D/unit layers), tiles from `FoWTileset.NCGR`
(256 tiles, loaded at tile 0; the first ~96 are overwritten by the BG's own map) in **colours
0-15 of the map's tileset palette** (`KingTileset.NCLR` etc.; Mars and Pirate have their own fog
colours). The game keeps a 32 x 26 tile copy of the screen at `0x02152940` (row pointers at
`0x02151FB0`) and writes it a cell at a time (`0x02039FB4`): each map cell is 3 x 2 tiles,
lined up with the ground's cells.

Which six tiles a cell gets (`0x0203A318` -> `0x0203A460`):

1. Fog state of five cells, the cell above, left, the cell itself, right and below: 2 if in the
   visible grid, else 1 if in the explored grid, else 0. Cells off the map are 0.
2. Code = up | left << 2 | self << 4 | right << 6 | down << 8 (10 bits).
3. `codes[code]` (1024 bytes at `0x0213C81C`) picks one of 48 cell pictures; a picture is 6 tile
   numbers (288 bytes at `0x0213C6FC`), top row then bottom row.

The pictures: a solid grey cloud for never seen, a **50% checker of it for seen before but not
now** (so explored ground shows through, dimmed), nothing for seen now (picture 11, tile 100,
which is blank), and puffy edge pieces between them. A settings flag (`0x020092A8` +0 or +0x1F,
or a per-player check at `0x020A221C`) makes every in-map cell count as 2: fog off.

Check: from a RAM dump of a mp01 game, building every cell's tiles from the two grids and the two
tables gives the game's screen copy **768 of 768 tiles exact**, also after filling the explored
grid with random bits (`out/fogcheck.py`, scratch). The client draws the same pictures
(`client/src/fogView.ts`, tables read from the user's ARM9 by `extract/src/fogArt.ts`).

### Colour cycling (confirmed)

The fog shimmers because palette colours 8-15 rotate: every 2 game ticks colour i takes colour
i + 1's value and 15 takes 8's (`0x02028590`, timed against the game tick counter in the
emulator). The same mechanism animates water and lava on the ground; the cycles are set up per
tileset at `0x02038980` (tileset picked by name at `0x020A44A0`):

| tileset | colours / period in ticks |
|---|---|
| King | 8-15 / 2, 16-39 / 3, 40-47 / 3, 67-71 / 3, 239-244 / 2 |
| Pirate | 8-15 / 2, 16-39 / 3, 40-47 / 3, 199-204 / 3 |
| Mars | 8-15 / 2, 16-39 / 3, 40-47 / 3, 71-79 / 3 |

The client cycles the fog colours. **open**: the ground's water/lava cycles aren't drawn yet (our
ground is a baked picture). Where the cycle starts against our tick count isn't known; it only
shifts the phase.

### Minimap (confirmed)

The minimap is sub BG3 (scrolled to (136,40)); its tiles are rebuilt from the map's minimap data
a quarter of the rows per call (`0x02026900`, rows 0-23, 24-47, 48-71, 72-95 in turn). Per pixel,
with the cell rule from hud.md: seen now keeps its colour, never seen is colour 0 (panel shows
through), seen before takes `remap[colour]` from the 16 bytes at `0x02143D90`
(0,10,1,10,8,0,9,9,8,9,10,...): darker greens, greys and blues, the tree colour goes to background.
Check: against an emulator screenshot with random explored bits, 4657 drawn pixels, the only
mismatches are the view frame and unit dots.

Unit dots: enemies are drawn only when their cell is in the visible grid (`0x02025C14` tests it);
own and allied units always. The client's dots follow the units it draws, which matches.

### Units

- Enemy units outside the visible grid: the client hides them. **likely** for the main view
  (the minimap's dot rule above), not watched in the emulator.
- `User::FogCircle` objects also come from map event records (`0x020A5DC0`);
  campaign maps may use them to reveal areas. Not needed for skirmish.
