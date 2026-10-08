# Function map

Game code: `C5SE` (LEGO Battles, USA). ARM9 loads at `0x02000000`, 1,379,128 bytes
decompressed. Code is a mix of ARM and Thumb.

Keep names in `Module_verbNoun` style so they sort into groups.

| address | mode | name | purpose | confidence | notes |
|---|---|---|---|---|---|
| `0x02001E70` | ARM | `Bp_loadEntities` | Loads `BP\entities.ebp` and stores a u16 resource handle at `0x0215083C` | likely | Registers `Bp_onEntitiesLoaded` as the callback |
| `0x02001EE0` | ARM | `Bp_onEntitiesLoaded` | Callback after the file is decompressed: stores the buffer pointer, then calls `Bp_buildEntities` | likely | |
| `0x02001F3C` | ARM | `Bp_buildEntities` | Walks 0x7C-byte entity records, switches on the kind byte at +8, allocates a 12-byte wrapper per record and adds it to a list | likely | Key function for M4 |
| `0x020025D4` | ARM | `Bp_loadFactions` | Same pattern as `Bp_loadEntities`, for `BP\factions.fbp` | likely | |
| `0x020EFD90` | ARM | `Res_loadAsync` | Generic resource load: takes a scope, a callback, a source-location string and line; returns a handle | guess | Called by every `Bp_load*` |
| `0x020F16B4` | ARM | `Res_pushScope` | Called before a load with the file path and a line number | guess | Paired with `0x020F178C` |
| `0x020F178C` | ARM | `Res_popScope` | Closes the scope opened by `Res_pushScope` | guess | |
| `0x0200302C` | ARM | `Fn_makeCallback` | Wraps a function pointer for `Res_loadAsync` | guess | |
| `0x0204C6E4` | ? | `Mem_alloc` | Allocation with (size, file, line) | guess | Debug-heap style signature |
| `0x020A3944` | Thumb | `Map_readSection` | Compares a 4-byte tag and dispatches to the TERR/EVNT/TRIG/MINE/MARK readers | confirmed | |
| `0x020A39E8` | Thumb | `Map_readTerr` | Reads width/height, tileset name, terrain/edges/regions planes, the tree runs and the ground layer into the map object | confirmed | Map object: +0x14 width, +0x15 height, +0x30 ground, +0x2E8 terrain, +0x2EC regions, +0x2F0 edges, +0x2F4 tree runs |
| `0x020A30C8` | Thumb | `Map_plantTrees` | Walks the tree runs; sets terrain 1 on tree cells that are terrain 0; then calls `Map_retileTrees` | confirmed | |
| `0x020A40D0` | Thumb | `Map_retileTrees` | Calls `Map_retileTree` for every terrain-1 cell | confirmed | |
| `0x020A3FC0` | Thumb | `Map_treeKey` | Builds the 18-bit 3x3 neighbourhood key | confirmed | See formats.md "Trees" |
| `0x020A41E4` | Thumb | `Map_retileTree` | Looks the key up and writes the ground metatile | confirmed | Table addresses in `extract/src/trees.ts` |
| `0x020A26B8` | Thumb | `Table_findRange` | Binary search: index of the last start key <= key | confirmed | |
| `0x020A308C` / `0x020A30A0` | Thumb | `Map_getTerrain` / `Map_setTerrain` | Read/write one terrain byte at a cell | confirmed | |
| `0x0205CBF4` | ARM | `Stats_init` | Fills a unit's stats component from its entity record: speed, damage (+0x68), multiplier 1.0, cooldown (+0x6D) | confirmed | Component at unit +0x164 |
| `0x0205CC68` | ARM | `Stats_meleeDamage` | `max(1, damage + Combat_meleeBonus(attacker, defender))` | confirmed | |
| `0x02002B18` | ARM | `Combat_meleeBonus` | Signed byte from the class matrix, by entity index | confirmed | Tables in combat.md |
| `0x02050A40` | ARM | `Unit_attackTick` | Cooldown check vs unit +0x19C, melee hit with `rand(+0x6A)` roll, HP at unit +0x1A0; ranged units branch to spawn a projectile | confirmed | Watched in the emulator |
| `0x0205E5F4` | ARM | `Unit_isMelee` | Projectile field (+0x66) == 0xFFFF | confirmed | |
| `0x0205E63C` | ARM | `Unit_inRange` | Range check with +0x6E/+0x6F, or an override range | confirmed | |
| `0x0207F640` | ARM | `Range_check` | Squared cell distance between footprints vs min^2/max^2 | confirmed | |
| `0x0206E950` | ARM | `Projectile_hit` | `min + rand(max - min)` from projectile +0x70/+0x72, times defender multiplier | confirmed | |
| `0x0206E5EC` | ARM | `Projectile_splash` | Rings 0-2 around the impact cell, skips allies, scales min/max by 1.0/0.8/0.6, calls `Projectile_hit` per cell | confirmed | |
| `0x0206E2xx` | ARM | `Projectile_update` (tail) | After moving: impact when the projectile's cell is inside the target's footprint | confirmed | |
| `0x0205571C` | ARM | `Mover_step` | Shared unit/projectile movement: step toward goal, snap when the step covers the rest | likely | |
| `0x0207EC24` | ARM | `Map_cellsInSquare` | Cells within r of a cell (Chebyshev), clipped to the map | confirmed | |
| `0x0207ECFC` | ARM | `Rect_containsCell` | Cell inside an origin + size footprint | confirmed | |
| `0x020638A8` | ARM | `Ai_pickTarget` | Picks from search results: in-range first, then priority +0x70 | confirmed | |
| `0x0205E7D4` | ARM | `Unit_setHp` | Writes HP, damage time +0x1A4, under-attack alert, damaged event 0x2C | likely | |
| `0x020F1108` | ARM | `Math_rand32` | Nitro SDK `MATH_Rand32` 64-bit LCG | confirmed | Game RNG context at `0x021552F4` +0xC |
| `0x020832EC` | ARM | `Game_get` | Returns the game object; +0x8B4 is the 30 Hz time counter | confirmed | |
| `0x020F67C4` | ARM | `Game_mainLoop` | Loop body: read ms, wait VBlank, run `Game_frame`, wait one more VBlank only if under 20 ms since the first read | likely | Source of the uneven update rate; see formats.md "Movement speed and update rate" |
| `0x020F2558` | ARM | `Os_getMilliseconds` | 64-bit hardware tick count * 64 / 33514 (bus clock in kHz) | likely | |
| `0x0210FA34` | ARM | `Os_waitVBlank` | Waits for the next VBlank interrupt | likely | |
| `0x02089E40` | ARM | `Game_frame` | One game update; called once per loop iteration | likely | Units move one step per call |
| `0x020599D4` | ARM | `Unit_setPosition` | Stores x, y (20.12 px) at unit +0xEC / +0xF0 | likely | |
| `0x02080EF4` | ARM | `Path_astar?` | References the string `AstarSearch.cpp` | guess | Pathfinding lives near here; start M4 movement work from this |
| `0x0203A8BC` | ARM | `Unit_showsBars` | Decides whether a unit gets bars this frame: units when selected (via the object at +0xF4) or when +0x1D4 > 0; buildings at HP <= 32% | likely (unit/building cases confirmed in the emulator) | |
| `0x0203AA60` | ARM | (per-unit draw loop) | Calls `Unit_drawBars` for every unit that `Unit_showsBars` accepts | likely | |
| `0x0203B698` | ARM | (team palette setup) | Picks each team's palette bank via the table at `0x02127E30`, patches colors 12-14 from `0x02127E48` | likely | Effect confirmed in VRAM |
| `0x0203BED0` | ARM | `Unit_drawBars` | Health bar (+ hero charge bar) over a unit, as untextured 3D quads | confirmed | Rules in docs/re-notes/hud.md |
| `0x0203C264` | ARM | (bar layout) | Bar width/cell count and screen position | likely | |
| `0x0203C480` | ARM | (bar polygons) | Emits the bar's quads; colors packed to BGR555 at `0x0203C640` | likely | |

## Notes

- The source-file string for asserts is empty everywhere except `AstarSearch.cpp`,
  so most functions must be found from file paths and data instead.
- All 91 overlays load at the same address (`0x0216A200`) and are tiny (256 B to 6.4 KB).
  That's one small module per mission at most, so **game logic is in ARM9**.

## Translated functions

When a function's logic gets ported to `/sim`, add a section:

### `Name` @ `0x0200____`

- **Ported to:** `sim/src/...`
- **Confidence:** likely
- **Behavior:** one paragraph in plain words.
- **Fixed-point:** which format (20.12? 16.16?), any rounding detail that matters.
- **RNG:** does it draw from the game's RNG? How many times per call?
- **Open questions:**
