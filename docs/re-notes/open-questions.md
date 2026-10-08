# Open questions

| question | leads | status |
|---|---|---|
| Entity record fields (HP, cost, damage, range, speed, build time) | `Bp_buildEntities` and the kind-specific constructors it calls; compare candidate u16s with in-game values | open (M1/M4) |
| How entity records reference the name/sprite string table | look for offsets into the tail of `Entities.ebp` | open |
| What `Factions.fbp` holds per entry | names like `KCM01_User` / `KCM01_Enemy` suggest per-mission starting forces | open |
| Map sections `EVNT`, `TRIG`, `MARK`, `MINE` | diff a few skirmish maps; start positions and resource spots are likely in `MARK`/`MINE` | open (M1) |
| Terrain codes (0/2/3/5) | compare with where units can walk in-game; needed for M2 pathing | open |
| Object layer (trees, rocks) | transparent ground cells mark them; maybe `DetailTiles_<map>.tbp` or the unknown planes after the terrain grid | open |
| Original sim tick rate | find the main loop: what it waits on per iteration (VBlank = 60 Hz) and whether logic runs every frame or every N | open |
| Does combat use randomness? | find the game RNG (often an LCG `x = x * A + C`); see who calls it from combat code | open |
| Game logic in ARM9 or overlays? | overlays are all tiny and share one address | **answered: ARM9** |
| Fixed-point format(s) used | look for `>> 12` vs `>> 16` after multiplies | open |
| Relay hosting | Fly.io / Railway / home box; decide in M3 | open |
