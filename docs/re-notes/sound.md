# Sound: archive format and playback

Game: LEGO Battles (USA, `C5SE`). Found 2026-10-09 by parsing `Sound/sound_data.sdat` and comparing our
output with DeSmuME's audio (`tools/emu/wav.py`). When each sound plays is in
[sound-triggers.md](sound-triggers.md). Code: `extract/src/sdat.ts` (formats), `extract/src/sseq.ts` (driver),
`extract/src/sound.ts` (archive access), `client/src/audio.ts` and `client/src/gameSound.ts` (browser).

**DS background:** the DS has 16 hardware sound channels. Each plays 8-bit PCM, 16-bit PCM or IMA-ADPCM
at a rate set by a timer (one sample every `timer` ticks of 16.756991 MHz), with a 7-bit volume, a
divider and a pan. The mixer samples every channel at 33.513982 MHz / 1024 = 32728.5 Hz without
interpolation. Nintendo's sound library runs a sequencer on the ARM7 that drives the channels from
an SDAT archive; the game (ARM9) only asks for "sequence N of archive M" or "stream N".

## What the archive holds (confirmed)

`Sound/sound_data.sdat`, 62.9 MB, with full symbol names. Next to it, `Sound/sound_data.sadl` is the
sound tool's C header (`#define LABEL number`); the game doesn't read it.

| kind | count | notes |
|---|---|---|
| SEQ | 0 | no plain sequences |
| SEQARC | 217 | every sound effect; 748 slots, 694 used (list in sound-triggers.md) |
| BANK | 200 | one instrument bank per SEQARC, plus INTERFACE, COMMON, UNITS |
| WAVEARC | 8 | INTERFACE, COMMON, UNITS, STRUCTURES, COLOURFACTIONS, PROJECTILES, SPELLS, COLLECTIBLES |
| PLAYER | 2 | PLAYER_EFFECTS: 8 sequences, channels 4, 5, 10-15; PLAYER_INTERFACE: 4 sequences, channels 0-3 |
| STRMPLAYER | 2 | BGM: channels 6-7; BGM1: channels 8-9 |
| STRM | 98 | all music, 22 minutes |

The header's block table is at 0x10: SYMB offset/size, INFO, FAT, FILE (the FAT offset is at 0x20).
Formats follow the usual SDAT layout; the parts we use are described in `sdat.ts`.

### Effects are one note each

Every used sequence is exactly: program change, one note (key = the instrument's root key, 60 or 72;
velocity 127; length 0 = until the sample ends), end. Every instrument is a single PCM region
(no drum sets, key splits, PSG or noise) with ADSR 127/127/127/125 and centre pan, pointing at an
IMA-ADPCM sample that doesn't loop. So an effect is its sample at its own rate, at full volume from
the first sound frame, centred. Sequence volume is 127 except the six builders' chop (`*_BUILDER_ONSTRIKE`,
32). confirmed (whole archive scanned)

We still render through a small model of the sound driver (sound frames, tempo ticks, envelope,
volume curve, mixer) so the timing and levels come out as the hardware's.

### Music streams

All STRMs are stereo signed 8-bit PCM in a single block (no ADPCM), not looping. Their HEAD block
stores the rate at 0x1C: 22767 Hz for 97 tracks and 47605 Hz for `COMBINED_FE_THEME`; the u16 at 0x1E
is 33513982 / 64 / rate, not the usual timer. confirmed: the title music in DeSmuME matches
`COMBINED_FE_THEME` decoded at 47605 Hz (normalised cross-correlation 0.995). The left channel
plays hard left and the right hard right: the recording's left is 0.39 x our left + 0.00 x our right
(likely; the right side matched less cleanly, 0.81).

## Driver numbers (confirmed from the ROM)

Read from the ARM7 binary and ARM9 (the SDK keeps copies of some tables in both) and matched by formula,
so the code computes them instead of copying tables:

| table | where (USA) | formula |
|---|---|---|
| decibel | ARM7 `0x0238F16C` (file +0xF16C), ARM9 `0x02139928` | `round(200 * log10(x / 127))`, x = 0 -> -32768 |
| decibel square (volume, velocity, sustain) | ARM7 +0xF06C | `round(400 * log10(x / 127))`, floor -722 |
| pitch, 768 steps an octave | ARM9 `0x02139A28` | `round((2^(i/768) - 1) * 65536)` |
| attack, values 109-127 | ARM7 +0xF280 | 19 bytes; below 109 the rate is `255 - attack` (copied: no formula) |
| modulation sine | ARM7 +0xF048 | 33-entry quarter sine (copied) |
| channel volume | ARM9 `0x0213A028`, 724 bytes | 7-bit volume + divider for `10^((t - 723) / 200)`; the table's own rounding differs by up to one step, which we don't reproduce (under 1%) |

Driver timing: one sound frame every 64 * 2728 ARM7 cycles (5.21 ms); tempo 120 adds 120 a frame and
a tick runs per 240. A note starts sounding on the frame after its tick (channels start on their next
update). Whether the tempo counter starts at 0 or 240 shifts every effect by one or two frames: we
start it full. guess

## Levels (confirmed against the emulator)

- Tapping the title screen plays `SE_FE_CLICK1`. Our render matches the recording with gain 0.98 and
  correlation 0.94 after removing the music (DeSmuME's resampling to 44.1 kHz accounts for the rest).
  So the effect chain (sequence volume, velocity, envelope, centre pan = half each side) is right.
- Music plays at 0.36 of full scale in the emulator. The game sets the stream volume from the
  profile's music option, 50 in a new profile (sound-triggers.md "Volumes"); 50 on the decibel curve
  is -8.1 dB = 0.39. The last 0.8 dB is unexplained. likely
- Our sliders are those two option bytes (0..127, music 50 and effects 127 by default), through the
  same decibel curve.
- In front of both sits our own volume control (bottom right, always visible, with mute), which the DS
  doesn't have: its speaker is small, while full scale through headphones is very loud. It starts at
  40% (gain 0.16, -16 dB; the slider is squared) and is saved in the browser with the other two.

## Browser playback

- The ROM worker renders each effect once, at 32728.5 Hz with the mixer's sample-and-hold, and
  decodes a music track when it is first needed; the page caches them as AudioBuffers.
- Each player keeps its own limit: 8 effects on PLAYER_EFFECTS, 4 on PLAYER_INTERFACE. A new one
  over the limit stops the oldest with a 63 ms fade (release 125). Equal priorities everywhere, so
  oldest-first is the rule (likely, NNS behaviour). We don't model the 16-channel pool shared with
  music; music has its own channels, and the two effect players don't share channels, so this only
  matters if a sequence used more than one channel, which none does.
- Tracks hand over when one ends; the game prepares the next track halfway through, so its hand-over
  is gapless. Ours can leave a few milliseconds between tracks.

## Adaptations and gaps

- **View gate.** The game plays unit sounds only for units in a rectangle around its 256x192 view.
  Our view is the browser canvas, so we use the canvas's cells plus 2 on every side.
- **Strip icons you can't afford** play UI BACK1 in the game; disabled browser buttons get no clicks,
  so ours are silent.
- **Group buttons, clock, objectives, screen swap, pickups:** their sounds are wired in the archive but
  OpenBattles has none of those features yet.
- **Custom armies:** music uses the faction of the army's buildings. The game reads a faction byte
  (player +0x31) we haven't traced for custom armies. guess
