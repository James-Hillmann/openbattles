import { Application, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import {
  INPUT_DELAY_TICKS,
  TICK_MS,
  cloneWorld,
  createFog,
  createWorld,
  isVisible,
  updateFog,
  fx,
  fxToFloat,
  hashWorld,
  spawnUnit,
  step,
  CELL_H,
  CELL_W,
  cellCenterX,
  cellCenterY,
  reachableFrom,
  spreadCells,
  type Fx,
  type MeleeBonusTable,
  type Fog,
  type ScheduledCommand,
  type UnitType as SimUnitType,
  type TerrainGrid,
  type World,
} from '@lbw/sim';
import { FACINGS, FACTIONS, FLASH_BANK, OUTLINE_OTHER, OUTLINE_OWN, clipFrame, modelRow, type HudBundle, type MapBundle, type Rgba, type UnitBundle, type UnitSprite, type UnitStats } from '@lbw/extract';
import { HudView, drawUnitBars } from './hud';
import { animate, attack, facing, type AnimState } from './unitAnim';
import { ModelView, type ModelClipName } from './modelView';
import { mountRomPanel } from './romPanel';
import { Selection, type Pickable } from './selection';

const LOCAL_PLAYER = 0;
const COLORS = [0xd33b2c, 0x3b6fd3];
/** Palette bank per player: even banks are team colors (0 red, 2 blue); bank + 1 is the same team selected. */
const TEAM_BANK = [0, 2];
/** Hit flash window, in ticks after the tick the damage landed. */
const HIT_FLASH_FROM = 2.5;
const HIT_FLASH_TO = 5.5;

let world: World = createWorld({ seed: 1234 });
let prev: World = cloneWorld(world);
const pending: ScheduledCommand[] = [];

function resetWorld(cx: number, cy: number, grid: TerrainGrid | null = null) {
  world = createWorld({ seed: 1234, grid });
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
    for (let i = 0; i < 4; i++) spawnUnit(world, 0, fx(cx - 120 + i * 28), fx(cy - 60));
    for (let i = 0; i < 4; i++) spawnUnit(world, 1, fx(cx + 40 + i * 28), fx(cy + 60));
  }
  prev = cloneWorld(world);
  pending.length = 0;
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
const selection = new Selection();
/** Where each unit was drawn last frame, for picking. */
let drawn: Pickable[] = [];

// --- Map + sprites from the ROM ---------------------------------------------

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
/** Entity names per faction prefix, in table order (heroes, builder, melee, ranged, mounted, siege, ship). */
let factionUnits = new Map<string, string[]>();
/** Sim stats per entity name, from Entities.ebp. */
let unitStats: Record<string, UnitStats> = {};
let combatBonus: MeleeBonusTable | null = null;

function simType(s: UnitStats | undefined): SimUnitType {
  if (!s) return {};
  const { index, speed, hp, priority, damage, damageRand, cooldown, minRange, maxRange, sight, projectile, moves, layer, role } = s;
  return { kind: index, speed, hp, priority, moves, layer, role, attack: { damage, damageRand, cooldown, minRange, maxRange, sight, projectile } };
}
/** Render-side only: which unit type each sim unit is. The sim doesn't know unit types yet. */
const unitKind = new Map<number, string>();
const unitSprites = new Map<number, Sprite>();
/** Per unit: animation state, facing, and the sim's lastAttack we last started a swing for. */
const unitAnim = new Map<number, { state: AnimState; row: number; flip: boolean; swing: number; clip: ModelClipName; clipStart: number }>();
const bgr = (c: number): [number, number, number] => [((c & 31) * 255) / 31, (((c >> 5) & 31) * 255) / 31, (((c >> 10) & 31) * 255) / 31];
const factionPick: [string, string] = ['K', 'A'];

function onUnits(u: UnitBundle) {
  for (const t of unitTypes.values()) t.model?.destroy();
  unitTypes.clear();
  factionUnits = new Map();
  unitStats = u.stats;
  for (const s of u.sprites) {
    const tex = textureFrom(s.atlas);
    const cols = s.atlas.width / s.frameW;
    const frames = Array.from({ length: s.rows }, (_, row) =>
      Array.from({ length: cols }, (_, col) => new Texture({ source: tex.source, frame: new Rectangle(col * s.frameW, row * s.frameH, s.frameW, s.frameH) })),
    );
    unitTypes.set(s.key, { sprite: s, frames });
  }
  for (const m of u.models) unitTypes.set(m.key, { model: new ModelView(m, textureFrom) });
  // Table order within each faction: heroes ... mounted (sprites), then siege, flyers, ships (models).
  for (const s of [...u.sprites, ...u.models]) {
    const prefix = s.name.slice(0, 1);
    const list = factionUnits.get(prefix) ?? [];
    if (!list.includes(s.name)) list.push(s.name);
    factionUnits.set(prefix, list);
  }
  mountFactionPickers(u);
}

/** Walkable cells for `count` units near (px, py), all on one landmass. */
function spawnCells(grid: TerrainGrid, px: number, py: number, count: number): [Fx, Fx][] {
  const [x, y] = [Math.floor(px / CELL_W), Math.floor(py / CELL_H)];
  const first = spreadCells(grid, x, y, 1);
  return spreadCells(grid, x, y, count, reachableFrom(grid, first)).map((c) => [
    cellCenterX(c % grid.width),
    cellCenterY(Math.floor(c / grid.width)),
  ]);
}

/** Spawn each player's faction lineup: every sprite unit type once, at its real speed. */
function spawnLineups(cx: number, cy: number) {
  world = createWorld({ seed: 1234, grid: mapGrid, bonus: combatBonus });
  unitKind.clear();
  for (let p = 0; p < 2; p++) {
    const names = factionUnits.get(factionPick[p]!) ?? [];
    const py = cy + (p === 0 ? -50 : 50);
    const spots = mapGrid ? spawnCells(mapGrid, cx, py, names.length) : names.map((_, i) => [fx(cx - 90 + i * 36), fx(py)] as [Fx, Fx]);
    names.forEach((name, i) => {
      const spot = spots[i];
      if (!spot) return;
      const t = unitTypes.get(`${name}@${TEAM_BANK[p]}`);
      const u = spawnUnit(world, p, spot[0], spot[1], unitStats[name] ? simType(unitStats[name]) : { speed: (t?.sprite ?? t?.model?.unit)?.speed });
      unitKind.set(u.id, name);
    });
  }
  if (!factionUnits.size) resetWorld(cx, cy, mapGrid);
  prev = cloneWorld(world);
  pending.length = 0;
  for (const s of unitSprites.values()) s.destroy();
  unitSprites.clear();
  unitAnim.clear();
  selection.ids.clear();
}

let mapSize = { w: 600, h: 440 };
let mapGrid: TerrainGrid | null = null;
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
  minimap = b.minimap;
  combatBonus = b.combatBonus;
  mapSize = { w: b.ground.width, h: b.ground.height };
  mapGrid = { width: b.width, height: b.height, cells: b.terrain };
  fog = createFog(b.width, b.height);
  spawnLineups(mapSize.w / 2, mapSize.h / 2);
  centerOn(mapSize.w / 2, mapSize.h / 2);
}

function mountFactionPickers(u: UnitBundle) {
  const el = document.getElementById('factions')!;
  const opts = FACTIONS.map((f) => `<option value="${f.prefix}">${f.name}</option>`).join('');
  el.innerHTML = `
    <label>You <select data-p="0">${opts}</select></label>
    <label>Opponent <select data-p="1">${opts}</select></label>
    ${u.missing.length ? `<p class="muted">Not drawn: ${u.missing.map((m) => m.name).join(', ')}</p>` : ''}`;
  el.querySelectorAll<HTMLSelectElement>('select').forEach((sel) => {
    const p = Number(sel.dataset.p);
    sel.value = factionPick[p]!;
    sel.addEventListener('change', () => {
      factionPick[p] = sel.value;
      spawnLineups(mapSize.w / 2, mapSize.h / 2);
    });
  });
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
    selection.click(drawn, LOCAL_PLAYER, w.x, w.y, e.shiftKey);
  } else if (boxRect) {
    selection.box(drawn, LOCAL_PLAYER, boxRect.x0, boxRect.y0, boxRect.x1, boxRect.y1, true);
  }
  drag = null;
  boxRect = null;
});
window.addEventListener('pointermove', (e) => {
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
window.addEventListener('keydown', (e) => keys.add(e.key.toLowerCase()));
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
  const unitIds = world.units.filter((u) => u.owner === LOCAL_PLAYER && selection.ids.has(u.id)).map((u) => u.id);
  if (unitIds.length === 0) return;
  // Sprites are anchored near the feet, so hit-test the box above them.
  const enemy = world.units.find(
    (u) => u.owner !== LOCAL_PLAYER && !hiddenByFog(u) && Math.abs(fxToFloat(u.x) - px) <= 12 && fxToFloat(u.y) - py <= 19 && py - fxToFloat(u.y) <= 5,
  );
  const cmd = enemy ? { kind: 'attack' as const, unitIds, target: enemy.id } : { kind: 'move' as const, unitIds, x: fx(px), y: fx(py) };
  pending.push({ tick: world.tick + INPUT_DELAY_TICKS, player: LOCAL_PLAYER, cmd });
});

// --- Fog of war (sim/src/fog.ts; docs/re-notes/fog.md) --------------------------

/** Enemy units outside our vision aren't drawn. guess: not yet checked in the emulator. */
function hiddenByFog(u: World['units'][number]): boolean {
  if (!fog || u.owner === LOCAL_PLAYER || u.cell < 0) return false;
  return !isVisible(fog, u.cell % fog.width, Math.floor(u.cell / fog.width));
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

// --- Loop: fixed-step sim, interpolated render ---------------------------------

const tickEl = document.getElementById('tick')!;
const hashEl = document.getElementById('hash')!;

let acc = 0;
let animTime = 0;
app.ticker.add((t) => {
  const pan = 8 / camera.scale.x;
  if (keys.has('arrowleft') || keys.has('a')) camera.x += pan * camera.scale.x;
  if (keys.has('arrowright') || keys.has('d')) camera.x -= pan * camera.scale.x;
  if (keys.has('arrowup') || keys.has('w')) camera.y += pan * camera.scale.y;
  if (keys.has('arrowdown') || keys.has('s')) camera.y -= pan * camera.scale.y;

  acc += t.deltaMS;
  animTime += t.deltaMS;
  while (acc >= TICK_MS) {
    acc -= TICK_MS;
    prev = cloneWorld(world);
    const due = pending.filter((c) => c.tick === world.tick);
    for (const c of due) pending.splice(pending.indexOf(c), 1);
    step(world, due);
    if (fog) updateFog(fog, world, LOCAL_PLAYER);
    tickEl.textContent = String(world.tick);
    hashEl.textContent = hashWorld(world).toString(16).padStart(8, '0');
  }

  const alpha = acc / TICK_MS;
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
  drawFog();
  const nextDrawn: Pickable[] = [];
  for (const u of world.units) {
    if (hiddenByFog(u)) {
      const hidden = unitSprites.get(u.id);
      if (hidden) hidden.visible = false;
      continue;
    }
    const p = prev.units.find((q) => q.id === u.id) ?? u;
    const x = fxToFloat(p.x) + (fxToFloat(u.x) - fxToFloat(p.x)) * alpha;
    const y = fxToFloat(p.y) + (fxToFloat(u.y) - fxToFloat(p.y)) * alpha;
    nextDrawn.push({ id: u.id, owner: u.owner, x, y });
    const isSelected = selection.ids.has(u.id);
    const bank = TEAM_BANK[u.owner]! + (isSelected ? 1 : 0);
    // Models carry team colors only; a selected one gets an outline instead of the odd bank.
    const type = unitTypes.get(`${unitKind.get(u.id)}@${bank}`) ?? unitTypes.get(`${unitKind.get(u.id)}@${bank & ~1}`);
    // Hit flash: drawn in the grey bank from 2.5 to 5.5 ticks after the damage tick (emulator).
    const sinceHit = world.tick - 1 - u.lastHit + alpha;
    const flash = sinceHit >= HIT_FLASH_FROM && sinceHit < HIT_FLASH_TO ? unitTypes.get(`${unitKind.get(u.id)}@${FLASH_BANK}`) : undefined;
    if (!type) {
      fallback.circle(x, y, 8).fill(COLORS[u.owner] ?? 0xffffff);
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
    if (type.model) {
      // The game keeps one controller per clip and switches between idle, move and attack.
      const clip: ModelClipName = moving ? 'move' : target ? 'attack' : 'idle';
      if (clip !== a.clip) Object.assign(a, { clip, clipStart: animTime });
      const outline = isSelected ? bgr(u.owner === LOCAL_PLAYER ? OUTLINE_OWN : OUTLINE_OTHER) : undefined;
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

  const mine = world.units.filter((u) => u.owner === LOCAL_PLAYER);
  const firstSelected = mine.find((u) => selection.ids.has(u.id));
  const selectedName = firstSelected && unitKind.get(firstSelected.id);
  const selectedEntity = selectedName ? hudView.entityIndex(selectedName) : -1;
  hudView.update({
    // Placeholders until the sim has an economy: the skirmish starting bricks and the population cap seen in the emulator.
    bricks: 500,
    minifigs: mine.length,
    minifigCap: Math.max(4, mine.length),
    star: [0, 0],
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
      dots: drawn.map((d) => ({ x: Math.floor(d.x / 16), y: Math.floor((d.y * 3) / 32), size: 1, rgb: MINIMAP_DOT[d.owner] ?? [255, 255, 255] })),
    },
  });
});

mountRomPanel(document.getElementById('rom') as HTMLInputElement, document.getElementById('rominfo')!, onMap, onUnits);
