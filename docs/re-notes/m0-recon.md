# M0: Recon

Goal: unpack the ROM, know what file formats exist, have ARM9 + overlays loaded
in Ghidra with a few functions named. Everything here runs on **your machine with
your own dump**; outputs go to `out/`, which is gitignored.

## DS in 60 seconds

- Two CPUs. **ARM9** (ARM946E-S, ARMv5TE, ~67 MHz) runs the game. **ARM7** handles
  sound, touch, and wifi; ignore it.
- No FPU. Games use **fixed-point** math, usually 20.12 or 16.16. When you see
  `x * y >> 12` in Ghidra, that's a fixed-point multiply.
- Code is in two places: the **ARM9 binary** (always in RAM) and **overlays**
  (chunks loaded into RAM on demand, often one per game mode or level type).
  Overlays can share an address range, so Ghidra needs them as separate blocks.
- ARM9 and overlays are usually **BLZ-compressed** in the ROM. Our extractor
  decompresses them so Ghidra sees what's actually in RAM.
- Files live in **NitroFS**, a read-only filesystem inside the ROM.
- Code mixes **ARM** (32-bit) and **Thumb** (16-bit) instructions. If Ghidra
  decompiles garbage, it's probably in the wrong mode: select the bytes and press
  `Ctrl+R` (Set Register) to set `TMode` to 1 for Thumb, 0 for ARM, then `D`.
- LEGO Battles was developed by **Hellbent Games** (not TT's own studio), so don't
  assume TT's PC/console formats apply. Most of its data sits in a custom `PMOC`
  container (LZ11 chunks); inside are standard Nitro formats plus custom `BP/` tables.
  See [formats.md](formats.md) for what M0 found.

## 1. Unpack and inventory

```sh
npm install
npm run m0 -- ~/roms/lego-battles.nds      # writes ./out
```

You get:

| path | what |
|---|---|
| `out/header.json` | title, game code, ARM9/ARM7 load addresses, table offsets |
| `out/fs/...` | every NitroFS file, original paths |
| `out/dec/...` | PMOC files unwrapped, same paths |
| `out/arm9.bin` | ARM9, decompressed |
| `out/overlays/overlay_NNNN.bin` + `overlays.json` | overlays, decompressed, with RAM addresses |
| `out/inventory.md` | file count and bytes grouped by extension and magic |
| `out/ghidra-memory-map.md` | which base address to load each binary at |

Or drop the ROM into the web client sidebar (`npm run dev`) for the same inventory
in the browser.

**Sanity check:** the CLI prints whether ARM9 was compressed. If it fails with
a BLZ error, cross-check with `ndstool` (below): this is the first time our
decoder meets real data, so a bug here is ours until proven otherwise.

Optional cross-check tools:
- `ndstool -x rom.nds -9 arm9.bin -7 arm7.bin -y9 y9.bin -d data -y overlay`
  (ships with devkitPro). Its `arm9.bin` is still compressed; compare sizes only.
- **Tinke** (Windows) can preview many Nitro formats (NCGR/NCLR/NSCR, NARC). Handy
  for eyeballing sprites before we write decoders.

**Post back to the thread:** paste `out/inventory.md` and `out/ghidra-memory-map.md`
(they contain names and sizes only, no game data). That decides what M1 decodes first.

## 2. Ghidra setup

1. Install Ghidra 12.x (needs JDK 21).
2. New project, `File > Import File > out/arm9.bin`.
   - Format: **Raw Binary**
   - Language: **ARM:LE:32:v5t** (little endian, v5t)
   - Options: Base Address = ARM9 RAM address from `ghidra-memory-map.md` (usually `0x02000000`)
3. Don't auto-analyze yet. First go to the entry point address from the memory
   map, press `D` to disassemble, then run `Analysis > Auto Analyze`.
4. For each overlay: `File > Add To Program`, pick the `.bin`, set its base
   address, and check **Overlay** so ones sharing addresses don't collide.
   Start with the largest overlays; game logic tends to be in big ones.
5. Optional: the [NTRGhidra](https://github.com/pedro-javierf/NTRGhidra) loader
   imports a `.nds` directly and maps DS I/O registers. Nice to have, but the raw
   load above is enough and doesn't depend on a plugin matching your Ghidra version.

## 3. Find your way in

Strings are the fastest anchors. In Ghidra, `Search > For Strings`, then look for:

- File paths from `out/fs` (e.g. anything under a units or maps folder). The
  function that references a path loads that file, and its caller tells you
  what the data is for.
- Unit/building names, debug messages, asserts. Asserts often name the source file.
- Nitro SDK functions: `OS_`, `FS_`, `MI_`, `GX_` strings, or the well-known
  `memcpy`/`memset`/divide helpers (`_s32_div_f`, `_u32_div_f`). Name these first:
  every other function calls them, so decompiled code gets much more readable.

For each function you understand, add a row to [function-map.md](function-map.md).

## M0 done when

- [ ] `out/inventory.md` posted in the thread
- [ ] ARM9 + overlays load in Ghidra with sensible-looking code at the entry point
- [ ] File-loading function found and named
- [ ] 10+ rows in the function map
- [ ] First guesses for: unit data file, map file, sprite format (in [formats.md](formats.md))
