import type { Fx } from './fixed';
import type { EntityId, PlayerId } from './state';

/** Everything a player can do. These are what lockstep sends over the wire. */
export type Command = { kind: 'move'; unitIds: EntityId[]; x: Fx; y: Fx };

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
