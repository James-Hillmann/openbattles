import type { Fx } from './fixed';
import type { Rng } from './rng';

export type PlayerId = number;
export type EntityId = number;

export interface Unit {
  id: EntityId;
  owner: PlayerId;
  x: Fx;
  y: Fx;
  /** Movement target, or null when idle. */
  tx: Fx | null;
  ty: Fx | null;
  /** Distance per tick. */
  speed: Fx;
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
}
