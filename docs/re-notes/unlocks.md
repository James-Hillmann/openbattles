# Unlockables

Game code `C5SE`. Parsed by `extract/src/unlocks.ts`. **OpenBattles gates none
of this**: every faction, unit, hero and map is available from the start. This
note records what the game would gate, so nothing is missed.

## Storage (confirmed)

`User::UnlockableManager` holds four bit arrays of 289 bits each (all four
equal on a new profile; which one means unlocked vs. bought vs. seen is not
traced). Each bit belongs to one kind-2 record in `Entities.ebp`, whose u16 at
**+0x6C** is the bit index (`0x02000C6C`). All 289 bits are used once.

A new profile unlocks the 27 entity indices in the table at `0x02128528`
(read by `0x020EB464`): bits 0-15, 20, 22, 96, 98-105. **Confirmed**: these are
exactly the bits set in RAM on a fresh profile.

## What the bits are

| bits | records | count | unlocked at start |
|---|---|---|---|
| 0-29 | `Map_01`..`Map_30` (skirmish maps) | 30 | maps 1-16, 21, 23 |
| 30-95 | `ConceptArt_*` (gallery) | 66 | none |
| 96-180 | `Minifig_*`: every unit of the six factions (hero, female hero, builder, ... transport ship), plus 25 bonus characters | 85 | the King faction except the female King |
| 181-198 | `RedBrick_*` cheats (fast mining, one-hit kill, fog off, ...) | 18 | none |
| 199-288 | `Minikit*` collectibles from the story missions | 90 | none |

For minifigs, +0x60 is the entity index of the unit they unlock (e.g.
`Minifig_DwarfKing` -> `DwarfKing`). +0x68 looks like a price or requirement
(faction heroes 30, female heroes and bonus heroes 40, Santa 50, mounted/siege 5,
builders 2), **guess**. +0x6A distinguishes groups (0xFF06 maps/minifigs/art,
0xFF04 red bricks, 0xFF08 minikits), **guess**.

Bonus characters (18 from the story factions plus 7 specials): Dwarf King, Dwarf,
Dwarf Mine Defender, Troll King, Troll, Troll Battle Wheel, Islander Chief,
Islander, Islander War Canoe, Ninja King, Ninja, War Junk, Space Police Captain,
Space Police, Space Police Ship, Space Criminal Leader, Space Criminal, Space
Criminal Ship, Forest Man, Ghost, Sheriff, Conquistador, Agent Chase, Classic
Space, Santa.

## In OpenBattles

- All six factions are pickable in the client already; nothing checks unlocks.
- Red bricks are game modifiers, not characters: they stay off by default.
- The bonus characters are used through the army screen (armies.md), which offers
  every minifig in every slot it fits.
