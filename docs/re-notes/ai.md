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
  priority 80 when free population runs low (wants 2 if bricks > 2575); tower priority 50 when no
  tower is within 12 of the spot and the CPU has more than 4 buildings. confirmed (code), likely (values in play)
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

## Checking against the game

Run in DeSmuME (py-desmume, tools/emu) with the human idle, King vs Wizard CPU on mp01, logging every
entity the CPU creates. The CPU's first barracks came at ~190 ticks, builders at 175-1833, its
first soldier at 1895, a lumber mill at 2234, towers from 1572, a mine at 3250, and it killed the
idle King's base around tick 5100. `npx tsx tools/ai/run.ts game.nds mp01 6000 King Wizard` gives our
port's timeline on the same setup (first soldiers ~1970, win ~4600).

## Not ported yet

- `JobAttackTaskForce` (siege groups), transports and naval landings (AIPlayer+0x58), retiring
  units when at the population cap, late-game cleanup (0x02094738).
- Bridges and walls built by the AI (0x02094504, 0x0208C6B8).
- Hero spell choice (guess above).
- The game's exact AI seed.
