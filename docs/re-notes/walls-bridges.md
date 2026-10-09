# Walls and bridges

Every army builds the same Wall and bridges (Factions.fbp slots 19-25 hold the
Wall and the six bridges for all six factions). Gates exist in the entity table
but no skirmish strip offers them, so we leave them out (see Open). Sim code:
`sim/src/walls.ts`; drawing: `extract/src/structures.ts` and
`client/src/structures.ts`.

Found 2026-10-09 in ARM9 (C5SE) and checked in headless DeSmuME on mp01 (walls)
and mp04 River Crossing (bridges).

DS note: walls and bridges have no sprite. They are drawn into BG1, the 2D map
layer, by swapping the map's own tile and metatile numbers for that cell. A BG
"screen entry" is a 16-bit number that names an 8x8 tile in the tileset's
character data.

## Entity records (Entities.ebp)

| entity | index | HP | cost | build ticks | role | size code | footprint (w x h) | terrain | layer | sight |
|---|---|---|---|---|---|---|---|---|---|---|
| Wall | 120 | 250 | 10 | 60 | 19 | 1 | 1x1 | open | ground + air flags | 3 |
| BridgeSmallH / V | 121 / 122 | 350 | 10 | 30 | 17 | 7 / 4 | 3x2 / 2x3 | rough + water | bridge | 5 |
| BridgeMediumH / V | 123 / 124 | 500 | 10 | 30 | 17 | 8 / 5 | 6x2 / 2x6 | rough + water | bridge | 5 |
| BridgeLargeH / V | 125 / 126 | 650 | 10 | 30 | 17 | 9 / 6 | 9x2 / 2x9 | rough + water | bridge | 5 |
| GateH / GateV | 127 / 128 | 100 | 10 | 180 | 18 | 11 / 10 | 4x1 / 1x4 | open | | |

confirmed (record bytes; HP and build time also watched in the emulator for a
Wall and a BridgeMediumH).

**The size code (+0x1D) is an index, not a side length.** The game's table at
`0x02001170` gives (w, h): 1 1x1, 2 2x2, 3 3x3, 4 2x3, 5 2x6, 6 2x9, 7 3x2,
8 6x2, 9 9x2, 10 1x4, 11 4x1. Codes 1-3 are the squares every other building
uses, so treating the code as a side was right until now. The sim's
`fpW`/`fpH` (`sim/src/footprint.ts`) read the table. confirmed (code; every
bridge measured matches)

## Walls

### Placing (drag)

- Pick the Wall on the Builder's strip (after the Tower), then drag on the map.
  A green line follows the stylus; letting go sends one
  `ConstructMultipleCommand` (builders, entity type, start cell, end cell).
  confirmed (emulator)
- The cells come from `0x020679D0`. With d = end - start, the line runs along
  x if |dx| > |dy| (a tie goes along y). The number of steps n is
  |d along the line| divided by the footprint along it (1 for a wall), in the
  DS's 20.12 fixed point. Each axis steps by `FX_Div(d, n)` (rounded to the
  nearest 1/4096), and the cell for step i = 0..n is start + floor(i * step).
  So (0,0) to (5,2) gives y = 0,0,0,1,1,1, and (0,0) to (5,-2) gives
  y = 0,-1,-1,-2,-2,-2. confirmed (code; a 5-wall drag in the emulator matches)
- Each cell is kept only if the per-cell check `0x020016AC` passes and it isn't
  already in the list. We read that check as "the terrain takes a wall" (open
  ground). likely: whether it also refuses unexplored cells is not traced; we
  don't refuse them.

### Building

From `ConstructMultipleEntityCommand` (update `0x02067C30`, 8 states) and the
emulator:

- Pieces go up one at a time, in line order. confirmed (emulator)
- A piece is paid (10 bricks) and put down with 1 HP when the builder gets to
  it, not when the line is dragged. Out of bricks, the order stops there
  (state 0 checks the cost). confirmed (emulator: bricks dropped by 10 per
  piece as each started)
- The builder works from **outside**: from any cell touching the piece,
  diagonals included, and it doesn't move while it already touches the next
  piece. Each piece takes 60 ticks; HP rises with the work like any site.
  confirmed (emulator, five pieces)
- Walking up: the game tries up to 5 times to find a spot next to the piece.
  We skip a piece with nowhere to stand. guess (the 5 tries are code; what
  happens after is not traced)
- Units standing where the piece goes (state 2): the game helps a piece of the
  same type someone already started, or nudges the units off. We move our own
  idle units away and skip the piece for anyone else's. guess (state 2 is only
  partly read)
- A Builder sent to an unfinished wall (right-click) helps it from outside.
  likely
- A wall blocks ground units and flyers: it takes both its ground and air
  occupancy (record +0x1A and +0x1B). The sim marks the cell with its
  building code (4), which nothing can enter. confirmed (flags); likely (that
  flyers can't cross; not watched)

### Drawing

`0x02034B44` runs for every map cell that holds a wall, after the cell's ground:

1. **Neighbour mask** (`0x0205DFE0`, kept at unit +0x224): bit 0 east, bit 1
   north, bit 2 west, bit 3 south, set when that cell holds a wall of the same
   palette slot (same player). The new mask is the computed one ORed with the
   old one minus the south bit, so links to the east, north or west stay drawn
   after that neighbour is gone. If the result is 0 and the old mask had south,
   it becomes north. It is only recomputed when a flag (0x10) says a neighbour
   changed. confirmed (code); the five-wall drag ended with masks 1, 5, 5, 5, 4
   (confirmed, RAM)
2. **Tiles**: a 16-entry table of 6 bytes (top row, then bottom row) per mask.
   Odd x uses the table at `0x02127CF0`, even x the one at `0x02127D50` (the
   same with the two columns swapped, so the grey/team stripes continue across
   cells). 0xFF keeps the ground tile. confirmed (code; screen entries read
   from BG1 VRAM matched)
3. A byte b becomes tile b + base[b odd ? slot : 0] (u16 table at
   `0x02127CC4`, 0x3C8 for slot 0), plus 0x20 under 33% HP or 0x18 under 66%,
   plus 4 if unit +0x71 is set (meaning unknown; those tiles have a cyan
   border). Tiles come from `<Faction>Tileset.NCGR`. confirmed (code, tiles)

Unfinished walls draw the same way, so a new piece looks battered and mends as
it is built. likely (follows from the code: nothing checks progress)

## Team colour (walls and bridges)

BG palette entries 0x37 + 3s .. 0x39 + 3s are overwritten with a 3-colour ramp
for palette slot s (`0x02034D84`, from `0x02028508`). The ramps (RGB555, light
to dark) are at `0x02127CCC`, in team-colour order: red, blue, green, yellow,
magenta, grey. Each slot's wall tiles and bridge metatiles are the same art on
that slot's own palette entries, so we draw slot 0's art once per team colour.
confirmed (palette VRAM: slot 0 red, slot 1 blue)

## Bridges

### Sites

- Bridges go only on the map's bridge sites: the MARK section's lists of type
  7 (horizontal) and 8 (vertical) points, each the top-left cell of the span.
  MARK is 'L', type, count, then count x (x, y, one more byte). confirmed
  (site builder `0x020A36E4`; mp04 in the emulator)
- **Size** (`0x020A36E4`): try small, medium, then large. The far end is start +
  3, 6 or 9 cells along the span. If the terrain there is water (3) or 4, try
  the next size; large is always taken. confirmed (code; all four mp04 sites)
- Skirmish maps with sites: mp04, mp07, mp08, mp09, mp14, mp22, mp30. The Pond
  (mp01) has none.

### Placing

- Pick the Bridge on the strip (one icon, BridgeSmallH's), then tap near a
  crossing: the game takes the nearest site whose start or far end is under 4
  cells away (Manhattan). The preview snaps across the water and a check button
  confirms it. That sends `ConstructStructureCommand` with the site's own
  bridge type and start cell (`0x020AAD50`, `0x020A34C8`, `0x020A86F8`,
  `0x020AB020`). confirmed (emulator on mp04)

### Building

Watched once, BridgeMediumH at mp04 (45, 29):

- Nothing is paid until the Builder reaches the site. Then the 10 bricks go and
  the Bridge entity appears with 1 HP. confirmed
- The Builder goes **inside** (+0x114 set), like other buildings. 30 ticks of
  work, HP rising; unit +0x231 turns 1 when done. confirmed
- It came out 22 ticks after the bridge was done, at the cell past the far end
  of the top row (51, 29). confirmed (once). Vertical bridges: we use the cell
  below the left column. guess
- While it is built nothing is drawn except a dust cloud that moves along the
  span (`BridgeConstructionEffect`). We draw only the bars for now (open).

### Finished bridge

- The cells under it change from water (3) to rough ground (2), and the region
  grid changes too (`0x02058730`, through `0x020A30A0`). So walkers path over
  it as rough ground and ships can't pass. confirmed (code + terrain grid in
  RAM)
- Drawing (`0x0200D8A8`, only once +0x231 is set): horizontal bridges use
  metatile 0xD5 on the top row and 0xDA on the other; vertical ones 0xD0 on the
  left column and 0xD1 on the other; slot s adds 15. Metatiles come from the
  tileset's own table (`BP/<King>Tiles.tbp`, not the map's detail table).
  confirmed (code; matches the emulator screen)

### Destroyed bridge

Bridge vtable slot 5 (`0x02058364`) first calls `0x0205878C`: the footprint goes
back to water (it writes 3 to every cell), and the ground units on it are
killed, except heroes, which are put back on the nearest bank. likely (code;
not watched: writing 0 HP in RAM doesn't run the death path, so it needs a
real fight). A flag read through `0x020092A8` gates the hero rescue; what it
is isn't known, so we always rescue them.

## Payment, compared with other buildings

Other buildings are paid the moment they are placed. Walls and bridges are paid
when the work starts. confirmed (emulator, both)

## Open

- Gates: a drag UI exists (mode 10, `0x020AB178`; GateH or GateV by drag
  direction) but no skirmish strip shows them. Probably campaign-only.
- The bridge dust cloud (`BridgeConstructionEffect`).
- What unit +0x71 means on a wall (the cyan-bordered tiles).
- Whether several Builders build a piece faster (also open for other buildings).
- How the game moves units off a wall cell (state 2 of `0x02067C30`).
