# Pickups: Blue Studs and powerups

Game class `Sim::CollectableItem`. Ported in `sim/src/pickups.ts`. Traced 2026-10-09 on C5SE.

## Where they come from (confirmed)

Every skirmish map's EVNT section ends with pickup records (8 bytes: x, y, then 0, 0x14, the
blueprint index, 0xFF, 2, 1). On all 30 skirmish maps there are 10, all with blueprint index 8.
The index points into the mission's blueprint table (`MultiplayerMissionBase` object at
`[0x02153F98+8]`, table at +0x138). Entry 8 is `BlueStud` (Entities.ebp record 211, a kind-2
record with entity index 0xD3 and type byte +0x5C = 10).

Reading the CollectableItem in RAM gives the other two record bytes their meaning:

| field | value on skirmish maps | meaning | confidence |
|---|---|---|---|
| +0x174 | 2 | mode: 1 = only the item's owner's units may take it, 2 = anyone's | confirmed (code) |
| +0x178 | 20 | role filter: 20 = any role, otherwise only units of that role | confirmed (code) |

Collectable type names (type byte, table at `0x02149404`): 0 HealthPowerup, 1 ManaPowerup,
2 HintItem, 3 MissionObjectiveItem, 4 ConceptArt, 5 MultiplayerMap, 6 ProfileCard, 7 CheatCode,
8 Ticket, 9 Minikit, 10 BlueStud, 11 Minifig. Only the Blue Stud appears in skirmish.

## Who picks it up (confirmed from code, checked in the emulator)

`0x0205923C` runs when a unit claims a new cell. It takes the item when the unit's cell is in the
item's footprint (`0x0207ECFC`), the role filter passes, and the mode allows that unit's team.
Dispatch by type is `0x020593A0`.

In DeSmuME (mp01, King) the King walked onto the stud at (21, 31). It vanished and bricks went
500 to 1500 as soon as the King claimed the cell, before he reached its middle. The sim checks every
pickup after the move phase, units in id order (units claim cells during that phase, so the same
tick; the id order when two units arrive at once is a guess).

A loading-screen tip says "Only your Hero can collect Gold Bricks." On skirmish maps the role filter
reads 20 (any role) in RAM, so we let any unit take the stud; the tip likely means the story-mode
Gold Brick. Only the King has been seen taking one. **likely**

## What each one does (confirmed from code)

| type | handler | effect |
|---|---|---|
| Health | `0x0205ED5C` | +100 HP up to max (+0x62). Not taken if HP wouldn't change. |
| Mana | `0x0205EDA0` | +100 magic up to max (+0x64); needs unit +0x227 set (we use "has magic", **guess**). Not taken if nothing changes. |
| Blue Stud | `0x0205F018` | Adds bricks to the finder's team (cap 500000): 1000, or 150 when the win condition is "Collect 10000 LEGO Bricks". Then `0x020A6660` adds the same to the player's "Bricks Collected" stat. |

The 150 case reads `[0x02156944+0x78] == 2`. That byte holds the win condition (0 hero, 1 units,
2 bricks: verified by picking each option). In the emulator with the byte poked to 2, a stud took
the King's team from 500 to 650. **confirmed**

## Look (confirmed / likely)

The stud on the map is a spinning gold 2x2 brick, not a blue stud. Its pictures are 16x16 cells of
`Sprites/CastleItems.NCBR` (a 64x128 linear 4bpp sheet, palette `Sprites/KingFaction.NCLR`
bank 0): cell 7 and cells 8-11 (row 1 col 3, row 2). Each picture is held 3 VBlanks, so a full spin
is 15 VBlanks (counted from 64 consecutive emulator frames). The order within the spin is
**likely**, and Mars and Pirate maps may use `MarsItems` / `PiratesItems` (**guess**: only mp01
checked). The record's +0x64 byte (2 Health, 1 Mana, 7 Stud) may be the picture index; not traced.

We draw a pickup once its cell is explored (**guess**). The game's "You found a blue LEGO Stud!"
message (LANG 1019) is a story-mode text; we didn't see it in a skirmish and don't show it.
