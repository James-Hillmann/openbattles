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
2. Tap Single Player twice, then the second option twice. That opens the skirmish map picker.
3. Use the arrows at (208,135) to pick a map, then tap Continue (215,165) four times.

## What's been checked this way

- Trees: the baked ground and terrain layers in RAM match `bakeTrees()` on mp01, mp02 and mp03
  (see `docs/re-notes/formats.md`, "Trees").
- The map renderer is pixel-exact against the bottom screen, apart from sprites and fog of war.
- Unit frames: King hero and builder idle, walk and timing match our sheets pixel for pixel
  (see `docs/re-notes/formats.md`, "Unit animation timing"). To repeat:

  ```sh
  npx tsx extract/cli/sheets.ts 1 k_eng_0 k_eng_1 k_eng_2    # bank 1 = selected, red
  out/venv/bin/python tools/emu/burst.py game.nds out/game.dst out/walk 120,68 60,150 120
  out/venv/bin/python tools/emu/track.py out/walk 24 'out/png1/k_eng_*.png'
  ```

  With the profile from step 1, `Continue` x3 then `Start` (215,175) on the default map gives a King
  skirmish with the builder at (120,68) and the hero at (144,100) on the bottom screen.
