import type { ScheduledCommand } from './commands';
import { hashWorld } from './hash';
import type { World } from './state';
import { step } from './world';

/** A recorded game: initial setup plus every command. Enough to reproduce it exactly. */
export interface InputLog {
  seed: number;
  ticks: number;
  commands: ScheduledCommand[];
}

/** Run a log to completion and return the state hash at every tick. */
export function replay(w: World, log: InputLog): number[] {
  const byTick = new Map<number, ScheduledCommand[]>();
  for (const c of log.commands) {
    const list = byTick.get(c.tick) ?? [];
    list.push(c);
    byTick.set(c.tick, list);
  }
  const hashes: number[] = [];
  while (w.tick < log.ticks) {
    step(w, byTick.get(w.tick) ?? []);
    hashes.push(hashWorld(w));
  }
  return hashes;
}
