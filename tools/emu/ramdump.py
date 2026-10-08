import sys, os
from desmume.emulator import DeSmuME
e = DeSmuME(); e.open(sys.argv[1]); e.savestate.load_file(sys.argv[2])
for _ in range(5): e.cycle(with_joystick=False)
m = e.memory.unsigned
open(sys.argv[3],'wb').write(bytes(m[0x02000000:0x02400000]))
open(sys.argv[3]+'.vram','wb').write(bytes(m[0x06000000:0x06000000+0x80000]) )
open(sys.argv[3]+'.vramsub','wb').write(bytes(m[0x06200000:0x06200000+0x20000]))
open(sys.argv[3]+'.regs','wb').write(bytes(m[0x04000000:0x04001100]))
