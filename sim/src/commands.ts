import type { Fx } from './fixed';
import type { EntityId, PlayerId } from './state';

/** Everything a player can do. These are what lockstep sends over the wire. */
export type Command =
  | { kind: 'move'; unitIds: EntityId[]; x: Fx; y: Fx }
  | { kind: 'attack'; unitIds: EntityId[]; target: EntityId }
  /** Builders chop the tree in cell (cx, cy) and keep harvesting nearby trees. */
  | { kind: 'harvest'; unitIds: EntityId[]; cx: number; cy: number }
  /** Pay for and place a building of entity kind `type` with its top-left at (cx, cy); the builders go build it. */
  | { kind: 'build'; unitIds: EntityId[]; type: number; cx: number; cy: number }
  /** Builders go work on an existing unfinished building. */
  | { kind: 'construct'; unitIds: EntityId[]; site: EntityId }
  /** Queue a unit of entity kind `type` at a production building. */
  | { kind: 'train'; building: EntityId; type: number }
  /** A hero casts spell `spell` at unit `target` (0 for none) or at point (x, y). */
  | { kind: 'cast'; caster: EntityId; spell: number; target: EntityId; x: Fx; y: Fx }
  /** Units walk to transport `transport` and board it (game: GarrisonCommand). */
  | { kind: 'load'; unitIds: EntityId[]; transport: EntityId }
  /** Everyone aboard these transports gets off onto nearby land (game: UngarrisonCommand). */
  | { kind: 'unload'; transports: EntityId[] };

/** A command stamped with who issued it and the tick it executes on. */
export interface ScheduledCommand {
  tick: number;
  player: PlayerId;
  cmd: Command;
}

/**
 * Deterministic ordering for commands that land on the same tick:
 * by player, then by the order that player issued them (stable sort).
 */
export function orderCommands(cmds: readonly ScheduledCommand[]): ScheduledCommand[] {
  return cmds
    .map((c, i) => ({ c, i }))
    .sort((a, b) => a.c.player - b.c.player || a.i - b.i)
    .map(({ c }) => c);
}
