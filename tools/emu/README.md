# Emulator checks

We check our decoders against the real game running in DeSmuME, driven headless
from Python through the `py-desmume` package. The reference is your own ROM, as
everywhere else in this repo. Savestates, screenshots and RAM dumps contain game
data: keep them in `out/` (gitignored) and never commit them.

```sh
python3 -m venv out/venv && out/venv/bin/pip install py-desmume pillow
export SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy

# Drive the game: wN waits N frames, tX,Y taps the touch screen, kKEY:N holds a key,
# sNAME saves a screenshot, SNAME saves a savestate, LNAME loads one.
out/venv/bin/python tools/emu/drive.py game.nds out w1200 t128,96 w300 stitle Sboot

# Dump main RAM (0x02000000, 4 MB) plus VRAM from a savestate.
out/venv/bin/python tools/emu/ramdump.py game.nds out/boot.dst out/ram.bin
```

## Getting to a skirmish (USA ROM)

1. Tap the title screen, create a profile, then type a name and tap Ok.
2. Tap Single Player (88,62) once, then the second option (175,90) twice. That opens the skirmish map picker.
3. Use the arrows at (208,135) to pick a map, then tap Continue (215,165) four times.

On The Pond (default map) with the default CPU, the Wizard's swordsmen reach your King about
6000 frames after the match starts, which makes a handy combat test.

## Economy watches

The local player's object is at `0x0224D350` in a King skirmish; bricks are the u32 at +0x90.
`desmume.memory.register_write(0x0224D3E0, cb, 4)` logs every change, and the return address on the
stack names the caller (see `docs/re-notes/economy.md`). Selecting a unit and tapping the red tab at
(8,50) opens its build/train strip on the bottom screen; a building preview is confirmed with the
check mark that appears at the left edge. Hold the d-pad to scroll the camera (it accelerates).

## Recording audio

`tools/emu/wav.py` takes the same tokens as `drive.py` and writes DeSmuME's mixer output to a WAV
(16-bit stereo, 44.1 kHz). Compare it with our renders from `npx tsx extract/cli/sound.ts game.nds`
(`out/sound/LABEL.wav`) by cross-correlation; see `docs/re-notes/sound.md`.

```sh
out/venv/bin/python tools/emu/wav.py game.nds out/tap.wav w1500 t128,96 w200   # title tap: SE_FE_CLICK1
```

## What's been checked this way

- Trees: the baked ground and terrain layers in RAM match `bakeTrees()` on mp01, mp02 and mp03
  (see `docs/re-notes/formats.md`, "Trees").
- Combat: melee damage, random rolls and cooldowns logged with exec hooks on `0x02050B70` and
  `0x02050BC4` (`desmume.memory.register_exec`) match `sim/src/combat.ts` (see docs/re-notes/combat.md).
- The map renderer is pixel-exact against the bottom screen, apart from sprites and fog of war.
- HUD: the top screen we compose (frame, icons, counters, portrait, name, HP) matches the emulator pixel for
  pixel with the King and with the Builder selected. Tap a unit at its bottom-screen position (y - 192 in the
  256x384 screenshot) to select it.
- Bars over units: lowering a unit's HP in RAM (unit +0x1A0, see `docs/re-notes/hud.md`) through
  `emu.memory` and screenshotting is how the lit-cell rule and color bands were measured.
- Unit frames: King hero and builder idle, walk and timing match our sheets pixel for pixel
  (see `docs/re-notes/formats.md`, "Unit animation timing"). To repeat:

  ```sh
  npx tsx extract/cli/sheets.ts 1 k_eng_0 k_eng_1 k_eng_2    # bank 1 = selected, red
  out/venv/bin/python tools/emu/burst.py game.nds out/game.dst out/walk 120,68 60,150 120
  out/venv/bin/python tools/emu/track.py out/walk 24 'out/png1/k_eng_*.png'
  ```

  With the profile from step 1, `Continue` x3 then `Start` (215,175) on the default map gives a King
  skirmish with the builder at (120,68) and the hero at (144,100) on the bottom screen.
- Sound: the title music is `STRM_COMBINED_FE_THEME` at 47605 Hz, the title tap is `SE_FE_CLICK1` at our
  level (docs/re-notes/sound.md). When each sound plays was logged with exec hooks on the game's sound
  module (docs/re-notes/sound-triggers.md).
