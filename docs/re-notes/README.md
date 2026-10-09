# RE notes

Findings from reverse-engineering LEGO Battles (DS). These describe **behavior in
our own words**. Short snippets (a few instructions, a struct offset) are fine
when they explain something; never paste decompiler output wholesale.

| file | what goes in it |
|---|---|
| [m0-recon.md](m0-recon.md) | Step-by-step M0 setup: unpack, inventory, Ghidra |
| [function-map.md](function-map.md) | Every function we've named: address, name, purpose, confidence |
| [formats.md](formats.md) | File formats: layout tables, what's known, what isn't |
| [movement.md](movement.md) | Walking, cell occupancy, waiting, sidestepping, the path search |
| [hud.md](hud.md) | Top-screen HUD, selection outline, bars over units |
| [skirmish.md](skirmish.md) | Skirmish options, start setup, win and loss, terrain per unit type |
| [fog.md](fog.md) | Fog of war: vision circles, visible and explored grids |
| [armies.md](armies.md) | The army screen, unit pools per slot, the icon table, Build Costs panel |
| [unlocks.md](unlocks.md) | What the game unlocks over time (we unlock everything) |
| [multiplayer.md](multiplayer.md) | DS wireless setup screens, the command lockstep netcode, and our online version |
| [walls-bridges.md](walls-bridges.md) | Walls (drag line, neighbour tiles) and bridges (map sites, sizing, terrain change) |
| [open-questions.md](open-questions.md) | Things we need to find out, with leads |

## Confidence levels

Used everywhere a claim is made:

- **confirmed**: verified by running it (emulator breakpoint, or our decoder renders it correctly)
- **likely**: clear from the code, not yet tested
- **guess**: plausible from names, strings, or context only

## Addresses

Always write addresses as the RAM address (`0x02012345`), plus `ov<N>:` for code in
an overlay (`ov3:0x021a0040`), since overlays share address ranges.
Game version matters: record the game code from `out/header.json` (e.g. `YLBE`)
next to anything version-specific.
