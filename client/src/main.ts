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
  type ScheduledCommand,
  type World,
} from '@lbw/sim';
import { FRAME, type HudBundle, type MapBundle, type Rgba } from '@lbw/extract';
import { HudView, drawUnitBars } from './hud';
import { mountRomPanel } from './romPanel';
import { Selection, type Pickable } from './selection';

const LOCAL_PLAYER = 0;
const COLORS = [0xd33b2c, 0x3b6fd3];
/** Palette bank per player: even banks are team colors (0 red, 2 blue); bank + 1 is the same team selected. */
const TEAM_BANK = [0, 2];
/** The sandbox spawns Guardsmen (K_Swordsman, sheet k_mel). */
const SANDBOX_ENTITY = 'K_Swordsman';
/** Until the sim tracks HP, every unit shows full health: the entity's max HP from Entities.ebp. */
let sandboxHp = 0;

let world: World = createWorld({ seed: 1234 });
let prev: World = cloneWorld(world);
const pending: ScheduledCommand[] = [];

function resetWorld(cx: number, cy: number) {
  world = createWorld({ seed: 1234 });
  for (let i = 0; i < 4; i++) spawnUnit(world, 0, fx(cx - 120 + i * 28), fx(cy - 60));
  for (let i = 0; i < 4; i++) spawnUnit(world, 1, fx(cx + 40 + i * 28), fx(cy + 60));
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

/** frames[row][col]: rows are facings (back, back-right, right, front-right, front), cols the walk cycle. */
type Frames = Texture[][];
interface UnitTextures {
  walk: Frames;
  /** One frame per facing row. */
  idle: Texture[];
}
/** Per player: normal, and selected (outlined) from the odd palette bank. */
let teamFrames: { normal: UnitTextures; selected: UnitTextures }[] = [];
const unitSprites = new Map<number, Sprite>();
/** Last facing row per unit, so idle units keep looking where they walked. */
const unitRow = new Map<number, number>();
/** When each walking unit started walking, so its cycle begins at frame 0 like in the game. */
const walkStart = new Map<number, number>();

function cutFrames(sheet: Texture, rows: number, cols: number): Frames {
  return Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) => new Texture({ source: sheet.source, frame: new Rectangle(col * FRAME, row * FRAME, FRAME, FRAME) })),
  );
}

/**
 * The game advances unit animation frames every 4 VBlanks (60/4 = 15 fps),
 * measured in the emulator. Render-side only.
 */
const ANIM_FRAME_MS = (4 * 1000) / 60;

/**
 * Walk cycle for 24 px units, from BP/Animations.abp: the 5 walk frames, then
 * the idle pose as a 6th frame, looped. -1 means "the idle frame for this facing".
 */
const WALK_CYCLE = [0, 1, 2, 3, 4, -1];

function unitTextures(b: MapBundle, bank: number): UnitTextures {
  return {
    walk: cutFrames(textureFrom(b.units[`k_mel_1@${bank}`]!), 5, 5),
    idle: cutFrames(textureFrom(b.units[`k_mel_0@${bank}`]!), 1, 5)[0]!,
  };
}

let sandboxEntity = -1;

function onMap(b: MapBundle, hud: HudBundle) {
  ground.texture = textureFrom(b.ground);
  teamFrames = TEAM_BANK.map((bank) => ({ normal: unitTextures(b, bank), selected: unitTextures(b, bank + 1) }));
  hudView.setBundle(hud);
  sandboxEntity = hudView.entityIndex(SANDBOX_ENTITY);
  sandboxHp = hud.labels[sandboxEntity]?.maxHp ?? 0;
  selection.ids.clear();
  for (const s of unitSprites.values()) s.destroy();
  unitSprites.clear();
  unitRow.clear();
  walkStart.clear();
  resetWorld(b.ground.width / 2, b.ground.height / 2);
  centerOn(b.ground.width / 2, b.ground.height / 2);
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

// --- Input: right-click moves your selected units -------------------------------

app.canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const r = app.canvas.getBoundingClientRect();
  // Quantize pointer input to whole world pixels before it enters the sim.
  const x = fx(Math.round((e.clientX - r.left - camera.x) / camera.scale.x));
  const y = fx(Math.round((e.clientY - r.top - camera.y) / camera.scale.y));
  const unitIds = world.units.filter((u) => u.owner === LOCAL_PLAYER && selection.ids.has(u.id)).map((u) => u.id);
  if (unitIds.length === 0) return;
  pending.push({ tick: world.tick + INPUT_DELAY_TICKS, player: LOCAL_PLAYER, cmd: { kind: 'move', unitIds, x, y } });
});

// --- Loop: fixed-step sim, interpolated render ---------------------------------

const tickEl = document.getElementById('tick')!;
const hashEl = document.getElementById('hash')!;

/** Facing row + mirror from a movement vector (sprites natively face right). */
function facing(dx: number, dy: number): { row: number; flip: boolean } {
  const a = Math.atan2(dy, dx); // render-side only; never feeds the sim
  const oct = Math.round(a / (Math.PI / 4)); // -4..4, 0 = right, 2 = down
  const rowByOct: Record<number, number> = { [-4]: 2, [-3]: 1, [-2]: 0, [-1]: 1, 0: 2, 1: 3, 2: 4, 3: 3, 4: 2 };
  return { row: rowByOct[oct] ?? 4, flip: Math.abs(oct) >= 3 };
}

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
  overlay.clear();
  selection.prune((id) => world.units.some((u) => u.id === id));
  const nextDrawn: Pickable[] = [];
  for (const u of world.units) {
    const p = prev.units.find((q) => q.id === u.id) ?? u;
    const x = fxToFloat(p.x) + (fxToFloat(u.x) - fxToFloat(p.x)) * alpha;
    const y = fxToFloat(p.y) + (fxToFloat(u.y) - fxToFloat(p.y)) * alpha;
    nextDrawn.push({ id: u.id, owner: u.owner, x, y });
    const team = teamFrames[u.owner];
    const isSelected = selection.ids.has(u.id);
    const frames = team && (isSelected ? team.selected : team.normal);
    if (!frames) {
      fallback.circle(x, y, 8).fill(COLORS[u.owner] ?? 0xffffff);
      continue;
    }
    let s = unitSprites.get(u.id);
    if (!s) {
      s = new Sprite(frames.idle[4]!);
      s.anchor.set(0.5, 0.8);
      unitLayer.addChild(s);
      unitSprites.set(u.id, s);
    }
    const moving = u.x !== p.x || u.y !== p.y;
    if (moving) {
      const f = facing(u.x - p.x, u.y - p.y);
      s.scale.x = f.flip ? -1 : 1;
      if (!walkStart.has(u.id)) walkStart.set(u.id, animTime);
      const frame = Math.floor((animTime - walkStart.get(u.id)!) / ANIM_FRAME_MS);
      const col = WALK_CYCLE[frame % WALK_CYCLE.length]!;
      s.texture = col < 0 ? frames.idle[f.row]! : frames.walk[f.row]![col]!;
      unitRow.set(u.id, f.row);
    } else {
      s.texture = frames.idle[unitRow.get(u.id) ?? 4]!;
      walkStart.delete(u.id);
    }
    s.position.set(Math.round(x), Math.round(y));
    s.zIndex = y;
    // The game shows a unit's bars while it is selected.
    if (isSelected) drawUnitBars(overlay, Math.round(x) - FRAME / 2, Math.round(y - FRAME * 0.8), sandboxHp, sandboxHp);
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
  hudView.update({
    // Placeholders until the sim has an economy: the skirmish starting bricks and the population cap seen in the emulator.
    bricks: 500,
    minifigs: mine.length,
    minifigCap: Math.max(4, mine.length),
    star: [0, 0],
    selected: firstSelected && sandboxEntity >= 0 ? { entity: sandboxEntity, hp: sandboxHp } : undefined,
  });
});

mountRomPanel(document.getElementById('rom') as HTMLInputElement, document.getElementById('rominfo')!, onMap);
