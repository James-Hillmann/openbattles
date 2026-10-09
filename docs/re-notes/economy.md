# Economy: bricks, gathering, building, production

Game: LEGO Battles (USA, `C5SE`). Found 2026-10-08 by reading ARM9 and watching a King skirmish on
The Pond (mp01) in DeSmuME. Ported to `sim/src/economy.ts`; tests in `tests/sim/economy.test.ts`.

**DS background:** the C++ class names survive as RTTI strings (`N7Battles3Sim13HarvestActionE` is
`Battles::Sim::HarvestAction`). Each class's typeinfo points at its name, and each vtable has the
typeinfo pointer just before it, so names lead straight to the code. "Ticks" below are the game's
30 Hz time counter (`Game_get()+0x8B4`); `0x020F2510` converts milliseconds to ticks (`ms * 30 / 1000`).

## Player object

The local player is at `0x0224D350` in a King skirmish (likely the same every match).

| offset | meaning | confidence |
|---|---|---|
| +0x90 | bricks (u32) | confirmed (RAM watch: 500 -> 450 when a Builder is queued) |
| +0xEE | pop slots reserved by queued units | confirmed (code `0x02085F0C`; HUD shows 2/4 the moment a Builder is queued) |
| +0xEF | star slots reserved by queued units | likely (code) |

- `Player_addBricks` `0x020866C0`: adds, clamped to **500,000**. `Player_spendBricks` `0x020866F0`:
  fails if the player has fewer than asked. `Player_setBricks` `0x02086614`. confirmed (code)
- Skirmish start: **500 bricks**. confirmed (HUD and RAM).

## Brick income

| source | rule | confidence |
|---|---|---|
| Trickle | every player +5 bricks when the time counter hits a multiple of 1800 (60 s) | confirmed: code `0x02083720`, RAM watch saw +5 about every 3,665 frames |
| Chopping | a Builder chops one tree for **150 ticks**, then carries one load | confirmed: `HarvestAction` timer `0x020531D8` returns 150; ~293 frames per chop in the emulator |
| Delivering | load = **75** bricks, **100** once the owner has a finished Lumber Mill | 75 confirmed (RAM watch, 15 deliveries); the +25 is code (`0x0206D0C0`), not yet watched |
| Mine | a finished Mine pays its record's +0x6C (**25**) every **2.5 s (75 ticks)** with no Builder | likely: `IdleMineEntityCommand` sets a 2500 ms repeating timer (`0x0206D6C8`) and pays on it (`0x0206D7D0`). Not watched: I couldn't place a Mine in the emulator yet |

- Each chop fells the tree: the forest edge recedes one tree per trip in the emulator, and the map
  terrain is written as the chop ends. likely
- The Builder takes the load to the owner's **finished building with the smallest Manhattan
  distance** (cell of the Builder to the building's top-left cell), `0x0206CD70`. The search walks
  two building lists (categories 8 and 7) with one shared minimum. likely; which buildings those
  categories hold is a guess (the sim accepts any finished building).
- After a delivery the Builder goes back to chop. Our rule (same tree if still standing, else the
  nearest tree within 10 cells) is a **guess**; the game's `HarvestEngineerEntityCommand` search is not traced.
- Red Brick cheats (`RedBrick_FastHarvest`, `FastMining`, `FastProduction`) double loads/payouts or cut
  times to 1 for the local player (flags in the settings object at `0x020092A8`). Not ported.

## Construction

- Placing a building pays its cost (+0x5E) at once (Farm: 500 -> 425). confirmed
  Walls and bridges are the exception: each is paid when the work on it starts ([walls-bridges.md](walls-bridges.md)).
- The site appears with 1 HP. Progress ticks up once per tick of work; **build time is +0x60 in
  ticks** (Farm 360: started tick 386, finished tick 746). HP rises with it to the full value.
  Unit +0x22E holds percent done (100 = finished). confirmed (one Builder on a Farm)
- Whether several Builders build faster: **open**. The sim counts one tick of work per tick.
- Footprint is +0x1D, an index into a size table built by `0x02001170`: 1 = 1x1, 2 = 2x2, 3 = 3x3,
  4 = 2x3, 5 = 2x6, 6 = 2x9, 7 = 3x2, 8 = 6x2, 9 = 9x2, 10 = 1x4, 11 = 4x1 (w x h). confirmed (code);
  Castle 3, most buildings 2, towers 1, which fits the emulator (the Castle's first unit walks out
  3 rows below its corner; the Farm preview is 2x2). The sim only places the square ones (1-3).
- A Mine must sit on a `MINE` site from the map. likely. Every footprint cell must be free and of a terrain
  the building's own flags allow: entity +0x16 open, +0x17 rough, +0x18 water, +0x19 tree (the per-code test
  units move by, `0x02001510`). King data: Castle, Farm, Barracks, Stables, Tower, Lumber Mill open only;
  Mine rough only (the map's mine sites are rough); Shipyard water only. likely (entity data and a playtester's
  report; the placement code itself isn't traced)
- A Shipyard must also touch land (a non-water cell around it). likely (playtester; not traced)
- Nothing can be placed on cells the player hasn't seen (fog). likely (playtester); ours checks explored cells,
  and a Shipyard's shore too, client side (fog isn't part of the lockstep state).

## Production

- Queuing a unit pays its cost at once and reserves its pop slot. confirmed (500 -> 450, HUD 2/4).
- Train time = the unit's +0x60 in ticks (Builder 150: queued tick 333, out at tick 483). Unit +0x22F
  of the building counts percent. confirmed
- The new unit stands on the first free cell below the building's middle column: Castle at (10,10)
  put the Builder at (11,13). confirmed for one case; the search order beyond that is a guess.
- Queue length 3 per building. likely (a playtester of the DS game; not watched or traced)
- A building only trains, and a Builder only builds, its own faction's entities: the strips list one
  faction (build-ui.md, confirmed). The sim enforces it from the entity name prefix (`EntityType.faction`)
  so a doctored client cannot queue another faction's units over the wire.

## Population and stars (top-screen HUD counters)

- **Pop cap = 4 + 4 per finished Farm** (`0x02085E3C`). confirmed (HUD 1/4 -> 1/8 when a Farm finished;
  the Farm card says "+4" and "+1 star").
- Pop used counts roles 1-5 (builder, melee, ranged, mounted, transport); the hero and siege units
  (role 6) don't (`0x02086524`). confirmed for the hero (HUD 1/4 with King + Builder).
- **Star cap = finished Farms**; stars used = transports + siege units + reserved (`0x02085F54`). So the
  red star counter is the limit on big units. likely (code; HUD showed 0/1 after one Farm).
- **Ceilings**: the per-player limit table at `0x02126CA4` (`1, 20, 4, 7, 14, 29, 20, 8, 0, 5`, read by
  `0x020863B8`) gives 1 hero, 20 pop and 4 stars. `0x02086440` stores min(20, 4 + 4 x Farms) and the HUD
  (`0x020E018C`) shows min(Farms, 4) stars. confirmed (code; matches a playtester: "20 regular, 4 special").
  Entries 3-9 are open (3, 4 and 6 double in some game mode).

## Functions

| address | name | notes |
|---|---|---|
| `0x02086614` / `0x020866C0` / `0x020866F0` | `Player_setBricks` / `addBricks` / `spendBricks` | cap 500,000 |
| `0x02083680` | `Game_tick` | bumps +0x8B4, runs subsystems, pays the 60 s trickle |
| `0x0205323C` | `HarvestAction::update` | chop timer, then `0x020536D4` sets carry (unit +0x228) |
| `0x0206D0C0` | (harvest delivery) | load value, Lumber Mill bonus, adds bricks |
| `0x0206CD70` | (pick drop-off) | nearest finished building, Manhattan |
| `0x0206D6C8` / `0x0206D7D0` | `IdleMineEntityCommand` start / payout | 2.5 s timer, +0x6C bricks |
| `0x02052388` | `ConstructProgressAction` | reads build time +0x60 |
| `0x02085D90` / `0x02085E3C` / `0x02085E58` | farms / pop cap / free pop | |
| `0x02085F54` | free stars | |
| `0x02086524` | pop used | |
| `0x0205D6C0` | (unit init) | +0x22E = 100, HP from +0x62 |

## How the sim blocks footprints (our choice)

Cells under a building get terrain code 4, which the game's terrain check (`0x02001510`) refuses for
every unit and no skirmish map uses, so ground units path around buildings. When a building dies its
cells go back to open ground. Skirmish start buildings use the map record's cell as the footprint's
top-left: **guess**. Whether flyers cross buildings in the game: open (the sim blocks them).

## Builder inside buildings: drop-off and construction (2026-10-09)

Watched in DeSmuME: the local Builder on The Pond (2 deliveries to the Castle, from `castle.dst`) plus
8 CPU Builder deliveries (`builder.dst`), logging unit position (+0xEC/+0xF0), the building it is in
(+0x114, 0xFF = none), carry (+0x228), the command's state and bricks every VBlank, with exec hooks on
the action constructors. Unit +0xDC is the unit's own handle (not its cell).

**Drop-off.** `HarvestEngineerEntityCommand` (vtable `0x02149C2C`, update `0x0206C780`, state u32 at
command +0x34, jump table `0x0206C824`) runs these states once the Builder reaches the drop building:

| tick | state | what happens | confidence |
|---|---|---|---|
| T | 7 (`0x0206D2A0`) | starts a `LoadAction` (`0x02053744`, update `0x02053790`) for the drop building | confirmed |
| T+1 | 9 (`0x0206D0C0`) | the Builder is put **inside** the building (`0x0205B2DC`: unit +0x114 = building handle, unit added to the building's list at +0xFC); in the same tick the load is paid (+75) and carry cleared. **Bricks arrive at the start of the hidden time.** | confirmed (both local deliveries: 2500 -> 2575 -> 2650 on the tick it vanished) |
| T+2 | 8 (`0x0206D2C8`) | `DelayAction` (`0x02053078`, update `0x020530B4`) of **20 ticks**: counts 20 down to 0, finishes on its 21st update | confirmed |
| T+23 | 10 (`0x0206D2F0`) | starts an `UnloadAction` (`0x02055C8C`, update `0x02055CBC`) | confirmed |
| T+24 | 0 | the Builder is placed outside (`0x0205B704` -> `0x0205B364`) and heads back to chop | confirmed |

- Inside for **23 ticks** (T+1 to T+24), about **46 VBlanks / 0.77 s**; measured 45-49 VBlanks over 10
  deliveries (some emulator ticks take 3 VBlanks). It is game logic, not drawing: the next chop is 23
  ticks later than it would be without the wait. confirmed
- Drawing trails the logic by 2-4 ticks: on screen the Builder vanished 5-8 VBlanks after it was loaded
  and reappeared 5-6 VBlanks after the unload. confirmed (screenshots)
- Its stored position does not change while inside (it keeps the spot it entered from, mid-walk). confirmed
- **Where it comes out:** not where it went in. The local Builder went in from cell (9,13), diagonally
  below-left of the Castle at (10,10), and came out both times at **(11,13)**: the cell under the middle
  column of the footprint, the same cell a newly trained Builder appears on. CPU Builders went in from
  cells (49..53,54) and came out at (52,54) under a Castle at (51,51), or at (51,55) / (52,55) when that cell
  was taken. confirmed for the first cell; the search when it is taken is likely `0x0207F378` (radius
  footprint + 3), not traced.

**Construction** (`bplace.dst` + the Farm tap from `out/pw5.py`). `ConstructStructureEntityCommand`
(update `0x02068CD0`, state at command +0x18) also puts the Builder inside the site:

- When the Builder arrives it goes into the site (same `0x0205B2DC`, unit +0x114 = site), so it is
  **hidden for the whole build**. Progress (`ConstructProgressAction`) starts on that tick: in at tick 494, 100 % at tick 855 (Farm 360 + 1). confirmed
- When building ends the Farm plays a `BounceAction` (`0x02051C40`: 20 ticks of a vertical offset table
  written to building +0x8C, for building types 8-19). It started at tick 852. The command waits in state 3
  until the bounce is done, then starts an `UnloadAction` (state 3 at `0x02069798`; tries again every 16 ticks
  if it fails). Unloaded at tick 873: **17-18 ticks (~35 VBlanks) after 100 %**. confirmed for one Farm
- Where: Farm at (12,17), 2x2; the Builder went in from (11,16) and came out at **(13,19)**, the cell under
  the footprint at column x + w/2. Same rule as the Castle drop-off: (x + floor(w/2), y + h), when free. confirmed
  for these two buildings; likely in general.
