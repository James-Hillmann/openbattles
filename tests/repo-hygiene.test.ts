import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Legal rule: no game data in the repo. Fails if a tracked file looks like a ROM or Nitro asset. */
const NITRO_MAGICS = ['NARC', 'RGCN', 'RLCN', 'RCSN', 'RNAN', 'RECN', 'SDAT', 'BMD0', 'BTX0', 'BCA0', 'SSAR', 'SSEQ', 'SBNK', 'SWAR', 'SWAV', 'STRM'];

describe('repo hygiene', () => {
  it('contains no ROMs or extracted Nitro assets', () => {
    let files: string[];
    try {
      files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
        .split('\n')
        .filter(Boolean);
    } catch {
      return; // not a git checkout
    }
    const bad = files.filter((f) => {
      if (/\.(nds|srl|narc|ncgr|nclr|nscr|nanr|ncer|sdat|nsbmd|nsbtx|sseq|ssar|sbnk|swar|swav|strm|sadl|wav)$/i.test(f)) return true;
      let head: Buffer;
      try {
        head = readFileSync(f).subarray(0, 0xc0);
      } catch {
        return false;
      }
      const magic = head.subarray(0, 4).toString('latin1');
      // Real DS headers store header size 0x4000 at offset 0x84.
      const looksLikeNdsHeader = head.length >= 0x88 && head.readUInt32LE(0x84) === 0x4000;
      return NITRO_MAGICS.includes(magic) || looksLikeNdsHeader;
    });
    expect(bad).toEqual([]);
  });
});
