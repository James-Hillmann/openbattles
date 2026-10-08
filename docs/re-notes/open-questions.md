# Open questions

| question | leads | status |
|---|---|---|
| Entity record fields (HP, cost, damage, range, speed, build time) | combat fields done (combat.md); build time and +0x70 still guesses | **mostly answered** |
| How entity records reference the name/sprite string table | look for offsets into the tail of `Entities.ebp` | open |
| What `Factions.fbp` holds per entry | names like `KCM01_User` / `KCM01_Enemy` suggest per-mission starting forces | open |
| Map sections `EVNT`, `TRIG`, `MARK` | `MINE` is done (mine sites). EVNT looks like starting units and buildings per player; MARK points are unknown. Watch them in the emulator | open (M2) |
| Terrain codes: which ones block walking and building | known: 0 open, 1 tree, 2 rough, 3 water, 5 cliff. Test passability in the emulator | open (M2) |
| Object layer (trees, rocks) | trees are metatiles baked at load (formats.md "Trees"); rocks/cliffs are plain ground tiles | **answered** |
| How chopping a tree changes its tiles | mp03 in the emulator showed a half-chopped tree as metatile 186; watch `Map_setTerrain` writes while a builder chops | open (M4) |
| Original sim tick rate | find the main loop: what it waits on per iteration (VBlank = 60 Hz) and whether logic runs every frame or every N | open |
| Does combat use randomness? | yes: melee adds `rand(+0x6A)`, projectiles roll `min + rand(max-min)`; RNG is SDK `MATH_Rand32` (combat.md) | **answered** |
| Auto-targeting: how idle units pick enemies, and what +0x71 is | watch an idle unit acquire a target; find who reads +0x71 | open |
| Projectile flight: homing or fixed aim point, splash (+0x6B) | trace `0x02050C5C` and `0x0206E5EC` | open |
| Game logic in ARM9 or overlays? | overlays are all tiny and share one address | **answered: ARM9** |
| Fixed-point format(s) used | 20.12 for positions (cells), damage and multipliers | **answered** |
| Relay hosting | Fly.io / Railway / home box; decide in M3 | open |
