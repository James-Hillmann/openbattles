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

The counter is in step with the game's tick: on tick t it is ((t - 1) mod 13) + 1, so the resources pass runs
on ticks with t mod 13 = 6 or 12 (all 40-odd passes in two emulator matches; ours starts it at 13 on tick 0).
The resources pass gets the tick itself: even ticks do the economy (and every 12th tick only the pool chores),
odd ticks hand out the plan or do a "try other" chore. confirmed

All randomness comes from the AI's own generator (0x0208AEF0): a 64-bit LCG
`s = s*0x5D588B656C078965 + 0x269EC3`, result `(hi32 * n) >> 32`. It is separate from the combat RNG,
so the AI doesn't shift combat rolls. The game seeds it once at boot from the DS clock's time of day,
`hours << 12 | minutes << 6 | seconds` (0x0208ADA0 via 0x020F10CC; two boots gave 0xF210 and 0xF4E4), so no two
sessions play the same. We seed it from the world seed and player id. confirmed

## Skirmish setup (confirmed in RAM)

- The CPU gets **+100 bricks** at match start (0x02045BC8).
- About 5 s in (event 0x84, 0x02045CB4) it adds an attack goal on the enemy base. We use tick 162 (likely).
- At tick 3073 (event 0x85, 0x02045D50) the builder share target drops 70 → 18 and the away
  threshold rises 30 → 60: it stops growing the economy and starts sending more units out. confirmed

## Economy (AIResources 0x020942C0, AIBrain_economy 0x0208B1D0)

- Builders: keep at least 3 and at most 9 (priority 99 request) while the builder share is under the
  target %. confirmed
- Harvest (0x020965CC): the first tree within 4 rings of the builder, else from the map's forest markers
  (MARK records of type 0): the nearest unclaimed one to home (every other time to the builder), moved 3 cells
  up, down, left, right in turn by the harvest count (up only when y > 4, left only when x > 4), then the
  first tree within 7 rings of that. Both searches use the game's ring order (below). A marker with no tree
  left is given up; with no marker left the CPU wants one more mine. confirmed (code; emulator: the first
  search went from (58,49), 3 above the marker at (58,52), and picked the tree at (59,50))
- **Ring search** (0x02080430, `sim/src/ring.ts`): ring by ring, and within a ring nearer the side's middle
  first; among the symmetric cells at the same spot the order comes from three small tables the game reshuffles
  with its shared RNG at the start of every tick (0x02080398). A setup bug leaves the cells straight left and
  right of the centre out of every search. Building placement uses the same search. confirmed (code, tables read
  from RAM)
- Lumber mill (part of the harvest pass, for a tree found from a marker): with 1500 bricks or less only when
  that tree is 16 or more cells from home; then with more than 355 available, the CPU finds a spot within 16 of
  the tree and proposes a mill there at priority 81 unless one of its mills is closer than 11. So it can build a
  second mill at another forest. confirmed (code; emulator proposals at (57,47) and (42,61))
- Mine priority 99 (76 when bricks > 1920 or more than 10 soldiers); farm
  priority 80 when free population runs low (wants 2 if bricks > 2575). confirmed (code), likely (values in play)
- Every 12th tick the economy pass does only its "pool chores" (0x02097054): for each builder not yet in a
  squad, a tower at priority 76 where it stands (if a barracks exists and the spot check passes), and a walk
  home if it is more than 15 from home. It fired once in 6000 emulator ticks, on a Builder trained 12 ticks
  earlier (tick 1800, tower at (52,54)). Our builders have no squad-less state, so it does nothing here. Not
  ported.
- Placement: anchor next to the base, farms on the side away from the enemy, barracks, factories and
  towers toward it; spacing roll `rand(10)`: 0 below 3, 1 below 9, else 2 (farms 1); ring search up to 16
  rings (28 after 10 failures while fewer than 2 markers are given up, +8 for farms). The spot test
  (0x020016AC) asks the CPU's buildings, except mines, shipyards, bridges, gates and walls, for a margin of
  spacing + 1 cells all round inside the map, on ground the building could stand on (no trees) and without
  other buildings (walls and mines don't count). confirmed (code)
- Plans (0x02097354 / 0x020951F0): a proposal replaces the plan only when the plan is empty or of strictly
  lower priority, and says so; a plan of the same role counts as yes. It needs the available bricks (below)
  to cover the price and, for a building, a builder. An unaffordable plan loses a priority point per odd pass,
  down to 10. confirmed (code)
- Available bricks (AITeamStats +0x3C) are the bank as the income pass last saw it, or 0 when the reserve is
  larger. The reserve and the planned role are worked out when a plan is set and when an own building is
  created, and the role stays until a building of it appears. confirmed (code)
- Handing the plan out (0x02094324): to the nearest idle builder, else to the nearest harvester if 8 are
  harvesting, or if at least 2 are and the plan has waited 56 passes, or there are more than 1500 available
  bricks, or the plan's priority is 76 or more, or 3 harvest and more than 750 are available. With fewer than
  2 harvesting it waits, which is why the first barracks (priority 99, proposed at tick 25) went to the second
  Builder as it came out at tick 175 in both emulator matches. confirmed (code and emulator)
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
   - Special factory (stables role): the first above 355 bricks, a second above 2575; priority 50. The
     shipyard proposer runs between them whenever the barracks proposer said no *or no shipyard stands*, and
     its answer replaces the barracks', so without a shipyard the special factory is always tried as well
     (emulator: barracks 99 and special factory 50 proposed on the same pass, tick 25). confirmed
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

Run in DeSmuME (py-desmume, tools/emu) with the human idle, King vs Wizard CPU on mp01, from a fresh profile,
with exec hooks on the CPU's propose (0x02097354), hand-out (0x02096988) and harvest (0x020965CC) functions and
its per-role counters (team +0xDA, which count sites) read every 30 frames. Two matches, started 137 frames
apart; the AI's draws were the same until about tick 1800, when combat timing split them.
`npx tsx tools/ai/run.ts game.nds mp01 9000 King Wizard --trace` gives our port's timeline and decisions on the
same setup. Ticks below are when each site went down (or the unit came out):

| | game A | game B | port |
|---|---|---|---|
| first barracks (proposed 25, handed out 175) | 272 | 276 | 272 |
| first farm (proposed 344, handed out 357) | 395 | 385 | 449 |
| first tower | 1313 | 1306 | 948 |
| first soldier | 1849 | 1841 | 1968 |
| second barracks | 2616 | 2650 | 2753 |
| special factory | 3255 | 2665 | 3378 |
| lumber mill | 3075 | 4072 | 3260 |
| mine | 5513 | 4116 | 5419 |
| first Tower II | 2943 | 2902 | 4219 |
| idle King beaten | not by 6500 | not by 6500 | 6128 |

Up to the first farm the port makes the same decisions on the same ticks, at the same cells for the
barracks (47,51). After that the AI's random rolls (its own seed, the game's from the clock) and the shared
ring-search shuffle decide spots and order, so single matches differ; the later milestones fall in the
range of the two game runs. Known gaps: the first tower in both game runs came from a 4-in-100 roll at tick
389 that let it propose with only 235 bricks, and the game's Tower II comes earlier (its upgrade timer).

## Not ported yet

- `JobAttackTaskForce` (siege groups), transports and naval landings (AIPlayer+0x58), retiring
  units when at the population cap, late-game cleanup (0x02094738).
- Bridges and walls built by the AI (0x02094504, 0x0208C6B8), the shipyard proposer, pool chores.
- Hero spell choice (guess above).
- The game's exact AI seed.
