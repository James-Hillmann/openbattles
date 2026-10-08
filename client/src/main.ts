import { Application, Graphics } from 'pixi.js';
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
import { mountRomPanel } from './romPanel';

const LOCAL_PLAYER = 0;
const COLORS = [0x3b82f6, 0xef4444];

const world = createWorld({ seed: 1234 });
for (let i = 0; i < 4; i++) spawnUnit(world, 0, fx(80 + i * 24), fx(120));
for (let i = 0; i < 4; i++) spawnUnit(world, 1, fx(400 + i * 24), fx(300));
let prev: World = cloneWorld(world);

/** Commands waiting for their tick. In M3 these arrive from the relay too. */
const pending: ScheduledCommand[] = [];

const app = new Application();
await app.init({ resizeTo: document.getElementById('stage')!, background: 0x1d2a1d, antialias: true });
document.getElementById('stage')!.appendChild(app.canvas);

app.canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const r = app.canvas.getBoundingClientRect();
  // Quantize pointer input to whole sim units before it enters the sim.
  const x = fx(Math.round(e.clientX - r.left));
  const y = fx(Math.round(e.clientY - r.top));
  const unitIds = world.units.filter((u) => u.owner === LOCAL_PLAYER).map((u) => u.id);
  pending.push({ tick: world.tick + INPUT_DELAY_TICKS, player: LOCAL_PLAYER, cmd: { kind: 'move', unitIds, x, y } });
});

const gfx = new Graphics();
app.stage.addChild(gfx);
const tickEl = document.getElementById('tick')!;
const hashEl = document.getElementById('hash')!;

// Fixed-timestep sim, variable-rate render with interpolation between ticks.
let acc = 0;
app.ticker.add((t) => {
  acc += t.deltaMS;
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
  gfx.clear();
  for (const u of world.units) {
    const p = prev.units.find((q) => q.id === u.id) ?? u;
    const x = fxToFloat(p.x) + (fxToFloat(u.x) - fxToFloat(p.x)) * alpha;
    const y = fxToFloat(p.y) + (fxToFloat(u.y) - fxToFloat(p.y)) * alpha;
    gfx.circle(x, y, 8).fill(COLORS[u.owner] ?? 0xffffff);
  }
});

mountRomPanel(document.getElementById('rom') as HTMLInputElement, document.getElementById('rominfo')!);
