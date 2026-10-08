# Open questions

| question | leads | status |
|---|---|---|
| Entity record fields (HP, cost, damage, range, speed, build time) | combat fields done (combat.md); build time and +0x70 still guesses | **mostly answered** |
| How entity records reference the name/sprite string table | look for offsets into the tail of `Entities.ebp` | open |
| What `Factions.fbp` holds per entry | names like `KCM01_User` / `KCM01_Enemy` suggest per-mission starting forces | open |
| Map sections `EVNT`, `TRIG`, `MARK` | `MINE` is done (mine sites). EVNT looks like starting units and buildings per player; MARK points are unknown. Watch them in the emulator | open (M2) |
| Terrain codes: which ones block walking and building | walking answered (formats.md): 0 and 2 walkable; 1, 3, 5 block. Building placement still open | walking **answered**, building open |
| How units avoid each other while walking | group orders get one cell per unit; the game's mid-walk avoidance not studied yet | open (M4) |
| Object layer (trees, rocks) | trees are metatiles baked at load (formats.md "Trees"); rocks/cliffs are plain ground tiles | **answered** |
| How chopping a tree changes its tiles | mp03 in the emulator showed a half-chopped tree as metatile 186; watch `Map_setTerrain` writes while a builder chops | open (M4) |
| Original sim tick rate | no fixed tick: the main loop aims for 30 Hz but sometimes updates 1 VBlank apart, depending on frame cost (formats.md "Movement speed and update rate") | **answered** |
| Does combat use randomness? | yes: melee adds `rand(+0x6A)`, projectiles roll `min + rand(max-min)`; RNG is SDK `MATH_Rand32` (combat.md) | **answered** |
| Auto-targeting: how idle units pick enemies, and what +0x71 is | watch an idle unit acquire a target; find who reads +0x71 | open |
| Projectile flight: homing or fixed aim point, splash (+0x6B) | trace `0x02050C5C` and `0x0206E5EC` | open |
| Game logic in ARM9 or overlays? | overlays are all tiny and share one address | **answered: ARM9** |
| Fixed-point format(s) used | 20.12 for positions (cells), damage and multipliers | **answered** |
| How to draw the 3D-model units (siege, flyers, ships, Giant) | decoded, camera fitted, clips read from ARM9 (formats.md "3D models") | **answered** |
| Mounted units' draw anchor (32 px frames) | 4 px left and 8 px up of a 24 px frame for the same position (formats.md "Where sprites sit") | **answered** |
| Where unit positions sit relative to our cell centres | the game's idle units sat on 24 x 16 px multiples while our sim parks them on cell centres; sprites are drawn 15 px below their frame top from that point (ours: 19). Needs a check against map tiles | open |
| Model selection outline: exact shape | the client draws a 1 px ring; compare pixels with a selected ballista | open |
| Off-by-one start tiles in `Animations.abp` sets 2 and 4 | see formats.md "Animations" | open |
| Entity record size: fixed 0x7C (units.ts) or per kind 0x7C/0x74/0x70 (entities.ts)? | both parsers pass their tests and agree on the sprite units; reconcile into one parser | open |
| Relay hosting | Fly.io / Railway / home box; decide in M3 | open |
| Minimap: fog-of-war reveal radius, other teams' dot colors, maps wider than 64 cells (minimap file is 128 px) | see hud.md | open |
| What the HUD's red-star counter ("0/0") counts | changes icon when a unit is selected | open |
| Unit +0x1D4: other reason a unit shows its bars | set it in RAM and the builder's bar appears | open |
