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
| +0x10 | u16 | the computer's spell category (read as a byte by its spell choice, ai.md "Hero spells"): 0 attack, 1 hot wire / vehicle attack, 2 armor, 3 heal, 4 speed, 5 chop, 6 mine, 7 forest, 8 teleport, 9 lightning/fireball areas, 10 tracking, 11 none | confirmed (code) |
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

## Pictures

Found 2026-10-11 from ARM9 and a King's Speed cast in DeSmuME (mp01). Ported in `extract/src/spellFx.ts` and
`client/src/spellFx.ts`. Both effects below draw 24 x 24 quads, centred on their spot, cut from the local
player's faction's effects sheet: `UI/AllInOne/CastleEffects` for King and Wizard, `PirateEffects` for Captain and
Governor, `MarsEffects` for Commander and Alien (picked at `0x0202EC9C` from the local player's entity type;
confirmed from code). The three sheets differ only in rows 136-159, where the icons are.

Pictures are found through `UI/Game/UIMgrData.bin` (confirmed): record n is 28 bytes, its +8 is the file
offset of a picture record whose +0x0F byte is the palette bank and whose +0x14 holds s16 x, y, w, h in the
sheet (`0x020E3D18` returns the record).

### Hero cast effect (HeroStartSpellEffect, confirmed from code; timing seen in the emulator)

Created on the hero when a spell starts (`0x02016BFC(kind, hero)`), it shows a swirl round the body, a dome
over the head that turns into a gold picture of the spell, and plays the dome again when the spell ends.

- Spot: the hero's cell corner + (16, 12) px, i.e. 4 px right of and 4 px below our cell-centre position.
- Frames are UIMgrData ids 0x495-0x4A6 (cyan, bank 2): swirl 0-7, sparkles 8-9, dome 10-16. The picture is id
  0x4A7 + kind: kind = spell id - 4 for 4-16, plus 17 -> 0x1D, 18 -> 0x1F, 19 -> 0x1E, 20-23 -> 0xD-0x10,
  24 -> 0x11, 25 -> 0x12, 26 -> 0x13, 27 -> 0x15, 28 -> 0x16, 29 -> 0x17, 30 -> 0x18, 31 -> 0x1A, 32 -> 0x1B
  (`HERO_SPELL_KIND`; read from each spell class's call; 13 seen in the emulator; 10-12 likely). Heals start
  none.
- It steps every 3 ticks: each update adds 33.3 ms and it steps at 66.7 ms + 1 (`0x0201B410`).
- Swirl (5 px up): frames n mod 9 until 7, then (n mod 6) + 2 until the spell ends, then (n mod 3) + 9 with
  the counter restarted at 1, hidden at 2. Dome (30 px up): 10, then 10 + (n mod 7), hidden at 6; the
  picture (30 px up) shows from the dome's fourth frame. When the spell ends the dome plays again, the
  picture goes at its fourth frame and the effect is removed at the sixth. `heroFxFrame` runs both machines.
- Seen: a Speed cast's effect lasted until ~20 ticks after the 300-tick buff ended.

### Unit icons (SpellIcons*Effect, confirmed from code; offsets checked against RAM)

- Buffs: the stats rebuild (`0x0205F85C`) adds an icon per buff slot and removes it when the slot empties:
  speed -> SpellIconsSpeed (id 0x4D0, a grey winged boot), or SpellIconsTradeWind for roles 5-6 (ship wheel:
  0x4B8 if the entity record's +0x18 water flag is set, else 0x4CB); damage -> Sword (0x4D2); armour ->
  Armour (0x4D4); chopping -> Chopping (0x4C5, axe); mining -> Mining (0x4C4, pickaxe).
- Heals: a HealSpell pulse that heals a unit adds SpellIconsHeart (0x4CE) unless it has one; a pulse that
  finds the unit full removes it (`0x02078944` -> `0x02078B74`). We see pulses as HP going up (likely).
- Spot: the unit's cell corner + 12 px each way, raised by the unit's height (24 px a cell) plus 8 px for
  minifigures (roles 0-4) or 20 px for roles 5-6. Seen: a Builder's icon at (252, 188) over its cell corner
  (240, 208).
- Each tick it moves along a 14-step path (ARM9 `0x0215118C`, 12-byte records: vtable, s32 x, s32 y):
  x 0, 3, 5, 6, 6, 5, 3, 0, -3, -5, -6, -6, -5, -3 and y 0, -1, -2, -1, 0, 1, 1, 0, -1, -1, 0, 1, 2, 1.
- Removing one (effect method 9) makes it blink: still at step 0, alpha 31 and 5 on alternate ticks, gone
  after 11 ticks.

### Spell effects (found 2026-10-11)

The damage, freeze and projectile spells' own pictures, ported in `client/src/spellAnims.ts` (pictures
cut by `extract/src/spellFx.ts`, `SPELL_FX_PICS`). Each effect is an object the effect manager
(`0x020168B8`) updates once a game tick; its quads are 3D quads with an alpha 0-31 and a depth of screen
y + 11 + a per-effect bias (bigger draws on top). Sources: each class's update and draw (vtables found by
their RTTI names) plus emulator traces of every cast from the King with the spell id poked into his
spell slot (`out/re/trace.py` logs every quad set at `0x02015E24`). Confidence is **confirmed** (code,
matched in the trace) unless marked.

Position rules: a quad's x, y are its centre, because `0x02015DE0` subtracts half the previous size; the
explosion, Roar's puffs and the laser keep their top-left there. Effects on a unit follow its box: x =
corner + 12 px per footprint cell, y = the box's top (the corner is 12 px left of and 8 px above our
unit position). The game draws the pictures' random numbers from its own RNG (the sim keeps those draws
so lockstep matches, `spells.ts`); the client uses its own generator, so the same cast scatters
differently but in the same way.

- **GenericExplosion** (`0x02019CAC`): pictures 0x4D9-0x4DD, 24 x 24, top-left at its spot; a new frame
  every 2 updates (the first shows for 1), gone after 11.
- **EarthQuake** (13, `0x02015880`): no picture. The camera shakes sideways by the s16 table at
  `0x02142F4C` over 35 updates (0, 0, 1, 1, ... 13, 13, 15 x 6, 14, ... 2, 2, 0), negative on even ticks.
  Three slots (effect id mod 3) are summed and capped at 15. If the squared cell distance from the
  view's middle cell (camera cell + (5, 6)) to the hero is 36 or more, the amount is scaled by 36 / that
  (`0x020F2B5C`). Ours measures from the middle of our larger view (likely equivalent).
- **ArrowVolley** (25, `0x0200EE44`): one at the spot's cell corner and one on every unit that joins.
  An arrow every 6 updates, 5 in all, at x = rand(10) - 5, y = -(rand(40) + 40); it falls from speed 1,
  x1.25 an update, until y >= 15, then sticks (0x4EF) and fades 31, 15, 7, 3, 1. Bias 50.
- **ClusterBomb** (31, `0x02012338`): rand(2) + 1 bombs at the spot corner + (rand(61) - 30, rand(61) - 30),
  dropping from 64 px up at speed 1 x1.15, blinking on a counter from 11. On landing 4 explosions at
  +-20 px on counter 7, 5, 3, 1. Bias 200.
- **Artillery** (23, `0x0200FB88`) and **CoconutStorm** (22, `0x02012CC4`): on the hero, once its cast effect
  shows the spell picture (+0x10A). The muzzle sits at the box's centre column, 15 px left or 5 px right
  toward the target, raised sprite height / 15. Shells fly a quadratic curve whose control point is the
  midpoint pushed sideways by r * (Ey, -Ex), r = 0.5-1 (`rand(0x800) + 0x800` in 20.12), mirrored for a
  target on the left. Artillery: a shell every min(n, 10) + 1 updates, n = max(7, 30 * min(1, (len /
  128)^2)), straight when the shot is under 30 px or steeply up; explosions at the muzzle and the
  impact (bias 200). Coconut: every 11 updates, target + rand(21) - 10 each way, always curved, 20 steps,
  landing pictures 0x446-0x44A one an update, no explosion. **not ported**: the hero icon turning toward
  the target.
- **MonkeySwarm** (20, `0x0201D7FC`): on every unit that joins. Two monkeys 11-20 px left and right drop
  from 20-39 px up (x1.15 an update) flickering alpha 31 / 15, then sit, swapping 0x4F4 / 0x4F5 every 3
  updates. When the spell ends each shows a puff (0x432) for 5 updates and the last explosion frame for 5.
  Bias 40.
- **CrabSwarm** (21, `0x02013B88`): on every unit that joins. Up to 4 crabs, one an update, each in a free
  cell of a 4 x 4 grid shared by all crab swarms (`0x02151020`; col = rand(4), row = rand(4), 16 tries,
  else (36, 24)) at x = -12 + 12 col, y = -8 + 8 row. A crab climbs out over 9 updates (picture squashed
  to k px while rising 1 px an update, dust 0x4F7 / 0x4F8 flickering 4 px above), then flips every 3
  updates; when the spell ends it sinks back.
- **SpaceLaser** (28, `0x0201F45C`): on every unit that joins. 7 beam segments (8 x 8, top-left 56 - 8i px
  up), segment i starting i updates in and playing frames 0..min(i, 3); from update 7 the impact (15 x 15,
  top-left (-2, -4)) loops 3 frames. After 70 updates or the spell's end it fades 4 alpha an update,
  segment i going after 8 - i updates. Bias 200 / 220.
- **Roar** (18, `0x0201E704`): on the hero (its box's middle) once the cast picture shows. Puffs
  (0x45F-0x465, 15 x 15, top-left on the spot, one frame an update) in rings: 5 on the axes at 25 + 15k px
  starting 8 + k updates in, 6 at 26.5 degrees off the x axis at 25 + 15k starting 12 + k in. Bias 240.
- **FireBall** (14, kind 0x2E): follows the projectile. Its first five updates each add a trail particle
  (15 x 15); particle k plays frames 0..k (0x456 + frame) and holds, the last loops 3..8 (bias 220, the
  rest 200). Particles sit ahead of the fireball by v * (0.25, 0.5, 1.25, 2, 2.5, 2.5, 2.5, 2.75) by age
  (**likely**: fitted to the trace, not read from code). At impact an explosion with its top-left 16 px
  right, 8 px down; 3 updates later six more fireballs (trails and all) fly from the impact to
  record 34's radius at 0, 60 .. 300 degrees (24 x 16 px a cell) in 30 updates, ending without an
  explosion. The game also swings a scale 0.6-0.7 (`0x02151088`), which doesn't change the quads' size
  in the trace (**likely** unused for drawing).
- **LightningBolt** (15, kind 0x1E): made by the strike (`0x02079C88`). 8 bolts from the hero's cell
  corner to cells range (10) away at 0, 45 .. 315 degrees clockwise from up, offset (floor(R sin),
  floor(-R cos)), in 30 updates, then 4 more while the 16 x 16 quad (top-left 8 px right of the bolt)
  halves in size and alpha, then an explosion. Up/down 0x4D6, sideways 0x4D6 turned 90 degrees,
  diagonals 0x4D8 (mirrored for up-right / down-left). The game keeps targets inside the camera's
  cells; ours keeps them on the map (**guess**: the difference only shows near the view's edge).
- **ThunderHammer** (16, kind 0x1F): a 24 x 24 hammer on the projectile, swapping 0x4F1 / 0x4F2 every
  update and turning 90 degrees every 2 from 90 * rand(8); an explosion where it stops. 6 updates after
  a real impact (not a fizzle) six hammers fly from 10 px out to record 16's radius in 30 updates, each
  ending in an explosion. Fizzles: **guess** that Fireball also explodes where it stopped.
- **EAttack** (27 kind 0x25, 29 kind 0x27): 8 flakes (0x494 for 27, 0x493 for 29, 15 x 15) fly out of the
  spot's cell corner at 45-degree steps, b7 cells (24 x 16 px a cell) in the record's time, turning 90
  degrees every other update. Bias 0.
- **Freeze** (kind 0x31): a frozen minifigure or vehicle is drawn in grey palette bank 12 for as long as
  it is frozen (table `0x02143188`, the hit flash's bank). It also spins a swirl (0x493 / 0x494 for
  vehicles) at depth 30, which the unit covers in the emulator, so it isn't drawn.
- **SpellIncreaseEffect** (`Particles/SpellIncreaseEffect.hps`, id 2 of the particle table at
  `0x02126AC8`): when a unit's count in some buff slot goes up (`0x0205F6A0` -> `0x0205D06C` compares the
  counts with last update's), the blue plus signs play over it once, one frame a tick, following it, at
  its box corner + (sprite width / 2, -sprite height / 4) = 14 px above our position. A count going down
  plays SpellDecreaseEffect, but our sim has no debuffs.

Without the ROM's pictures the client still marks damage and freeze areas with a see-through diamond or
square. Planted trees use the map's own tree tiles.

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
