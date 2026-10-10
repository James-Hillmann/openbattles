import { describe, expect, it } from 'vitest';
import { isNaval, trains } from '@lbw/sim';

// Moves bits as extract/src/entities.ts packs them: 1 open, 2 trees, 4 rough, 8 water. Layer 1 = air.
const land = { moves: 5, layer: 0 };
const ship = { moves: 8, layer: 0 };
const flyer = { moves: 15, layer: 1 };

describe('what each building trains (0x020D9754)', () => {
  it('Castle: hero and Builder; Barracks: melee, ranged, mounted', () => {
    expect([0, 1, 2].map((role) => trains(7, { role, ...land }))).toEqual([true, true, false]);
    expect([1, 2, 3, 4, 5].map((role) => trains(11, { role, ...land }))).toEqual([false, true, true, true, false]);
  });

  it('Stables: specials and transports that are not ships', () => {
    expect(trains(12, { role: 6, ...land })).toBe(true); // Catapult, Ballista
    expect(trains(12, { role: 6, ...flyer })).toBe(true); // Gryphon, Dragon
    expect(trains(12, { role: 5, ...flyer })).toBe(true); // Earth and Aliens fly their transport
    expect(trains(12, { role: 6, ...ship })).toBe(false); // the Pirates' and Imperials' specials
  });

  it('Shipyard: specials and transports that move only on water', () => {
    expect(trains(16, { role: 5, ...ship })).toBe(true);
    expect(trains(16, { role: 6, ...ship })).toBe(true);
    expect(trains(16, { role: 5, ...flyer })).toBe(false);
    expect(trains(16, { role: 6, ...land })).toBe(false);
    expect(isNaval({ moves: 9, layer: 0 })).toBe(false); // open ground too: not a ship
  });
});
