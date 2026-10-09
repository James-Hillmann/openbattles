# Open questions

| question | leads | status |
|---|---|---|
| Entity record fields (HP, cost, damage, range, speed, build time) | combat fields done (combat.md); build time +0x60, footprint +0x1D, mine yield +0x6C in economy.md | **mostly answered** |
| How entity records reference the name/sprite string table | look for offsets into the tail of `Entities.ebp` | open |
| What `Factions.fbp` holds per entry | names like `KCM01_User` / `KCM01_Enemy` suggest per-mission starting forces | open |
| Map sections `EVNT`, `TRIG`, `MARK` | `MINE` done; `EVNT` = start spawns + pickups (skirmish.md); TRIG empty on skirmish maps; MARK points unknown | EVNT **answered**, MARK open |
| Terrain codes: which ones block walking and building | walking answered (formats.md): 0 and 2 walkable; 1, 3, 5 block. Building placement still open | walking **answered**, building open |
| How units avoid each other while walking | one unit per cell, wait 2 s for walkers, sidestep, short A*: see movement.md | answered (likely; key cases confirmed) |
| How a group order picks each unit's goal cell | we spread units over nearby cells (our rule) | open |
| Object layer (trees, rocks) | trees are metatiles baked at load (formats.md "Trees"); rocks/cliffs are plain ground tiles | **answered** |
| How chopping a tree changes its tiles | mp03 in the emulator showed a half-chopped tree as metatile 186; watch `Map_setTerrain` writes while a builder chops | open (M4) |
| Original sim tick rate | no fixed tick: the main loop aims for 30 Hz but sometimes updates 1 VBlank apart, depending on frame cost (formats.md "Movement speed and update rate") | **answered** |
| Does combat use randomness? | yes: melee adds `rand(+0x6A)`, projectiles roll `min + rand(max-min)`; RNG is SDK `MATH_Rand32` (combat.md) | **answered** |
| Auto-targeting: how idle units pick enemies, and what +0x71 is | scan every 30 ticks within sight (+0x71), in-range first, then priority +0x70 (combat.md) | **answered** |
| Auto-targeting tie order, and which AI states move/attack orders use | trace how the search queue fills its candidate list; watch AI state at unit +0x2A0 under orders | open |
| Projectile flight: homing or fixed aim point, splash (+0x6B) | homes, hits on entering the target cell; splash 5x5 at 100/80/60% (combat.md) | **answered** |
| Game logic in ARM9 or overlays? | overlays are all tiny and share one address | **answered: ARM9** |
| Fixed-point format(s) used | 20.12 for positions (cells), damage and multipliers | **answered** |
| How to draw the 3D-model units (siege, flyers, ships, Giant) | decoded, camera fitted, clips read from ARM9 (formats.md "3D models") | **answered** |
| Mounted units' draw anchor (32 px frames) | 4 px left and 8 px up of a 24 px frame for the same position (formats.md "Where sprites sit") | **answered** |
| Where unit positions sit relative to our cell centres | the game's idle units sat on 24 x 16 px multiples while our sim parks them on cell centres; sprites are drawn 15 px below their frame top from that point (ours: 19). Needs a check against map tiles | open |
| Model selection outline: exact shape | the client draws a 1 px ring; compare pixels with a selected ballista | open |
| Off-by-one start tiles in `Animations.abp` sets 2 and 4 | see formats.md "Animations" | open |
| Entity record size: fixed 0x7C (units.ts) or per kind 0x7C/0x74/0x70 (entities.ts)? | both parsers pass their tests and agree on the sprite units; reconcile into one parser | open |
| Relay hosting | Fly.io / Railway / home box; decide in M3 | open |
| Do several Builders build faster? | watch two Builders on one Farm | open |
| Mine payout seen in the emulator | find a reachable mine site on The Pond and build one with poked bricks | open (code read only) |
| Where a Builder goes after delivering a load | trace `HarvestEngineerEntityCommand` (vtable `0x02149C2C`) | open (sim guesses) |
| Building placement rules | which terrain codes allow a footprint; units in the way | open |
| Which buildings train which units, queue length | castle trains hero + builder (HUD); others not checked | open |
| Minimap: dot colors for teams 3+, maps wider than 64 cells (minimap file is 128 px), the last few tree-border pixels | see hud.md | open |
| What the HUD's red-star counter ("0/0") counts | transports + siege units, capped by finished Farms (economy.md) | **answered** (likely) |
| Unit +0x1D4: other reason a unit shows its bars | set it in RAM and the builder's bar appears | open |
| Fog of war: visibility grid, reveal radius, does it re-fog | `User::FogCircle`; BG2 + `FoWTileset.NCGR`; see skirmish.md | open |
| Hero defeat in the emulator | heroes regenerate; needs a real fight to watch `Rules_onUnitDestroyed` | open |
| Building footprints | `0x02001170` maps record +0x1D to a w x h table: 1x1, 2x2, 3x3, 2x3, 2x6, 2x9, 3x2, 6x2, 9x2, 1x4, 4x1 (economy.md) | **answered** (code) |
| What pickups (`CollectableItem`, blueprint 8) give | Blue Stud: 1000 bricks (150 in a bricks game), anyone may take it (pickups.md) | **answered** |
| Fog: main-view texture and edge tiles, minimap fog, which units set the circle widen flags, whether enemies are hidden outside vision | see fog.md | open |
| Does a Builder auto-engage enemies while chopping or building? | Builders have 5 melee damage and sight 5; the scan runs in AI states 1-4 (combat.md), but which state a harvest/construct action is in isn't traced. The sim lets combat take over the Builder (the job stalls until the fight ends). Check on mp01: a chopping Builder as the Wizard's swordsmen arrive | open |
| Start records on blocked cells (mp29 slot 0) | the sim moves the unit to the nearest free cell (skirmish.md); the map is locked on a fresh profile | open |
| Where a unit walks to board a transport | trace `0x0207F99C` (transports.md; the sim uses the nearest free cell) | open |
| A sinking transport that could put only some riders ashore | the rest seem to stay in the container; the sim kills them | open |
| The hero-respawn flag at `0x020092A8() + 0xD` for a hero in a dead container | find what sets it | open |
