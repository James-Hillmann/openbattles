import sys, os
from desmume.emulator import DeSmuME
from desmume.controls import Keys, keymask
e = DeSmuME()
e.open(sys.argv[1])
out = sys.argv[2]
script = sys.argv[3:]  # tokens: wN (wait N frames), kKEY:N (hold key N frames), tX,Y (tap), sNAME (screenshot)
def run(n):
    for _ in range(n): e.cycle(with_joystick=False)
for tok in script:
    if tok[0]=='w': run(int(tok[1:]))
    elif tok[0]=='k':
        k,n = tok[1:].split(':'); m = keymask(getattr(Keys, 'KEY_'+k))
        e.input.keypad_add_key(m); run(int(n)); e.input.keypad_rm_key(m); run(10)
    elif tok[0]=='t':
        x,y = map(int, tok[1:].split(',')); e.input.touch_set_pos(x,y); run(6); e.input.touch_release(); run(10)
    elif tok[0]=='s':
        e.screenshot().save(os.path.join(out, tok[1:]+'.png'))
    elif tok[0]=='S': e.savestate.save_file(os.path.join(out, tok[1:]+'.dst'))
    elif tok[0]=='L': e.savestate.load_file(os.path.join(out, tok[1:]+'.dst'))
