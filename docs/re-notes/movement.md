# Unit movement and spacing

Game code `C5SE`. How a unit walks once it has a move order, how it keeps out
of other units' cells, and what it does when something is in the way.
Ported in `sim/src/movement.ts`. Confidence per claim: **confirmed** (seen in
DeSmuME), **likely** (read from the code), **guess**.

The class names come from RTTI strings in ARM9 (`N7Battles3Sim…`), which is
how the pieces were found: `MoveUnitAction`, `AlignToTileSeeker`,
`DirectVectorSeeker`, `SegmentedVectorPlotter`, `WaitForObstaclePlotter`,
`SidestepAvoidancePlotter`, `AstarPlotter`, `OccupationGrid`.

## Coordinates

The game stores positions as 20.12 pixels measured from cell **centres**: a
unit standing in the middle of cell (cx, cy) is at (cx·24, cy·16). Its cell is
`floor((x + 12) / 24), floor((y + 8) / 16)`. Our sim measures from the map's
top-left, so sim = game + (12, 8). Cell indices are the same. (likely; the
King replay below matches to 1/100 px)

## The pieces

Each tick, for a unit with a move order (`MoveActionBase` update, `0x02053C44`):

1. The **plotter** picks a waypoint cell.
2. The **seeker** moves the unit one tick toward that cell's centre.
3. If the seeker can't get into the next cell, the plotter is told (`onBlocked`)
   and escalates.
4. Once the plotter says "this waypoint is the goal" and the unit has entered
   it, the action switches to **aligning**: walk toward the centre of the cell
   it is in until inside a small window, then stop.

The plotter is one object, a chain of subclasses, each falling back to its
parent: `AstarPlotter` ⊃ `SidestepAvoidancePlotter` ⊃ `WaitForObstaclePlotter`
⊃ `SegmentedVectorPlotter`. (likely; class layout from vtables at
`0x02148FB8`, `0x021491C0`, `0x021491E4`, `0x021490A8`)

### Occupancy (likely; confirmed for the King/builder case)

`OccupationGrid` keeps, per cell and per layer (3 layers, a unit has a layer
mask), a state and the id of the unit in it: 0 free, 1 a unit stands here,
2 a unit has reserved it. A unit stands in exactly one cell. When its next
position would cross into a new cell, it must reserve that cell first
(`Unit_reserveCell 0x02059C40`, which also checks the terrain); `setPosition`
then turns the reservation into "stands here" and frees the old cell. Both
happen in the same tick, so in effect: **one unit per cell, and you can only
step into a free one**. Footprints are w×h cells from the entity record; every
unit we've looked at is 1×1. We model one layer only (**guess**: flying and
naval units probably use other layers).

### Seeker (`0x0205571C`, likely)

- Arrived when the unit's cell is the target cell (and, when aligning, it is
  inside the window). The direct seeker therefore "arrives" the moment it
  enters a waypoint cell, not at its centre.
- Otherwise move one tick toward the target cell's centre (velocity set up
  from the unit's speed each tick, `0x02055C34`).
- Same cell: just move. New cell: reserve it, then move. Reservation failed:
  if the unit's cell is diagonally next to its target (dx and dy both ±1),
  reserve the target cell instead and move anyway (this lets a diagonal step
  get past a blocked corner cell; the unit's sprite briefly overlaps that
  cell). Else report **blocked** with the cell it bumped into.
  The blocked corner cell can be terrain, so units (ships too) slip through a
  one-cell diagonal line of unwalkable cells. **Confirmed** (2026-10-09): on
  mp01 we wrote a diagonal line of water cells (x = y) into the terrain grid in
  RAM; the King walked from (11, 15) to (15, 11) straight through it, holding
  (12, 13) then (13, 12). A line two cells thick stopped him. Our sim holds the
  same cells. A ship is a ground-layer unit with a water-only mask, so it cuts
  across thin diagonal land the same way.
- The aligning seeker never reserves and is done once the position, measured
  from the cell's top-left, is 6–17 px across and 6–9 px down. (likely;
  **confirmed** by the King replay)

### Segmented vector (`0x02056994`, likely)

The default behaviour: walk straight at a point about 5 cells along the line
to the goal, recomputed every tick. With `d` = goal − cell and
`len = max(|dx|, |dy|)`, the step is `floor(d · k / 4096)` with
k = 0x143 (len ≥ 64), 0x28A (≥ 32), 0x529 (≥ 16), 0xAAB (≥ 8), else the whole
`d`. That point is then moved to the nearest free walkable cell with a ring
search of radius `min(len, 5) − 1` (`0x0207F134` → `0x02080430`).

The ring search order is quirky: ring r tries (0, −r), (0, r), then the same
two again, never (±r, 0). The table for the axis points (`0x02155140`, built at
boot) lists cases 2, 3, 0, 1, which all collapse to the vertical pair when the
other coordinate is 0. **Confirmed**: sent into the forest on mp01, the King's
first waypoint was (4, 16), not the nearer (4, 15) that a full ring would find
first.

What the location match accepts is a **guess**: we take walkable and not held
by another unit.

### Wait for obstacle (`0x020574A4`, `0x020577AC`, likely)

On blocked: look at the cell bumped into.
- Terrain, a standing unit, or a unit that is itself waiting for *us*: don't
  wait (hand over to sidestep).
- A unit that is walking (has a `MoveUnitAction`): wait. The counter is
  `2 * 30` ticks (`0x020F2548` converts seconds to ticks: ×30).
Each tick while waiting: blocker gone → resume; still a walking blocker →
count down, give up at 0; anything else → give up.

### Sidestep (`0x02056DB0`, `0x02056EE4`, `0x02057104`, likely)

When waiting won't help, try a cell next to the unit: first straight toward
the current waypoint, then 45° counter-clockwise, then 45° clockwise (screen
axes, y down). Tables at `0x021490D8…0x02149198` (filled at boot; read from
RAM). A candidate must be walkable and free. After a diagonal sidestep the
unit tries straight again from the new cell. If all three fail without the
unit having moved, sidestepping is over. While sidestepping, being exactly
one cell from the goal also ends it.

### A* (`0x02056074`, likely)

When sidestepping ends, search a path — not to the goal, but to the current
segment point (~5 cells ahead) — then follow it cell by cell, and return to
segmented walking at its end. Blocked on the path: skip to the next path cell
(and use sidestep toward it); blocked on the last one: the move fails.

Path costs (`0x02082BC4`): free cell 1, cell with a walking unit 3, cell with a
standing unit 150, terrain 200 = wall. 8 neighbours in the order (−1,−1),
(0,−1), (1,−1), (−1,0), (1,0), (−1,1), (0,1), (1,1), no corner rule, the same
cost for diagonals, Chebyshev heuristic (`0x02082030`). The result is rejected
if another unit is in the end cell (`0x020826E4`). **Confirmed**: the builder
case below ends this way.

Unknowns we fill in ourselves (**guess**): the open-list tie-break (we use f,
then h, then cell index) and whether paths list every cell (we do). The game
runs the search as a background job, a few rounds per tick, and the unit
stands still until it finishes; we finish it in the same tick. In the forest
test the King's search never finished (an unreachable goal), so the King
stood at the edge with its order still active; ours fails the search and
ends the order. Both look the same on screen.

## Emulator checks

On mp01 from savestate `E.dst` (scratch only, not in the repo):

| test | game | sim |
|---|---|---|
| King from (264, 240) to cell (13, 18) | stops at (310.64, 286.64) | (310.64, 286.64) |
| Builder to the same cell after | stops in cell (13, 17) at (310.93, 272.83) | cell (13, 17) at (311.37, 273.72), with the King's speed for the builder |
| King tapped into the forest | first waypoint (4, 16), stops at the forest edge | same rules (test uses a smaller map) |

## Not covered yet

- How a group order picks each unit's goal. We still give each unit its own
  cell near the click (our rule).
- Layers for flying and naval units; footprints bigger than 1×1.
- The search window check on A* paths (`0x020566E4`, globals at +0x154..+0x15D).
- The special location search for one entity kind (kind 9) in `0x0207F194`.
