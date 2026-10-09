/**
 * Play a computer opponent on a real map, headless, and print what it does: every unit and building
 * it gets, with the tick, plus its bricks now and then. For comparing with the game in DeSmuME
 * (docs/re-notes/ai.md "Checking against the game").
 *
 *   npx tsx tools/ai/run.ts your.nds [map=mp01] [ticks=6000] [you=King] [cpu=Wizard] [--both]
 *
 * Player 0 (you) stays idle unless --both, which makes both players computers.
 */
import { readFileSync } from 'node:fs';
import { buildArmyBundle, buildMapBundle, buildUnitBundle, tryRomFile, unpackRom, type UnitStats } from '../../extract/src/index';
import { addAi, createSkirmish, getPlayer, step, type EntityType, type World } from '../../sim/src/index';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const both = process.argv.includes('--both');
const [romPath, mapName = 'mp01', ticksArg = '6000', youArmy = 'King', cpuArmy = 'Wizard'] = args;
if (!romPath) throw new Error('usage: run.ts rom.nds [map] [ticks] [you] [cpu] [--both]');

const rom = unpackRom(new Uint8Array(readFileSync(romPath)));
const army = buildArmyBundle(rom);
const units = buildUnitBundle((p) => tryRomFile(rom, p), [0, 1, 2, 3]);
const map = buildMapBundle(rom, mapName);
const stats = units.stats;
const byIndex = new Map(Object.values(stats).map((s) => [s.index, s]));

function simType(s: UnitStats): EntityType {
  const faction = /^[KWPIEA]_/.test(s.name) ? s.name[0] : undefined;
  return {
    kind: s.index, speed: s.speed, hp: s.hp, priority: s.priority, moves: s.moves, layer: s.layer, role: s.role, cost: s.cost, buildTime: s.buildTime,
    size: s.size, sight: s.sight, yield: s.yield, ...(faction ? { faction } : {}), charge: s.charge, spells: s.spells,
    attack: { damage: s.damage, damageRand: s.damageRand, cooldown: s.cooldown, minRange: s.minRange, maxRange: s.maxRange, sight: s.sight, projectile: s.projectile },
  };
}

const types: (EntityType | undefined)[] = [];
for (const s of Object.values(stats)) types[s.index] = simType(s);
const picks = [youArmy, cpuArmy].map((a) => army.armies[a]!);
const prefix = [youArmy, cpuArmy].map((a) => army.prefixes[a]!);
const w: World = createSkirmish(
  { seed: 1234, grid: { width: map.width, height: map.height, cells: map.terrain.slice() }, bonus: map.combatBonus ?? null, types, mineSites: map.mineSites.map((m) => m.y * map.width + m.x), spellDefs: army.spells },
  map.starts,
  {
    prebuilt: false,
    rules: { mode: 0 },
    bricks: 500,
    slots: [0, 1],
    armies: picks.map((p, i) => ({ units: p.units.map((n) => stats[n]?.index ?? -1), base: prefix[i]! })),
    typeFor: (p, role, index) => {
      const list = role < 7 ? picks[p]!.units.map((n) => stats[n]).filter((s): s is UnitStats => !!s && s.role === role) : Object.values(stats).filter((s) => s.name.startsWith(`${prefix[p]}_`) && s.role === role).sort((a, b) => a.index - b.index);
      const st = list[index];
      return st ? simType(st) : null;
    },
  },
);
const marks = map.forestMarks.map((m) => m.y * map.width + m.x);
const towers = map.towerMarks.map((m) => m.y * map.width + m.x);
addAi(w, 1, 0, marks, towers);
if (both) addAi(w, 0, 1, marks, towers);

const seen = new Set<number>();
const ticks = Number(ticksArg);
const cellOf = (u: { x: number; y: number }) => `(${Math.floor(u.x / 65536 / 24)},${Math.floor(u.y / 65536 / 16)})`;
for (let t = 0; t < ticks; t++) {
  step(w, []);
  for (const u of w.units) {
    if (seen.has(u.id)) continue;
    seen.add(u.id);
    if (t > 0) console.log(`${w.tick} P${u.owner} ${byIndex.get(u.kind)?.name ?? u.kind} ${cellOf(u)}`);
  }
  if (w.tick % 600 === 0) {
    const s = w.players.map((p) => `P${p.id} ${p.bricks}b ${w.units.filter((u) => u.owner === p.id).length}u`).join('  ');
    const ai = w.ai.find((a) => a.player === 1)!;
    console.log(`== ${w.tick} ${s}  squads ${ai.squads.map((q) => `${q.id}:j${q.job}s${q.state}n${q.units.length}`).join(' ')} plan ${ai.res.plan.kind}`);
  }
  if (w.players.some((p) => p.status !== 0)) {
    console.log(`game over at ${w.tick}: ${w.players.map((p) => `P${p.id} status ${p.status}`).join(', ')}`);
    break;
  }
}
console.log(getPlayer(w, 1));
// Where each squad's units are at the end, and what they're doing.
for (const q of w.ai.find((a) => a.player === 1)!.squads) {
  const us = q.units.map((id) => w.units.find((u) => u.id === id)).filter((u) => u !== undefined);
  console.log(`squad ${q.id} job ${q.job} state ${q.state} goal ${q.goal}: ${us.map((u) => `${byIndex.get(u.kind)?.name}${cellOf(u)}${u.tx === null ? '' : '>'}${u.target === null ? '' : '!'}`).join(' ')}`);
}
