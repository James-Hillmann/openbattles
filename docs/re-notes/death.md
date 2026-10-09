# Death effects

`DieEntityCommand` (vtable `0x02149A40`, start `0x0206A078`, update `0x0206A2F4`). Ported in
`client/src/deathFx.ts` (drawing only). Traced 2026-10-09 on C5SE, from code.

When a unit dies the command sets a timer of `0x020F2510(250)` = 250 ms at 30 ticks/s = 7 ticks,
and the update counts it down by one per tick. What plays depends on the dead thing's role:

| role | at timer | effect (`0x02029214`, particle table `0x02126AC8`) | confidence |
|---|---|---|---|
| 0-6 (units) | 7 and 5 | 23 `LegoSmallStudDestroy` at the unit | confirmed (code) |
| 7-16, 18 (buildings) | 4 and 0 (timer & 3 == 0) | 1 `DustConstruction` at a random x across the footprint width, y offset 0 | confirmed (code) |
| 7-16, 18 | 1 | 21 `LegoStudDestroy`, offset (w/2, -h/2) from the building's anchor: the footprint middle | likely (anchor not lined up in the emulator) |
| 17 | 7 | one effect per footprint cell (`0x0206A82C`) | confirmed (code), not ported (walls) |
| 19 | 7 | `0x0206A9B4` | not traced |

The particle table holds a path and a flag per id; ids 1, 2, 3, 14-24 are named, e.g.
1 DustConstruction, 20 LegoStudConstruction, 21 LegoStudDestroy, 22 HealthBoostStarBurst,
23 LegoSmallStudDestroy, 24 DragonFireBall.

The stud effects use the same four stud sprites as the construction effect (build-ui.md).
`GenericExplosionEffect` did not play for unit deaths in the emulator. In our sim units leave the
world the tick they die (the game frees them about 8 ticks later), so the sim reports them in
`World.lastDead` for the renderer.
