# Function map

Game code: `____` (from `out/header.json`). One row per function we've named.
Keep names in `Module_verbNoun` style so they sort into groups.

| address | name | module | purpose | confidence | notes |
|---|---|---|---|---|---|
| `0x0200____` | `Sdk_memcpy` | sdk | memcpy | guess | example row, replace |

## Modules

Use these prefixes so related functions sort together:

| prefix | area |
|---|---|
| `Sdk_` | Nitro SDK / libc helpers |
| `Fs_` | file loading, archives, decompression |
| `Unit_` | unit stats, spawning, state machine |
| `Bld_` | buildings, construction, production queues |
| `Res_` | resource gathering and economy |
| `Cbt_` | combat: targeting, damage, projectiles |
| `Path_` | pathfinding and movement |
| `Map_` | map loading and tiles |
| `Ai_` | CPU opponent |
| `Gfx_` | rendering (low priority for us) |
| `Main_` | game loop, tick, scene switching |

## Translated functions

When a function's logic gets ported to `/sim`, add a section:

### `Cbt_applyDamage` @ `0x0200____`

- **Ported to:** `sim/src/...`
- **Confidence:** likely
- **Behavior:** one paragraph in plain words.
- **Fixed-point:** which format (20.12? 16.16?), any rounding detail that matters.
- **RNG:** does it draw from the game's RNG? How many times per call? (Matters for faithfulness, not for our determinism.)
- **Open questions:** ...
