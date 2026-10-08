# Fog of war

Game code `C5SE`. Ported in `sim/src/fog.ts`; the client draws it in
`client/src/main.ts`. Confidence per claim: **confirmed** (seen in DeSmuME),
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

- Main view: unexplored cells are covered with the grey `FoWTileset.NCGR`
  texture on main BG2, with a soft, bumpy edge (confirmed by screenshot). We
  draw flat grey (the texture's most common colour, 152/168/176) per cell.
  The texture and edge tiles are **open**.
- Minimap: unexplored stays panel background; the game redraws a few rows per
  frame. Explored but not currently visible looks darker (seen once, **likely**).
  Our minimap doesn't show fog yet. **open**
- Enemy units outside the visible grid: the client hides them. **guess**, not
  checked in the emulator.
- `User::FogCircle` objects also come from map event records (`0x020A5DC0`);
  campaign maps may use them to reveal areas. Not needed for skirmish.
