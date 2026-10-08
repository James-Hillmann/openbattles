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
| `0x02080EF4` | ARM | `Path_astar?` | References the string `AstarSearch.cpp` | guess | Pathfinding lives near here; start M4 movement work from this |

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
