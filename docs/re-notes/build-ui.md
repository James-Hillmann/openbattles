# Build and train UI, buildings on the map

Game: LEGO Battles (USA, `C5SE`). Watched 2026-10-08 in DeSmuME on The Pond (mp01), King vs CPU,
with and without the Prebase option and a 2500-brick bank. Client side: `client/src/commandBar.ts`,
the strip and placement code in `client/src/main.ts`; building pictures in `extract/src/units.ts`.

## How the game does it

- Select a unit or building, then tap the **tab at the left edge** of the bottom screen (around
  (8,50); the tabs are two blue and two red, stacked from y 16). A **row of 24x24 red icons** opens
  across the bottom screen at y 32 (x from about 10, 24 px apart), one per thing the selection
  can make or do. A stop-sign button sits at the bottom-left corner. confirmed (emulator)
- The **top screen** swaps the minimap panel for a cost list while the strip is open: the title
  says "Build Costs" (Builder, Castle, Barracks) or "Magic Costs" (hero), icons in a 3-column grid with
  the price under each. confirmed (emulator). Layout file is probably `UI/WorldViewTop_Build.NSCR`: likely.
- A blue tab opens a second strip of order icons (for the Builder: what look like
  rally/guard/patrol/attack/stop). Not traced yet.
- Placing a building: pick its icon, a footprint preview follows the stylus, and a check mark at
  the left edge confirms (tools/emu/README.md). confirmed (economy thread)

| selection | strip, in order | confidence |
|---|---|---|
| Builder (King) | Castle 1000, Farm 75, Lumber Mill 400, Mine 600, Barracks 200, Stables (star icon) 350, Shipyard 350, Tower 300, Wall 10, Bridge 10 | confirmed (emulator) |
| Castle | hero 500 (one icon while the King is alive), Builder 50 | confirmed (emulator) |
| Barracks | Swordsman 100, Archer 150, Knight 250 | confirmed (emulator) |
| Stables | the star (siege/flying) units | guess: from the star icon and the star cap; not opened yet |
| Shipyard | Transport Ship | guess |
| King (hero) | four spells: 100, 100, 400, 600 | confirmed (emulator); spells not built |

So the Barracks also trains the mounted unit, and the "Stables" building is the one with the star
icon. The sim enforces this table (`TRAINS` in `sim/src/economy.ts`). One hero at a time is a
**guess** (the Castle offered the hero icon with the King alive, at 500, but we didn't try buying it).

## Building pictures

Buildings are drawn from the top of their faction's `Sprites/<f>_bld_mtd` sheet (the same sheet as
the mounted unit's frames from y 96). Each building's entity record says where:

| field | meaning | confidence |
|---|---|---|
| +0x1D | footprint shape (see economy.md) | confirmed |
| +0x1E / +0x1F | picture width / height in 8 px tiles (Castle 7x7, Barracks 6x6, Farm 6x5, Tower 5x7) | likely: every King building matches the sheet |
| +0x20 (u16) | first tile of the picture, row-major in a 32-tile-wide sheet (Castle 0, Tower 7, Farm 12, Mine 18, Barracks 26, Tower2 175, Tower3 180, Shipyard 224, Stables 232, Lumber Mill 250) | likely (same check) |

Units have the same fields (Builder: 3x3 tiles at tile 0 of its own sheet).

Our placement of the picture on its footprint (bottom centre on the footprint's bottom centre) is a
**guess** that looks right next to the emulator but hasn't been lined up pixel for pixel. How the game
draws a site under construction is **not traced**: we draw the finished picture see-through until done.

## Ours

- The strip opens as soon as a Builder or a finished production building is selected (no tab tap),
  at the game's spot (DS y 32, shown at 2x): a red band from the left edge that ends after the last
  icon, unaffordable icons checkered. The prices are on the top screen's Build Costs panel (armies.md).
- Icons come from the ARM9 icon table (armies.md); a unit with no strip icon shows its head.
- Placement: click a spot (green = `canPlace`), right-click or Escape cancels. No check mark.
- Right-click a tree with Builders: harvest. Right-click your unfinished building: help build it.
- Chopped trees: the client asks the ROM worker to re-bake the ground with the live terrain
  (`rebakeGround`), so felled trees disappear and their neighbours re-pick edge tiles.

## Open

- Strip icons of Imperial, Earth and Aliens units; the strip's exact end cap and stop button (atlas cells in `UI/AllInOne/UI_MainCastle`, see hud.md).
- Stables and Shipyard lists; Wall and Bridge placement; the blue order strip; hero spells.
- Construction-site look; the game's placement rules beyond "walkable and free".

## Builder at work (emulator, 2026-10-08)

- **Chopping**: the Builder stands next to the tree, faces it and loops its attack swing: six poses
  (the five attack frames of `<f>_eng_2`, then the idle pose), 4 VBlanks each, 24 VBlanks a cycle,
  for the whole chop. confirmed (frame hashes repeat exactly every 24 VBlanks). Ours does the same.
- **Carrying** a load back: the ordinary walk; no load is drawn on the unit. likely (no carry sheet exists:
  the King Builder has only `_eng_0/1/2`).
- **Building**: the site is a cloud of dust with LEGO bricks flying out, under a progress bar, not the
  building itself. The Builder's pose inside the cloud couldn't be seen; ours plays the same swing as
  chopping (guess). The dust cloud isn't built yet (ours draws the building see-through).
