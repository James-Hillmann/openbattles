"""Record the game's audio output to a WAV file while driving it like drive.py.

    out/venv/bin/python tools/emu/wav.py game.nds out/title.wav w600 t128,96 w900

Tokens are the same as drive.py (wN, kKEY:N, tX,Y, LNAME loads out/NAME.dst). Recording
starts after the first token that is `R` (or at the start if there is none). The file is
DeSmuME's core mixer output: 16-bit stereo, 44100 Hz. It contains game audio: keep it in out/.
"""
import sys, os
from desmume.emulator import DeSmuME
from desmume.controls import Keys, keymask

e = DeSmuME()
e.open(sys.argv[1])
wav = sys.argv[2].encode()
script = sys.argv[3:]
begin = getattr(e.lib, '_Z9WAV_BeginPKc7WAVMode')
end = getattr(e.lib, '_Z7WAV_Endv')
WAVMODE_CORE = 0

def run(n):
    for _ in range(n): e.cycle(with_joystick=False)

if 'R' not in script: begin(wav, WAVMODE_CORE)
try:
    for tok in script:
        if tok == 'R': begin(wav, WAVMODE_CORE)
        elif tok[0] == 'w': run(int(tok[1:]))
        elif tok[0] == 'k':
            k, n = tok[1:].split(':'); m = keymask(getattr(Keys, 'KEY_' + k))
            e.input.keypad_add_key(m); run(int(n)); e.input.keypad_rm_key(m); run(10)
        elif tok[0] == 't':
            x, y = map(int, tok[1:].split(',')); e.input.touch_set_pos(x, y); run(6); e.input.touch_release(); run(10)
        elif tok[0] == 'L': e.savestate.load_file(os.path.join('out', tok[1:] + '.dst'))
        elif tok[0] == 'S': e.savestate.save_file(os.path.join('out', tok[1:] + '.dst'))
finally:
    end()  # writes the WAV sizes; without it the header says 0 bytes
