import { describe, expect, it } from 'vitest';
import { wallDamage, wallMask } from '@lbw/extract';

describe('wall neighbour mask', () => {
  const walls = (cells: [number, number][]) => (x: number, y: number) => cells.some(([a, b]) => a === x && b === y);

  it('sets east, north, west and south bits for neighbouring walls', () => {
    // A five-piece row, as dragged in the emulator: 1, 5, 5, 5, 4.
    const row = walls([[8, 16], [9, 16], [10, 16], [11, 16], [12, 16]]);
    expect([8, 9, 10, 11, 12].map((x) => wallMask(row, x, 16, 0))).toEqual([1, 5, 5, 5, 4]);
    expect(wallMask(walls([[5, 4], [5, 6]]), 5, 5, 0)).toBe(2 | 8);
  });

  it('keeps east, north and west links from before, but not south', () => {
    const none = walls([]);
    expect(wallMask(none, 0, 0, 1 | 4)).toBe(5);
    expect(wallMask(none, 0, 0, 8)).toBe(2);
    expect(wallMask(none, 0, 0, 0)).toBe(0);
  });
});

describe('wall damage', () => {
  it('steps below 66% and below 33% HP', () => {
    expect([250, 165, 164, 83, 82, 1].map((hp) => wallDamage(hp, 250))).toEqual([0, 0, 1, 1, 2, 2]);
  });
});
