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
import { FRAME, type MapBundle, type Rgba } from '@lbw/extract';
import { mountRomPanel } from './romPanel';

const LOCAL_PLAYER = 0;
const COLORS = [0xd33b2c, 0x3b6fd3];
/** Palette bank per player: even banks are team colors (0 red, 2 blue). */
const TEAM_BANK = [0, 2];

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
let teamFrames: Frames[] = [];
const unitSprites = new Map<number, Sprite>();
/** Last facing row per unit, so idle units keep looking where they walked. */
const unitRow = new Map<number, number>();

function cutFrames(sheet: Texture): Frames {
  return Array.from({ length: 5 }, (_, row) =>
    Array.from({ length: 5 }, (_, col) => new Texture({ source: sheet.source, frame: new Rectangle(col * FRAME, row * FRAME, FRAME, FRAME) })),
  );
}

function onMap(b: MapBundle) {
  ground.texture = textureFrom(b.ground);
  teamFrames = TEAM_BANK.map((bank) => cutFrames(textureFrom(b.units[`k_mel_1@${bank}`]!)));
  for (const s of unitSprites.values()) s.destroy();
  unitSprites.clear();
  unitRow.clear();
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
window.addEventListener('keydown', (e) => keys.add(e.key.toLowerCase()));
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
app.canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = app.canvas.getBoundingClientRect();
  const sx = e.clientX - r.left;
  const sy = e.clientY - r.top;
  const wx = (sx - camera.x) / camera.scale.x;
  const wy = (sy - camera.y) / camera.scale.y;
  const s = Math.min(4, Math.max(1, camera.scale.x * (e.deltaY < 0 ? 1.25 : 0.8)));
  camera.scale.set(s);
  camera.x = sx - wx * s;
  camera.y = sy - wy * s;
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
  for (const u of world.units) {
    const p = prev.units.find((q) => q.id === u.id) ?? u;
    const x = fxToFloat(p.x) + (fxToFloat(u.x) - fxToFloat(p.x)) * alpha;
    const y = fxToFloat(p.y) + (fxToFloat(u.y) - fxToFloat(p.y)) * alpha;
    const frames = teamFrames[u.owner];
    if (!frames) {
      fallback.circle(x, y, 8).fill(COLORS[u.owner] ?? 0xffffff);
      continue;
    }
    let s = unitSprites.get(u.id);
    if (!s) {
      s = new Sprite(frames[4]![0]!);
      s.anchor.set(0.5, 0.8);
      unitLayer.addChild(s);
      unitSprites.set(u.id, s);
    }
    const moving = u.x !== p.x || u.y !== p.y;
    if (moving) {
      const f = facing(u.x - p.x, u.y - p.y);
      s.scale.x = f.flip ? -1 : 1;
      s.texture = frames[f.row]![Math.floor(animTime / 120) % 5]!;
      unitRow.set(u.id, f.row);
    } else {
      s.texture = frames[unitRow.get(u.id) ?? 4]![0]!;
    }
    s.position.set(Math.round(x), Math.round(y));
    s.zIndex = y;
  }
  unitLayer.sortableChildren = true;
});

mountRomPanel(document.getElementById('rom') as HTMLInputElement, document.getElementById('rominfo')!, onMap);
