# Open questions

| question | leads | status |
|---|---|---|
| Entity record fields (HP, cost, damage, range, speed, build time) | `Bp_buildEntities` and the kind-specific constructors it calls; compare candidate u16s with in-game values | open (M1/M4) |
| How entity records reference the name/sprite string table | look for offsets into the tail of `Entities.ebp` | open |
| What `Factions.fbp` holds per entry | names like `KCM01_User` / `KCM01_Enemy` suggest per-mission starting forces | open |
| Map sections `EVNT`, `TRIG`, `MARK` | `MINE` is done (mine sites). EVNT looks like starting units and buildings per player; MARK points are unknown. Watch them in the emulator | open (M2) |
| Terrain codes: which ones block walking and building | walking answered (formats.md): 0 and 2 walkable; 1, 3, 5 block. Building placement still open | walking **answered**, building open |
| How units avoid each other while walking | group orders get one cell per unit; the game's mid-walk avoidance not studied yet | open (M4) |
| Object layer (trees, rocks) | trees are metatiles baked at load (formats.md "Trees"); rocks/cliffs are plain ground tiles | **answered** |
| How chopping a tree changes its tiles | mp03 in the emulator showed a half-chopped tree as metatile 186; watch `Map_setTerrain` writes while a builder chops | open (M4) |
| Original sim tick rate | no fixed tick: the main loop aims for 30 Hz but sometimes updates 1 VBlank apart, depending on frame cost (formats.md "Movement speed and update rate") | **answered** |
| Does combat use randomness? | find the game RNG (often an LCG `x = x * A + C`); see who calls it from combat code | open |
| Game logic in ARM9 or overlays? | overlays are all tiny and share one address | **answered: ARM9** |
| Fixed-point format(s) used | look for `>> 12` vs `>> 16` after multiplies | open |
| Relay hosting | Fly.io / Railway / home box; decide in M3 | open |
