"""
Load a savestate, tap the touch screen at each X,Y (bottom-screen coordinates),
then save one screenshot per VBlank for N frames.

  python tools/emu/burst.py game.nds state.dst outdir 120,68 60,150 120
"""
import sys, os
from desmume.emulator import DeSmuME
e = DeSmuME(); e.open(sys.argv[1]); e.savestate.load_file(sys.argv[2])
outdir=sys.argv[3]; os.makedirs(outdir, exist_ok=True)
def run(n):
    for _ in range(n): e.cycle(with_joystick=False)
def tap(x,y): e.input.touch_set_pos(x,y); run(4); e.input.touch_release(); run(4)
run(2)
for t in sys.argv[4:-1]:
    x,y=map(int,t.split(',')); tap(x,y); run(10)
n=int(sys.argv[-1])
for i in range(n):
    run(1); e.screenshot().save(f'{outdir}/{i:03d}.png')
