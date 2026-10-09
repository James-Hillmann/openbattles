import { describe, expect, it } from 'vitest';
import { barCells, hpBand, litCells } from '../client/src/bars';
import { Selection } from '../client/src/selection';
import { ALERT_SHOW_MS, ALERT_THROTTLE_MS, BattleAlert } from '../client/src/battleAlert';

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

describe('selection cap', () => {
  const army = (n: number, role: number, from: number) =>
    Array.from({ length: n }, (_, i) => ({ id: from + i, owner: 0, x: 10 + i, y: 10, role }));

  it('a box keeps at most 9, hero then mounted then melee then ranged then builders', () => {
    const s = new Selection();
    const units = [...army(4, 1, 1), ...army(3, 3, 10), ...army(3, 2, 20), ...army(2, 4, 30), ...army(1, 0, 40)];
    s.box(units, 0, 0, 0, 100, 100, false);
    expect([...s.ids]).toEqual([40, 30, 31, 20, 21, 22, 10, 11, 12]);
  });

  it('refuses a 10th unit by click', () => {
    const s = new Selection();
    const units = army(10, 2, 1).map((u, i) => ({ ...u, x: 20 * i + 10 }));
    s.box(units, 0, 0, 0, 1000, 100, false);
    expect(s.ids.size).toBe(9);
    s.click(units, 0, units[9]!.x, units[9]!.y, true);
    expect(s.ids.has(10)).toBe(false);
  });

  it('a box over buildings only selects one building', () => {
    const s = new Selection();
    const b = (id: number) => ({ id, owner: 0, x: 50, y: 50, building: true, box: { l: 40, t: 30, r: 60, b: 50 } });
    s.box([b(1), b(2)], 0, 0, 0, 100, 100, false);
    expect([...s.ids]).toEqual([1]);
  });
});

describe('battle alert', () => {
  const u = (id: number, owner: number, hp: number, target: number | null = null) => ({ id, owner, hp, x: id * 100, y: 0, target });

  it('fires when my unit is hurt by an attacker, shows 7.5 s, refreshes at most every 2 s', () => {
    const a = new BattleAlert();
    a.observe([u(1, 0, 100), u(2, 1, 50, 1)], [u(1, 0, 90), u(2, 1, 50, 1)], 0, 1000);
    expect(a.spot).toEqual({ x: 100, y: 0 });
    expect(a.shown(1000 + ALERT_SHOW_MS - 1)).toBe(true);
    expect(a.shown(1000 + ALERT_SHOW_MS)).toBe(false);
    a.observe([u(1, 0, 90), u(3, 1, 50, 1)], [u(1, 0, 80), u(3, 1, 50, 1)], 0, 1000 + ALERT_THROTTLE_MS - 1);
    expect(a.at).toBe(1000);
  });

  it('fires when my unit hurts an enemy, not for battles between others or kills', () => {
    const a = new BattleAlert();
    a.observe([u(1, 1, 100), u(2, 2, 50, 1)], [u(1, 1, 90), u(2, 2, 50, 1)], 0, 0);
    expect(a.spot).toBeNull();
    a.observe([u(1, 1, 10), u(2, 0, 50, 1)], [u(1, 1, 0), u(2, 0, 50, 1)], 0, 0);
    expect(a.spot).toBeNull();
    a.observe([u(1, 1, 100), u(2, 0, 50, 1)], [u(1, 1, 90), u(2, 0, 50, 1)], 0, 0);
    expect(a.spot).toEqual({ x: 100, y: 0 });
  });
});
