import type { Fx } from './fixed';
import type { Rng } from './rng';
import type { TerrainGrid } from './terrain';

export type PlayerId = number;
export type EntityId = number;

export interface Unit {
  id: EntityId;
  owner: PlayerId;
  x: Fx;
  y: Fx;
  /** Final movement target, or null when idle. */
  tx: Fx | null;
  ty: Fx | null;
  /** Cells (y * width + x) to pass through, in order, before heading to (tx, ty). */
  path: number[];
  /**
   * Game speed value from Entities.ebp (+0x0C): 1/4096 of a map cell per tick.
   * Plain integer, not Fx.
   */
  speed: number;
}

export interface World {
  tick: number;
  rng: Rng;
  nextId: EntityId;
  /**
   * Always kept sorted by id. Iterate this array, never an object's keys or a
   * Set, so every client processes entities in the same order.
   */
  units: Unit[];
  /** Map walkability; null for a bare test world, where units move in straight lines. */
  grid: TerrainGrid | null;
}
