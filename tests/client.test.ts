import { describe, expect, it } from 'vitest';
import { barCells, hpBand, litCells } from '../client/src/bars';
import { Selection } from '../client/src/selection';

describe('unit bars', () => {
  it('has 7 cells, 22 px, over a 24 px unit', () => {
    expect(barCells(24)).toBe(7);
    expect(3 * barCells(24) + 1).toBe(22);
  });

  it('lights floor(pct * 7 / 100) cells, as measured in the emulator', () => {
    const measured: [number, number][] = [[1000, 7], [999, 6], [858, 5], [715, 4], [572, 3], [500, 3], [429, 2], [300, 2], [286, 1], [200, 1], [143, 0], [1, 0]];
    for (const [hp, lit] of measured) expect([hp, litCells(hp, 1000, 7)]).toEqual([hp, lit]);
  });

  it('switches color band at 40% and 20%', () => {
    expect([400, 399, 200, 199].map((hp) => hpBand(hp, 1000))).toEqual([0, 1, 1, 2]);
  });
});

describe('selection', () => {
  const units = [
    { id: 1, owner: 0, x: 100, y: 100 },
    { id: 2, owner: 0, x: 104, y: 110 },
    { id: 3, owner: 1, x: 200, y: 100 },
  ];

  it('picks the frontmost unit and ignores enemies', () => {
    const s = new Selection();
    s.click(units, 0, 104, 100, false);
    expect([...s.ids]).toEqual([2]);
    s.click(units, 0, 200, 95, false);
    expect([...s.ids]).toEqual([]);
  });

  it('adds with shift and box-selects own units', () => {
    const s = new Selection();
    s.click(units, 0, 100, 90, false);
    s.click(units, 0, 104, 110, true);
    expect([...s.ids].sort()).toEqual([1, 2]);
    s.box(units, 0, 0, 0, 300, 300, false);
    expect([...s.ids].sort()).toEqual([1, 2]);
  });
});
