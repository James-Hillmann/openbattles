# Combat

Game: LEGO Battles (USA, `C5SE`). Found 2026-10-08 by reading ARM9 and watching a real fight in
DeSmuME (hooks on the attack functions, King vs Wizard Swordsmen/Crossbowmen on The Pond).
Ported to `sim/src/combat.ts`; the hit flash is in `client/src/main.ts`.

**DS background:** the game time counter used here ticks at 30 Hz (every 2nd VBlank). Most game
math is 20.12 fixed point (`x << 12`, 4096 = 1.0); the ARM9 does 64-bit `smull` then shifts right
12. Numbers below are plain integers unless they say 20.12.

## Stat fields (BP/Entities.ebp, kind-0 records)

| offset | type | meaning | confidence |
|---|---|---|---|
| +0x04 | u16 | entity index; keys the melee bonus tables below | confirmed |
| +0x62 | u16 | max HP. Runtime HP is a u16 at unit +0x1A0 | confirmed |
| +0x66 | u16 | projectile: entity index of a kind-1 record, `0xFFFF` = melee | confirmed (`isMelee` @ `0x0205E5F4`) |
| +0x68 | u16 | melee base damage (King 40, Swordsman 10) | confirmed |
| +0x6A | u16 | melee random damage: each hit adds `rand(n)`, 0 <= roll < n (King 10, Swordsman 5) | confirmed |
| +0x6C | u8 | copied into the stats component (+0x16); unused by attacks we saw. 0 except mines (25) | guess |
| +0x6D | u8 | cooldown in ticks between attacks (King 20, Swordsman 30, Archer 24) | confirmed |
| +0x6E | u8 | minimum range in cells (1 for all units) | confirmed (code) |
| +0x6F | u8 | maximum range in cells (melee 1, Archer 5, Catapult 8) | confirmed (code) |
| +0x5C | u8 | role: 0 hero, 1 builder, 2 melee, 3 ranged, 4 mounted, 5 transport, 6 siege/special, 7 base, 8 lumber mill, 9 mine, 10 farm, 11 barracks, 12 special production, 13-15 tower levels, 16 shipyard, 17 bridge, 18 gate, 19 wall | likely (switches in targeting and damage code; names match) |
| +0x70 | u8 | target priority for auto-targeting: higher is picked first (hero 30, builder 11, Swordsman 15, Archer 18, Knight 20, towers 40, Ballista 45, Catapult 55, Gryphon 65, base 10, other buildings 2-8) | confirmed (code) |
| +0x71 | u8 | sight radius in cells: how far idle units look for enemies (5 melee, 7 ranged, 8 siege, 11 base) | confirmed (code) |

The hero card's lightning-bolt rating presumably summarizes damage; not checked.

### Projectile records (kind 1, 0x74 bytes)

Archers, towers, siege and ships point +0x66 at one of these (`Arrow`, `CrossbowBolt`, `Boulder`...).

| offset | type | meaning | confidence |
|---|---|---|---|
| +0x0C | u16 | flight speed, 1/4096 cell per tick like unit speed (Arrow 2048) | likely |
| +0x6B | u8 | 1 = splash damage (Boulder, TBoulder, OgreBoulder, Fireball, TFireball, AirFireball, ICannonBall, PCannonBall, PlasmaBall, LaserCannon, Gift) | confirmed (code) |
| +0x6C, +0x6E | u16 | min/max damage of the in-flight hit (`0x0206E3E8`, a callback the flight calls with the entity it hits); +0x70/+0x72 are the arrival hit's (`0x0206E430`). Always equal in this ROM, so no visible difference | confirmed (code) |
| +0x70 | u16 | min damage | confirmed (code) |
| +0x72 | u16 | max damage, exclusive: damage = min + rand(max - min) | confirmed (code) |

Record sizes per kind: 0x7C (kind 0), 0x74 (kind 1), 0x70 (kind 2), 0x227 records, then the
string table. Confirmed: the loader's switch, and the walk ends exactly at the string table.

## Melee hit (`0x02050A40`, confirmed in the emulator)

Called every tick for a unit that is attacking a target in range.

1. If `now < lastAttack + cooldown` (unit +0x19C, entity +0x6D), do nothing.
2. `lastAttack = now`. Melee units (no projectile) hit right away:
3. `roll = damageRand > 0 ? rand(damageRand) : 0` (one draw from the game RNG).
4. `base = max(1, damage + bonus(attacker, defender))` (`0x0205CC68`).
5. HP -= `(roll + base) * defenderMultiplier` in 20.12, clamped at 0. The multiplier sits in the
   defender's stats component (unit +0x164, multiplier at +0x10, read through `0x0205CBD4`). It is rebuilt
   from the unit's buffs (`0x0205CCA4`): 1.0 normally, 0.5 with a positive buff in slot 2 (the armor spell,
   spells.md) and 2.0 with a negative one. The same routine scales speed (slot 0: x1.5, or a cut), damage
   (slot 1: x2 or x0.5) and two more stats (slots 3, 4). confirmed (code); no skirmish spell we know gives a
   negative buff

Emulator log (King: damage 40, rand 10, cooldown 20 vs Wizard Swordsman: 15, 5, 30):

```
t3529 King      -> Swordsman  base=40 roll=9  hp 225 -> 176
t3530 Swordsman -> King       base=15 roll=1  hp 1000 -> 984
t3549 King      -> Swordsman  base=40 roll=0  hp 176 -> 136
t3560 Swordsman -> King       base=15 roll=4  hp 984 -> 965
```

King hits every 20 ticks, the Swordsman every 30, rolls stay in [0, n). Over 60+ hits, every
HP change equals roll + base exactly.

### Melee bonus tables (confirmed)

`bonus = matrix[defClass[defender] * stride + atkClass[attacker]]`, a signed byte; 0 if either
class byte is `0xFF`. Indexed by entity index (+0x04). USA addresses: stride byte `0x021413E8` (40),
attacker classes `0x021413EC`, defender classes `0x02141614`, matrix `0x0214183C` (102 rows).
`extract/src/entities.ts` reads them from your ROM; they're never copied into the repo.

What's in them, roughly: buildings take +15 to +20 from heroes and builders and -10 from basic
infantry; melee units get +10 against ranged units and +10/+15 against mounted/flying.
Only the first 40 entity indexes have attacker classes (heroes and early units of each faction),
so many later units get no bonus at all. Looks like an unfinished spreadsheet in the shipped game.

## Ranged hit

Ranged units go through the same cooldown, then spawn a projectile (`0x02050C5C`). On impact
`0x0206E950` deals `min + rand(max - min)` times the defender multiplier to whatever stands in the
target cell (confirmed, code). No bonus table for projectiles.

Flight (confirmed: code and emulator). The projectile moves through the same movement routine as
units (`0x0205571C`): in cell space, at its speed (+0x0C, e.g. CrossbowBolt 2731 = 2/3 cell per
tick), re-aimed at the target's current position each tick, and its first move happens on the
tick it is fired. After each move, `0x0206E2xx` hits when the projectile's cell lies inside the
target's footprint (`0x0207ECFC`), so it lands as soon as it *enters the target's cell*, not
when it reaches the target's centre. Emulator, W_Crossbowman at the King (positions read from the
projectile object, +0xEC/+0xF0 in 20.12 px):

| shot | distance | ticks to hit | why |
|---|---|---|---|
| straight down, King still | 2 cells | 3 | 32 px at 10.7 px a tick, enters the King's cell on the 3rd move |
| sideways, King walking in | 2 cells | 1 | 16 px a tick, King stepped into the cell it reached |
| sideways | adjacent | 0 | its first move, on the firing tick, already enters the King's cell |

The game puts units at cell corners and rounds positions to cells; the sim puts them at cell
centres and floors, which gives the same cells.

On arrival (`0x0206E430`) a shot fired at a unit (mode 1, set when the shooter had a target, `0x0206E0F4`)
damages that unit only if it is still alive; a splash shot explodes on its own cell either way. A shot fired
at a cell (mode 0) hits every enemy standing in that cell. confirmed (code). Whether a shot keeps flying after
its target dies (so a splash shot still explodes there) is in the flight action (`0x0205482C`, update
`0x02053C44`), not traced: the sim drops it.

### Splash (`0x0206E5EC`, confirmed by reading the code)

Projectiles with +0x6B = 1 damage an area instead of one cell:

1. For ring `r` = 0, 1, 2: take every map cell in the square `r` cells around the impact cell
   (Chebyshev distance, clipped to the map). A cell already hit by a smaller ring is skipped, so
   the area is 5x5 cells and each cell is hit once.
2. Skip cells whose occupant is on the shooter's team or an ally.
3. Factor `f = 1.0 - 0.2 * r` in 20.12: 4096, 3277, 2458 (1.0, 0.8, 0.6).
4. `min' = (min * f) >> 12`, `max' = (max * f) >> 12`, then the normal hit: `min' + rand(max' - min')`.

The game holds one unit per cell; the sim lets units share cells, so every enemy unit in a cell
takes its own hit.

## Auto-targeting (`0x02063680`..`0x02063AF0`, confirmed by reading the code)

Each unit has an AI component (unit +0x2A0) with a tick counter (+0x48).

- **When:** a unit scans when `(counter + 0x1C) % 30 == 0`: once a second, first at age 2 ticks,
  so units spawned together scan together. It scans while idle, moving or attacking (AI states
  1-4) but not in states 5-6 (likely: dead/garrisoned).
- **Radius:** sight (+0x71) for units; max range (+0x6F) for buildings (role 8-19).
- **Results** come back 0-5 ticks later (the search is queued). The sim applies them at once
  (guess that this doesn't matter visibly).
- The sim scans while holding, patrolling or attacking an enemy it picked itself; not while
  walking under a move order, and it never drops a target the player ordered. Idle units hold a
  post and measure the pick from it; Stand Ground only takes enemies in range (orders.md).
- **Candidates** (`0x0207EC24` -> `0x0207E994`): every occupant of the square of cells within the search
  radius of the unit's cell (Chebyshev, clipped to the map), added row by row from the top-left; a building
  once, at its first footprint cell in that order. confirmed (code)
- **Pick** (`0x020638A8`): walk that list from the end. Drop candidates outside
  `min range <= d <= sight + max range` (of the post when holding). Once the pick is in attack range, an
  out-of-range candidate is skipped; otherwise a candidate replaces the pick when its priority (+0x70) is
  strictly higher, or when it is in range and the pick isn't. So ties keep the candidate found **last** in
  the row-major scan (lower, then further right), and a priority-0 enemy is never picked unless it is in range
  and nothing in range was picked before. confirmed (code); two units sharing a cell (the sim allows it) go by
  higher id first (our rule)
- **Stand ground** (`0x020673FC`): the same walk over the max-range square, in-range candidates only, strictly
  higher priority replaces, so the same tie order and priority 0 never. confirmed (code)

## Cheat flags (likely, not ported)

Three flag bytes in a global settings block (`0x020092A8` returns it) change combat for the local
player only: +0x01 makes the hero kill in one melee hit, +0x0D makes the hero take no damage,
+0x11 doubles splash damage (capped at 0xFFFF). These look like the unlockable extras. They're
off in a normal skirmish and would desync online play, so the sim ignores them.

## Taking damage (`0x0205E7D4`)

Sets HP and records the time at unit +0x1A4. If the unit wasn't hit in the last 450 ticks (15 s),
it raises an "under attack" alert (likely). It also posts event `0x2C` (damaged; likely what
starts the hit flash).

## Range check (`0x0205E63C` -> `0x0207F640`, confirmed by reading the code)

Squared Euclidean distance between cells, inclusive: `min^2 <= dx^2 + dy^2 <= max^2`, with dx, dy
in whole cells (20.12, but integral). For buildings it loops over the attacker's footprint and
uses the nearest cell of the target. Consequence: melee range 1 reaches the 4 orthogonal
neighbours but **not diagonals** (1 + 1 > 1), and not the unit's own cell (min range 1).

## RNG (confirmed)

`0x020F1108` is the Nitro SDK `MATH_Rand32`: 64-bit LCG `x = x * 0x5D588B656C078965 + 0x269EC3`,
result `((x >> 32) * max) >> 32`. One shared game RNG (also used by AI), so the exact sequence
can't be matched in a lockstep game anyway. The sim uses its own seeded RNG with the same ranges.

## Timing and animation

- Game time counter: `[0x021552F4 + 4] + 0x8B4`, +1 per 2 VBlanks (30 Hz). confirmed.
- The attack animation (`*_2` sheet: 5 rows of facings x 5 frames, then the idle pose) starts
  about when damage lands. likely, from screenshots every 4 VBlanks; the client plays it from
  `lastAttack` at 15 fps.
- Hit flash: the unit is drawn with palette bank 12 of `KingFaction.NCLR`, a bank of light greys
  (confirmed: every flashed pixel in the emulator equals a bank-12 colour after the DS's 5-bit
  rounding, e.g. 189,197,189 shows as 184,192,184). Timing (likely, emulator, 4 hits on the King
  and a Wizard Swordsman): starts 4-6 VBlanks after the HP change and lasts 6-7 VBlanks, so about
  2.5 to 5.5 ticks after the damage tick. The client uses that window.

## What the sim does that the game may not (guesses to check)

- Units and buildings whose record has no melee damage, no random damage and no projectile
  (castles, farms, mills, barracks...) never attack: the sim drops their attack stats at spawn.
  The formula above would otherwise give them max(1, bonus) a swing. Likely, not watched.

- Without pathing, melee units walk to the cell beside the target on the side they come from.
- Damage multiplier fixed at 1.0.
