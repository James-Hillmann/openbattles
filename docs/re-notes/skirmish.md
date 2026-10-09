# Skirmish rules: start setup, win and loss, terrain per unit

Game code `C5SE`. Ported in `sim/src/skirmish.ts`, `sim/src/rules.ts` and
`sim/src/terrain.ts`. Confidence per claim: **confirmed** (seen in DeSmuME),
**likely** (read from the code), **guess**.

Class names come from RTTI strings: `MultiplayerMissionBase` (one per skirmish
map), `Sim::GameRuleManager`, `Sim::Team`, `Sim::CollectableItem`,
`Sim::ContinentManager`, `User::FogCircle` (fog.md).

## Options screen (confirmed)

Before a skirmish the game shows one screen of options:

| option | values | default |
|---|---|---|
| Win condition | "Defeat the enemy's Hero", "Collect 10000 LEGO Bricks", "Defeat all enemy units" | Hero |
| Prebuilt bases | on / off | off |
| Random starting positions | on / off | off |
| Starting bricks | 500, 1000, ... | 500 |

The win condition ends up in `GameRuleManager +4` (pointer at `0x02155084`):
**0 hero, 1 all units, 2 bricks**. Confirmed by starting a game with each option
and reading the field.

## Random starting positions (confirmed code and RAM)

`0x020A2C48` builds the slot-to-player table at `[[0x02156BD0]+0x320]` (count +0x324). With the
option off (`0x020A2BEC`) slot i goes to the i-th team. With it on, the free list is every slot the
map has (0..3 on mp01), and each present player in turn takes a random remaining one through
`0x0208339C` (`MATH_Rand32`). Read with it on: [1, 255, 0, 255]. The sim does the same with the
seeded RNG (`randomSlots` in skirmish.ts), so both lockstep clients draw the same slots. Which
player draws first is likely (team order).

## Start setup: the map's EVNT section (likely; spot-checked in the emulator)

Reader `Map_readEvnt` `0x020A3BB0`: groups of `'L'`, u8 group id, body, until `'!'`.
Body (`0x020A4B70`):

| part | layout | skirmish maps |
|---|---|---|
| points | u8 n, n × (x, y) | empty |
| flag | u8; if set, 4 more bytes | 0 |
| spawns | u8 n, n × 9 bytes (`0x020A5C0C`) | 6 per start slot |
| pickups | u8 n, n × 8 bytes (`0x020A45F0`) | 10, in group 0 |
| other | u8 n, records read by `0x020A5DC0` | empty |

Spawn record: `x, y, slot, role, index, 100, 1, 1, 1`. The game takes the
player's faction entities whose role (+0x5C) is `role` (`0x020858D4`) and spawns
the `index`th one at cell (x, y). The last four bytes are kept but not decoded.
Every skirmish map gives each of its 4 slots the same six records: base (role 7),
barracks (11), farm (10), two builders (1) and the hero (0).

Positions are cell centres in game units: the mp01 builder record (10, 13) is the
builder at game position (240, 208) = (10·24, 13·16). **Confirmed** (RAM).

**Prebuilt bases off** (`0x020A2FD4`, map flag +0x334 = 0): per player, only the
first hero, first builder and first base record spawn; everything else is
dropped. **Confirmed** on mp01: off gives castle + 1 builder + King, at the first
records' cells; on gives all six (castle, farm, barracks, 2 builders, King).

**Records on blocked cells** (guess): on mp29, slot 0's second builder record
(12, 51) lies inside its own castle's footprint (3x3 at (11, 50)); no other map has
such a record. The sim moves that unit to the nearest free cell (Chebyshev rings,
row-major), as production does for a building's exit. Not seen in the emulator:
mp29 is locked on a fresh profile.

The hero record also sets the player's start point (camera), once per player
(`0x020A3CEC`, stored at map +0x234).

**Slots** (likely): with fixed starting positions the human is slot 0 and the CPU
slot 1 on mp01 (blue castle found at slot 1's base cell, (51, 51)). The mapping
goes through a table at map +0x320 (`0x020A2D84`); random starting positions
presumably shuffle it (not traced). Slots nobody plays are skipped.

**Pickups**: 8-byte records `x, y, ?, 0x14, item, 0xFF, 2, 1`. On map start they
become `Sim::CollectableItem`s (10 on mp01, at the record cells: corners, edge
middles, around the lake), from collectable blueprint `item` (8 on every map).
What they give is not traced; the sim doesn't spawn them yet.

## Win and loss (`GameRuleManager`, `0x020753D4`..`0x02075E70`)

Player state lives on `Sim::Team`: bricks at +0x90, status at +0x9C
(0 playing, 1 defeated, 2 won, 3 lost). The manager listens to six game events
and dispatches in `0x02075608`. Ported in `sim/src/rules.ts`.

- **Unit destroyed** (event 0x33, `0x02075750`), for the dead unit's owner, if
  still playing:
  - mode 0: if the player has no unit with role 0 left (`0x02085BFC`), they are
    defeated. (likely)
  - modes 1 and 2: if the player is eliminated (`0x02075808`), they are defeated.
    (likely)
- **Eliminated** (`0x02075808`): any unit of role 0-6 keeps you in. Otherwise
  count production buildings: base (7, needs 50 bricks) and barracks (11, needs
  100) and stables (12) / shipyard (16) (need 250). None: out. Exactly one and
  bricks below what it needs: out. Otherwise a base or barracks keeps you in;
  with only stables/shipyards you also need a farm (10). The 50/100/250 are
  constants in the code, not read from the unit table. (likely)
- **One side left** (`0x02075DAC` then `0x02075CCC`): when every player still
  playing is allied with every other, they all win. (likely)
- **Bricks** (event 0x3B, `0x02075B9C`), mode 2 only: a player with >= 10000
  bricks wins and every other player still playing loses (status 3).
  **Confirmed**: set our bricks to 9998, the next brick income ended the game
  with status 2 / 3 and "Victory!".
- Events 0x25 (`0x02075BF0`: a player wins outright, others lose) and 0x39
  (end-of-game bookkeeping, local-player defeat screen) are not ported; we don't
  know what raises 0x25 yet.

Not checked in the emulator: defeat by losing the hero. Heroes regenerate
(about 4 HP per update seen after setting the King's HP low in RAM), and
writing HP 0 to RAM doesn't kill (death runs in the damage code), so this needs a
real fight. **open**

## Terrain and layers per unit (likely, from the code)

The terrain test `0x02001510` (called from the cell reservation chain
`0x02059C40` → `0x0205C014` → `0x020016AC` → `0x02001938` → `0x02001574`)
reads one flag byte of the entity record per terrain code:

| terrain code | flag | King ground units | ships, shipyard | gryphon/dragon | Space Police ship |
|---|---|---|---|---|---|
| 0 open | +0x16 | 1 | 0 | 1 | 1 |
| 1 tree | +0x19 | 0 | 0 | 1 | 0 |
| 2 rough | +0x17 | 1 | 0 | 1 | 1 |
| 3 water | +0x18 | 0 | 1 | 1 | 1 |
| 4, 5 cliff | none | never | never | never | never |
| > 5 | none | always | always | always | always |

Buildings: base, barracks, farm etc. need open ground only; mines rough only;
shipyards water only.

The occupancy layer mask (`0x0200159C`) is +0x1A → 1 (ground), +0x1B → 2 (air,
the gryphon/dragon and the space ships), +0x1C → 4 (bridges and gates). Ships use
the ground layer, so a ship and a walker can't share a cell, but water and land
never overlap anyway. The sim keeps one occupancy plane per layer and only
checks the unit's own layer. Whether a flyer and a walker really may share a cell
is a **guess** from the separate layers.

`Sim::ContinentManager` probably groups connected cells per terrain mask (for
"can this unit reach there"); not traced. The sim's group-move spreading uses a
flood fill with the unit's own mask instead.

## Not covered yet

- Fog of war: see [fog.md](fog.md).
- Buildings' footprints. The sim gives a building its record's cell only. **guess**
- Pickups: see [pickups.md](pickups.md). Score stats: [score.md](score.md).
