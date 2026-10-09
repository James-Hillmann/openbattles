# Armies: the army screen, unit pools and icons

Game: LEGO Battles (USA, `C5SE`). Watched 2026-10-08 in DeSmuME (Single Player → Free Play →
Continue, with every unlock bit set). Code: `extract/src/armies.ts`, `extract/src/armyBundle.ts`,
`client/src/armySelect.ts`. Screenshots of the real screens (not in the repo):
`/mnt/project-files/ui/ds-army-select.png`, `ds-army-slots.png`, `ds-build-train-strip.png`.

## The DS army screen

- **Top screen**: the character's card (`UI/FE/FEPlayerCards`, one 128x192 picture per character)
  with name, slot name and four stats: attack (lightning, pips), hit points (heart, number),
  cost (brick, number), speed (boot, pips). confirmed (emulator)
- **Bottom screen**: the army's nine units as heads, hero alone on top then two columns:
  builder / close combat, ranged / mounted, special 1 / special 2, special 3 / transport.
  Tapping a slot lists every character that may fill it. confirmed (emulator)
- Slot head positions on the bottom screen: hero (44,22), then (30,52), (64,52), (30,82), (64,82),
  (30,112), (64,112), (30,142), (64,142). confirmed (emulator)
- How a pick is **confirmed** is not traced: tapping a choice only shows it; the swap button,
  double-tap and dragging onto the slot did nothing in our tries. Ours puts the character in the
  slot on click.
- Which **buildings** a mixed army gets is not traced. Ours: the buildings of the army you started
  from (the coin row along the top of our screen). guess

## Factions.fbp

`Factions.fbp` (PMOC-compressed, FANZ chunk) holds 130 records of 64 bytes:

| offset | meaning | confidence |
|---|---|---|
| +0x00 u32 | offset of the name string | confirmed |
| +0x04 u8 | id | likely |
| +0x05 u8 | faction: 0x7C King, 0x7D Wizard, 0x7E Pirates, 0x7F Imperial, 0x80 Earth, 0x81 Aliens | likely |
| +0x06 u16 | flags | not decoded |
| +0x08 u32 | always 0 | confirmed (all 130) |
| +0x0C 26 × u16 | entity index per slot: 0-8 army units, 9-18 buildings | confirmed |

Unit slots: hero, builder, close combat, ranged, mounted, special 1, special 2, special 3,
transport. Building slots: base, lumber mill, mine, farm, barracks, special factory, shipyard,
tower 1-3. confirmed (King, Wizard and Pirates match what they build and train in game)

Records named King, Wizard, Pirates, Imperial, Earth, Aliens are the six playable armies; Trolls,
Dwarves, Islanders, Ninjas, SpacePolice and SpaceCriminals are the story's bonus armies.

## Choice pools

What each slot may hold is the `Minifig_*` unlockables (unlocks.md) in bit order, sorted into
slots by the unit's role; bonus specials go in Special 2. Counts: hero 25, builder 6,
close combat 8, ranged 10, mounted 6, special 1/2/3 6/12/6, transport 6. confirmed (the emulator's
lists are one shorter because they leave out the current pick; the hero order matches)

## Icon table

ARM9 `C5SE` 0x0214E400: 166 u32 entity indices. Entry *n* is drawn by icon cell *n* of
`UI/MiniHeads` (menus) and `UI/MiniHeadsGame` (in game): 24x24 cells, 16 per row. confirmed
(found by searching ARM9 for the King's entity indices in order; every head on the army screen matches)

- Heads use palette bank 5 of `UI/WorldViewTop_Back.NCLR`. likely (colours match the emulator)
- The red strip icons of hero, builder, close combat, ranged and mounted are cell + 104 for the
  King (confirmed: 104 crown, 105 hammer), Wizard and Pirates (likely), with bank 7. For Imperial,
  Earth and Aliens we show their heads. guess: their strip icons weren't found at +104.

## Stat pips

The pip counts aren't stored anywhere we found. These formulas reproduce all nine King units:

- attack = ceil(average damage ÷ cooldown × 30 ÷ 20), 1 to 5. guess
- speed = floor(speed ÷ 157), 1 to 5 (any divisor 154-159 fits). guess

## Build Costs (top screen while the strip is open)

A dark panel (40,32,48) at x 136-239, y 40-167 replaces the minimap; title "Build Costs"
(text id 99) in the name box. Icons at (144 + 32·col, 40 + 32·row), three columns; the price under
each in the HUD digit font, snapped to the 8 px grid: x = floor((x + 12 − len·4) ÷ 8)·8, y + 24.
confirmed (emulator, Builder and Castle). Code: `drawCosts` in `extract/src/hud.ts`.

## Map select

Single Player → Free Play opens the map picker: the map's minimap in a blue frame, its name on a
bar underneath, arrows either side, Continue. confirmed (emulator)

- The picture is `<map>mini.NCGR` (the minimap with trees baked in, 1.5 px per cell, 96x96 for
  every skirmish map) drawn 1:1 at bottom-screen (80,15). confirmed (pixel-exact on mp01, mp02, mp03, mp23)
- Its colours depend on the map's tileset: ARM9 `C5SE` 0x0212799C holds three 16-colour palettes,
  King, Pirate, Mars, in that order. Colours 1-7 of the King one equal `LS_Maps` bank 9, which is
  how we find the table. confirmed (mp01 King, mp02 Mars, mp03 and mp23 Pirate)
- Names: mpNN is LOC string 1241 + 2·(NN − 1) ("The Pond" … "Ruthless"); the strings between are
  placeholder "Multiplayer Mission NN (Mission Description)" text. likely (mp01, mp02, mp03, mp23 seen)
- The Free Play list in our save had 23 maps: left from The Pond goes to Lost Lagoon (mp23). Whether
  mp24-mp30 are locked or multiplayer-only isn't traced; we offer all 30.
- The in-game HUD minimap (`renderMinimap`) still always uses `LS_Maps` bank 9; it probably needs the
  tileset palette too on Pirate and Mars maps. guess, not checked in game.

## Emulator recipes

- Profile → main menu: `w1200 t128,96 w300 t210,170 w120 t35,92 t35,92 t210,165 w300`.
- Single Player (88,62), Free Play (175,90) twice → map select (arrows (48,135) / (208,135)); Continue (215,165) twice → army screen.
- Unlock everything: find `FF FF 50 00 … 00 FD 03` in RAM and write 37 × 0xFF at each hit.

## Ours

- Pre-match army screen for skirmish and the online lobby: any character in any slot, everything
  unlocked. The pick travels as nine entity names (`army` in the lobby, `PROTOCOL_VERSION` 2) and
  the sim checks training and building against it (`allowed` in `sim/src/economy.ts`).
- A faction's own army is sent as no army at all, so stock games hash as before.
