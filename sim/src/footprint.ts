/**
 * Footprint shapes. Entities.ebp +0x1D is an index into the game's table at
 * 0x02001170 (width, height in cells), not a side length: 1-3 are squares,
 * 4-9 the bridges and 10-11 the gates. confirmed (code, and every bridge
 * measured in the emulator matches)
 */
const SHAPES: readonly (readonly [number, number])[] = [
  [1, 1], [1, 1], [2, 2], [3, 3], [2, 3], [2, 6], [2, 9], [3, 2], [6, 2], [9, 2], [1, 4], [4, 1],
];

const shape = (size: number) => SHAPES[size] ?? [size, size];

/** Footprint width in cells for a size code. */
export const fpW = (size: number): number => shape(size)[0];
/** Footprint height in cells for a size code. */
export const fpH = (size: number): number => shape(size)[1];
