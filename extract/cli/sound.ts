/**
 * Renders sounds from your ROM to WAV files in out/sound/ for listening and for comparing
 * with the emulator (tools/emu/wav.py). Output stays in out/ (gitignored).
 *
 *   npx tsx extract/cli/sound.ts game.nds                 # every effect, plus a list
 *   npx tsx extract/cli/sound.ts game.nds SE_UI_CLICK1 STRM_KING_BATTLE_1
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OUT_RATE, unpackRom } from '../src/index';
import { loadSoundArchive } from '../src/sound';

const [romPath, ...labels] = process.argv.slice(2);
if (!romPath) throw new Error('usage: sound.ts game.nds [LABEL...]');
const rom = unpackRom(new Uint8Array(readFileSync(romPath)));
const snd = loadSoundArchive(rom);
const dir = join('out', 'sound');
mkdirSync(dir, { recursive: true });

function wav(path: string, left: Float32Array, right: Float32Array, rate: number) {
  const n = left.length;
  const b = Buffer.alloc(44 + n * 4);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 4, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22); b.writeUInt32LE(Math.round(rate), 24);
  b.writeUInt32LE(Math.round(rate) * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 4, 40);
  const q = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v * 32768)));
  for (let i = 0; i < n; i++) { b.writeInt16LE(q(left[i]!), 44 + 4 * i); b.writeInt16LE(q(right[i]!), 46 + 4 * i); }
  writeFileSync(path, b);
}

const all = labels.length ? labels : snd.labels();
const list: string[] = [];
for (const label of all) {
  const out = label.startsWith('STRM_') ? snd.music(label) : snd.effect(label);
  if (!out) { console.warn(`no sound ${label}`); continue; }
  wav(join(dir, `${label}.wav`), out.left, out.right, OUT_RATE);
  list.push(`${label}\t${(out.left.length / OUT_RATE).toFixed(3)} s`);
}
writeFileSync(join(dir, 'list.txt'), list.join('\n') + '\n');
console.log(`Wrote ${list.length} sounds to ${dir}`);
