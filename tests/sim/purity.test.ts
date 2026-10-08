import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Static guard for architecture rules 1 and 2. Cheap, and catches the classic
 * desync sources before they ever reach a two-browser test.
 */
const BANNED: [RegExp, string][] = [
  [/Math\.random/, 'use the seeded rng in sim state'],
  [/Date\.now|performance\.now|new Date\(/, 'sim time is world.tick'],
  [/Math\.(sin|cos|tan|asin|acos|atan2?|exp|log\w*|pow|hypot|cbrt)\b/, 'not bit-identical across engines; use fixed-point helpers'],
  [/from ['"](pixi\.js|@pixi\/|node:)/, 'sim must stay pure (no render or Node imports)'],
  [/\b(window|document|localStorage|requestAnimationFrame)\b/, 'no DOM in sim'],
  [/\bfor\s*\(\s*(const|let)\s+\w+\s+in\b/, 'for..in iterates object keys; iterate a sorted array instead'],
];

function* tsFiles(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* tsFiles(p);
    else if (p.endsWith('.ts')) yield p;
  }
}

describe('sim purity', () => {
  for (const file of tsFiles(join(__dirname, '../../sim/src'))) {
    it(file.split('/sim/')[1]!, () => {
      const lines = readFileSync(file, 'utf8').split('\n');
      const hits: string[] = [];
      lines.forEach((line, i) => {
        if (/^\s*(\/\/|\*)/.test(line)) return; // comments may mention banned things
        for (const [re, why] of BANNED) if (re.test(line)) hits.push(`${i + 1}: ${line.trim()}  <- ${why}`);
      });
      expect(hits).toEqual([]);
    });
  }
});
