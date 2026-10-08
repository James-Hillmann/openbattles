import { Application, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import {
  INPUT_DELAY_TICKS,
  NEVER,
  TICK_MS,
  cloneWorld,
  createWorld,
  fx,
  fxToFloat,
  hashWorld,
  spawnUnit,
  step,
  type MeleeBonusTable,
  type ScheduledCommand,
  type UnitType,
  type World,
} from '@lbw/sim';
import { FRAME, type MapBundle, type Rgba, type UnitStats } from '@lbw/extract';
import { mountRomPanel } from './romPanel';

const LOCAL_PLAYER = 0;
const COLORS = [0xd33b2c, 0x3b6fd3];
/** Palette bank per player: even banks are team colors (0 red, 2 blue). */
const TEAM_BANK = [0, 2];

let world: World = createWorld({ seed: 1234 });
let prev: World = cloneWorld(world);
const pending: ScheduledCommand[] = [];

function unitType(s: UnitStats | undefined): UnitType {
  if (!s) return {};
  const { index, speed, hp, damage, damageRand, cooldown, minRange, maxRange, sight, projectile } = s;
  return { kind: index, speed, hp, attack: { damage, damageRand, cooldown, minRange, maxRange, sight, projectile } };
}

function resetWorld(cx: number, cy: number, type: UnitType = {}, bonus: MeleeBonusTable | null = null) {
  world = createWorld({ seed: 1234, bonus });
  // Two squads far enough apart (more than 5 cells, the sight radius) that nobody fights until ordered.
  for (let i = 0; i < 4; i++) spawnUnit(world, 0, fx(cx - 120 + i * 28), fx(cy - 60), type);
  for (let i = 0; i < 4; i++) spawnUnit(world, 1, fx(cx + 40 + i * 28), fx(cy + 60), type);
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
fallback.zIndex = 1e9; // projectiles and health bars draw over sprites

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
  attack: Frames;
  /** One frame per facing row. */
  idle: Texture[];
}
let teamFrames: UnitTextures[] = [];
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
/** Attack: same shape, played once from the tick the hit lands (docs/re-notes/combat.md). */
const ATTACK_CYCLE = [0, 1, 2, 3, 4, -1];
/** Sim ticks per animation frame: 30 Hz sim, 15 fps animation. */
const TICKS_PER_FRAME = 2;

function onMap(b: MapBundle) {
  ground.texture = textureFrom(b.ground);
  teamFrames = TEAM_BANK.map((bank) => ({
    walk: cutFrames(textureFrom(b.units[`k_mel_1@${bank}`]!), 5, 5),
    attack: cutFrames(textureFrom(b.units[`k_mel_2@${bank}`]!), 5, 5),
    idle: cutFrames(textureFrom(b.units[`k_mel_0@${bank}`]!), 1, 5)[0]!,
  }));
  for (const s of unitSprites.values()) s.destroy();
  unitSprites.clear();
  unitRow.clear();
  walkStart.clear();
  resetWorld(b.ground.width / 2, b.ground.height / 2, unitType(b.stats['k_mel']), b.combatBonus);
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
  // Whole-number zoom only, so every game pixel stays a crisp square like on the DS.
  const s = Math.min(4, Math.max(1, Math.round(camera.scale.x) + (e.deltaY < 0 ? 1 : -1)));
  camera.scale.set(s);
  camera.x = Math.round(sx - wx * s);
  camera.y = Math.round(sy - wy * s);
});

// --- Input: right-click an enemy to attack it, anywhere else to move ----------

app.canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const r = app.canvas.getBoundingClientRect();
  // Quantize pointer input to whole world pixels before it enters the sim.
  const px = Math.round((e.clientX - r.left - camera.x) / camera.scale.x);
  const py = Math.round((e.clientY - r.top - camera.y) / camera.scale.y);
  const unitIds = world.units.filter((u) => u.owner === LOCAL_PLAYER).map((u) => u.id);
  // Sprites are 24x24 anchored near the feet, so hit-test that box.
  const enemy = world.units.find(
    (u) => u.owner !== LOCAL_PLAYER && Math.abs(fxToFloat(u.x) - px) <= 12 && fxToFloat(u.y) - py <= 19 && py - fxToFloat(u.y) <= 5,
  );
  const cmd = enemy ? { kind: 'attack' as const, unitIds, target: enemy.id } : { kind: 'move' as const, unitIds, x: fx(px), y: fx(py) };
  pending.push({ tick: world.tick + INPUT_DELAY_TICKS, player: LOCAL_PLAYER, cmd });
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
  for (const [id, s] of unitSprites) {
    if (world.units.some((u) => u.id === id)) continue;
    s.destroy();
    unitSprites.delete(id);
  }
  for (const p of world.projectiles) fallback.circle(fxToFloat(p.x), fxToFloat(p.y) - 8, 1.5).fill(0xffffff);
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
      s = new Sprite(frames.idle[4]!);
      s.anchor.set(0.5, 0.8);
      unitLayer.addChild(s);
      unitSprites.set(u.id, s);
    }
    const moving = u.x !== p.x || u.y !== p.y;
    const attackFrame = u.lastAttack === NEVER ? -1 : Math.floor((world.tick - 1 - u.lastAttack + alpha) / TICKS_PER_FRAME);
    const target = u.target === null ? undefined : world.units.find((t) => t.id === u.target);
    if (attackFrame >= 0 && attackFrame < ATTACK_CYCLE.length) {
      const f = target ? facing(target.x - u.x, target.y - u.y) : { row: unitRow.get(u.id) ?? 4, flip: s.scale.x < 0 };
      s.scale.x = f.flip ? -1 : 1;
      const col = ATTACK_CYCLE[attackFrame]!;
      s.texture = col < 0 ? frames.idle[f.row]! : frames.attack[f.row]![col]!;
      unitRow.set(u.id, f.row);
      walkStart.delete(u.id);
    } else if (moving) {
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
    if (u.hp < u.maxHp) {
      // Placeholder health bar until the HUD work draws the game's own.
      const w = 14;
      fallback.rect(Math.round(x) - w / 2, Math.round(y) - 22, w, 2).fill(0x202020);
      fallback.rect(Math.round(x) - w / 2, Math.round(y) - 22, Math.max(1, Math.round((w * u.hp) / u.maxHp)), 2).fill(0x5ad35a);
    }
  }
  unitLayer.sortableChildren = true;
});

mountRomPanel(document.getElementById('rom') as HTMLInputElement, document.getElementById('rominfo')!, onMap);
