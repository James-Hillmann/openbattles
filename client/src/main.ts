import './ui.css';
import { Application, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import {
  TICK_MS,
  cloneWorld,
  createFog,
  createWorld,
  isVisible,
  updateFog,
  visionCell,
  fx,
  fxToFloat,
  hashWorld,
  spawnUnit,
  CELL_H,
  CELL_W,
  cellCenterX,
  cellCenterY,
  reachableFrom,
  spreadCells,
  createSkirmish,
  canPlace,
  isBuilding,
  isFinished,
  getPlayer,
  popUsed,
  popCap,
  starsUsed,
  starCap,
  unitCell,
  TRAINS,
  PLAYING,
  WON,
  START_BRICKS,
  TERRAIN_TREE,
  ROLE_BUILDER,
  type EntityType,
  type StartSpawn,
  type WinMode,
  type Fx,
  type MeleeBonusTable,
  type Fog,
  type UnitType as SimUnitType,
  type TerrainGrid,
  type World,
} from '@lbw/sim';
import { FE_TEXT, priceLabel, type ArmyBundle, FLASH_BANK, OUTLINE_OTHER, OUTLINE_OWN, clipFrame, modelRow, type HudBundle, type MapBundle, type Rgba, type UnitBundle, type UnitSprite, type UnitStats } from '@lbw/extract';
import { HudView, drawUnitBars } from './hud';
import { animate, attack, facing, type AnimState } from './unitAnim';
import { ModelView, type ModelClipName } from './modelView';
import { createRom, savedRom, saveRom, skirmishFirst } from './romPanel';
import { Selection, type Pickable } from './selection';
import { Match, bareWorld, type MatchStart, type RelayClient } from './match';
import { defaultRelayUrl, mountLobby } from './lobby';
import { canvasOf, defaultPick, type ArmyPick } from './armySelect';
import { mountMenus } from './menus';
import type { GameSettings, GameType } from '@lbw/server/protocol';
import type { SkirmishSetup } from './menus';
import { CommandBar, type CommandItem } from './commandBar';
import { SiteFx } from './siteFx';

/** The player this browser controls: 0 offline, the lobby slot online. */
let localPlayer = 0;
/** Fallback circle colors per team color (red, blue, green, orange, magenta, grey). */
const COLORS = [0xd33b2c, 0x3b6fd3, 0x2f9e44, 0xf08c00, 0xb030b0, 0x707070];
/**
 * Team color (0..5) per player; palette bank 2c is that team, 2c + 1 the same team selected.
 * Offline: red vs blue.
 */
let teamColor = [0, 1];
const bankOf = (p: number) => 2 * (teamColor[p] ?? p);
/** Online settings, or null in the offline sandbox. */
let online: { settings: GameSettings; relay: RelayClient; ready: boolean } | null = null;
/** Most catch-up ticks run in one frame after a stall or a slow frame. */
const MAX_CATCHUP_TICKS = 8;
/** Our hash at each hash tick, for the two-tab test and for desync reports. */
const hashLog = new Map<number, number>();
/** Hit flash window, in ticks after the tick the damage landed. */
const HIT_FLASH_FROM = 2.5;
const HIT_FLASH_TO = 5.5;

/** Seed for the next world: fixed offline, the relay's online. */
let worldSeed = 1234;
let world: World = createWorld({ seed: worldSeed });
let prev: World = cloneWorld(world);
let match = new Match(world, 0, [0]);

/** Start ticking `w`: offline only player 0 sends input; online everyone in the room does. */
function adopt(w: World) {
  world = w;
  prev = cloneWorld(w);
  match.dispose();
  match = online ? new Match(w, localPlayer, teamColor.map((_, p) => p), online.relay) : new Match(w, 0, [0]);
  hashLog.clear();
  if (online) online.ready = true;
}

function resetWorld(cx: number, cy: number, grid: TerrainGrid | null = null) {
  world = createWorld({ seed: worldSeed, grid });
  if (grid) {
    // Stand each team on walkable cells near a point left/right of centre.
    // Keep a team on one landmass: spread only over cells reachable from the first one found.
    const team = (px: number, owner: number) => {
      const [x, y] = [Math.floor(px / CELL_W), Math.floor(cy / CELL_H)];
      const first = spreadCells(grid, x, y, 1);
      for (const c of spreadCells(grid, x, y, 4, reachableFrom(grid, first)))
        spawnUnit(world, owner, cellCenterX(c % grid.width), cellCenterY(Math.floor(c / grid.width)));
    };
    team(cx - 120, 0);
    team(cx + 120, 1);
  } else {
    world = bareWorld(worldSeed, cx, cy);
  }
  adopt(world);
}
resetWorld(300, 220);

const stageEl = document.getElementById('stage')!;
const app = new Application();
await app.init({ resizeTo: stageEl, background: 0x1d2a1d, antialias: false });
stageEl.appendChild(app.canvas);

/** Everything in world space lives under the camera. */
const camera = new Container();
app.stage.addChild(camera);
const ground = new Sprite();
camera.addChild(ground);
const unitLayer = new Container();
camera.addChild(unitLayer);
const fallback = new Graphics();
unitLayer.addChild(fallback);
/** Fog of war over unexplored cells (above units, below bars). */
const fogLayer = new Graphics();
camera.addChild(fogLayer);
/** Health bars and the box-select rectangle draw above units. */
const overlay = new Graphics();
camera.addChild(overlay);
const hudView = new HudView(document.getElementById('side')!);
/** `?dev` shows the tick and state hash. */
const DEV = new URLSearchParams(location.search).has('dev');
document.getElementById('dev')!.hidden = !DEV;
const selection = new Selection();
/** Where each unit was drawn last frame, for picking. */
let drawn: Pickable[] = [];

// --- Map + sprites from the ROM ---------------------------------------------

function canvasFrom(img: Rgba): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')!.putImageData(new ImageData(img.data.slice(), img.width, img.height), 0, 0);
  return c;
}

function textureFrom(img: Rgba): Texture {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')!.putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
  const t = Texture.from(c);
  t.source.scaleMode = 'nearest';
  return t;
}

/**
 * One unit type in one team color. Sprite units: frames[row][col], rows are facings, cols atlas
 * columns. Model units: poses drawn on demand.
 */
type UnitType = { sprite: UnitSprite; frames: Texture[][]; model?: undefined } | { model: ModelView; sprite?: undefined };
/** By "<entity name>@<bank>". */
const unitTypes = new Map<string, UnitType>();
/** Sim stats per entity name, from Entities.ebp. */
let unitStats: Record<string, UnitStats> = {};
let combatBonus: MeleeBonusTable | null = null;

function simType(s: UnitStats): EntityType & SimUnitType {
  const { index, speed, hp, priority, damage, damageRand, cooldown, minRange, maxRange, sight, projectile, moves, layer, role, cost, buildTime, size } = s;
  // Faction prefix of the six factions' entities; bonus characters (DwarfKing, ...) have none.
  const faction = /^[KWPIEA]_/.test(s.name) ? s.name[0] : undefined;
  return {
    kind: index, speed, hp, priority, moves, layer, role, cost, buildTime, size, sight, yield: s.yield, ...(faction ? { faction } : {}),
    attack: { damage, damageRand, cooldown, minRange, maxRange, sight, projectile },
  };
}

/** The lobby's game type as the sim's win rule (GameRuleManager mode). */
const WIN_MODE: Record<GameType, WinMode> = { 'hunt-the-hero': 0, elimination: 1, 'gold-rush': 2 };
/** Entity name per entity index (sim Unit.kind), from Entities.ebp. */
let nameByIndex = new Map<number, string>();
const unitKind = { get: (id: number) => nameByIndex.get(world.units.find((u) => u.id === id)?.kind ?? -1) };
/** Building pictures by "<entity name>@<bank>", and every type's picture as a small canvas for the command strip. */
const buildingTex = new Map<string, Texture>();
const iconCache = new Map<string, HTMLCanvasElement>();
const unitSprites = new Map<number, Sprite>();
/** Per unit: animation state, facing, and the sim's lastAttack we last started a swing for. */
const unitAnim = new Map<number, { state: AnimState; row: number; flip: boolean; swing: number; clip: ModelClipName; clipStart: number }>();
const bgr = (c: number): [number, number, number] => [((c & 31) * 255) / 31, (((c >> 5) & 31) * 255) / 31, (((c >> 10) & 31) * 255) / 31];
/** The ROM's armies (army screen data and strip icons), once a ROM is loaded. */
let armyBundle: ArmyBundle | null = null;
/** Army per player. Offline: yours, then the opponent's. */
let picks: ArmyPick[] = [];
const pickOf = (p: number): ArmyPick | null => picks[p] ?? (armyBundle ? defaultPick(armyBundle, p === 0 ? 'King' : 'Aliens') : null);
/** Faction prefix of a player's buildings. */
const basePrefix = (p: number) => (armyBundle && armyBundle.prefixes[pickOf(p)?.army ?? 'King']) ?? (p === 0 ? 'K' : 'A');

function onUnits(u: UnitBundle) {
  for (const t of unitTypes.values()) t.model?.destroy();
  unitTypes.clear();
  unitStats = u.stats;
  nameByIndex = new Map(Object.values(u.stats).map((s) => [s.index, s.name]));
  buildingTex.clear();
  iconCache.clear();
  for (const b of u.buildings) {
    buildingTex.set(b.key, textureFrom(b.image));
    iconCache.set(b.key, canvasFrom(b.image));
  }
  for (const s of u.sprites) {
    const tex = textureFrom(s.atlas);
    const cols = s.atlas.width / s.frameW;
    const frames = Array.from({ length: s.rows }, (_, row) =>
      Array.from({ length: cols }, (_, col) => new Texture({ source: tex.source, frame: new Rectangle(col * s.frameW, row * s.frameH, s.frameW, s.frameH) })),
    );
    unitTypes.set(s.key, { sprite: s, frames });
  }
  for (const m of u.models) unitTypes.set(m.key, { model: new ModelView(m, textureFrom) });
}

/** Start a skirmish on the loaded map: each player's start units from the map, the lobby's (or default) rules. */
function startSkirmish() {
  if (!mapGrid || !unitStats || !Object.keys(unitStats).length) return resetWorld(mapSize.w / 2, mapSize.h / 2, mapGrid);
  const types: (EntityType | undefined)[] = [];
  for (const st of Object.values(unitStats)) types[st.index] = simType(st);
  const ofRole = (p: number, role: number) => {
    const army = pickOf(p);
    // Units come from the player's army: the slots holding this role, in slot order.
    if (army && role < 7) return army.units.map((n) => unitStats[n]).filter((st): st is UnitStats => !!st && st.role === role);
    return Object.values(unitStats)
      .filter((st) => st.name.startsWith(`${basePrefix(p)}_`) && st.role === role)
      .sort((x, y) => x.index - y.index);
  };
  const players = online ? teamColor.length : 2;
  const settings = online?.settings ?? offlineSettings;
  // The sim writes chopped trees and footprints into the grid: every match starts from the map's own.
  const grid = { ...mapGrid, cells: mapTerrain.slice() };
  world = createSkirmish({ seed: worldSeed, grid, bonus: combatBonus, types, mineSites: mapMines }, mapStarts, {
    prebuilt: settings?.prebase ?? false,
    rules: { mode: settings ? WIN_MODE[settings.game] : 0 },
    bricks: settings?.bank ?? START_BRICKS,
    slots: Array.from({ length: players }, (_, p) => p),
    armies: Array.from({ length: players }, (_, p) => {
      const army = pickOf(p);
      return army ? { units: army.units.map((n) => unitStats[n]?.index ?? -1), base: basePrefix(p) } : undefined;
    }),
    typeFor: (p, role, index) => {
      const st = ofRole(p, role)[index];
      return st ? simType(st) : null;
    },
  });
  mapGrid = grid;
  groundTrees = treeCount(grid.cells);
  adopt(world);
  for (const sp of unitSprites.values()) sp.destroy();
  unitSprites.clear();
  unitAnim.clear();
  selection.ids.clear();
  placing = null;
  const start = getPlayer(world, localPlayer)?.start ?? -1;
  if (start >= 0) centerOn(cellCenterPx(start % grid.width, 'x'), cellCenterPx(Math.floor(start / grid.width), 'y'));
}

const cellCenterPx = (c: number, axis: 'x' | 'y') => (axis === 'x' ? c * CELL_W + CELL_W / 2 : c * CELL_H + CELL_H / 2);
const treeCount = (cells: Uint8Array) => cells.reduce((n, c) => n + (c === TERRAIN_TREE ? 1 : 0), 0);

let mapSize = { w: 600, h: 440 };
let mapGrid: TerrainGrid | null = null;
/** The map's terrain as loaded (trees standing), its skirmish start records and Mine sites. */
let mapTerrain = new Uint8Array(0);
let mapStarts: StartSpawn[] = [];
let mapMines: number[] = [];
let mapName = '';
/** Trees on the ground texture we show; when the sim's count drops, the ground is redrawn. */
let groundTrees = 0;
let groundAsked = 0;
/** Building picked from the strip, waiting for a spot: entity index. */
let placing: { type: number } | null = null;
let minimap: Rgba | undefined;
/** The local player's fog (presentation only, not part of the lockstep state). */
let fog: Fog | null = null;
/** Most common colour of the game's fog texture (FoWTileset), measured from a screenshot. The texture itself isn't drawn yet. */
const FOG_COLOR = 0x98a8b0;
/** Minimap dot colors per player: red is BGR555 0x015F (measured); blue is a guess until seen in game. */
const MINIMAP_DOT: [number, number, number][] = [[255, 82, 0], [0, 82, 255]];

function onMap(b: MapBundle, hud: HudBundle) {
  ground.texture = textureFrom(b.ground);
  hudView.setBundle(hud);
  hudBundle = hud;
  priceCanvases.clear();
  siteFx = hud.particles ? new SiteFx(hud.particles) : null;
  minimap = b.minimap;
  combatBonus = b.combatBonus;
  mapSize = { w: b.ground.width, h: b.ground.height };
  mapGrid = { width: b.width, height: b.height, cells: b.terrain };
  mapTerrain = b.terrain.slice();
  mapStarts = b.starts;
  mapMines = b.mineSites.map((m) => m.y * b.width + m.x);
  mapName = b.name;
  fog = createFog(b.width, b.height);
  centerOn(mapSize.w / 2, mapSize.h / 2);
  startSkirmish();
}

// --- Camera: drag with left mouse, or arrow keys / WASD ------------------------

function centerOn(x: number, y: number) {
  camera.x = Math.round(app.screen.width / 2 - x * camera.scale.x);
  camera.y = Math.round(app.screen.height / 2 - y * camera.scale.y);
}
camera.scale.set(2);
centerOn(300, 220);

/** Screen point -> world pixel. */
function toWorld(clientX: number, clientY: number): { x: number; y: number } {
  const r = app.canvas.getBoundingClientRect();
  return { x: (clientX - r.left - camera.x) / camera.scale.x, y: (clientY - r.top - camera.y) / camera.scale.y };
}

// Left button: click selects a unit (shift adds), drag pans, shift+drag box-selects.
let drag: { x: number; y: number; startX: number; startY: number; moved: boolean; box: boolean } | null = null;
let boxRect: { x0: number; y0: number; x1: number; y1: number } | null = null;
app.canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  drag = { x: e.clientX - camera.x, y: e.clientY - camera.y, startX: e.clientX, startY: e.clientY, moved: false, box: e.shiftKey };
});
window.addEventListener('pointerup', (e) => {
  if (!drag) return;
  if (!drag.moved) {
    const w = toWorld(e.clientX, e.clientY);
    hover = w;
    if (!tryPlace()) selection.click(drawn, localPlayer, w.x, w.y, e.shiftKey);
  } else if (boxRect) {
    selection.box(drawn, localPlayer, boxRect.x0, boxRect.y0, boxRect.x1, boxRect.y1, true);
  }
  drag = null;
  boxRect = null;
});
window.addEventListener('pointermove', (e) => {
  hover = toWorld(e.clientX, e.clientY);
  if (!drag) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 4) return;
  drag.moved = true;
  if (drag.box) {
    const a = toWorld(drag.startX, drag.startY);
    const b = toWorld(e.clientX, e.clientY);
    boxRect = { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
    return;
  }
  camera.x = e.clientX - drag.x;
  camera.y = e.clientY - drag.y;
});
const keys = new Set<string>();
window.addEventListener('keydown', (e) => {
  keys.add(e.key.toLowerCase());
  if (e.key === 'Escape') placing = null;
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
app.canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = app.canvas.getBoundingClientRect();
  const sx = e.clientX - r.left;
  const sy = e.clientY - r.top;
  const wx = (sx - camera.x) / camera.scale.x;
  const wy = (sy - camera.y) / camera.scale.y;
  // Whole-number zoom only, so every game pixel stays a crisp square like on the DS.
  const s = Math.min(4, Math.max(1, Math.round(camera.scale.x) + (e.deltaY < 0 ? 1 : -1)));
  camera.scale.set(s);
  camera.x = Math.round(sx - wx * s);
  camera.y = Math.round(sy - wy * s);
});

// --- Input: right-click an enemy to attack it, anywhere else to move ------------

app.canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const r = app.canvas.getBoundingClientRect();
  // Quantize pointer input to whole world pixels before it enters the sim.
  const px = Math.round((e.clientX - r.left - camera.x) / camera.scale.x);
  const py = Math.round((e.clientY - r.top - camera.y) / camera.scale.y);
  if (placing) {
    placing = null;
    return;
  }
  const sel = world.units.filter((u) => u.owner === localPlayer && selection.ids.has(u.id));
  const unitIds = sel.map((u) => u.id);
  if (unitIds.length === 0) return;
  const builders = sel.filter((u) => u.role === ROLE_BUILDER).map((u) => u.id);
  const hit = selection.pick(drawn, px, py);
  const target = hit && world.units.find((u) => u.id === hit.id);
  // Builders sent to one of our unfinished buildings go and build it.
  if (target && target.owner === localPlayer && isBuilding(target) && !isFinished(target) && builders.length) {
    match.issue({ kind: 'construct', unitIds: builders, site: target.id });
    return;
  }
  if (target && target.owner !== localPlayer) {
    match.issue({ kind: 'attack', unitIds, target: target.id });
    return;
  }
  // Builders sent to a tree chop it and keep harvesting; everyone else walks there.
  const g = world.grid;
  const [cx, cy] = [Math.floor(px / CELL_W), Math.floor(py / CELL_H)];
  if (g && builders.length && cx >= 0 && cy >= 0 && cx < g.width && cy < g.height && g.cells[cy * g.width + cx] === TERRAIN_TREE) {
    match.issue({ kind: 'harvest', unitIds: builders, cx, cy });
    const rest = unitIds.filter((id) => !builders.includes(id));
    if (rest.length) match.issue({ kind: 'move', unitIds: rest, x: fx(px), y: fx(py) });
    return;
  }
  match.issue({ kind: 'move', unitIds, x: fx(px), y: fx(py) });
});

// --- Fog of war (sim/src/fog.ts; docs/re-notes/fog.md) --------------------------

/** Enemy units outside our vision aren't drawn. guess: not yet checked in the emulator. */
function hiddenByFog(u: World['units'][number]): boolean {
  if (!fog || u.owner === localPlayer) return false;
  const [cx, cy] = visionCell(u);
  return !isVisible(fog, cx, cy);
}

/** Flat grey over every cell no unit has seen yet (the game draws its FoWTileset texture there, with soft edges). */
function drawFog() {
  fogLayer.clear();
  if (!fog) return;
  for (let cy = 0; cy < fog.height; cy++) {
    for (let cx = 0; cx < fog.width; cx++) {
      if (fog.explored[cy * fog.width + cx]) continue;
      // Merge runs of fogged cells in a row into one rectangle.
      let end = cx;
      while (end + 1 < fog.width && !fog.explored[cy * fog.width + end + 1]) end++;
      fogLayer.rect(cx * CELL_W, cy * CELL_H, (end - cx + 1) * CELL_W, CELL_H);
      cx = end;
    }
  }
  fogLayer.fill(FOG_COLOR);
}

// --- Buildings ------------------------------------------------------------------

/** Centre (Fx) of what a Builder is working on, when it stands next to it: the tree it chops or the site it builds. */
function workSpot(u: World['units'][number]): { x: Fx; y: Fx } | null {
  const g = world.grid;
  const job = u.job;
  if (!g || !job || (job.kind !== 'chop' && job.kind !== 'build')) return null;
  const here = unitCell(world, u);
  const [hx, hy] = [here % g.width, Math.floor(here / g.width)];
  let cx: number, cy: number, size: number;
  if (job.kind === 'chop') {
    if (g.cells[job.tree] !== TERRAIN_TREE) return null;
    [cx, cy, size] = [job.tree % g.width, Math.floor(job.tree / g.width), 1];
  } else {
    const site = world.units.find((b) => b.id === job.site);
    if (!site || isFinished(site)) return null;
    const o = unitCell(world, site);
    [cx, cy, size] = [o % g.width, Math.floor(o / g.width), site.size];
  }
  // Next to it (Chebyshev distance 1 from the rectangle), as the sim requires before work counts.
  const dx = hx < cx ? cx - hx : hx >= cx + size ? hx - (cx + size - 1) : 0;
  const dy = hy < cy ? cy - hy : hy >= cy + size ? hy - (cy + size - 1) : 0;
  if (Math.max(dx, dy) !== 1) return null;
  return { x: fx(cx * CELL_W + (size * CELL_W) / 2), y: fx(cy * CELL_H + (size * CELL_H) / 2) };
}

/** A building's footprint in world pixels (top-left cell is where the sim keeps it). */
function footprint(u: World['units'][number]) {
  const g = world.grid!;
  const c = unitCell(world, u);
  return { left: (c % g.width) * CELL_W, top: Math.floor(c / g.width) * CELL_H, w: u.size * CELL_W, h: u.size * CELL_H };
}

/** The construction effect, once the ROM is loaded. */
let siteFx: SiteFx | null = null;
/** Per site: the cloud's sprite, and the picture cut to the part built so far. */
const siteViews = new Map<number, { fx: Sprite; cut?: { key: string; tex: Texture } }>();
/** Sites a Builder is working right now (the studs only fly then). */
let workedSites = new Set<number>();

/**
 * Building picture with its bottom centre on the footprint's bottom centre: guess, not yet lined
 * up with the emulator. Selected buildings use the odd (outlined) bank like units.
 *
 * A site under construction (docs/re-notes/build-ui.md): the dust cloud sits on the done line,
 * which climbs the picture as the work goes on, and only the part of the picture below that line
 * shows, see-through (emulator: likely; how see-through is a guess).
 */
function drawBuilding(u: World['units'][number], isSelected: boolean, out: Pickable[]) {
  if (!world.grid) return;
  const f = footprint(u);
  const name = nameByIndex.get(u.kind);
  const tex = buildingTex.get(`${name}@${bankOf(u.owner) + (isSelected ? 1 : 0)}`) ?? buildingTex.get(`${name}@${bankOf(u.owner)}`);
  const top = tex ? f.top + f.h - tex.height : f.top;
  out.push({ id: u.id, owner: u.owner, x: f.left + f.w / 2, y: f.top + f.h, box: { l: f.left, t: top, r: f.left + f.w, b: f.top + f.h }, building: true });
  const done = isFinished(u);
  const view = siteViews.get(u.id);
  if (!tex) {
    fallback.rect(f.left + 2, f.top + 2, f.w - 4, f.h - 4).fill(COLORS[teamColor[u.owner] ?? u.owner] ?? 0xffffff);
  } else {
    let s = unitSprites.get(u.id);
    if (!s) {
      s = new Sprite();
      s.anchor.set(0.5, 1);
      unitLayer.addChild(s);
      unitSprites.set(u.id, s);
    }
    const left = Math.round(f.left + f.w / 2 - tex.width / 2);
    // The game's box: picture-wide in whole 24 px cells, picture-high in whole 16 px rows.
    const box = { left, top, w: Math.floor(tex.width / 24) * 24, h: Math.floor(tex.height / 16) * 16 };
    const pct = Math.floor((100 * u.progress) / Math.max(1, u.buildTime));
    const hidden = done ? 0 : Math.max(0, SiteFx.anchorY(box, pct) - top);
    s.texture = hidden ? cutTexture(u.id, tex, hidden) : tex;
    s.position.set(f.left + f.w / 2, f.top + f.h);
    s.zIndex = f.top + f.h;
    s.alpha = done ? 1 : 0.55;
    s.visible = hidden < tex.height;
    const cloud = siteFx?.draw(u.id, box, done ? 100 : pct, workedSites.has(u.id), animTime / TICK_MS);
    if (cloud) {
      const v = view ?? { fx: new Sprite() };
      if (!view) {
        unitLayer.addChild(v.fx);
        siteViews.set(u.id, v);
      }
      if (v.fx.texture.source.resource !== cloud.canvas) {
        v.fx.texture = Texture.from(cloud.canvas);
        v.fx.texture.source.scaleMode = 'nearest';
      } else v.fx.texture.source.update();
      v.fx.position.set(cloud.x, cloud.y);
      v.fx.zIndex = f.top + f.h + 1;
      v.fx.visible = true;
    } else if (view) view.fx.visible = false;
  }
  // Buildings show bars when selected or at <= 32% HP (emulator); we also show them while being built.
  if (isSelected || !done || u.hp * 100 <= u.maxHp * 32) drawUnitBars(overlay, Math.round(f.left + f.w / 2 - 12), top + 4, u.hp, u.maxHp);
}

/** The picture without its top `hidden` rows, cached until the cut moves. */
function cutTexture(id: number, tex: Texture, hidden: number): Texture {
  const v = siteViews.get(id) ?? { fx: new Sprite() };
  if (!siteViews.has(id)) {
    unitLayer.addChild(v.fx);
    siteViews.set(id, v);
  }
  const key = `${tex.uid}:${hidden}`;
  if (v.cut?.key !== key) {
    v.cut?.tex.destroy();
    const fr = tex.frame;
    v.cut = { key, tex: new Texture({ source: tex.source, frame: new Rectangle(fr.x, fr.y + hidden, fr.width, fr.height - hidden) }) };
  }
  return v.cut.tex;
}

/** Drop the cloud and cut picture of buildings that are gone. */
function pruneSites() {
  for (const [id, v] of siteViews) {
    if (world.units.some((u) => u.id === id)) continue;
    v.cut?.tex.destroy();
    v.fx.destroy();
    siteViews.delete(id);
  }
  siteFx?.prune((id) => siteViews.has(id));
}

// --- Build and train strip (docs/re-notes/build-ui.md) ---------------------------

/** Order of the Builder's strip in the game: Castle, Farm, Lumber Mill, Mine, Barracks, Stables, Shipyard, Tower (then Wall, Bridge, not built yet). */
const BUILD_ORDER = [7, 10, 8, 9, 11, 12, 16, 13];

const endEl = document.createElement('div');
endEl.className = 'endbanner';
endEl.hidden = true;
stageEl.appendChild(endEl);

const bar = new CommandBar(stageEl, (key) => {
  const [what, idx] = key.split(':');
  const type = Number(idx);
  if (what === 'build') placing = { type };
  else if (what === 'train') {
    const b = world.units.find((u) => u.owner === localPlayer && selection.ids.has(u.id) && isBuilding(u));
    if (b) match.issue({ kind: 'train', building: b.id, type });
  }
});

/** Stats of what player p's buildings train: their army's units, in slot order. */
function armyUnits(p: number): UnitStats[] {
  const army = pickOf(p);
  if (!army) return Object.values(unitStats).filter((st) => st.name.startsWith(`${basePrefix(p)}_`) && st.role < 7).sort((a, b) => a.index - b.index);
  return [...new Set(army.units)].map((n) => unitStats[n]).filter((st): st is UnitStats => !!st);
}
/** Stats of player p's buildings (their army's base faction). */
const armyBuildings = (p: number) =>
  Object.values(unitStats)
    .filter((st) => st.name.startsWith(`${basePrefix(p)}_`) && st.speed === 0xffff)
    .sort((a, b) => a.index - b.index);

/** Strip icon canvases by entity name. */
const stripIconCache = new Map<string, HTMLCanvasElement>();

/**
 * Picture for a strip button: the game's icon (UI/MiniHeadsGame through the ROM's icon table),
 * else a stand-in (the building itself, or the unit's front idle frame).
 */
function iconFor(name: string): HTMLCanvasElement | null {
  const game = armyBundle?.stripIcons[name];
  if (game) {
    let c = stripIconCache.get(name);
    if (!c) stripIconCache.set(name, (c = canvasOf(game)));
    return c;
  }
  const bank = bankOf(localPlayer);
  const key = `${name}@${bank}`;
  const hit = iconCache.get(key);
  if (hit) return hit;
  const t = unitTypes.get(key)?.sprite;
  if (!t) return null;
  const c = document.createElement('canvas');
  c.width = t.frameW;
  c.height = t.frameH;
  const img = new ImageData(t.atlas.data.slice(), t.atlas.width, t.atlas.height);
  const tmp = canvasFrom({ width: img.width, height: img.height, data: img.data });
  c.getContext('2d')!.drawImage(tmp, t.idle * t.frameW, 4 * t.frameH, t.frameW, t.frameH, 0, 0, t.frameW, t.frameH);
  iconCache.set(key, c);
  return c;
}

const displayName = (name: string) => hudView.label(name)?.display ?? name.replace(/^._/, '');

let hudBundle: HudBundle | null = null;
const priceCanvases = new Map<number, HTMLCanvasElement>();
/** A price in the game's digit font for the strip, or null before a ROM's HUD is loaded. */
function priceCanvas(cost: number): HTMLCanvasElement | null {
  if (!hudBundle) return null;
  let c = priceCanvases.get(cost);
  if (!c) priceCanvases.set(cost, (c = canvasOf(priceLabel(hudBundle, cost))));
  return c;
}

/** What the top screen's "Build Costs" panel shows while the strip is open, or null. */
let stripCosts: { title: string; items: { icon: Rgba; cost: number }[] } | null = null;

function updateStrip() {
  stripCosts = null;
  const me = getPlayer(world, localPlayer);
  const sel = world.units.filter((u) => u.owner === localPlayer && u.hp > 0 && selection.ids.has(u.id));
  if (!me || me.status !== PLAYING || sel.length === 0) return bar.hide();
  const item = (st: UnitStats, verb: string): CommandItem => ({
    key: `${verb}:${st.index}`,
    label: `${displayName(st.name)}: ${st.cost} bricks`,
    cost: st.cost,
    price: priceCanvas(st.cost),
    icon: iconFor(st.name),
    enabled: me.bricks >= st.cost,
  });
  const costs = (list: UnitStats[]) => {
    const icons = armyBundle?.stripIcons;
    if (!icons) return;
    stripCosts = { title: armyBundle!.text[FE_TEXT.buildCosts] ?? 'Build Costs', items: list.filter((st) => icons[st.name]).map((st) => ({ icon: icons[st.name]!, cost: st.cost })) };
  };
  const b = sel.find(isBuilding);
  if (b) {
    const name = nameByIndex.get(b.kind) ?? '';
    if (!isFinished(b)) return bar.show(`${displayName(name)}: ${Math.floor((100 * b.progress) / Math.max(1, b.buildTime))}%`, []);
    const roles = TRAINS[b.role] ?? [];
    // One hero icon (the first), as the Castle strip shows in the emulator.
    const list = armyUnits(localPlayer).filter((st, i, all) => roles.includes(st.role) && st.speed !== 0xffff && (st.role !== 0 || all.find((x) => x.role === 0) === st));
    costs(list);
    const queue = b.queue.map((k, i) => {
      const n = nameByIndex.get(k) ?? '';
      const bt = world.types[k]?.buildTime ?? 1;
      return { icon: iconFor(n), pct: i === 0 ? Math.floor((100 * b.prod) / Math.max(1, bt)) : -1 };
    });
    return bar.show('', list.map((st) => item(st, 'train')), queue);
  }
  if (!sel.some((u) => u.role === ROLE_BUILDER)) return bar.hide();
  const all = armyBuildings(localPlayer);
  const list = BUILD_ORDER.map((r) => all.find((st) => st.role === r)).filter((st): st is UnitStats => !!st);
  costs(list);
  bar.show(placing ? `Place the ${displayName(nameByIndex.get(placing.type) ?? '')}. Right-click cancels.` : '', list.map((st) => item(st, 'build')));
}

let hover = { x: 0, y: 0 };

/** Top-left cell of a footprint of `size` centred on the pointer. */
function placeCell(size: number) {
  const cx = Math.floor(hover.x / CELL_W) - ((size - 1) >> 1);
  const cy = Math.floor(hover.y / CELL_H) - ((size - 1) >> 1);
  return { cx, cy };
}

/** Building preview under the pointer: green where it can stand, red where not. */
function drawPlacement() {
  ghost.visible = false;
  if (!placing || !world.grid) return;
  const t = world.types[placing.type];
  if (!t) return;
  const { cx, cy } = placeCell(t.size);
  const ok = canPlace(world, t, cx, cy);
  const [l, tp, w, h] = [cx * CELL_W, cy * CELL_H, t.size * CELL_W, t.size * CELL_H];
  overlay.rect(l, tp, w, h).fill({ color: ok ? 0x30ff30 : 0xff3030, alpha: 0.35 });
  const tex = buildingTex.get(`${nameByIndex.get(placing.type)}@${bankOf(localPlayer)}`);
  if (tex) {
    ghost.texture = tex;
    ghost.position.set(l + w / 2, tp + h);
    ghost.visible = true;
  }
}

const ghost = new Sprite();
ghost.anchor.set(0.5, 1);
ghost.alpha = 0.6;
camera.addChild(ghost);

/** Place the picked building at the pointer with the selected Builders. */
function tryPlace(): boolean {
  if (!placing) return false;
  const t = world.types[placing.type];
  const unitIds = world.units.filter((u) => u.owner === localPlayer && u.role === ROLE_BUILDER && selection.ids.has(u.id)).map((u) => u.id);
  if (t && unitIds.length) {
    const { cx, cy } = placeCell(t.size);
    if (!canPlace(world, t, cx, cy)) return true; // keep the preview up; the spot is taken
    match.issue({ kind: 'build', unitIds, type: placing.type, cx, cy });
  }
  placing = null;
  return true;
}

/** Redraw the ground when trees have been chopped (at most twice a second). */
function checkGround() {
  if (!world.grid || !mapName || !rom.summary()) return;
  const now = performance.now();
  if (now - groundAsked < 500) return;
  const n = treeCount(world.grid.cells);
  if (n === groundTrees) return;
  groundTrees = n;
  groundAsked = now;
  rom.rebake(mapName, world.grid.cells);
}

// --- Loop: fixed-step sim, interpolated render ---------------------------------

const tickEl = document.getElementById('tick')!;
const hashEl = document.getElementById('hash')!;
const netEl = document.getElementById('net')!;

let acc = 0;
let animTime = 0;

/** Run every sim tick that `ms` more of wall time allows (fewer while waiting on input). */
function advance(ms: number) {
  acc = Math.min(acc + ms, TICK_MS * MAX_CATCHUP_TICKS);
  while (acc >= TICK_MS) {
    const before = cloneWorld(world);
    const r = match.tick();
    if (!r) break; // waiting for the other player's input: hold this tick
    prev = before;
    acc -= TICK_MS;
    if (r.hash !== null) hashLog.set(world.tick, r.hash);
    if (fog) updateFog(fog, world, localPlayer);
    tickEl.textContent = String(world.tick);
    hashEl.textContent = hashWorld(world).toString(16).padStart(8, '0');
  }
}

// Browsers stop animation frames in a hidden tab and slow its timers to 1 Hz, which would
// freeze an online match for the other player too. A worker's timer keeps running, so it
// drives the sim while the tab is hidden; the render loop drives it while visible.
const clock = new Worker(URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${Math.floor(TICK_MS)})`], { type: 'text/javascript' })));
let hiddenAt = 0;
clock.onmessage = () => {
  if (!document.hidden || !online) return;
  const now = performance.now();
  advance(hiddenAt ? now - hiddenAt : TICK_MS);
  hiddenAt = now;
};
document.addEventListener('visibilitychange', () => {
  hiddenAt = document.hidden ? performance.now() : 0;
});

app.ticker.add((t) => {
  const pan = 8 / camera.scale.x;
  if (keys.has('arrowleft') || keys.has('a')) camera.x += pan * camera.scale.x;
  if (keys.has('arrowright') || keys.has('d')) camera.x -= pan * camera.scale.x;
  if (keys.has('arrowup') || keys.has('w')) camera.y += pan * camera.scale.y;
  if (keys.has('arrowdown') || keys.has('s')) camera.y -= pan * camera.scale.y;

  // The first frame back after hiding can carry a huge delta; the worker already ticked.
  advance(document.hidden ? 0 : Math.min(t.deltaMS, 250));
  animTime += t.deltaMS;
  // While stalled, show the latest tick rather than extrapolating past it.
  const waiting = online ? match.waitingFor() : [];
  netEl.textContent = !online ? '' : match.desynced ? 'Out of sync' : match.left.length ? 'Connection Lost!' : waiting.length && acc >= TICK_MS ? 'Waiting...' : '';

  const alpha = Math.min(1, acc / TICK_MS);
  fallback.clear();
  overlay.clear();
  // Dead units leave the sim; drop their sprites.
  for (const [id, sp] of unitSprites) {
    if (world.units.some((u) => u.id === id)) continue;
    sp.destroy();
    unitSprites.delete(id);
    unitAnim.delete(id);
  }
  for (const p of world.projectiles) overlay.circle(fxToFloat(p.x), fxToFloat(p.y) - 8, 1.5).fill(0xffffff);
  selection.prune((id) => world.units.some((u) => u.id === id));
  pruneSites();
  workedSites = new Set(world.units.flatMap((u) => (u.job?.kind === 'build' && workSpot(u) ? [u.job.site] : [])));
  drawFog();
  const nextDrawn: Pickable[] = [];
  for (const u of world.units) {
    if (hiddenByFog(u)) {
      const hidden = unitSprites.get(u.id);
      if (hidden) hidden.visible = false;
      const site = siteViews.get(u.id);
      if (site) site.fx.visible = false;
      continue;
    }
    if (isBuilding(u)) {
      drawBuilding(u, selection.ids.has(u.id), nextDrawn);
      continue;
    }
    const p = prev.units.find((q) => q.id === u.id) ?? u;
    const x = fxToFloat(p.x) + (fxToFloat(u.x) - fxToFloat(p.x)) * alpha;
    const y = fxToFloat(p.y) + (fxToFloat(u.y) - fxToFloat(p.y)) * alpha;
    nextDrawn.push({ id: u.id, owner: u.owner, x, y });
    const isSelected = selection.ids.has(u.id);
    const bank = bankOf(u.owner) + (isSelected ? 1 : 0);
    // Models carry team colors only; a selected one gets an outline instead of the odd bank.
    const type = unitTypes.get(`${unitKind.get(u.id)}@${bank}`) ?? unitTypes.get(`${unitKind.get(u.id)}@${bank & ~1}`);
    // Hit flash: drawn in the grey bank from 2.5 to 5.5 ticks after the damage tick (emulator).
    const sinceHit = world.tick - 1 - u.lastHit + alpha;
    const flash = sinceHit >= HIT_FLASH_FROM && sinceHit < HIT_FLASH_TO ? unitTypes.get(`${unitKind.get(u.id)}@${FLASH_BANK}`) : undefined;
    if (!type) {
      fallback.circle(x, y, 8).fill(COLORS[teamColor[u.owner] ?? u.owner] ?? 0xffffff);
      continue;
    }
    const box = type.sprite ?? type.model.unit;
    let s = unitSprites.get(u.id);
    if (!s) {
      s = new Sprite();
      s.anchor.set(box.anchorX / box.frameW, box.anchorY / box.frameH);
      unitLayer.addChild(s);
      unitSprites.set(u.id, s);
    }
    // Start facing the camera: sprite row 4 (front), model row 0.
    const a = unitAnim.get(u.id) ?? { state: { mode: 'idle' } as AnimState, row: type.model ? 0 : 4, flip: false, swing: u.lastAttack, clip: 'idle' as ModelClipName, clipStart: animTime };
    const face = (dx: number, dy: number) => (type.model ? { row: modelRow(dx, dy, type.model.unit.rows), flip: false } : facing(dx, dy));
    const moving = u.x !== p.x || u.y !== p.y;
    if (moving) Object.assign(a, face(u.x - p.x, u.y - p.y));
    const target = u.target === null ? undefined : world.units.find((o) => o.id === u.target);
    if (u.lastAttack !== a.swing) {
      // The sim just attacked: face the target and play one swing.
      a.swing = u.lastAttack;
      if (target) Object.assign(a, face(target.x - u.x, target.y - u.y));
      a.state = attack(animTime);
    }
    // Builders at work swing their attack frames over and over, facing the tree or site
    // (emulator: 6 poses x 4 VBlanks, looping, while chopping; that building looks the same is a guess).
    const work = !moving && !u.mv ? workSpot(u) : null;
    if (work && !type.model) {
      Object.assign(a, face(work.x - u.x, work.y - u.y));
      if (a.state.mode !== 'attack') a.state = attack(animTime);
    }
    if (type.model) {
      // The game keeps one controller per clip and switches between idle, move and attack.
      const clip: ModelClipName = moving ? 'move' : target ? 'attack' : 'idle';
      if (clip !== a.clip) Object.assign(a, { clip, clipStart: animTime });
      const outline = isSelected ? bgr(u.owner === localPlayer ? OUTLINE_OWN : OUTLINE_OTHER) : undefined;
      s.texture = type.model.texture(a.row, clipFrame(type.model.unit.clips[clip], animTime - a.clipStart), outline);
      s.scale.x = 1;
    } else {
      const r = animate(type.sprite, a.state, moving, animTime);
      a.state = r.state;
      s.texture = (flash && !flash.model ? flash : type).frames[a.row]![r.col]!;
      s.scale.x = a.flip ? -1 : 1;
    }
    unitAnim.set(u.id, a);
    s.visible = true;
    s.position.set(Math.round(x), Math.round(y));
    s.zIndex = y;
    // The game shows a unit's bars while it is selected; we also show them once it is hurt.
    if (isSelected || u.hp < u.maxHp) drawUnitBars(overlay, Math.round(x) - box.anchorX, Math.round(y) - box.anchorY, u.hp, u.maxHp);
  }
  unitLayer.sortableChildren = true;
  drawn = nextDrawn;
  if (boxRect) {
    const l = Math.min(boxRect.x0, boxRect.x1);
    const t = Math.min(boxRect.y0, boxRect.y1);
    overlay.rect(l, t, Math.abs(boxRect.x1 - boxRect.x0), Math.abs(boxRect.y1 - boxRect.y0)).stroke({ color: 0xffff00, width: 1 / camera.scale.x });
  }

  drawPlacement();
  updateStrip();
  checkGround();
  const mine = world.units.filter((u) => u.owner === localPlayer);
  const firstSelected = mine.find((u) => selection.ids.has(u.id));
  const selectedName = firstSelected && unitKind.get(firstSelected.id);
  const selectedEntity = selectedName ? hudView.entityIndex(selectedName) : -1;
  const me = getPlayer(world, localPlayer);
  endEl.hidden = !me || me.status === PLAYING;
  if (me && me.status !== PLAYING) endEl.textContent = me.status === WON ? 'Victory!' : 'Defeat';
  hudView.update({
    costs: stripCosts ?? undefined,
    bricks: me?.bricks ?? online?.settings.bank ?? START_BRICKS,
    minifigs: me ? popUsed(world, localPlayer) : mine.length,
    minifigCap: me ? popCap(world, localPlayer) : Math.max(4, mine.length),
    star: me ? [starsUsed(world, localPlayer), starCap(world, localPlayer)] : [0, 0],
    selected: selectedEntity >= 0 && firstSelected ? { entity: selectedEntity, hp: firstSelected.hp } : undefined,
    minimap: minimap && {
      image: minimap,
      // World px -> minimap px: 1.5 px per 24x16 cell, i.e. x / 16 and y * 3 / 32.
      view: {
        x: Math.floor(-camera.x / camera.scale.x / 16),
        y: Math.floor((-camera.y / camera.scale.y) * 3 / 32),
        w: Math.round(app.screen.width / camera.scale.x / 16),
        h: Math.round((app.screen.height / camera.scale.y) * 3 / 32),
      },
      dots: drawn.map((d) => ({ x: Math.floor(d.x / 16), y: Math.floor((d.y * 3) / 32), size: d.building ? 2 : 1, rgb: MINIMAP_DOT[teamColor[d.owner] ?? d.owner] ?? [255, 255, 255] })),
    },
  });
});

// --- ROM, menus, lobby -----------------------------------------------------------

const rom = createRom({
  onMap,
  onUnits,
  onArmy: (a) => {
    armyBundle = a;
    stripIconCache.clear();
  },
  onError: (m) => console.error(m),
});
rom.onGround = (name, g) => {
  if (name === mapName) ground.texture = textureFrom(g);
};

const appEl = document.getElementById('app')!;
const screensEl = document.getElementById('screens')!;
/** Menus over a dimmed battlefield, or the battlefield with the top screen beside it. */
function setMode(mode: 'menu' | 'game') {
  appEl.classList.toggle('menu', mode === 'menu');
  screensEl.hidden = mode === 'game';
  if (mode === 'game') requestAnimationFrame(() => app.resize());
}

const skirmishMaps = () => skirmishFirst(rom.summary()?.maps ?? []).filter((m) => /^mp\d+$/.test(m));
const PICK_KEY = 'ob.army';
let myPick: ArmyPick | null = null;
try {
  const saved = JSON.parse(localStorage.getItem(PICK_KEY) ?? 'null') as ArmyPick | null;
  if (saved && typeof saved.army === 'string' && Array.isArray(saved.units) && saved.units.length === 9) myPick = saved;
} catch {
  /* storage blocked or bad data: start from the King */
}
/** The saved pick only if this ROM has those characters. */
const validPick = (p: ArmyPick | null) =>
  p && armyBundle && armyBundle.armies[p.army] && p.units.every((u, i) => armyBundle!.choices[i]?.includes(u)) ? p : null;

const menus = mountMenus(screensEl, {
  army: () => armyBundle,
  maps: skirmishMaps,
  loadRom: async (bytes) => {
    const keep = bytes.slice(0);
    await rom.load(bytes);
    await saveRom(keep);
  },
  savedRom,
  forgetRom: () => saveRom(null),
  pick: () => validPick(myPick),
  setPick: (p) => {
    myPick = p;
    try {
      localStorage.setItem(PICK_KEY, JSON.stringify(p));
    } catch {
      /* ignore */
    }
  },
  startSkirmish: (setup) => void startOffline(setup),
  startBare: () => {
    offlineSettings = null;
    resetWorld(300, 220);
    setMode('game');
  },
  openLobby: () => lobby.show(),
});

/** Offline game settings (from the skirmish setup screen). */
let offlineSettings: GameSettings | null = null;

async function startOffline(setup: SkirmishSetup) {
  offlineSettings = { game: setup.game, map: setup.map, randomStart: false, prebase: setup.prebase, bank: setup.bank };
  const b = armyBundle!;
  picks = [validPick(myPick) ?? defaultPick(b), defaultPick(b, setup.opponent)];
  setMode('game');
  await rom.loadMap(setup.map);
}

document.getElementById('quit')!.onclick = () => {
  if (lobby.inGame()) return lobby.leave();
  backToMenu();
};
document.getElementById('helpBtn')!.onclick = () => {
  const h = document.getElementById('help')!;
  h.hidden = !h.hidden;
};

function backToMenu() {
  offlineSettings = null;
  selection.ids.clear();
  setMode('menu');
  menus.main();
}

// --- Online: lobby, then a lockstep match --------------------------------------

async function startOnline(relay: RelayClient, start: MatchStart) {
  const players = [...start.players].sort((a, b) => a.slot - b.slot);
  localPlayer = start.you;
  teamColor = players.map((p) => p.color);
  const b = armyBundle;
  // Each side's army: the nine names they sent, or their faction's own army.
  picks = b
    ? players.map((p) => {
        const army = Object.entries(b.prefixes).find(([, pre]) => pre === p.faction)?.[0] ?? 'King';
        return { army, units: p.army ? [...p.army] : [...b.armies[army]!.units] };
      })
    : [];
  worldSeed = start.seed;
  online = { settings: start.settings, relay, ready: false };
  selection.ids.clear();
  setMode('game');
  // Freeze the offline sandbox until the world is built, so nothing ticks early.
  match.dispose();
  match = new Match(world, localPlayer, [-1]);
  if (rom.summary()) {
    // Same ROM (the lobby checked) + same seed + same lineups = the same world everywhere.
    await rom.loadUnits(teamColor, teamColor[localPlayer]!);
    await rom.loadMap(start.settings.map);
  } else {
    adopt(bareWorld(worldSeed));
  }
  for (const s of unitSprites.values()) s.destroy();
  unitSprites.clear();
  unitAnim.clear();
}

function endOnline(reason: string) {
  online = null;
  localPlayer = 0;
  teamColor = [0, 1];
  picks = [];
  worldSeed = 1234;
  if (rom.summary()) void rom.loadUnits(teamColor, 0);
  resetWorld(300, 220);
  setMode('menu');
  // A lost connection shows on the multiplayer screen; quitting goes to the main menu.
  if (!reason) menus.main();
}

const lobby = mountLobby(
  screensEl,
  {
    rom: () => {
      const s = rom.summary();
      return s && { fingerprint: s.fingerprint, maps: skirmishMaps() };
    },
    army: () => armyBundle,
    pick: () => validPick(myPick) ?? (armyBundle ? defaultPick(armyBundle) : null),
    chooseArmy: (done) => menus.chooseArmy(done),
    start: (relay, start) => void startOnline(relay, start),
    ended: endOnline,
    back: () => menus.main(),
  },
  defaultRelayUrl(location),
);

void menus.boot();

/** Read-only hooks for the two-tab browser test (tests/e2e). Not used by the game. */
(window as unknown as { __ob: object }).__ob = {
  tick: () => world.tick,
  hashAt: (t: number) => hashLog.get(t) ?? null,
  /** True once the online match's world is built and ticking. */
  online: () => online?.ready === true,
  local: () => localPlayer,
  units: () => world.units.map((u) => ({ id: u.id, owner: u.owner, x: u.x, y: u.y, role: u.role, kind: u.kind, hp: u.hp, progress: u.progress, queue: [...u.queue], job: u.job?.kind ?? null })),
  player: (id: number) => getPlayer(world, id) ?? null,
  /** Select units as a click would (tests drive the strip and orders through the real input path). */
  select: (ids: number[]) => {
    selection.ids.clear();
    for (const id of ids) selection.ids.add(id);
  },
  /** World pixel -> page pixel, for clicking. */
  toScreen: (x: number, y: number) => {
    const r = app.canvas.getBoundingClientRect();
    return { x: r.left + camera.x + x * camera.scale.x, y: r.top + camera.y + y * camera.scale.y };
  },
  grid: () => world.grid && { width: world.grid.width, height: world.grid.height, cells: [...world.grid.cells] },
  issueMove: (x: number, y: number) =>
    match.issue({ kind: 'move', unitIds: world.units.filter((u) => u.owner === localPlayer).map((u) => u.id), x: fx(x), y: fx(y) }),
  desynced: () => match.desynced,
  /** Economy orders through the real command path: the base trains a Builder, Builders chop the nearest tree. */
  /** Any command, as if the local player gave it. */
  issue: (c: Parameters<Match['issue']>[0]) => match.issue(c),
  issueEconomy: () => {
    const mine = world.units.filter((u) => u.owner === localPlayer && u.hp > 0);
    const builder = mine.find((u) => u.role === ROLE_BUILDER);
    const base = mine.find((u) => u.role === 7);
    if (base && builder) match.issue({ kind: 'train', building: base.id, type: builder.kind });
    const g = world.grid;
    if (!g || !builder) return;
    const here = unitCell(world, builder);
    let best = -1;
    for (let i = 0; i < g.cells.length; i++) {
      if (g.cells[i] !== TERRAIN_TREE) continue;
      const d = (i: number) => Math.abs((i % g.width) - (here % g.width)) + Math.abs(Math.floor(i / g.width) - Math.floor(here / g.width));
      if (best < 0 || d(i) < d(best)) best = i;
    }
    if (best >= 0) match.issue({ kind: 'harvest', unitIds: [builder.id], cx: best % g.width, cy: Math.floor(best / g.width) });
  },
};
