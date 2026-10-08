# Open questions

| question | leads | status |
|---|---|---|
| Entity record fields (HP, cost, damage, range, speed, build time) | `Bp_buildEntities` and the kind-specific constructors it calls; compare candidate u16s with in-game values | open (M1/M4) |
| How entity records reference the name/sprite string table | look for offsets into the tail of `Entities.ebp` | open |
| What `Factions.fbp` holds per entry | names like `KCM01_User` / `KCM01_Enemy` suggest per-mission starting forces | open |
| Map sections `EVNT`, `TRIG`, `MARK` | `MINE` is done (mine sites). EVNT looks like starting units and buildings per player; MARK points are unknown. Watch them in the emulator | open (M2) |
| Terrain codes: which ones block walking and building | known: 0 open, 1 tree, 2 rough, 3 water, 5 cliff. Test passability in the emulator | open (M2) |
| Object layer (trees, rocks) | trees are metatiles baked at load (formats.md "Trees"); rocks/cliffs are plain ground tiles | **answered** |
| How chopping a tree changes its tiles | mp03 in the emulator showed a half-chopped tree as metatile 186; watch `Map_setTerrain` writes while a builder chops | open (M4) |
| Original sim tick rate | find the main loop: what it waits on per iteration (VBlank = 60 Hz) and whether logic runs every frame or every N | open |
| Does combat use randomness? | find the game RNG (often an LCG `x = x * A + C`); see who calls it from combat code | open |
| Game logic in ARM9 or overlays? | overlays are all tiny and share one address | **answered: ARM9** |
| Fixed-point format(s) used | look for `>> 12` vs `>> 16` after multiplies | open |
| How to draw the 3D-model units (siege, flyers, ships, Giant) | `Models/*.nsbmd` + `.nsbca` are standard Nitro 3D; need a model + joint-animation decoder and the game's camera angle | open |
| Mounted units' draw anchor (32 px frames) | the client puts the feet 5 px above the frame bottom, like 24 px units; measure a Knight in the emulator | open |
| Off-by-one start tiles in `Animations.abp` sets 2 and 4 | see formats.md "Animations" | open |
| Relay hosting | Fly.io / Railway / home box; decide in M3 | open |
