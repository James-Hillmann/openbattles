import { HASH_INTERVAL_TICKS, INPUT_DELAY_TICKS } from './config';
import type { Command, ScheduledCommand } from './commands';
import type { Fx } from './fixed';
import { hashWorld } from './hash';
import type { PlayerId, World } from './state';
import { step } from './world';

/**
 * Deterministic lockstep, the same scheme the DS game uses (every player action is a
 * serialized Command object, plus SyncCheck/SyncStatus commands; see
 * docs/re-notes/multiplayer.md):
 *
 * - Each player sends exactly one input (a possibly empty command list) per tick,
 *   for tick `now + inputDelay`. Ticks before `inputDelay` carry no input.
 * - A tick runs only once every player's input for it has arrived, so every client
 *   steps the same commands on the same tick. Missing input means everyone waits.
 * - Every `hashInterval` ticks the caller sends `hashWorld()` to the relay to compare.
 *
 * Works for any number of players; the lobby is 1v1 for now.
 */
export interface LockstepOptions {
  /** Players who send input, in slot order. Others (e.g. an offline dummy opponent) never block a tick. */
  players: readonly PlayerId[];
  inputDelay?: number;
  hashInterval?: number;
}

export interface StepResult {
  /** The tick that just ran. */
  tick: number;
  /** Hash of the world after the tick (at `world.tick`) when that is a hash tick; otherwise null. */
  hash: number | null;
}

export class Lockstep {
  readonly players: readonly PlayerId[];
  readonly inputDelay: number;
  readonly hashInterval: number;
  /** tick -> one command list per entry of `players` (undefined = not arrived). Looked up by key only. */
  private readonly inputs = new Map<number, (Command[] | undefined)[]>();

  constructor(readonly world: World, opts: LockstepOptions) {
    this.players = [...opts.players];
    this.inputDelay = opts.inputDelay ?? INPUT_DELAY_TICKS;
    this.hashInterval = opts.hashInterval ?? HASH_INTERVAL_TICKS;
  }

  /** The tick a player's input sent now would be for. */
  get inputTick(): number {
    return this.world.tick + this.inputDelay;
  }

  /**
   * Record a player's input for a tick. Wire input goes through `sanitizeCommand`, so a
   * malformed command is dropped the same way on every client. Returns false (and
   * changes nothing) for an unknown player, a tick already run, or a duplicate.
   */
  addInput(player: PlayerId, tick: number, cmds: readonly unknown[]): boolean {
    const slot = this.players.indexOf(player);
    if (slot < 0 || !Number.isInteger(tick) || tick < this.world.tick || tick < this.inputDelay) return false;
    const row = this.inputs.get(tick) ?? new Array<Command[] | undefined>(this.players.length).fill(undefined);
    if (row[slot] !== undefined) return false;
    row[slot] = (Array.isArray(cmds) ? cmds : []).map(sanitizeCommand).filter((c): c is Command => c !== null);
    this.inputs.set(tick, row);
    return true;
  }

  /** Players whose input for the current tick hasn't arrived. Empty means `step()` can run. */
  waitingFor(): PlayerId[] {
    if (this.world.tick < this.inputDelay) return [];
    const row = this.inputs.get(this.world.tick);
    return this.players.filter((_, i) => row?.[i] === undefined);
  }

  canStep(): boolean {
    return this.waitingFor().length === 0;
  }

  /** Run the current tick. Throws if an input is missing: call `canStep()` first. */
  step(): StepResult {
    if (!this.canStep()) throw new Error(`tick ${this.world.tick}: waiting for players ${this.waitingFor().join(',')}`);
    const tick = this.world.tick;
    const row = this.inputs.get(tick);
    this.inputs.delete(tick);
    const cmds: ScheduledCommand[] = [];
    this.players.forEach((player, i) => {
      for (const cmd of row?.[i] ?? []) cmds.push({ tick, player, cmd });
    });
    step(this.world, cmds);
    const done = this.world.tick;
    return { tick, hash: done % this.hashInterval === 0 ? hashWorld(this.world) : null };
  }
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= -0x80000000 && v <= 0x7fffffff;
const isIds = (v: unknown): v is number[] => Array.isArray(v) && v.length <= 256 && v.every((id) => isInt(id) && id > 0);

/**
 * Rebuild a Command from untrusted wire data, keeping only known fields, or null.
 * Values must be 32-bit integers, as everything in the sim is.
 */
export function sanitizeCommand(x: unknown): Command | null {
  if (typeof x !== 'object' || x === null) return null;
  const c = x as Record<string, unknown>;
  if (c.kind === 'move' && isIds(c.unitIds) && isInt(c.x) && isInt(c.y)) return { kind: 'move', unitIds: [...c.unitIds], x: c.x as Fx, y: c.y as Fx };
  if (c.kind === 'attack' && isIds(c.unitIds) && isInt(c.target)) return { kind: 'attack', unitIds: [...c.unitIds], target: c.target };
  if (c.kind === 'harvest' && isIds(c.unitIds) && isInt(c.cx) && isInt(c.cy)) return { kind: 'harvest', unitIds: [...c.unitIds], cx: c.cx, cy: c.cy };
  if (c.kind === 'build' && isIds(c.unitIds) && isInt(c.type) && isInt(c.cx) && isInt(c.cy))
    return { kind: 'build', unitIds: [...c.unitIds], type: c.type, cx: c.cx, cy: c.cy };
  if (c.kind === 'construct' && isIds(c.unitIds) && isInt(c.site)) return { kind: 'construct', unitIds: [...c.unitIds], site: c.site };
  if (c.kind === 'train' && isInt(c.building) && isInt(c.type)) return { kind: 'train', building: c.building, type: c.type };
  if (c.kind === 'upgrade' && isInt(c.building)) return { kind: 'upgrade', building: c.building };
  if (c.kind === 'repair' && isIds(c.unitIds) && isInt(c.target)) return { kind: 'repair', unitIds: [...c.unitIds], target: c.target };
  if (c.kind === 'cast' && isInt(c.caster) && isInt(c.spell) && isInt(c.target) && isInt(c.x) && isInt(c.y))
    return { kind: 'cast', caster: c.caster, spell: c.spell, target: c.target, x: c.x as Fx, y: c.y as Fx };
  return null;
}
