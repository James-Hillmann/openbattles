import { describe, expect, it } from 'vitest';
import { mapTitleId } from '@lbw/extract';

describe('map select names', () => {
  it('puts mpNN at every other LOC string from The Pond', () => {
    expect(mapTitleId('mp01')).toBe(1241);
    expect(mapTitleId('mp02')).toBe(1243);
    expect(mapTitleId('mp30')).toBe(1299);
  });
  it('has no name for story maps or out-of-range numbers', () => {
    expect(mapTitleId('ck1_1')).toBeUndefined();
    expect(mapTitleId('mp31')).toBeUndefined();
    expect(mapTitleId('mp00')).toBeUndefined();
  });
});
