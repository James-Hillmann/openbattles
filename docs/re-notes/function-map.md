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
| `0x020866C0` | ARM | `Player_addBricks` | Adds bricks, clamped to 500,000; player +0x90 | confirmed | See economy.md for the rest of the economy functions |
| `0x020866F0` | ARM | `Player_spendBricks` | Pays if the player has enough | confirmed | |
| `0x0205323C` | ARM | `HarvestAction::update` | 150-tick chop, then carry | confirmed | |
| `0x02052388` | ARM | `ConstructProgressAction` | Build progress from +0x60 | likely | |
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
| `0x020A3BB0` | Thumb | `Map_readEvnt` | EVNT section: groups of start spawns and pickups | likely | See skirmish.md |
| `0x020A5C0C` | Thumb | `Evnt_readSpawn` | 9-byte spawn record: x, y, slot, role, index, 4 unknown bytes | likely | Spot-checked on mp01 |
| `0x020A45F0` | Thumb | `Evnt_readPickup` | 8-byte pickup record, makes a `CollectableItem` | likely | |
| `0x020A2FD4` | Thumb | `Skirmish_filterSpawn` | Without prebuilt bases, keeps the first hero, builder and base per player | confirmed | Emulator, mp01 |
| `0x020A3CEC` | Thumb | `Map_setStartPoint` | Hero record sets the player's start cell (map +0x234) | likely | |
| `0x020858D4` | ARM | `Faction_entitiesWithRole` | Player's faction entities with role (+0x5C) = r1, 0x14 = all | likely | |
| `0x020753D4` | ARM | `GameRuleManager_ctor` | Registers six event listeners; +4 = win mode (0 hero, 1 units, 2 bricks) | confirmed (mode values) | Pointer at `0x02155084` |
| `0x02075750` | ARM | `Rules_onUnitDestroyed` | Mode 0: no hero left -> defeated; modes 1-2: eliminated -> defeated | likely | |
| `0x02075808` | ARM | `Rules_isEliminated` | No units and no affordable production building | likely | Thresholds 50/100/250 |
| `0x020A15B8` | Thumb | `Fog_update` | Clears the visible grid, stamps every vision circle, stamps moved circles into the explored grid | likely | Result matches RAM |
| `0x020A1694` | Thumb | `Fog_stampCircle` | Filled midpoint circle of cells, four row spans per step | confirmed | Port matches RAM cell for cell |
| `0x020A1650` | Thumb | `Fog_span` | Sets or clears one clipped row span in a BitArray2D | likely | |
| `0x020EEB04` | ARM | `BitArray2D_test` | Bit x of row y (row pointer table at +0x14) | likely | |
| `0x020EEB3C` | ARM | `BitArray2D_set` | Sets or clears bit x of row y | likely | |
| `0x02075B9C` | ARM | `Rules_onBricks` | Mode 2: >= 10000 bricks wins, others lose | confirmed | |
| `0x02075DAC` | ARM | `Rules_oneSideLeft` | All remaining players allied | likely | |
| `0x02086750` | ARM | `Team_setStatus` | Team +0x9C: 0 playing, 1 defeated, 2 won, 3 lost | likely | |
| `0x02085BFC` | ARM | `Team_hasHero` | Any entity of this team with role 0 | likely | |
| `0x02001510` | ARM | `Entity_canEnterTerrain` | Per-code flag: +0x16 open, +0x19 tree, +0x17 rough, +0x18 water; 4-5 never | likely | |
| `0x0200159C` | ARM | `Entity_layerMask` | +0x1A ground, +0x1B air, +0x1C bridges | likely | |
| `0x02004350` | ARM | `Cmd_init` | Command base constructor; r1 = command type id | likely (hooked in the emulator) | Every player and CPU order passes through it |
| `0x02004E9C` | ARM | `Cmd_create` (cases) | Command factory: allocates a command by type id | likely | 5 = SyncCheck, 6 = SyncStatus; see multiplayer.md |
| `0x020074EC` | ARM | `SyncCheckCommand_ctor` | Type id 5 | likely | |
| `0x02007514` / `0x02007534` | ARM | `SyncCheckCommand_write` / `_read` | Two u32 at +0x14, +0x18 | likely | Probably (turn, checksum) |
| `0x02007594` | ARM | `SyncStatusCommand_ctor` | Type id 6 | likely | |
| `0x020075BC` / `0x020075DC` | ARM | `SyncStatusCommand_write` / `_read` | u32 at +0x14, u8 at +0x18 | likely | |

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
| `0x02053C44` | ARM | `MoveAction_update` | Per-tick move: plotter, seeker, blocked handling, then align to the cell | likely | movement.md |
| `0x0205571C` | ARM | `Seeker_step` | Move toward target cell centre; reserve each new cell; status 0 moving, 1 new cell, 2 blocked, 3 arrived | likely | movement.md |
| `0x020559CC` | ARM | `Seeker_isAtTarget` | In target cell; with align flag also inside the 6-17 x 6-9 px window | confirmed | King replay |
| `0x02059C40` | ARM | `Unit_reserveCell` | Release old reservation, check terrain, occupy the footprint as state 2 | likely | |
| `0x0207D9E8` | ARM | `Occupancy_reserve` | Per cell/layer: free -> state 2 with the unit's handle; fails if another unit holds it | likely | |
| `0x0207DEB0` | ARM | `Occupancy_stand` | Cell state 1 (or own reservation 2 -> 1) | likely | |
| `0x0207E08C` | ARM | `Occupancy_vacate` | Own state-1 cell -> 0 | likely | |
| `0x02056994` | ARM | `SegmentedPlotter_update` | Waypoint ~5 cells toward the goal, nudged by a ring search | likely | |
| `0x02080430` | ARM | `Occupancy_ringSearch` | Rings 0..r-1 around a cell, calls a match function; axis points skip (+-r, 0) | confirmed | forest test |
| `0x020574A4` | ARM | `WaitPlotter_onBlocked` | Wait (60 ticks) only for a walking blocker not waiting on us | likely | |
| `0x02057568` | ARM | `WaitPlotter_findBlocker` | Who is in the bumped cell, and whether to wait for it | likely | |
| `0x02056DB0` | ARM | `SidestepPlotter_onBlocked` | Start or advance sidestepping | likely | |
| `0x02057104` | ARM | `SidestepPlotter_step` | Try straight / CCW 45 / CW 45 neighbour cells | likely | tables 0x021490D8.. |
| `0x02056074` | ARM | `AstarPlotter_update` | States: off, search to segment point, follow path, skipped step, failed | likely | |
| `0x02055F18` | ARM | `AstarPlotter_onBlocked` | | likely | |
| `0x02082BC4` | ARM | `Path_cellCost` | 1 free, 3 walking unit, 150 standing unit, 200 wall | likely | |
| `0x020820F4` | ARM | `Path_expand` | 8 neighbours in fixed order, no corner rule | likely | |
| `0x020826E4` | ARM | `Path_poll` | Runs the job a few rounds; fails if another unit is in the end cell | confirmed | builder case |
| `0x0205A088` | ARM | `Unit_isMoving` | Has a MoveUnitAction (action type 8) | likely | |
| `0x020F2548` | ARM | `Time_secondsToTicks` | n * 30 | likely | |
| `0x0207BBEC` | ARM | `Spell_create` | Factory: record type byte -> spell class | confirmed | spells.md |
| `0x0207B810` | ARM | `Spell_canCast` | Hero, range (cells^2), charge > cost; pays | confirmed | spells.md |
| `0x0207B56C` | ARM | `SpellPool_update` | Update every spell, delete finished ones | confirmed | spells.md |
| `0x02075FBC` | ARM | `SpellPool_scanNext` | Recompute one queued spell's area per tick | confirmed | spells.md |
| `0x0207AD54` | ARM | `Spell_scanArea` | Units within a Manhattan radius of the centre | confirmed | spells.md |
| `0x0207A9E0` | ARM | `SpellBase_update` | Caster gone or 0 ticks -> finished; else count down | confirmed | spells.md |
| `0x02078750` | ARM | `HealSpell_update` | Pulse every 7 ticks: +30 / +10 / maxHP/4 | confirmed | spells.md |
| `0x0205CCA4` | ARM | `UnitStats_rebuild` | Entity stats, upgrades, then buff signs per slot | confirmed | spells.md |
| `0x02076D64` | ARM | `DamageSpell_update` | rand(100)+1 per slot, hit if <= chance; slide chance/damage | confirmed | spells.md |
| `0x020772FC` | ARM | `EAttackSpell_update` | Growing ring, freeze enemies per new whole cell | confirmed | spells.md |
| `0x0205F104` | ARM | `Unit_regenCharge` | Living hero below max: charge + 1 | confirmed | spells.md |
| `0x020F27B8` | ARM | `FX_normalize` | 20.12 unit vector with the DS divider and sqrt rounding | confirmed | spells.md |
| `0x020F09DC` | ARM | `Cells_thickLine` | Bresenham line with side cells (Forest Spawn) | confirmed | spells.md |
| `0x02077FE0` | ARM | `ForrestSpell_endPoint` | range cells toward the tap, clamped to the map | confirmed | spells.md |
| `0x020779CC` | ARM | `ForrestSpell_update` | One 2x2 candidate a tick, 5 ticks per list cell | confirmed | spells.md |
| `0x02053F70` | ARM | `Projectile_contact` | Per-cell contact test for flying entities | confirmed | spells.md |
| `0x02079304` | ARM | `FireBall_aim` | Aim clamp (adds range past the tap: game bug) | confirmed | spells.md |
| `0x02001170` | ARM | `Footprint_shape` | Size code -> (w, h) table: squares, bridges, gates | confirmed | walls-bridges.md |
| `0x020679D0` | ARM | `Wall_lineCells` | Cells of a dragged wall line (FX_Div steps) | confirmed | walls-bridges.md |
| `0x02067C30` | ARM | `ConstructMultipleEntityCommand_update` | Builds wall pieces in order, paying each as it starts | likely | walls-bridges.md |
| `0x0205DFE0` | ARM | `Wall_neighbourMask` | E/N/W/S same-slot wall mask, kept at unit +0x224 | confirmed | walls-bridges.md |
| `0x02034B44` | ARM | `Wall_drawCell` | Swaps a cell's BG tiles for wall tiles | confirmed | walls-bridges.md |
| `0x02034D84` | ARM | `Bg_setTeamRamp` | Writes a slot's 3-colour ramp into BG palette 0x37+3s | confirmed | walls-bridges.md |
| `0x020A36E4` | THUMB | `Map_buildBridgeSites` | MARK 7/8 points -> sites, picks small/medium/large | confirmed | walls-bridges.md |
| `0x0200D8A8` | ARM | `Bridge_draw` | Swaps a finished bridge's cells for bridge metatiles | confirmed | walls-bridges.md |
| `0x020A30A0` | THUMB | `Map_setTerrain` | Writes one terrain grid cell (+0x2E8) | confirmed | walls-bridges.md |
| `0x0205878C` | ARM | `Bridge_collapse` | Footprint back to water; kills walkers on it, rescues heroes | likely | walls-bridges.md |
