import { ascii, u16 } from './bytes';
import { decodeChars, decodePalette, type CharData } from './nitro';
import type { Rgba } from './render';
import { parseEntityRecords, unitStats, type UnitStats } from './entities';
import { buildModelSprites } from './modelSprites';

/**
 * Entity blueprints (BP/Entities.ebp, after PMOC): `BPNZ`, then 0x7C-byte records,
 * then a string table at STRINGS holding each entity's name followed by its asset path.
 * See docs/re-notes/formats.md "BPNZ".
 */
const RECORD = 0x7c;
const STRINGS = 0xfa08;

export interface EntityInfo {
  /** Record index in the table. */
  index: number;
  /** Global id (+0x06). */
  id: number;
  name: string;
  /** Asset path, e.g. `Sprites/k_mel` or `Models/K_Ballista`. Empty for walls, bridges, gates. */
  asset: string;
  /** +0x0C: move speed in 1/4096 cell per tick, 0xFFFF for buildings. */
  speed: number;
}

export function parseEntities(ebp: Uint8Array): EntityInfo[] {
  if (ascii(ebp, 0, 4) !== 'BPNZ') throw new Error('Not an entity table (BPNZ)');
  const out: EntityInfo[] = [];
  for (let index = 0; 4 + (index + 1) * RECORD <= STRINGS; index++) {
    const r = 4 + index * RECORD;
    // Only record 0 has its name at offset 0; past the last entity the offsets read 0 again.
    if (index > 0 && u16(ebp, r) === 0) break;
    const nameAt = STRINGS + u16(ebp, r);
    if (nameAt >= ebp.length) break;
    const name = ascii(ebp, nameAt, 64);
    if (!name) break;
    out.push({ index, id: u16(ebp, r + 6), name, asset: ascii(ebp, nameAt + name.length + 1, 64), speed: u16(ebp, r + 0x0c) });
  }
  return out;
}

/**
 * The three sprite layouts units use, by asset suffix. Everything else that moves
 * (siege, flyers, ships, the Giant) is a 3D model under Models/, pre-rendered by
 * modelSprites.ts into the same atlas shape (layout `model`).
 *
 * - `hero` (`_hrm`, `_hrf`, also campaign heroes): one file per facing, `_w0..4` walk and `_a0..4`
 *   attack, 6 frames of 24 px in a row. Idle is walk frame 0 (confirmed in the emulator).
 * - `infantry` (`_eng`, `_mel`, `_rgd`): `_0` one idle frame per facing, `_1` walk and `_2` attack
 *   sheets, 5 facing rows x 5 frames of 24 px. Walk plays the 5 frames then the idle pose
 *   (confirmed in the emulator).
 * - `mounted` (`_bld_mtd`, shared with the faction's buildings): 32 px frames from y = 96, one row
 *   per facing; cols 0-2 walk (played 0,1,2,1), 3-7 attack, idle is col 1 (from BP/Animations.abp
 *   set 5; not yet seen in the emulator).
 */
export type SpriteLayout = 'hero' | 'infantry' | 'mounted' | 'model';

export function spriteLayout(asset: string): Exclude<SpriteLayout, 'model'> | null {
  if (!asset.startsWith('Sprites/')) return null;
  if (asset.endsWith('_bld_mtd')) return 'mounted';
  if (/_(eng|mel|rgd)$/.test(asset)) return 'infantry';
  return 'hero';
}

/** Facing rows, as stored: back, back-right, right, front-right, front. Left facings mirror these. */
export const FACINGS = 5;

/**
 * One unit type's frames for one team color, packed into an atlas: row = facing,
 * column = frame. Sequences index atlas columns.
 */
export interface UnitSprite {
  key: string;
  name: string;
  speed: number;
  layout: SpriteLayout;
  /** Frame size in px. */
  frameW: number;
  frameH: number;
  /**
   * Facing rows. Sprites: 5 (back, back-right, right, front-right, front), left facings mirrored.
   * Models: `rows` evenly spaced turns, row 0 facing away (up), going counter-clockwise (row
   * rows/4 faces left), never mirrored.
   */
  rows: number;
  mirrored: boolean;
  /** Pixel in the frame that sits on the unit's position. */
  anchorX: number;
  anchorY: number;
  atlas: Rgba;
  idle: number;
  /** Looped while moving. The game finishes the current pass before going idle. */
  walk: number[];
  /** Played once per attack, ending on the idle pose. */
  attack: number[];
}

/** Columns copied into the atlas, in order: [sheet suffix or per-facing file pattern, x, y offset per facing]. */
interface Cell {
  /** Sheet path; `{f}` is replaced by the facing index. */
  sheet: string;
  x: number;
  /** y of facing 0; facing f is at y + f * rowStep. */
  y: number;
  rowStep: number;
}

function cells(asset: string, layout: Exclude<SpriteLayout, 'model'>): { frame: number; cols: Cell[]; idle: number; walk: number[]; attack: number[] } {
  const p = asset; // e.g. Sprites/k_mel
  switch (layout) {
    case 'hero': {
      // walk 0..5 then attack 0..5; idle = walk 0.
      const cols = [
        ...[0, 1, 2, 3, 4, 5].map((i) => ({ sheet: `${p}_w{f}`, x: i * 24, y: 0, rowStep: 0 })),
        ...[0, 1, 2, 3, 4, 5].map((i) => ({ sheet: `${p}_a{f}`, x: i * 24, y: 0, rowStep: 0 })),
      ];
      return { frame: 24, cols, idle: 0, walk: [0, 1, 2, 3, 4, 5], attack: [6, 7, 8, 9, 10, 11, 0] };
    }
    case 'infantry': {
      const cols = [
        { sheet: `${p}_0`, x: 0, y: 0, rowStep: -1 }, // idle: one frame per facing along x
        ...[0, 1, 2, 3, 4].map((i) => ({ sheet: `${p}_1`, x: i * 24, y: 0, rowStep: 24 })),
        ...[0, 1, 2, 3, 4].map((i) => ({ sheet: `${p}_2`, x: i * 24, y: 0, rowStep: 24 })),
      ];
      return { frame: 24, cols, idle: 0, walk: [1, 2, 3, 4, 5, 0], attack: [6, 7, 8, 9, 10, 0] };
    }
    case 'mounted': {
      const cols = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ sheet: p, x: i * 32, y: 96, rowStep: 32 }));
      return { frame: 32, cols, idle: 1, walk: [0, 1, 2, 1], attack: [3, 4, 5, 6, 7, 1] };
    }
  }
}

/**
 * Build atlases for every sprite unit in the entity table, once per team bank.
 * Keys are `<entity name>@<bank>`. `sheetFor` returns a decoded `Sprites/*.NCBR` by path.
 */
export function buildUnitSprites(
  entities: readonly EntityInfo[],
  sheetFor: (path: string) => CharData | undefined,
  palette: Uint8Array,
  banks: readonly number[],
  filter: (e: EntityInfo) => boolean = () => true,
): UnitSprite[] {
  const sheets = new Map<string, CharData | null>();
  const sheet = (path: string) => {
    if (!sheets.has(path)) sheets.set(path, sheetFor(`${path}.NCBR`) ?? null);
    return sheets.get(path)!;
  };
  const out: UnitSprite[] = [];
  for (const e of entities) {
    const layout = spriteLayout(e.asset);
    if (!layout || e.speed === 0xffff || !filter(e)) continue;
    const c = cells(e.asset, layout);
    const width = c.cols.length * c.frame;
    const height = FACINGS * c.frame;
    // Palette indices first, colored per bank below.
    const idx = new Uint8Array(width * height);
    let ok = true;
    c.cols.forEach((col, ci) => {
      for (let f = 0; f < FACINGS; f++) {
        const s = sheet(col.sheet.replace('{f}', String(f)));
        if (!s) {
          ok = false;
          return;
        }
        const sw = s.tilesWide * 8;
        // rowStep -1: facings laid out along x (the infantry idle strip).
        const sx = col.rowStep < 0 ? col.x + f * c.frame : col.x;
        const sy = col.rowStep < 0 ? col.y : col.y + f * col.rowStep;
        for (let y = 0; y < c.frame; y++) {
          for (let x = 0; x < c.frame; x++) {
            const v = s.pixels[(sy + y) * sw + sx + x];
            if (v) idx[(f * c.frame + y) * width + ci * c.frame + x] = v;
          }
        }
      }
    });
    if (!ok) continue;
    for (const bank of banks) {
      const data = new Uint8ClampedArray(width * height * 4);
      for (let i = 0; i < idx.length; i++) {
        const v = idx[i]!;
        if (!v) continue;
        const o = (bank * 16 + v) * 4;
        data.set([palette[o]!, palette[o + 1]!, palette[o + 2]!, 255], i * 4);
      }
      out.push({
        key: `${e.name}@${bank}`,
        name: e.name,
        speed: e.speed,
        layout,
        frameW: c.frame,
        frameH: c.frame,
        rows: FACINGS,
        mirrored: true,
        // Feet 5 px above the frame's bottom edge (24 px: the old 0.8 anchor; 32 px: guess).
        anchorX: c.frame / 2,
        anchorY: c.frame - 5,
        atlas: { width, height, data },
        idle: c.idle,
        walk: c.walk,
        attack: c.attack,
      });
    }
  }
  return out;
}

/** Units share one palette file; its 16-color banks are team colors (see formats.md). */
export const UNIT_PALETTE = 'KingFaction.NCLR';

/** The six playable factions, by entity name prefix. */
export const FACTIONS = [
  { prefix: 'K', name: 'King' },
  { prefix: 'W', name: 'Wizard' },
  { prefix: 'P', name: 'Pirates' },
  { prefix: 'I', name: 'Imperial' },
  { prefix: 'E', name: 'Astronauts' },
  { prefix: 'A', name: 'Aliens' },
] as const;

export interface UnitBundle {
  /** Every unit of the playable factions, sprite or pre-rendered model, for each requested team bank. */
  sprites: UnitSprite[];
  /** Movers we couldn't draw (model missing or not decodable). */
  missing: EntityInfo[];
  /** Combat and movement stats per entity name, for every sprite unit (see docs/re-notes/combat.md). */
  stats: Record<string, UnitStats>;
}

/**
 * Read the entity table and build sprite atlases for the playable factions' units.
 * `fixPalette` patches the decoded palette first (e.g. `applyTeamColors`).
 */
export function buildUnitBundle(
  file: (path: string) => Uint8Array | undefined,
  banks: readonly number[],
  fixPalette?: (pal: Uint8Array) => void,
): UnitBundle {
  const need = (p: string) => {
    const d = file(p);
    if (!d) throw new Error(`File not in ROM: ${p}`);
    return d;
  };
  const entities = parseEntities(need('BP/Entities.ebp'));
  const playable = (e: EntityInfo) => /^[KWPIEA]_/.test(e.name);
  const palette = decodePalette(need(UNIT_PALETTE));
  fixPalette?.(palette);
  const sprites = buildUnitSprites(entities, (p) => {
    const d = file(p);
    return d ? decodeChars(d) : undefined;
  }, palette, banks, playable);
  const modelUnits = entities.filter((e) => playable(e) && e.speed !== 0xffff && e.asset.startsWith('Models/'));
  sprites.push(...buildModelSprites(modelUnits, file, palette, banks));
  // Keep table order (hero first ... ships last) for the sandbox lineup.
  const order = new Map(entities.map((e) => [e.name, e.index]));
  sprites.sort((a, b) => order.get(a.name)! - order.get(b.name)!);
  const records = parseEntityRecords(need('BP/Entities.ebp'));
  const stats: Record<string, UnitStats> = {};
  for (const name of new Set(sprites.map((s) => s.name))) {
    const rec = records.find((r) => r.name === name);
    if (rec?.kind === 0) stats[name] = unitStats(records, rec);
  }
  const drawn = new Set(sprites.map((s) => s.name));
  return { sprites, stats, missing: entities.filter((e) => playable(e) && e.speed !== 0xffff && !drawn.has(e.name)) };
}
