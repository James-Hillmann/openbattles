# Open questions

| question | leads | status |
|---|---|---|
| Entity record fields (HP, cost, damage, range, speed, build time) | combat fields done (combat.md); build time and +0x70 still guesses | **mostly answered** |
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
| How to draw the 3D-model units (siege, flyers, ships, Giant) | `Models/*.nsbmd` + `.nsbca` are standard Nitro 3D; need a model + joint-animation decoder and the game's camera angle | open |
| Mounted units' draw anchor (32 px frames) | the client puts the feet 5 px above the frame bottom, like 24 px units; measure a Knight in the emulator | open |
| Off-by-one start tiles in `Animations.abp` sets 2 and 4 | see formats.md "Animations" | open |
| Entity record size: fixed 0x7C (units.ts) or per kind 0x7C/0x74/0x70 (entities.ts)? | both parsers pass their tests and agree on the sprite units; reconcile into one parser | open |
| Relay hosting | Fly.io / Railway / home box; decide in M3 | open |
| Minimap: other teams' dot colors, maps wider than 64 cells (minimap file is 128 px) | see hud.md | open |
| What the HUD's red-star counter ("0/0") counts | changes icon when a unit is selected | open |
| Unit +0x1D4: other reason a unit shows its bars | set it in RAM and the builder's bar appears | open |
| Fog of war: visibility grid, reveal radius, does it re-fog | `User::FogCircle`; BG2 + `FoWTileset.NCGR`; see skirmish.md | open |
| Hero defeat in the emulator | heroes regenerate; needs a real fight to watch `Rules_onUnitDestroyed` | open |
| Building footprints | not in record +0x10..+0x13 (0xFF); `0x02001170` returns w/h per entity | open |
| What pickups (`CollectableItem`, blueprint 8) give | 10 per skirmish map from EVNT | open |
| Fog: main-view texture and edge tiles, minimap fog, which units set the circle widen flags, whether enemies are hidden outside vision | see fog.md | open |
