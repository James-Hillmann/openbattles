# Combat

Game: LEGO Battles (USA, `C5SE`). Found 2026-10-08 by reading ARM9 and watching a real fight in
DeSmuME (hooks on the attack functions, King vs Wizard Swordsmen/Crossbowmen on The Pond).
Ported to `sim/src/combat.ts`.

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
| +0x70 | u8 | grows with unit cost (Swordsman 15, Knight 20, Catapult 55). Maybe score/XP | guess |
| +0x71 | u8 | sight radius in cells (5 melee, 7 ranged, 8 siege, 11 base) | guess |

The hero card's lightning-bolt rating presumably summarizes damage; not checked.

### Projectile records (kind 1, 0x74 bytes)

Archers, towers, siege and ships point +0x66 at one of these (`Arrow`, `CrossbowBolt`, `Boulder`...).

| offset | type | meaning | confidence |
|---|---|---|---|
| +0x0C | u16 | flight speed, 1/4096 cell per tick like unit speed (Arrow 2048) | likely |
| +0x6B | u8 | nonzero = area damage path (`0x0206E5EC`), not ported | likely |
| +0x6C, +0x6E | u16 | always equal to +0x70/+0x72 in this ROM; not read by the hit code we traced | guess |
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
   defender's stats component (+0x10) and was 1.0 for every unit we saw (likely a buff/upgrade hook).

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

## Ranged hit (likely)

Ranged units go through the same cooldown, then spawn a projectile (`0x02050C5C`, not traced in
detail). On impact `0x0206E950` deals `min + rand(max - min)` times the defender multiplier.
No bonus table for projectiles. We assume the projectile homes on its target and fizzles if the
target dies first (guess; matches what's on screen, not checked in code).

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
- Hit units flash white a few frames after the hit. Not ported.

## What the sim does that the game may not (guesses to check)

- Idle units auto-attack the nearest enemy within sight (+0x71). Tie: lower id.
- Without pathing, melee units walk to the cell beside the target on the side they come from.
- Damage multiplier fixed at 1.0.
