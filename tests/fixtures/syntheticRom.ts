/**
 * A tiny synthetic ROM: real layout, made-up contents. Lets us test the
 * NitroFS walker without any game data in the repo.
 *
 *   /data/units.bin   (custom format, no magic)
 *   /data/sprites/a.narc
 *   /readme.txt
 *   overlay 0 -> file id 0
 */
export function buildRom(): Uint8Array {
  const rom = new Uint8Array(0x1000);
  const dv = new DataView(rom.buffer);
  const str = (o: number, s: string) => [...s].forEach((c, i) => (rom[o + i] = c.charCodeAt(0)));
  str(0, 'LEGOBATTLES');
  str(0x0c, 'TEST');
  str(0x10, '01');
  // ARM9: 0x10 bytes at 0x200, loaded at 0x02000000, uncompressed.
  dv.setUint32(0x20, 0x200, true);
  dv.setUint32(0x24, 0x02000800, true);
  dv.setUint32(0x28, 0x02000000, true);
  dv.setUint32(0x2c, 0x10, true);

  // FNT at 0x300. Main table: root (dir 0), data (dir 1), sprites (dir 2).
  const fnt = 0x300;
  const sub = (o: number, entries: number[]) => rom.set(entries, fnt + o);
  const mt = (i: number, subOff: number, firstFile: number, parent: number) => {
    dv.setUint32(fnt + i * 8, subOff, true);
    dv.setUint16(fnt + i * 8 + 4, firstFile, true);
    dv.setUint16(fnt + i * 8 + 6, parent, true);
  };
  const name = (s: string) => [...s].map((c) => c.charCodeAt(0));
  mt(0, 0x18, 1, 3); // root: files start at 1 (0 is the overlay), 3 dirs total
  mt(1, 0x30, 2, 0xf000);
  mt(2, 0x48, 3, 0xf001);
  sub(0x18, [0x80 | 4, ...name('data'), 0x01, 0xf0, 10, ...name('readme.txt'), 0]);
  sub(0x30, [9, ...name('units.bin'), 0x80 | 7, ...name('sprites'), 0x02, 0xf0, 0]);
  sub(0x48, [6, ...name('a.narc'), 0]);
  // readme is id 1 but listed after the dir in root, so ids: readme=1, units=2, a.narc=3.
  dv.setUint32(0x40, fnt, true);
  dv.setUint32(0x44, 0x60, true);

  // File contents and FAT at 0x400.
  const fat = 0x400;
  const put = (id: number, at: number, data: number[]) => {
    rom.set(data, at);
    dv.setUint32(fat + id * 8, at, true);
    dv.setUint32(fat + id * 8 + 4, at + data.length, true);
  };
  put(0, 0x500, [0xe1, 0x2f, 0xff, 0x1e]); // overlay code
  put(1, 0x520, name('hi'));
  put(2, 0x540, [0x05, 0x00, 0x10, 0x00]);
  put(3, 0x560, [...name('NARC'), 0xfe, 0xff]);
  dv.setUint32(0x48, fat, true);
  dv.setUint32(0x4c, 4 * 8, true);

  // ARM9 overlay table at 0x600: one uncompressed overlay at 0x02100000.
  const ovt = 0x600;
  dv.setUint32(ovt, 0, true);
  dv.setUint32(ovt + 4, 0x02100000, true);
  dv.setUint32(ovt + 8, 4, true);
  dv.setUint32(ovt + 24, 0, true);
  dv.setUint32(0x50, ovt, true);
  dv.setUint32(0x54, 32, true);
  return rom;
}

