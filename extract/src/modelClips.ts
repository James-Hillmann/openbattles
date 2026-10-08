import { u32 } from './bytes';

/**
 * Which frames of a model's one long joint animation the game plays for each state.
 * Found by watching the animation controller in the emulator (docs/re-notes/formats.md
 * "Model animation clips"); confirmed for the King dragon (idle, move, attack) and ballista (idle, attack).
 *
 * In ARM9 (C5SE): a function maps the entity id (Entities.ebp +0x06) to a clip-set index with
 * a compare tree, and a table of pointers holds one 5-entry clip set per index. Each entry
 * is 3 bytes: first frame, end frame (exclusive), and a byte that is always 1. The game only
 * builds controllers for entries 0-2: idle, move, attack. first == end holds that one frame.
 */
const CLIP_ADDRS: Record<string, { select: number; table: number }> = {
  C5SE: { select: 0x0200ce5c, table: 0x02142864 },
};

export type Clip = readonly [start: number, end: number];

export interface ModelClips {
  idle: Clip;
  move: Clip;
  attack: Clip;
}

const COND = (c: number, a: number, b: number): boolean => {
  switch (c) {
    case 0x0: return a === b;
    case 0x1: return a !== b;
    case 0xa: return a >= b;
    case 0xb: return a < b;
    case 0xc: return a > b;
    case 0xd: return a <= b;
    case 0xe: return true;
    default: throw new Error(`Unhandled condition ${c}`);
  }
};

/**
 * Run the game's entity-id -> clip-set switch. It only uses CMP r0,#imm, conditional B,
 * a jump table (ADDGE pc, pc, r0, LSL #2), MOV r0,#imm and BX LR, so a tiny interpreter
 * of those ARM instructions is enough.
 */
export function runClipSelect(arm9: Uint8Array, ramAddress: number, fn: number, id: number): number {
  let pc = fn;
  let r0 = id;
  let cmp: [number, number] = [0, 0];
  for (let steps = 0; steps < 200; steps++) {
    const w = u32(arm9, pc - ramAddress);
    const cond = w >>> 28;
    const op = w & 0x0fffffff;
    const pass = COND(cond, cmp[0], cmp[1]);
    if ((op & 0x0ff0f000) === 0x03500000 && ((op >> 16) & 15) === 0) {
      const rot = ((op >> 8) & 15) * 2;
      const imm = ((op & 0xff) >>> rot) | ((op & 0xff) << (32 - rot));
      cmp = [r0, rot ? imm | 0 : op & 0xff];
    } else if ((op & 0x0f000000) === 0x0a000000) {
      if (pass) {
        pc = pc + 8 + (((op & 0xffffff) << 8) >> 6);
        continue;
      }
    } else if (op === 0x008ff100) {
      if (pass) {
        pc = pc + 8 + r0 * 4;
        continue;
      }
    } else if ((op & 0x0ffff000) === 0x03a00000) {
      if (pass) r0 = op & 0xff;
    } else if (op === 0x012fff1e) {
      if (pass) return r0;
    } else {
      throw new Error(`Unexpected instruction ${w.toString(16)} at ${pc.toString(16)}`);
    }
    pc += 4;
  }
  throw new Error('Clip select did not return');
}

/** The idle, move and attack frame ranges the game uses for an entity's model, or null if unknown for this ROM. */
export function modelClips(arm9: Uint8Array, ramAddress: number, gameCode: string, entityId: number): ModelClips | null {
  const at = CLIP_ADDRS[gameCode];
  if (!at) return null;
  const set = runClipSelect(arm9, ramAddress, at.select, entityId);
  const base = u32(arm9, at.table - ramAddress + set * 4) - ramAddress;
  const clip = (i: number): Clip => [arm9[base + i * 3]!, arm9[base + i * 3 + 1]!];
  return { idle: clip(0), move: clip(1), attack: clip(2) };
}
