# Computer opponent (skirmish CPU)

Game: LEGO Battles (USA), `C5SE`. Code: `sim/src/ai/`. Headless check: `tools/ai/run.ts`.

The game's AI is a set of C++ classes in the `User::` namespace, found by their RTTI names (the
compiler stores each class name as a string next to its type info, and every object's vtable points
back to that type info, so a name leads to the vtable and from there to the methods): `AIPlayer`,
`AIBrain`, `AIResources`, `AIProducer`, `ArmySquadManager`, `Squad`, `JobAttack`, `JobDefend`,
`JobScout`, `JobRepair`, `JobContractBuild`, `JobAttackTaskForce`, `TargetItem`, `RequestItem`.

The AI does not cheat on actions: it builds the same command objects a player's touch input builds
and submits them the same way (confirmed: breakpoints on the command constructors fire from AI code
with the CPU's team id). It does read the whole map (enemy positions through fog). Our port does the
same: `aiStep` returns ordinary `Command`s that go through `applyCommand` for the AI's player.

ARM note: most AI code is THUMB (16-bit instructions, odd function pointers), the team helpers
around 0x02085000-0x02088FFF are ARM. Addresses below are function starts.

## Objects

| object | ctor | what it holds |
|---|---|---|
| AIPlayer | 0x02089FE4 | own and enemy team, stats, goal list, AIResources, AIBrain, AIProducer, transport helper, builder % (70), away % (30) |
| AITeamStats | 0x020922B8 | income, builder share, military count, buildings, away % |
| AIResources | 0x02094028 | builders: harvest, build, repair; building plans; builder queue (10) |
| AIBrain | 0x0208B084 | army unit requests (queue of 4), attack planning, ArmySquadManager |
| AIProducer | 0x0208C1C0 | the only thing that spends bricks on units |
| ArmySquadManager | 0x020986F4 | squads and their jobs |
| TargetMgr | 0x0209E4E4 | goals: the home base (defend) and attack points |

## Timing (confirmed)

`AIPlayer_updateDispatch` (0x0208AC08) runs every tick with a counter 1..13. Counter `c`:
`c%6==0` resources, else `(c+2)%6==0` brain, else `c%3==0` income + producer (and unit counts when
the tick is a multiple of 5), else `(c+3)%8==0` goal expiry. The brain alternates: every 4th update
economy and the away %, two updates later the squads, every odd update attack planning.

All randomness comes from the AI's own generator (0x0208AEF0): a 64-bit LCG
`s = s*0x5D588B656C078965 + 0x269EC3`, result `(hi32 * n) >> 32`. It is separate from the combat RNG,
so the AI doesn't shift combat rolls. We seed it from the world seed and player id (the game's seed
is not reproduced; guess that it matters only for exact replays against the cartridge).

## Skirmish setup (confirmed in RAM)

- The CPU gets **+100 bricks** at match start (0x02045BC8).
- About 5 s in (event 0x84, 0x02045CB4) it adds an attack goal on the enemy base. We use tick 162 (likely).
- At tick 3073 (event 0x85, 0x02045D50) the builder share target drops 70 → 18 and the away
  threshold rises 30 → 60: it stops growing the economy and starts sending more units out. confirmed

## Economy (AIResources 0x020942C0, AIBrain_economy 0x0208B1D0)

- Builders: keep at least 3 and at most 9 (priority 99 request) while the builder share is under the
  target %. confirmed
- Harvest: the nearest tree within 4 cells of the builder, else the map's forest markers (MARK
  records of type 0) with a rotating ±3 offset, searched within 7. confirmed
- Lumber mill priority 81; mine priority 99 (76 when bricks > 1920 or more than 10 soldiers); farm
  priority 80 when free population runs low (wants 2 if bricks > 2575). confirmed (code), likely (values in play)
- Every 12th tick the economy pass does only its "pool chores" (towers where squad-less builders
  stand); that pool was empty at all 175 calls we watched, and our builders have no such state, so
  it does nothing here. likely
- Placement: anchor next to the base, farms on the side away from the enemy, barracks, factories and
  towers toward it; spacing roll `rand(10)`; ring search up to 16 cells (28 for the second pass, +8
  for farms). confirmed
- Builders that are harvesting get pulled to build only under the steal rules in `assignBuild`. likely
- Repair: damaged own buildings get the nearest idle builder. likely
- Army units (`AIBrain_pickArmyUnit` 0x0208BF70): melee by default; ranged when melee > ranged + 4;
  mounted when ranged > 3 and bricks > 200; 50% chance of a special when bricks > 750, a special slot
  is free, fewer than 10 free unit slots, and a special factory exists. Water-only specials are
  skipped on land maps. Army queue holds 4, builder queue 10. confirmed (code), likely (thresholds in play)
- The producer trains at the nearest idle finished factory, one unit per factory at a time. confirmed

## Buildings and towers (AIResources "try other" 0x0209524C)

When no plan went to a builder on an odd pass, the CPU rolls `AI_rand(4)` and does one chore
(observed 75/61/82/62 over 280 calls; confirmed):

1. **Towers.** At most 7. With more than 4 Tower Is it may upgrade one. Otherwise, once it has a
   barracks and soldiers, it proposes a tower at priority 50 at the nearest tower spot (the map's
   MARK records of type 3; mp01 has 22) to its start. A spot takes a tower while none stands within 8,
   or 1-2 do and a "spot check" passes: an own building within 6, and the strength of everything
   within 6 plus `rand(60)` under 225. Then the spot is given up. confirmed (proposals at (49,45), then
   (57,47) on mp01)
2. **Walls.** It would plan wall rings past tick 7000 with 8 soldiers and 2 towers, but never built
   one in 13,700 ticks of emulator play. Not ported.
3. **Production buildings**, when it has no barracks, or 6 soldiers and 355 bricks, or 1500 bricks:
   - Barracks: the first at priority 99 at the base; a second at 50 when bricks exceed the reserve
     by 1500 (seen at tick 2619); a third when it has 2, a special factory and 2575 bricks, at
     `(base + enemy start) / 3` per axis. That is the sum over 3, not a third of the way: (20,22) on
     mp01, next to the human base, rebuilt every time it falls. confirmed
   - Special factory (stables role): the first above 355 bricks, a second above 2575; priority 50. confirmed
   - Shipyard: needs the island test (0x02093A50), not traced; it never fired on mp01. Not ported.
4. **Upgrade timer.** Counts passes; past the interval (40 at start, 1 after any tower appears,
   reset to 60 or 20 by case 1) it upgrades the Tower I nearest the base that is at least 100 ticks
   old (a Tower II once there are enough). confirmed
   - Quirk: the game re-issues the upgrade every ~150 ticks, and each re-issue restarts the research,
     so later upgrades never finish there. Our upgrade command ignores a tower that is already
     upgrading (towers thread, `sim/src/structures.ts`), so ours finish. Known difference.

**Tower next to a new building** (handler 0x0208A85C, TowerNextTo 0x020961A0): when a lumber mill,
mine, barracks or special factory's foundation goes down and bricks exceed the reserve by 340, the
CPU orders a tower right there, outside the plan, if the spot check passes. This is where most of its
towers come from. confirmed. The game hands it to the builder that placed the site; our builder is
inside the site by then, so the nearest idle builder (else harvester) takes it. guess

Bricks held back (reserve, 0x02093F7C): 420 while a special factory is planned, 420 before tick 7000
with more than 4 soldiers and no lumber mill, 600 for a late mine. likely

## Army (ArmySquadManager 0x0209878C, attack planning 0x0208B440)

- New units join a pool squad; squads are formed per job (attack, defend, scout).
- Defend: when the away % passes the threshold, or there is no defend squad and the home goal is
  threatened, a defend squad is formed. confirmed (code)
- Attack: every 300 brain updates it launches at the goal with the smallest enemy strength above 21
  (above 5 when `rand(10) > 7`); it needs 10 more strength than the goal's if that is under 25.
  Strength is each unit's priority field (+0x70). confirmed (code), likely (in play)
- Scouts every 900 planning calls, 1-3 units. A quirk is kept: a scout point with
  x > map height - 3 becomes x = 1 (it compares x with the height). confirmed (code)
- Squad steps: gather (wait up to 75 steps, give up at 150), assemble, advance with combat moves
  (the move command's mode 2: units fight what they meet on the way), fight back when hit, regroup
  within 6 cells, hold. The hero idles near base, wandering `rand(2r+10)-r-5` cells (r = 6), and
  retreats under 700 HP. confirmed (code)
- Hero spells: the real choice list is built around 0x02097780 and not traced. Our version casts a
  random castable spell at the nearest enemy within 5 cells once the charge is almost full. **guess**

Our addition (guess): units walk in straight segments with a short A* (movement.md), so a squad
sent straight across a lake stops at the shore. Advancing, regrouping and far-off fights steer by
waypoints 12 cells along a walkable route. How the game's CPU gets around water is not traced.

## Checking against the game

Run in DeSmuME (py-desmume, tools/emu) with the human idle, King vs Wizard CPU on mp01, logging every
entity the CPU creates. The CPU's first barracks came at ~190 ticks, builders at 175-1833, its
first soldier at 1895, a lumber mill at 2234, towers from 1572, a mine at 3250, and it killed the
idle King's base around tick 5100. `npx tsx tools/ai/run.ts game.nds mp01 9000 King Wizard` gives our
port's timeline on the same setup:

| | game | port |
|---|---|---|
| first barracks | ~190 | 12 |
| first tower | 1572 | 1676 |
| first soldier | 1895 | 2083 |
| special factory | 2798 | 3808 |
| lumber mill | 2234 | 6818 |
| second barracks | 2769 | 8274 |
| first tower upgrade done | 4684 | 4771 |
| idle King beaten | ~5100 | 8277 |

The first barracks comes early because the game's priority-99 barracks plan waited until ~175 for a
builder, for a reason we haven't found. The late second barracks and lumber mill and the slow win are
open: the port spends more on towers early and its first attack is smaller.

## Not ported yet

- `JobAttackTaskForce` (siege groups), transports and naval landings (AIPlayer+0x58), retiring
  units when at the population cap, late-game cleanup (0x02094738).
- Bridges and walls built by the AI (0x02094504, 0x0208C6B8), the shipyard proposer, pool chores.
- Hero spell choice (guess above).
- The game's exact AI seed.
