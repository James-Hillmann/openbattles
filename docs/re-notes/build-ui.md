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
**guess** that looks right next to the emulator but hasn't been lined up pixel for pixel. Sites under
construction: see "Construction effect" below.

## Ours

- The strip opens as soon as a Builder or a finished production building is selected (no tab tap),
  at the game's spot (DS y 32, shown at 2x): a red band from the left edge that ends after the last
  icon, unaffordable icons checkered. The prices are on the top screen's Build Costs panel (armies.md).
- Not in the game: each icon also has its price on a dark row under it, in the status-bar digit font
  (`priceLabel`), because players asked for it.
- Also not in the game: the Build Costs icons on the top screen are buttons that do what their strip
  button does (checkered when you can't afford it), since on a PC the panel looks clickable.
- Unit icons come from the ARM9 icon table (armies.md); a unit with no strip icon shows its head.
- Not in the game: building icons. The DS draws a red type icon per building slot (a castle glyph and
  so on, confirmed in the emulator), so every army's Farm looks alike. Playtesters found that hard to
  read, so ours shows each building's own selection portrait (`UI/GamePlayerCards/<name>`, the 96x96
  picture the top screen shows when it is selected) box-filtered down to 24x24, on the strip, its
  queue and the Build Costs panel (`shrink` in `extract/src/armyBundle.ts`).
- Placement: click a spot (green = `canPlace` and every footprint cell explored; a Shipyard's shore too),
  right-click or Escape cancels. No check mark. Terrain per building comes from its entity flags (economy.md).
- Right-click a tree with Builders: harvest. Right-click your unfinished building: help build it.
- Chopped trees: the client asks the ROM worker to re-bake the ground with the live terrain
  (`rebakeGround`), so felled trees disappear and their neighbours re-pick edge tiles.

## Open

- Strip icons of Imperial, Earth and Aliens units; the strip's exact end cap and stop button (atlas cells in `UI/AllInOne/UI_MainCastle`, see hud.md).
- Stables and Shipyard lists; Wall and Bridge placement; the blue order strip; hero spells.
- The game's placement rules beyond "walkable and free"; the yellow outline under a site.

## Builder at work (emulator, 2026-10-08)

- **Chopping**: the Builder stands next to the tree, faces it and loops its attack swing: six poses
  (the five attack frames of `<f>_eng_2`, then the idle pose), 4 VBlanks each, 24 VBlanks a cycle,
  for the whole chop. confirmed (frame hashes repeat exactly every 24 VBlanks). Ours does the same.
- **Carrying** a load back: the ordinary walk; no load is drawn on the unit. likely (no carry sheet exists:
  the King Builder has only `_eng_0/1/2`).
- **Building**: the site is a cloud of dust with LEGO bricks flying out, under a progress bar, not the
  building itself. The Builder isn't drawn while it works a site: it vanishes into the cloud and shows
  again when the building is done. likely (emulator: no Builder anywhere near the Farm through the whole
  build, one standing at its corner right after; a playtester of the DS game says the same). Ours hides it
  while it stands working the site. The cloud is below.

## Construction effect (dust cloud + flying studs), traced 2026-10-08

Watched on a Farm in a King skirmish (DeSmuME exec hooks on `0x0202918C` and `0x02052D9C`, and reading the
effect objects every VBlank). Scratch scripts: `out/hps.ts`, `out/pw3.py`.

**`.hps` files** (`Particles/*.hps`) are pre-baked particle animations, not emitters. confirmed (all 10 files parse exactly)

| field | meaning | confidence |
|---|---|---|
| u32 | frame count (50 for both construction files) | confirmed |
| u32 | 0x28000 here (0x32000 SmallStudDestroy, 0x50000 spells). Meaning unknown | guess: a duration or radius in fixed point |
| per frame: u32 n, then n x 16 bytes | the particles alive in that frame | confirmed |
| s16 x, s16 y | pixels from the effect's anchor; +y is down the screen | confirmed (lines up with the emulator) |
| u16 size | quad side in pixels (studs 16 = their 16x16 sprite at 1:1; dust 10 to 24) | likely |
| u16 rot | angle, 65536 = full turn (dust spins steadily; studs flip between 0 and 0x3FFF) | likely; direction not settled |
| u8 r, g, b, a | 0-31 DS colour and alpha. a = 0 on a puff's first frame (not drawn) | likely |
| u32 sprite | hash looked up in `UI/Game/UIMgrData.bin`: records of u32 hash, u16 x, y, w, h in the faction's `UI/AllInOne/<Castle/Mars/Pirate>Effects` sheet (a 256x256 4bpp linear bitmap, palette bank 0) | confirmed (hashes found there; rectangles hold the dust puff and studs) |

Sprites: dust `B610395A` = (0,0,32,32); studs (16x16 at y 48): `6E812EFD` grey x 0, `6E812EFC` blue x 16,
`6E812EFF` red x 32, `6E812EFE` green x 48, `6E812EF9` yellow x 64. Effect ids (table at `0x02126AC8`, 8 bytes each):
1 = DustConstruction, 20 = LegoStudConstruction, 21 = LegoStudDestroy, 23 = LegoSmallStudDestroy. confirmed

**Playback.** The frame number is the effect object's +0x0C. It goes up by 1 per game tick (every 2nd VBlank, now
and then 3), then the object frees itself after the last frame. One-shot, no looping. confirmed

**On a site** (`0x02052A90` → `0x02052BFC`), while percent done (unit +0x22E) is under 95:
- The box: left = building x (unit +0xEC), W = floor(picW*8/24)*24 px; top = building y (+0xF0) + footprint
  rows*16 - picH*8; H = floor(picH*8/16)*16. A Farm is 48x32. confirmed (code + logged positions)
- Anchor y = top + H*(1 - percent/100), so the cloud climbs up the picture as the work goes on. The dust follows
  it while alive; the studs keep the y they started at. confirmed
- **Three dust slots** at x = left + 0.2W, 0.5W, 0.9W (literals 0x333, 0x800, 0xE66). Each starts at a random frame
  from 10 to 14 (`rand(5)+10`). When a slot's effect gets near its end (about frame 45 of 50), a new one starts in
  that slot, so they overlap and the cloud never gaps. confirmed for positions; the threshold is likely
- **One stud effect** at x = left + 0.5W starting at frame 0, only while unit flag +0x24 bit 0x10 is set and the last
  one has finished. Seen every ~130 VBlanks (about a 30-VBlank wait after the 100-VBlank effect). likely
- Drawn as DS translucent quads that don't stack on top of each other (the same polygon ID), so the whole cloud
  shows as one see-through layer, not a white blob. likely: rendering it that way matches the emulator best
- The yellow dotted outline under the cloud and the progress bar are drawn separately. Not traced.

Check: `out/hps.ts --emu <vblank>` puts the logged effects over a frame taken before the cloud appears, using
world→screen (-134, -143) for this savestate. The cloud's outline and size line up. Mean |dRGB| in the site box
is 13.6 against 16.7 with no effect drawn; the rest is the order puffs are drawn in and the builder. Open: rotation
direction, draw order, the header word.

**The building under the cloud** (emulator, Farm, a screenshot every 150 VBlanks from placement to done): only the part
of the picture below the cloud's line shows, so the building rises out of the bottom of the cloud as the work goes on,
and it looks see-through until finished. likely (the cut follows the anchor by eye; how see-through is a guess). The
three factions' effect sheets hold the same dust and stud pictures at the same spots (compared by eye), so we use
`CastleEffects` for everyone.

**Ours** (`extract/src/effects.ts`, `client/src/siteFx.ts`): decodes both `.hps` files and the sprites, and plays the
three dust slots and the studs per site as above, drawn in software so the first puff to touch a pixel wins. The studs
fly while a Builder stands working the site (our reading of flag +0x24 bit 0x10: guess). Random start frames come from
the client, never the sim. The box's left edge is our picture's left edge (the game's building x relative to the
footprint isn't pinned down: guess).
