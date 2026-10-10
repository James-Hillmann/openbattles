# Tower upgrades, repair, and what a building needs first

Game: LEGO Battles (USA, `C5SE`). Found 2026-10-09 by reading ARM9 and watching a King skirmish on The
Pond (mp01) in DeSmuME with a 5000-brick bank written to the player (+0x90). Ported to
`sim/src/structures.ts`; tests in `tests/sim/structures.test.ts`.

**DS background:** the numbers below are in the game's 20.12 fixed point (FX32: 4096 = 1.0), which the
Nitro SDK's `FX_Mul` (`0x0200D984`, rounds the product) and `FX_Div` (`0x0210A604`, the hardware divider:
`(a << 32) / b`, rounded to 12 fraction bits) work on. Ticks are the game's 30 Hz counter (`Game_get()+0x8B4`).

## Build prerequisites

| building | needs | confidence |
|---|---|---|
| Stables (the "Special Factory", role 12) | a **finished** Barracks (role 11) and a **finished** Farm (role 10) | confirmed |
| Shipyard (role 16) | the same | confirmed (code; the strip button behaved like the Stables one) |
| everything else | nothing | likely (no other role is tested in either check) |

- Code: `ConstructStructureEntityCommand` start (`0x02068B74`) refuses the order for roles 12 and 16 unless
  `Team_countRole` (`0x020859D4`, finished buildings only: +0x22E = 100) finds a Barracks and a Farm. The
  strip's button check (`0x020DA0xx`, Thumb) asks the same thing, so the buttons are checkered.
- Emulator: with only a finished Farm, and again with a Farm and a Barracks still being built, the Builder's
  strip showed the Stables and Shipyard checkered and tapping them did nothing; once the Barracks finished
  both lit up. confirmed
- The tip text says "Special Factories require a Barracks to be built first" but the code also wants a Farm.
- A second check while the site is placed (`0x02069408`) uses the per-role counter at team +0xDA, which
  counts sites too. It only matters if the Barracks or Farm dies between the order and the placement. Not ported.
- Text 109 "<1> Required" exists; `0x020DCE0C` picks the Farm (text 644) or Barracks (text 637) name for it,
  probably for an info line we haven't seen on screen. Ours puts "Barracks, Farm Required" in the button tooltip.

## Building limits

`0x02086088` returns how many more of a limit group the team may have: the group's entry in the limit table at
`0x02126CA4` minus what it has (sites included) minus what is reserved (team +0xC5 + group). A build order needs
at least 1 left. The group is the entity record's byte +0x09.

| +0x09 | group | limit | counts | confidence |
|---|---|---|---|---|
| 0 | heroes | 1 | | confirmed (economy.md) |
| 1 | minifigures | 20 | roles 1-4 | confirmed (economy.md) |
| 2 | specials | 4 | roles 5, 6 | confirmed (economy.md) |
| 3 | towers | **7** | roles 13-15, any level | confirmed |
| 4 | buildings | **14** | roles 7-12, 16, 18 (Castle to Stables, Shipyard, gates; not towers, bridges or walls) | confirmed (code) |
| 6 | walls | 20 | role 19 | confirmed (code); walls are another thread's |
| 7 | bridges | 8 | role 17 | confirmed (code) |
| 8 | gates | 0 | role 18 | confirmed (code): gates can't be built in skirmish |

Decompiled `0x02086088`: each group counts the team's entities whose role is listed above (towers and walls
through `Team_countRole` with sites included), adds the slots reserved at team +0xC5 + group, and returns
the table entry minus that, floored at 0. The order's start (`0x02068B74`) refuses at 0, and so does the
placement on arrival (economy.md "Construction"). The check reads the ROM table at `0x02126CA4` itself. In
the emulator, writing 0 over the tower entry (RAM `0x02126CA7`) checkered the Builder's tower button and
writing 8 lit it again, so the strip and the order really follow that table entry; 7 towers weren't built to
watch it hit. `0x020863B8` keeps a per-team copy at team +0xCF + group, doubled for groups 3, 4 and 6 for the
non-local teams in one setup (a game type and a difficulty-like value of 2; not traced to a menu option), but
nothing in the build path reads that copy.

## Tower upgrades

Tower (role 13) -> Tower II (14) -> Tower III (15). From the tower's own strip (a grey tab, one button;
the top screen says "Upgrade Costs"). `ResearchUpgradeEntityCommand` (vtable `0x0214A328`, start `0x02073080`)
also researches spells (its +0x1C = 0); +0x1C = 1 is the tower upgrade.

| rule | value | confidence |
|---|---|---|
| Price | the next level's full cost (+0x5E): **500** to Tower II, **800** to Tower III, paid at once | confirmed (emulator: 4380 -> 3880; strip "Upgrade Costs" 500, then 800) |
| Which type | the player's faction entity with the next role (`0x020024E8` over the faction list) | likely (code) |
| Time | the next level's build time (+0x60): Tower II **840** ticks, Tower III 1260 | confirmed for Tower II (ordered tick 2992, swapped tick 3831) |
| Progress | a `ConstructProgressAction` in mode 3 on the tower; percent in tower +0x22F, drawn as a bar over it | confirmed (RAM: 6, 12, 18 ... % every ~50 ticks) |
| When done | the old tower is removed without dying (`0x0205DF74` with the quiet flag) and a new entity of the next level is made in the same cell; it stays selected | confirmed |
| HP | new HP = new max - (old max - old HP): the damage carries over | confirmed (Tower at 300/400 became Tower II at 400/500) |
| Cancel | refunds the full price (`0x020733DC`, if it was paid) | likely (code); ours goes through the `cancel` order on the tower's queue slot |
| Cheat flags | settings +0x13 makes it cost 1 brick; +0x14 (Fast Production) halves the time | likely (code); not ported |

The CPU upgrades its towers too (a CPU Tower II appeared during the watch). Whether a tower keeps shooting
while it upgrades is not checked; ours does (it's the same entity until the swap).

## Repair

`RepairStructureEntityCommand` (vtable `0x0214A2AC`, start `0x020728CC`, update `0x02072A0C`) and
`RepairStructureAction` (vtable `0x02148D98`, update `0x02054B64`).

- **Who**: the command start accepts only roles 0 (hero) and 1 (Builder). Both the Builder's and the King's blue
  strip have the wrench (Repair) button. confirmed (emulator: the King repaired a Tower II from 400 to 500 HP for 50 bricks)
- **How it's ordered**: with a Builder selected, touch a damaged building (tip 959). confirmed. The command
  doesn't check the owner; ours repairs own buildings only (1v1 has no allies).
- **What**: a building (roles 7-19) below full HP. A full one ends the order at once. The action also needs
  building +0x227 set, which we took to mean "finished" (sites are built, not repaired). But +0x227 is already
  set on a fresh site (a Farm at 9 %, read in RAM), so it means "on the map"; whether a Builder can be sent to
  repair a damaged unfinished site is open. guess
- **Where**: the unit walks next to the building and works from **outside**, facing it, playing its work
  animation (`0x0205A6A4` mode 2). If it isn't next to it the action ends and the command walks it back. confirmed
  (emulator: the Builder stood beside the tower, visible, the whole time)
- **Rate**, every tick next to it, for a building of max HP `M`, build time `T` (+0x60), cost `C` (+0x5E) and
  `missing` = M - HP, all in 20.12:
  - `share = FX_Div(missing, M)`; `ticks = max(1.0, FX_Mul(share, T))`
  - `bricks = FX_Mul(FX_Mul(0.5, C), share)` (half the price, scaled by the damage)
  - per tick: `bricks / ticks` added to a brick accumulator (action +0x24) and `missing / ticks` to an HP one (+0x20)
  - when both have a whole point: pay the whole bricks, add the whole HP (at most `missing`), keep the fractions.
    Until then both wait (the whole parts are put back).
  - If the player can't pay, that tick's whole parts are lost and the unit keeps trying.

  So a full repair costs **half the building's price and takes its build time**, whatever the damage, and
  any one repairer heals M / T HP a tick. Several repairers each run their own action, so they add up. likely
- Measured: a Builder on a Tower II (500 max, 840 ticks, 500 bricks) at 400 HP gained **+2 HP and paid 1 brick**
  at ticks 4103, 4106, 4110, 4113, 4116, 4120 ... (3, 4, 3, 3, 4 apart), reaching 500 at tick 4268 for **50 bricks**.
  Our port gives the same steps tick for tick. confirmed
- Cheat flags: settings +0x13 makes repairs free; +0x02 (for the local player) and +0x14 shorten the time. Not ported.

## Ours

- Commands `upgrade` (a tower) and `repair` (Builders and heroes, a target building). PROTOCOL_VERSION 6.
- The upgrade uses the tower's production slot (`queue` = the next level, `prod` = ticks done), so the strip
  shows it like a unit in training, and worlds without towers keep their hashes.
- Right-click one of your damaged buildings with Builders or the hero selected to repair it (the game's tap).
  The hero doing it by a tap rather than the Repair button is our shortcut.
- Strip: the Stables and Shipyard buttons are checkered until a Barracks and a Farm are finished, and towers or
  buildings at their limit are checkered too; the tooltip says why.

## Functions

| address | name | notes |
|---|---|---|
| `0x020859D4` | `Team_countRole` | r1 role (0x14 = any), r2 = 1 for finished only (+0x22E = 100) |
| `0x02086088` | `Team_limitLeft` | limit table `0x02126CA4` by group, minus count, minus reserved (+0xC5) |
| `0x02068B74` | `ConstructStructureEntityCommand::start` | bricks, limit, prerequisites |
| `0x02073080` | `ResearchUpgradeEntityCommand::start` | tower role 13/14 -> next level, pays its +0x5E |
| `0x02073620` | (upgrade done) | swaps the tower for the next level, keeps the damage |
| `0x02052388` | `ConstructProgressAction::update` | modes: 1 construction, 2 spell research, 3 upgrade |
| `0x020728CC` | `RepairStructureEntityCommand::start` | roles 0 and 1 only |
| `0x02054B64` | `RepairStructureAction::update` | the per-tick rate above |
