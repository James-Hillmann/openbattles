/**
 * Render unit sprite sheets from an unpacked ROM (`npm run m0` first) to PNGs, for
 * comparing against emulator screenshots with tools/emu/track.py.
 *
 *   npx tsx extract/cli/sheets.ts <bank> k_eng_0 k_eng_1 ...   -> out/png<bank>/<sheet>.png
 *
 * Bank 0 is red; bank 1 is red with the selection outline (selected units in the emulator).
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { decodeChars, decodePalette } from '../src/nitro';
import { renderSheet } from '../src/render';
import { UNIT_PALETTE } from '../src/units';
import { writePng } from './png';

const [bank, ...sheets] = process.argv.slice(2);
const pal = decodePalette(new Uint8Array(readFileSync(`out/fs/${UNIT_PALETTE}`)));
mkdirSync(`out/png${bank}`, { recursive: true });
for (const n of sheets) {
  const img = renderSheet(decodeChars(new Uint8Array(readFileSync(`out/dec/Sprites/${n}.NCBR`))), pal, Number(bank));
  writePng(`out/png${bank}/${n}.png`, img);
}
