/**
 * M0 recon: unpack your own ROM dump into ./out (gitignored).
 *
 *   npm run m0 -- path/to/legobattles.nds [outDir]
 *
 * Writes the NitroFS files (plus PMOC-unwrapped copies under dec/), a decompressed ARM9 + overlays ready for Ghidra,
 * a format inventory, and a memory map telling you which base address to
 * load each binary at. Nothing here leaves your machine.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { hex, isPmoc, pmocDecompress, unpackRom } from '../src/index';

const [romPath, outArg] = process.argv.slice(2);
if (!romPath) {
  console.error('usage: npm run m0 -- <rom.nds> [outDir=out]');
  process.exit(1);
}
const out = resolve(outArg ?? 'out');
const write = (rel: string, data: Uint8Array | string) => {
  const p = join(out, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, data);
};

const rom = new Uint8Array(readFileSync(romPath));
const r = unpackRom(rom);
const h = r.header;

write('header.json', JSON.stringify(h, (_, v) => (typeof v === 'number' && v > 0xffff ? hex(v) : v), 2));
for (const f of r.files) {
  write(join('fs', f.path), f.data);
  // Unwrapped copy of every PMOC container, same path under dec/.
  if (isPmoc(f.data)) write(join('dec', f.path), pmocDecompress(f.data));
}
write('arm9.bin', r.arm9);
for (const ov of r.overlays) write(`overlays/overlay_${String(ov.id).padStart(4, '0')}.bin`, ov.data);
write(
  'overlays.json',
  JSON.stringify(
    r.overlays.map(({ data, ...ov }) => ({ ...ov, ramAddress: hex(ov.ramAddress), decompressedSize: data.length })),
    null,
    2,
  ),
);

const inv = [
  `# Format inventory: ${h.title} (${h.gameCode})`,
  '',
  `${r.files.length} files in NitroFS. "?" means no recognizable magic: likely a custom format.`,
  '',
  '| ext | magic | files | bytes | example |',
  '|---|---|---:|---:|---|',
  ...r.inventory.map((i) => `| ${i.ext || '(none)'} | ${i.magic} | ${i.count} | ${i.bytes} | ${i.example} |`),
  '',
];
write('inventory.md', inv.join('\n'));

const mm = [
  '# Ghidra memory map',
  '',
  'Language: ARM:LE:32:v5t (ARM946E-S is ARMv5TE). Load each file as Raw Binary.',
  '',
  '| file | base address | size | notes |',
  '|---|---|---:|---|',
  `| arm9.bin | ${hex(h.arm9.ramAddress)} | ${r.arm9.length} | main program; entry ${hex(h.arm9.entry)}${r.arm9WasCompressed ? '; was BLZ-compressed, now decompressed' : ''} |`,
  ...r.overlays.map(
    (ov) =>
      `| overlays/overlay_${String(ov.id).padStart(4, '0')}.bin | ${hex(ov.ramAddress)} | ${ov.data.length} | bss ${ov.bssSize}${ov.compressed ? ', was compressed' : ''} |`,
  ),
  '',
  'Overlays that share a base address are swapped in and out at runtime. Add each as an',
  'overlay block (File > Add To Program, check "Overlay") so they do not collide.',
  '',
];
write('ghidra-memory-map.md', mm.join('\n'));

console.log(`${h.title} [${h.gameCode}]  ARM9 @ ${hex(h.arm9.ramAddress)} (${r.arm9WasCompressed ? 'decompressed' : 'uncompressed'}), ${r.overlays.length} overlays, ${r.files.length} files`);
console.log(`Wrote ${out}. Start with inventory.md and ghidra-memory-map.md.`);
