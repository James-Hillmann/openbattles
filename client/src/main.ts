import { Application, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import {
  INPUT_DELAY_TICKS,
  TICK_MS,
  cloneWorld,
  createWorld,
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
  type ScheduledCommand,
  type TerrainGrid,
  type World,
} from '@lbw/sim';
import { FACINGS, FACTIONS, type MapBundle, type Rgba, type UnitBundle, type UnitSprite } from '@lbw/extract';
import { animate, attack, facing, type AnimState } from './unitAnim';
import { mountRomPanel } from './romPanel';

const LOCAL_PLAYER = 0;
const COLORS = [0xd33b2c, 0x3b6fd3];
/** Palette bank per player: even banks are team colors (0 red, 2 blue). */
const TEAM_BANK = [0, 2];

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

/** One unit type in one team color: frames[row][col], rows are facings, cols atlas columns. */
interface UnitType {
  sprite: UnitSprite;
  frames: Texture[][];
}
/** By "<entity name>@<bank>". */
const unitTypes = new Map<string, UnitType>();
/** Entity names per faction prefix, in table order (hero, hero F, builder, melee, ranged, mounted). */
let factionUnits = new Map<string, string[]>();
/** Render-side only: which unit type each sim unit is. The sim doesn't know unit types yet. */
const unitKind = new Map<number, string>();
const unitSprites = new Map<number, Sprite>();
const unitAnim = new Map<number, { state: AnimState; row: number; flip: boolean }>();
const factionPick: [string, string] = ['K', 'A'];

function onUnits(u: UnitBundle) {
  unitTypes.clear();
  factionUnits = new Map();
  for (const s of u.sprites) {
    const tex = textureFrom(s.atlas);
    const cols = s.atlas.width / s.frame;
    const frames = Array.from({ length: FACINGS }, (_, row) =>
      Array.from({ length: cols }, (_, col) => new Texture({ source: tex.source, frame: new Rectangle(col * s.frame, row * s.frame, s.frame, s.frame) })),
    );
    unitTypes.set(s.key, { sprite: s, frames });
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
  world = createWorld({ seed: 1234, grid: mapGrid });
  unitKind.clear();
  for (let p = 0; p < 2; p++) {
    const names = factionUnits.get(factionPick[p]!) ?? [];
    const py = cy + (p === 0 ? -50 : 50);
    const spots = mapGrid ? spawnCells(mapGrid, cx, py, names.length) : names.map((_, i) => [fx(cx - 90 + i * 36), fx(py)] as [Fx, Fx]);
    names.forEach((name, i) => {
      const spot = spots[i];
      if (!spot) return;
      const t = unitTypes.get(`${name}@${TEAM_BANK[p]}`);
      const u = spawnUnit(world, p, spot[0], spot[1], t?.sprite.speed);
      unitKind.set(u.id, name);
    });
  }
  if (!factionUnits.size) resetWorld(cx, cy, mapGrid);
  prev = cloneWorld(world);
  pending.length = 0;
  for (const s of unitSprites.values()) s.destroy();
  unitSprites.clear();
  unitAnim.clear();
}

let mapSize = { w: 600, h: 440 };
let mapGrid: TerrainGrid | null = null;
function onMap(b: MapBundle) {
  ground.texture = textureFrom(b.ground);
  mapSize = { w: b.ground.width, h: b.ground.height };
  mapGrid = { width: b.width, height: b.height, cells: b.terrain };
  spawnLineups(mapSize.w / 2, mapSize.h / 2);
  centerOn(mapSize.w / 2, mapSize.h / 2);
}

function mountFactionPickers(u: UnitBundle) {
  const el = document.getElementById('factions')!;
  const opts = FACTIONS.map((f) => `<option value="${f.prefix}">${f.name}</option>`).join('');
  el.innerHTML = `
    <label>You <select data-p="0">${opts}</select></label>
    <label>Opponent <select data-p="1">${opts}</select></label>
    <p class="muted">Not drawn yet (3D models): ${u.models.map((m) => m.name).join(', ')}</p>`;
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

let drag: { x: number; y: number } | null = null;
app.canvas.addEventListener('pointerdown', (e) => {
  if (e.button === 0) drag = { x: e.clientX - camera.x, y: e.clientY - camera.y };
});
window.addEventListener('pointerup', () => (drag = null));
window.addEventListener('pointermove', (e) => {
  if (!drag) return;
  camera.x = e.clientX - drag.x;
  camera.y = e.clientY - drag.y;
});
const keys = new Set<string>();
window.addEventListener('keydown', (e) => {
  keys.add(e.key.toLowerCase());
  // F: preview the attack animation on your units (combat itself isn't in the sim yet).
  if (e.key.toLowerCase() === 'f' && !e.repeat) attackQueued = true;
});
let attackQueued = false;
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

// --- Input: right-click moves your units ---------------------------------------

app.canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const r = app.canvas.getBoundingClientRect();
  // Quantize pointer input to whole world pixels before it enters the sim.
  const x = fx(Math.round((e.clientX - r.left - camera.x) / camera.scale.x));
  const y = fx(Math.round((e.clientY - r.top - camera.y) / camera.scale.y));
  const unitIds = world.units.filter((u) => u.owner === LOCAL_PLAYER).map((u) => u.id);
  pending.push({ tick: world.tick + INPUT_DELAY_TICKS, player: LOCAL_PLAYER, cmd: { kind: 'move', unitIds, x, y } });
});

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
    tickEl.textContent = String(world.tick);
    hashEl.textContent = hashWorld(world).toString(16).padStart(8, '0');
  }

  const alpha = acc / TICK_MS;
  fallback.clear();
  for (const u of world.units) {
    const p = prev.units.find((q) => q.id === u.id) ?? u;
    const x = fxToFloat(p.x) + (fxToFloat(u.x) - fxToFloat(p.x)) * alpha;
    const y = fxToFloat(p.y) + (fxToFloat(u.y) - fxToFloat(p.y)) * alpha;
    const type = unitTypes.get(`${unitKind.get(u.id)}@${TEAM_BANK[u.owner]}`);
    if (!type) {
      fallback.circle(x, y, 8).fill(COLORS[u.owner] ?? 0xffffff);
      continue;
    }
    let s = unitSprites.get(u.id);
    if (!s) {
      s = new Sprite(type.frames[4]![type.sprite.idle]!);
      // Feet 5 px above the frame's bottom edge (guess for 32 px frames; 24 px matches the old 0.8 anchor).
      s.anchor.set(0.5, (type.sprite.frame - 5) / type.sprite.frame);
      unitLayer.addChild(s);
      unitSprites.set(u.id, s);
    }
    const a = unitAnim.get(u.id) ?? { state: { mode: 'idle' } as AnimState, row: 4, flip: false };
    const moving = u.x !== p.x || u.y !== p.y;
    if (moving) Object.assign(a, facing(u.x - p.x, u.y - p.y));
    if (attackQueued && u.owner === LOCAL_PLAYER) a.state = attack(animTime);
    const r = animate(type.sprite, a.state, moving, animTime);
    a.state = r.state;
    unitAnim.set(u.id, a);
    s.texture = type.frames[a.row]![r.col]!;
    s.scale.x = a.flip ? -1 : 1;
    s.position.set(Math.round(x), Math.round(y));
    s.zIndex = y;
  }
  attackQueued = false;
  unitLayer.sortableChildren = true;
});

mountRomPanel(document.getElementById('rom') as HTMLInputElement, document.getElementById('rominfo')!, onMap, onUnits);
