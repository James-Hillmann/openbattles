import { romFile, tryRomFile } from './bundle';
import { parseFont, renderText, type Font } from './font';
import { entityLabels, parseLang, type EntityLabel } from './lang';
import { decodeCells, decodeChars, decodePalette, decodeScreen, type CharData } from './nitro';
import { blitTile, renderCell, type Rgba } from './render';
import type { UnpackedRom } from './rom';
import { buildParticleFx, type ParticleFx } from './effects';

/**
 * The in-game top screen (256x192): red brick frame, name / portrait / minimap
 * panels and the status bar. See docs/re-notes/hud.md.
 */
export interface HudBundle {
  /** Empty frame, already in the player's team color. */
  frame: Rgba;
  /** Status-bar icons, 16x24 each: bricks, minifigs (animated in the game; frame 0 here), the red star. */
  icons: { bricks: Rgba; minifigs: Rgba; star: Rgba };
  /** 8x8 status-bar glyphs keyed by character ('0'-'9', '/', '-', '+'), transparent background. */
  glyphs: Record<string, Rgba>;
  /** Display names and max HP per entity, indexed like Entities.ebp. */
  labels: EntityLabel[];
  /** 96x96 portraits keyed by entity id (e.g. `K_Swordsman`), from UI/GamePlayerCards. */
  portraits: Record<string, Rgba>;
  /** Font for the unit name panel. */
  nameFont: Font;
  /** 24x24 build/train strip icons by entity name, for the entities whose icon number is known (COMMAND_ICONS). */
  commandIcons: Record<string, Rgba>;
  /** The dust cloud and flying studs over building sites (docs/re-notes/build-ui.md). */
  particles?: ParticleFx;
}

/**
 * Icon number in `UI/MiniHeadsGame.NCGR` (a grid of 24x24 cells, 16 a row) per entity, read off both
 * screens in the emulator (docs/re-notes/hud.md). confirmed for these King entities; where the game
 * keeps this mapping, and the other factions' numbers, are open.
 */
export const COMMAND_ICONS: Record<string, number> = {
  K_Castle: 9, K_LumberMill: 10, K_Mine: 11, K_Farm: 12, K_Barracks: 13, K_Stables: 14, K_Tower: 15,
  K_King: 104, K_Engineer: 105, K_Shipyard: 151,
};
/** MiniHeadsGame is drawn with WorldViewTop_Back bank 7, the same red as the strip's texture palette. confirmed */
const COMMAND_ICON_BANK = 7;

/** One 24x24 icon cell. Reads pixels directly: the sheet has 1440 tiles and blitTile keeps only 10 bits of a tile number. */
function commandIcon(chars: CharData, pal: Uint8Array, i: number): Rgba {
  const out = blank(24, 24);
  const x0 = (i % 16) * 24;
  const y0 = Math.floor(i / 16) * 24;
  for (let y = 0; y < 24; y++) {
    for (let x = 0; x < 24; x++) {
      const sx = x0 + x;
      const sy = y0 + y;
      const v = chars.pixels[((sy >> 3) * chars.tilesWide + (sx >> 3)) * 64 + (sy & 7) * 8 + (sx & 7)]!;
      if (!v) continue;
      const o = (COMMAND_ICON_BANK * 16 + v) * 4;
      out.data.set([pal[o]!, pal[o + 1]!, pal[o + 2]!, 255], (y * 24 + x) * 4);
    }
  }
  return out;
}

/** Where things sit on the top screen (confirmed against the emulator unless noted). */
export const HUD_LAYOUT = {
  portrait: { x: 24, y: 40 },
  /** HP text: tile row 16, centered under the portrait (columns 4-12 for "1000/1000"). */
  hpY: 128,
  hpCenterX: 72,
  /** Name: glyph cells top at y 16, x = (216 - text width) >> 1 (fits "King" and "Builder"). */
  nameY: 16,
  nameSpan: 216,
  /** Minimap panel, 96x96; the map image sits 1:1 at its top-left (confirmed on mp01). */
  minimap: { x: 136, y: 40, w: 96, h: 96 },
  /** Status bar: icons at y 168, numbers on the tile grid at y 176. */
  icons: { bricks: 8, minifigs: 88, star: 160, y: 168 },
  counters: { bricks: 24, minifigs: 104, star: 176, y: 176 },
} as const;

export const TOP_W = 256;
export const TOP_H = 192;

/** Palette bank the frame's NSCR uses; the game swaps it for a team ramp from UI_ExtraColors.NCLR. */
const FRAME_BANK = 6;

/** UI_ExtraColors.NCLR banks 0-6: red, blue, green, purple, gold, white, dark grey. */
export type TeamColor = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** WorldViewTop_Back.NCGR tiles for the status-bar digits (4x6 glyphs, color 1). */
const GLYPH_TILES: Record<string, number> = {
  '1': 27, '2': 28, '3': 29, '4': 30, '5': 31,
  '6': 59, '7': 60, '8': 61, '9': 62, '0': 63,
  '/': 91, '-': 92, '+': 93,
};
/** White at color 1; bank 14 is what the game's sub BG2 uses (confirmed from VRAM). */
const GLYPH_BANK = 14;

/** GameAnims.NCGR (24 tiles wide): top-left tile of each 2x3-tile icon, drawn with WorldViewTop_Back bank 14. */
const ICON_TILES = { bricks: 2, minifigs: 146, star: 74 } as const;
const ICON_BANK = 14;

const blank = (width: number, height: number): Rgba => ({ width, height, data: new Uint8ClampedArray(width * height * 4) });

function tileBlock(chars: CharData, pal: Uint8Array, first: number, w: number, h: number, bank: number): Rgba {
  const out = blank(w * 8, h * 8);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) blitTile(out, chars, pal, (first + y * chars.tilesWide + x) | (bank << 12), x * 8, y * 8);
  }
  return out;
}

function portrait(rom: UnpackedRom, id: string): Rgba | undefined {
  const base = `UI/GamePlayerCards/${id}`;
  const ncer = tryRomFile(rom, `${base}.NCER`);
  if (!ncer) return undefined;
  const cell = decodeCells(ncer)[0];
  if (!cell?.length) return undefined;
  return renderCell(cell, decodeChars(romFile(rom, `${base}.NCGR`)), decodePalette(romFile(rom, `${base}.NCLR`)));
}

export function buildHudBundle(rom: UnpackedRom, portraitIds: readonly string[], team: TeamColor = 0, language = 'American_English'): HudBundle {
  const chars = decodeChars(romFile(rom, 'UI/WorldViewTop_Back.NCGR'));
  const pal = decodePalette(romFile(rom, 'UI/WorldViewTop_Back.NCLR'));
  const teamPal = decodePalette(romFile(rom, 'UI_ExtraColors.NCLR'));
  pal.set(teamPal.subarray(team * 64, team * 64 + 64), FRAME_BANK * 64);

  const screen = decodeScreen(romFile(rom, 'UI/WorldViewTop_0.NSCR'));
  const frame = blank(TOP_W, TOP_H);
  for (let ty = 0; ty < TOP_H / 8; ty++) {
    for (let tx = 0; tx < TOP_W / 8; tx++) blitTile(frame, chars, pal, screen.entries[ty * screen.tilesWide + tx]!, tx * 8, ty * 8, true);
  }

  const glyphs: Record<string, Rgba> = {};
  for (const [c, tile] of Object.entries(GLYPH_TILES)) glyphs[c] = tileBlock(chars, pal, tile, 1, 1, GLYPH_BANK);

  const anims = decodeChars(romFile(rom, 'UI/GameAnims.NCGR'));
  const icons = {
    bricks: tileBlock(anims, pal, ICON_TILES.bricks, 2, 3, ICON_BANK),
    minifigs: tileBlock(anims, pal, ICON_TILES.minifigs, 2, 3, ICON_BANK),
    star: tileBlock(anims, pal, ICON_TILES.star, 2, 3, ICON_BANK),
  };

  const labels = entityLabels(romFile(rom, 'BP/Entities.ebp'), parseLang(romFile(rom, `LOC/${language}.lng`)));
  const portraits: Record<string, Rgba> = {};
  for (const id of portraitIds) {
    const p = portrait(rom, id);
    if (p) portraits[id] = p;
  }
  const heads = tryRomFile(rom, 'UI/MiniHeadsGame.NCGR');
  const commandIcons: Record<string, Rgba> = {};
  if (heads) {
    const hc = decodeChars(heads);
    for (const [name, i] of Object.entries(COMMAND_ICONS)) commandIcons[name] = commandIcon(hc, pal, i);
  }
  return { frame, icons, glyphs, labels, portraits, nameFont: parseFont(romFile(rom, 'Font/MSMincho-12.NFTR')), commandIcons, particles: buildParticleFx(rom) };
}

/** What the top screen shows this frame. */
export interface TopScreenState {
  bricks: number;
  minifigs: number;
  minifigCap: number;
  /** Third counter (red star); its meaning is still open. */
  star: [number, number];
  /** The selected entity, if any: index into `labels`, and its current HP. */
  selected?: { entity: number; hp: number };
  minimap?: MinimapState;
}

/** Minimap contents, all in minimap pixels (map px * 1.5 / cell size, i.e. x / 16, y * 3 / 32). */
export interface MinimapState {
  image: Rgba;
  /** The battlefield view: a 1 px white frame (16x18 for the DS's 256x192 view). */
  view?: { x: number; y: number; w: number; h: number };
  /** Units are 1 px, buildings 2x2 (castle measured). */
  dots: { x: number; y: number; size: number; rgb: [number, number, number] }[];
}

function draw(out: Rgba, img: Rgba, px: number, py: number): void {
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const s = (y * img.width + x) * 4;
      const dx = px + x;
      const dy = py + y;
      if (!img.data[s + 3] || dx < 0 || dy < 0 || dx >= out.width || dy >= out.height) continue;
      out.data.set(img.data.subarray(s, s + 4), (dy * out.width + dx) * 4);
    }
  }
}

function drawDigits(out: Rgba, hud: HudBundle, text: string, x: number, y: number): void {
  for (const c of text) {
    const g = hud.glyphs[c];
    if (g) draw(out, g, x, y);
    x += 8;
  }
}

function drawMinimap(out: Rgba, m: MinimapState): void {
  const P = HUD_LAYOUT.minimap;
  const put = (x: number, y: number, rgb: readonly number[]) => {
    if (x < 0 || y < 0 || x >= P.w || y >= P.h) return;
    out.data.set([rgb[0]!, rgb[1]!, rgb[2]!, 255], ((P.y + y) * TOP_W + P.x + x) * 4);
  };
  const img = m.image;
  for (let y = 0; y < Math.min(img.height, P.h); y++) {
    for (let x = 0; x < Math.min(img.width, P.w); x++) {
      const o = (y * img.width + x) * 4;
      if (img.data[o + 3]) put(x, y, [img.data[o]!, img.data[o + 1]!, img.data[o + 2]!]);
    }
  }
  for (const d of m.dots) for (let dy = 0; dy < d.size; dy++) for (let dx = 0; dx < d.size; dx++) put(d.x + dx, d.y + dy, d.rgb);
  const v = m.view;
  if (v) {
    const white = [255, 255, 255];
    for (let x = v.x; x < v.x + v.w; x++) {
      put(x, v.y, white);
      put(x, v.y + v.h - 1, white);
    }
    for (let y = v.y; y < v.y + v.h; y++) {
      put(v.x, y, white);
      put(v.x + v.w - 1, y, white);
    }
  }
}

/** Name text color: sub BG palette bank 0 color 14 (white 0x7FFF). */
const NAME_RGB: [number, number, number] = [255, 255, 255];

/** Compose the whole 256x192 top screen. */
export function composeTopScreen(hud: HudBundle, s: TopScreenState): Rgba {
  const out: Rgba = { width: TOP_W, height: TOP_H, data: hud.frame.data.slice() };
  const L = HUD_LAYOUT;
  draw(out, hud.icons.bricks, L.icons.bricks, L.icons.y);
  draw(out, hud.icons.minifigs, L.icons.minifigs, L.icons.y);
  draw(out, hud.icons.star, L.icons.star, L.icons.y);
  drawDigits(out, hud, String(s.bricks), L.counters.bricks, L.counters.y);
  drawDigits(out, hud, `${s.minifigs}/${s.minifigCap}`, L.counters.minifigs, L.counters.y);
  drawDigits(out, hud, `${s.star[0]}/${s.star[1]}`, L.counters.star, L.counters.y);
  if (s.minimap) drawMinimap(out, s.minimap);
  const label = s.selected ? hud.labels[s.selected.entity] : undefined;
  if (s.selected && label) {
    const p = hud.portraits[label.id];
    if (p) {
      // The slot behind the portrait is black: its few index-0 (transparent) pixels show black in game.
      for (let y = 0; y < p.height; y++) {
        for (let x = 0; x < p.width; x++) out.data.set([0, 0, 0, 255], ((L.portrait.y + y) * TOP_W + L.portrait.x + x) * 4);
      }
      draw(out, p, L.portrait.x, L.portrait.y);
    }
    const name = renderText(hud.nameFont, label.display, NAME_RGB);
    draw(out, name, (L.nameSpan - name.width) >> 1, L.nameY);
    const hp = `${Math.max(0, s.selected.hp)}/${label.maxHp}`;
    // On the 8 px tile grid, centered under the portrait.
    drawDigits(out, hud, hp, Math.floor(L.hpCenterX / 8 - hp.length / 2) * 8, L.hpY);
  }
  return out;
}
