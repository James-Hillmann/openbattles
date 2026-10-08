# Open questions

| question | leads | status |
|---|---|---|
| Sprite, map and unit-data formats | `out/inventory.md`; strings near file paths | open (M0) |
| Original sim tick rate | find the main loop: what it waits on per iteration (VBlank = 60 Hz) and whether logic runs every frame or every N | open |
| Does combat use randomness? | find the game RNG (often an LCG: `x = x * A + C`); see who calls it from combat code | open |
| Game logic in ARM9 or overlays? | where unit/combat strings are referenced from | open (M0) |
| Fixed-point format(s) used | look for `>> 12` vs `>> 16` after multiplies | open |
| Relay hosting | Fly.io / Railway / home box; decide in M3 | open |
