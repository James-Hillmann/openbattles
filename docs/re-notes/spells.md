# Hero spells

LEGO Battles USA (C5SE). Heroes cast spells ("magic") from an orange tab on the touch screen.
Tags: **confirmed** = code read and seen in DeSmuME, **likely** = code read, **guess**.
Sim: `sim/src/spells.ts`. Extract: `extract/src/spells.ts`. Ticks are 30 per second.

DS notes for newcomers: numbers marked 20.12 are fixed point (4096 = 1.0). The game multiplies
them with `smull` and rounds (+0x800) before shifting right 12 (`0x0204F2B8`), and divides with
the DS's hardware divider, rounding to nearest (FX_Div, `0x0210A604`).

## Spell table (confirmed)

One 0x14-byte record per spell at ARM9 `0x02126CB0`, 35 records, index = spell id = type byte.

| off | size | meaning | conf |
|---|---|---|---|
| +0x00 | u8 | type (= id); the factory `0x0207BBEC` picks the class from it | confirmed |
| +0x01 | u8 | icon: strip button / icon number | confirmed |
| +0x02..+0x05 | u8 x4 | class parameters (damage spells: end damage, end chance %, start damage, start chance %) | confirmed |
| +0x06 | u8 | cast range in cells | confirmed |
| +0x07 | u8 | area radius in cells | confirmed |
| +0x08 | u8 | what the player taps, see "Targeting" | likely |
| +0x0C | u32 | charge cost | confirmed |
| +0x10 | u16 | unknown (maybe an AI category) | guess |
| +0x12 | u16 | duration in ticks for damage, freeze, hot wire and tracking spells | confirmed |

A settings byte (`[0x020092A8]+8` / `+9`) makes range and +0x12 x1.5; it looks like a cheat brick. Not ported.

Classes: 1-3 HealSpell, 4-9 / 17 / 19 / 24 StatBufSpell, 10-12 ForrestSpell, 13 / 18 / 20-23 / 25 / 28 / 31
DamageSpell, 14 FireBall, 15 LightningBolt, 16 ThunderHammer, 26 Teleport, 27 / 29 EAttackSpell,
30 Tracking, 32 HotWire. 33 and 34 are the damage areas of Lightning and FireBall.

## Heroes' spells (confirmed)

Entity +0x72..+0x76 list the spell ids (0 = none); +0x64 is the most charge (1000 for heroes, 0 units,
0xFFFF buildings). Female heroes share the male hero's list.

| Hero | Spells | Hero | Spells |
|---|---|---|---|
| King | 5, 9, 10, 13 | Wizard | 7, 5, 14, 15 |
| Captain | 5, 9, 20, 21 | Governor | 7, 9, 12, 23 |
| Commander | 5, 9, 27, 28 | AlienKing | 7, 5, 29, 11 |
| SPCaptain | 9, 7, 30, 28 | SCLeader | 5, 9, 32, 31 |
| IslanderChief | 7, 5, 12, 22 | NinjaKing | 5, 7, 26, 25 |
| DwarfKing | 9, 7, 17, 16 | TrollKing | 7, 5, 19, 18 |
| ForestMan | 5, 9, 30, 25 | Ghost | 9, 7, 14, 13 |
| Sheriff | 7, 5, 27, 23 | Conquistador | 9, 7, 17, 21 |
| AgentChase | 5, 7, 32, 11 | ClassicSpace | 7, 9, 29, 28 |
| Santa | 5, 9, 10, 26 | | |

The list builder (`0x02002D6C`) also adds spell 3; the player's strip skips it (`0x020DC062`), only the
computer player's list keeps it.

Names: the game never shows a spell's name in battle. `SPELL_NAME_TEXT` maps ids to the LOC strings
262..294 by meaning (the effect classes each spell creates): likely, except 11 Crystal Cache, 12 Jungle
Growth and 29 Lockdown (vs ESP), which are guesses.

## Charge and casting (confirmed)

- Charge lives at unit +0x1A2. It starts full and a living hero below the most gains 1 a tick
  (`0x0205F104`; seen 900 -> 901). A pickup adds 100 (`0x0205EDA0`; pickups are not in the sim).
- Can-cast (`0x0207B810`): free when the cost is 0; otherwise the caster must be a hero, the target must
  be within range (whole-cell squared distance <= range^2, `0x0207B8A8`; no check for no-target spells) and
  the charge must be **more than** the cost. Then the cost is paid. No cooldown besides the charge.
- Command: CastSpellCommand (type 0x10): caster, record, mode (0 spot, 1 unit, 2 none). The spell is
  made and started on the command's tick (seen on tick 512).

### Targeting (+0x08; likely, from the strip's tap filter `0x020A9330`)

1 a spot on the ground, 2 one of your units, 4 an enemy unit, 8 your builder, 0x10 your mine,
0x20 an enemy transport or siege unit, 0x40 nothing: the spell goes off around the hero at once.
Seen: 1 for 5/7/9/25, 0x40 for 13, 4 for 20.

## Spell lifecycle (confirmed)

Each tick (`0x02083680`): every spell updates and finished ones are deleted (`0x0207B56C`), then **one**
spell from a scan queue gets its area recomputed (`0x02075FBC` -> `0x0207AD54`).

- A spell's update is the class's own, then SpellBase's (`0x0207A9E0`): if the caster is gone the spell
  ends; at 0 ticks left it ends; otherwise it counts down (-1 = forever). Damage spells therefore hit
  D + 1 times (61, 71, 76 seen) and a buff created on tick 515 ended on 816.
- The scan queue is first-in first-out without duplicates. Every area spell except buffs puts itself back
  after its scan, so the heal auras of every hero and base take turns. A new spell waits behind them: with
  4 auras a buff landed 4-5 ticks after the cast, and a new Earthquake hit nothing for its first 5 ticks.
- Area: units whose cell is within `|dx| + |dy| <= radius` of the centre (a diamond). Around the caster
  the centre is the caster's cell plus half its footprint, and it follows the caster. The member list
  keeps its slots: a unit that leaves empties its slot, newcomers fill the first empty one.
  guess: newcomers are taken in row order (y, then x).

## Heals (HealSpell; confirmed)

| id | what | who | amount |
|---|---|---|---|
| 1 | every base's aura, radius 5, forever | own heroes, only once the base is built | +30 HP every 7 ticks |
| 2 | every hero's aura, radius 3, forever | own non-building units, not the hero | +10 HP every 7 ticks |
| 3 | one pulse, 1 tick | own units | +maxHP / 4 |

Bases and heroes start their aura when created (`0x0205E224`). The pulse timer starts at 1, then 7.
Seen: a builder 20 -> 30 -> 40 and the King 500 -> 530 -> 560, 7 ticks apart. Spell 3 is computer-only and
actually heals nobody when cast at a spot: it pulses and ends before its area scan comes round (seen).

## Buffs (StatBufSpell; confirmed for 5, 7, 9)

Even ids take one unit, odd ids an area of radius 5 (own units, not the caster, no buildings). Every buff
lasts 300 ticks (10 s), whatever the record says, and ends early if the caster dies.

| ids | stat | effect |
|---|---|---|
| 4, 5 | speed | x1.5 (410 -> 615) |
| 6, 7 | melee damage | x2 before the class bonus (5 -> 10); ranged attacks don't read it |
| 8, 9 | damage taken | x0.5 (melee and projectiles): floor(hit / 2) |
| 24 | speed (Trade Winds) | x1.5 |
| 19 | chopping | x2 (not ported: the sim's chop timer) |
| 17 | mining, also on mines | x2 (not ported) |

- An area buff scans **once**: units inside then keep it even if they walk away, later arrivals get nothing.
- Buffs don't stack: the stats rebuild (`0x0205CCA4`) only checks whether each stat has any buff on it. Two
  casts give the same x1.5; the stat drops back when the last one ends.
- The stats rebuild on the unit's next update, one tick after the buff lands (seen).

## Damage spells (DamageSpell; confirmed for 13, 20, 25, likely for the rest)

Params: damage and hit chance slide in a straight line from the start values (+0x04, +0x05) to the end
values (+0x02, +0x03) over D ticks; both are 20.12 and the slopes round to nearest, so Earthquake's last
hit is 4 (4.998), not 5. +0x05 = 0xFF means always hit. D = +0x12 + an extra per spell.

Each tick, for **every slot** in the member list (empty ones too) the game rolls `rand(100) + 1` first.
Then a unit is hit if it is not an ally, its cell is within the spell's range (Manhattan) of where the
hero stands now, and the roll is <= the chance. The hit takes floor(damage) straight off its HP: no
armor, no class bonus, buildings too. Members are every other player's units, all layers.

Grace: when a unit joins a damage spell it gets the spell's extra as a count (unit +0x230); successful
rolls use it up before any damage lands (seen: 10 for Arrow Volley, 15 for Monkey Swarm).

| id | name | target | chance % | damage | D | extra / grace |
|---|---|---|---|---|---|---|
| 13 | Earthquake | around the hero | 50 -> 50 | 12 -> 5 | 60 | 0 |
| 18 | Roar | around the hero | 60 -> 50 | 10 -> 5 | 60 | 0 |
| 20 | Monkey Swarm | an enemy unit | 60 -> 50 | 6 -> 3 | 75 | 15 |
| 21 | Crab Swarm | a spot; hit only within a zone growing 0 -> 5 cells | 60 -> 45 | 9 -> 5 | 60 | 0 |
| 22 | Coconut Storm | an enemy unit | 60 -> 60 | 10 -> 7 | 80 | 20 |
| 23 | Artillery | a spot | 40 -> 50 | 12 -> 5 | 80 | 20 |
| 25 | Arrow Volley | a spot | 60 -> 50 | 10 -> 5 | 70 | 10 |
| 28 | Space Laser | a spot | 55 -> 50 | 11 -> 4 | 80 | 20 |
| 31 | Cluster Bomb | a spot | 40 -> 40 | 12 -> 6 | 80 | 20 |

18, 20, 21, 22 also skip units inside a transport (transports.md). Cluster Bomb draws
`rand(2)` and then two `rand(61)` per bomb when cast, for its picture; the sim draws them too so the
roll sequence matches. The pictures (EarthQuakeEffect and so on) draw from the same RNG in the game;
the sim keeps them off it.

## Freeze rings (EAttackSpell 27, 29; confirmed for 29)

A ring on the tapped spot grows from just under 1 to 5 cells over D = 60 ticks (+341/4096 a tick). Each
time it passes a whole cell (updates 2, 14, 26, 38, 50) it catches enemy units in the **square** of that
radius and freezes them for 60 ticks: they don't move, attack or work. 29 catches minifigures (roles
0-4), 27 vehicles (role 6); buildings never. The spell lasts 61 updates. No damage, no RNG.

Two game quirks, kept: after its first catch, 29 no longer takes ranged units; and a unit already caught
is caught again on later steps (its de-duplication is broken), which refreezes it. guess: a refreeze
restarts the 60 ticks.

## Pictures (not ported)

The game draws each spell with its own effect: icons over buffed units (SpellIconsSpeedEffect /
SwordEffect / ArmourEffect), `Particles/SpellIncreaseEffect.hps` when a buff lands, SpellIconsHeartEffect
on healed units, EarthQuakeEffect, ArrowVolleyEffect and so on. The client stands in with its own
markers for now: a see-through diamond (damage) or square (freeze) over the area, a pip per buff over
the unit, an ice tint on frozen units and a dot for a Fireball or Thunder Hammer in flight. Planted
trees use the map's own tree tiles.

## Forest spells (ForrestSpell 10, 11, 12; confirmed)

The far end is always `range` cells from the hero toward the tap (10; 8 for 11), Euclidean in cells,
clamped to the map (`0x02077FE0`); a tap on the hero's own cell keeps the end there. The game's 20.12
unit vector (`0x020F27B8`) is ported bit for bit in `sim/src/spellGeom.ts` (`normalize`).

- **10 Forest Spawn**: a thick line (`0x020F09DC`) strictly between the hero and the end: a Bresenham
  walk that also pushes one side cell while its error term is non-zero, and a diagonal pair (the cell
  twice) on a minor step. Straight and exactly diagonal lines are one cell thick. No RNG. First plant on
  T + 2 (T = the cast tick).
- **11, 12**: the open cells (terrain 0) of the 5x5 square around the end, rows first (`0x0207ED4C`); one
  `rand(100)` per cell sends it to the front (<= 50) or back group; the first 80% are kept. They wait for
  their picture (10 updates), so the first plant is on T + 12.
- Planting: each list cell tries its 2x2 block (offsets (0,0), (0,1), (1,0), (1,1)), one candidate a tick,
  then one tick to drop the cell: 5 ticks per cell, duplicates too. A candidate becomes a tree (terrain 1)
  only inside the playable rectangle (the whole map in skirmish), on open ground, with nobody on it. The
  spell ends the tick after its list runs out (T + 2 + 5n for 10). Names: Forest Spawn is likely; which of
  11 / 12 is Crystal Cache and which Jungle Growth is a guess.

## Fireball and Thunder Hammer (14, 16; confirmed)

They do no damage themselves: a projectile flies, and where it stops a damage area starts (record 34 for
Fireball: 60 -> 50 %, 6 -> 3, 30 ticks; record 16 for Thunder Hammer: 70 -> 50 %, 8 -> 6, 60 ticks), run
as a damage spell above (radius 5 around the stop).

- Launch on T + 1 from the hero's exact position; moves from T + 2. The velocity is set once:
  `normalize(dx, 1.5 dy)` times (24, 16) px times the speed 0.5, i.e. 12 px across / 8 px down a tick,
  straight at the aim cell's centre. A step that would pass the centre snaps onto it.
- Aim: the target unit's cell when cast at a unit, else the tapped cell. At Manhattan distance >= range
  (Fireball) the game adds `range` cells **beyond** the tap (a bug; past the left or top edge the byte wraps
  to the far side, so a fireball can fly the other way). Thunder Hammer, at distance > range, scales the
  offset down to `range` (Manhattan).
- After each step it checks its cell only: anybody there but the hero ends the flight for the spell (own
  units too); with nobody there, a tree is cut down and stops it, and so does a cliff. Reaching the aim
  cell also cuts a tree there (likely: a global flag that was on in skirmish).
- Fireball fizzles (charge spent, no damage) when it stopped on an own or allied unit or building.
  **Thunder Hammer fizzles on any unit at all**: the game's ally check compares the unit's player with
  itself. It only hurts when it lands on the ground. Its picture draws 1 `rand(8)` at launch and 6 more on
  a ground impact from the game RNG; the sim draws them too.
- After the impact the spell stays 35 (Fireball) / 37 (Thunder Hammer) ticks for its picture. A fizzled
  spell ends the tick after (guess).

## Lightning, Teleport, Tracking, Hot Wire (15, 26, 30, 32)

- **15 Lightning** (confirmed): around the hero. 14 ticks after the cast (when the hero's cast animation is
  done) record 33's damage area (65 -> 50 %, 9 -> 5, 30 ticks) starts around the hero and follows it. The
  8 beams are only a picture. The spell lingers 30 ticks.
- **26 Teleport** (confirmed for a player with a base): 23 ticks after the cast the hero lands in the first
  free cell of the game's ring search around its player's first base (seen: base at (10,10), King at
  (10,9)); without a base, around its start cell (likely).
- **30 Tracking** (likely): marks an enemy for 240 ticks (unit +0x155); the marked unit is drawn through
  fog. The mark is not counted: the first tracking to end clears it, if the unit is alive.
- **32 Hot Wire** (confirmed): taps an enemy transport or siege unit; on the next tick it changes sides for
  good and drops its orders. A siege unit is refused when the caster's player is at its special cap
  (likely). The spell shows its picture for 60 ticks.

## Gather buffs (17, 19) and Trade Winds (24)

- **19** (confirmed), on one own Builder: doubles the bricks of a load (75, or 100 with a Lumber Mill)
  when it is dropped off with the buff still on. Chopping time is unchanged.
- **17** (likely), on one own mine: doubles the mine's payout (25 -> 50); the interval is unchanged.
- **24 Trade Winds** (confirmed), on one own unit: speed x1.5, like spell 4. Transports and siege units
  show a different icon.
- Single-unit buffs take hold on T + 1, without waiting for the scan queue.
