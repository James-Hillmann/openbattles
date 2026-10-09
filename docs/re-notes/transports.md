# Transports

How units get on and off a transport ship. Game code `C5SE`. Sim: `sim/src/transport.ts`;
tests: `tests/sim/transport.test.ts`. Emulator checks were on The Black Seas (mp08), slot 0, with
the Shipyard built after a Farm (a ship needs a free star).

DS note: the game is C++ and keeps its class names for RTTI, so `strings arm9.bin | grep N7Battles`
lists them. A class's vtable has a pointer to its typeinfo just before it, and typeinfo + 4 points at
the name, which is how the classes below were found. Command "types" are the ids the game's command
queue switches on.

## Classes

| class | what it is | confidence |
|---|---|---|
| `GarrisonCommand` | player command (type `0x15`): "these units, get on that transport" | confirmed |
| `UngarrisonCommand` | player command (type `0x20`): "everyone off these transports" | confirmed |
| `GarrisonEntityCommand` | per-unit order (type 9, ctor `0x0206BB74`): walk next to the transport, then board | confirmed |
| `UngarrisonEntityCommand` | per-passenger order (type `0x1B`, ctor `0x020750D8`) | confirmed |
| `LoadAction` / `UnloadAction` | the actions those orders run (updates `0x02053790` / `0x02055CBC`) | confirmed |
| `UnitContainer` | the transport's cargo list | confirmed |

The same container code serves the Base and Lumber Mill (Builders go inside them); see economy.md.

## Who can board, and how many

- The player command makes one `GarrisonEntityCommand` for each listed unit other than the transport
  (`0x02084748`). Its init (`0x0206BBBC`) fails at once for a unit that can go on water: ships, and the
  flyers (Gryphon, Dragon and the other flying specials all have the water bit in their move mask).
  Buildings and the transport itself never board. confirmed (code)
- Room is per **cargo class**. A role-to-class table (`0x02142840`) gives classes
  `[0,1,2,3,2,6,4]` for roles 0-6 (hero, builder, melee, ranged, mounted, transport, special), and 6
  for buildings. `0x020010E0` gives a transport room 4 for classes 0-3 and 2 for class 4 (the Base and
  Lumber Mill get 10 for class 1 instead). `0x0205B1D8` counts what's already aboard against that room:
  classes 0-3 all share the 4 minifigure places, and specials share the 2 special places. So a
  transport holds **4 minifigures and 2 specials** (the game's own tip, LOC 1028, says the same).
  confirmed (code, the tip, and the top screen's 4 round + 2 star slots); the refusal of a 5th
  minifigure itself wasn't watched in the emulator.
- Only your own transport can be targeted (the sim also checks it is alive and not itself carried).

## Boarding

- Each tick the order checks whether the cell the unit *holds* touches the transport's footprint,
  8-way (`0x0207F558` / `0x0207F8E4`). If so `LoadAction` adds it to the container (`0x0205B2DC`)
  and it vanishes from the map. confirmed (emulator: the King boarded mid-step, before reaching his
  cell's centre).
- If not, it walks to a free cell next to the transport and tries again. A tries counter (+0x1E) ends
  the order after the fifth walk. likely (code)
- **guess**: the cell it walks to comes from `0x0207F99C`, which isn't traced. The sim picks the
  nearest free cell beside the footprint, as Builders do for buildings.
- A full container makes `LoadAction` return 5 and the order ends; the unit stays where it is.
  likely (code)
- Any new order to the unit cancels boarding.
- Transport ships are all size 2 (2x2), and a ship must touch land for a unit to reach it. The
  first try in the emulator failed with the ship one water cell off the shore. confirmed
- After one of the selected units boards, the selection is the transport. likely (seen once, with
  the King); the client does this.

## Riding

- A rider is off the map: no cell, can't be selected, attacked or given orders, and a hero can't cast.
  For position checks the game reads the carrier's cell (`0x0205BDE4`); the sim keeps a rider's
  position on the ship.
- The spells that skip units inside things (18, 20, 21, 22; spells.md) skip riders too.
- **guess**: riders add their own vision at the ship (fog). Not checked.
- **open**: what Hot Wire (spell 32) does to a captured transport's riders. The sim leaves them
  owned by their player, and only that player's Unload lets them off.

## Unloading

- The player command makes one `UngarrisonEntityCommand` per passenger, and `UnloadAction` removes the
  unit from the container (`0x0205B704`). They all run in the same frame, in **unit id order**, not in
  boarding order. confirmed (emulator: the Builder got the first cell although the King boarded first)
- The exit cell (`0x0205B364` -> `0x0207F378` -> ring search `0x0207FF24` with the matcher
  `0x02080708`) is the first cell, in this order, that is on the map, walkable for the unit and free:
  - rings k = 0 to (unit width + 2), so 4 rings for a 1x1 unit;
  - in ring k, for x from `-(k + unit w)` to `k + ship w`: the cell on the row above the ship
    (`y - (k + unit h)`), then the one on the row below (`y + ship h + k`);
  - then for y from `-(k + unit h - 1)` while below `k + ship w - 1`: the cell on the left
    (`x - (k + unit w)`), then the one on the right (`x + ship w + k`). The side loop's bound uses
    the width, minus 1, so for a 2x2 ship ring 0 tests only the top row's sides. Kept as is.
  - "On the map" is checked with room for the unit (`0x020A4280`: x + unit w < map width), so the
    last column never qualifies.
  - Any reachable-or-not land counts, so units can be put onto an island.
  confirmed (emulator: two units at the shore got (13,36) and (13,39) with the ship at (14,37); from
  open water with the ship at (19,35) they landed on islands at (15,31) and (24,40), both in ring 3,
  in exactly this order).
- A passenger with no exit cell (deep water) stays aboard. confirmed (code; seen as nothing happening)
- Unloading takes a few frames in the game; the sim does it on the tick the command lands.

## The transport sinks

- The death handler (`0x0206A078`) ejects cargo last-to-first with the same exit search (`0x0205B788`).
  If nobody got off, every passenger is killed (`0x0205E76C`). likely (code)
- **guess**: when only some get off, the rest seem to stay in the wreck's container; the sim kills
  them.
- **open**: a flag at `0x020092A8() + 0xD` makes a hero aboard a dead container respawn near its base
  instead. What sets it isn't known; the sim ignores it.

## UI

- The game's order strip (blue tab) has Load (stairs icon) for units and Load + Unload (crane icon)
  for a transport. The unit's Load arms a tap on a transport (tip LOC 1031: "To load units onto a
  Transport, select units then touch on a Transport.").
- Ours: the Actions strip has Load for units (then click a transport; right-clicking one does the
  same) and Unload for a transport. A selected transport shows its riders in 4 round + 2 star slots.
- Walking to a transport replaces the unit's combat command, so a boarding unit doesn't stop to fight.
  likely (it's one entity command at a time). When boarding gives up, and after getting off, the unit
  guards its cell like after any finished order. guess (not traced for these two cases).
- **Not done**: the transport's own Load button (the ship goes to pick units up).

## Memory layout (unit)

| offset | what | confidence |
|---|---|---|
| +0x100 / +0x104 | container: contents list / count | likely |
| +0x114 | handle of the container the unit is in | likely |
| +0x124 | cell struct; x at +0x128, y at +0x129 | confirmed |
| +0x227 | alive flag | likely |

## Emulator recipe

`py-desmume` in `out/venv` (tools/emu). On The Black Seas the player's bricks are at
`[0x0215532C] + 8` -> player `+0x90`, not the address other maps use. Entity list: `[0x02154F48] + 8`,
count at +12. Breakpoints with `register_exec`, reading `e.memory.register_arm9.r0` and so on.
Loading: select the units, open the blue tab, tap Load (stairs), then tap the ship. Tapping a ship
with units selected just moves them.
