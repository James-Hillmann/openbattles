# OpenBattles

An unofficial browser reimplementation of LEGO Battles (DS, 2009) with 1v1 online play.
Behavior is reverse-engineered and rebuilt in TypeScript; nothing from the
original game ships in this repo. **You load your own ROM dump in the browser**
and assets are extracted locally.

## Quick start

```sh
npm install
npm run dev        # client at http://localhost:5173
npm run server     # relay at ws://localhost:8787
npm test           # unit + determinism tests
npm run typecheck
npm run m0 -- path/to/your.nds   # M0 recon: unpack into ./out (gitignored)
```

## Layout

| dir | what |
|---|---|
| `client/` | Vite app: Pixi renderer, input, ROM loader (worker) |
| `sim/` | Pure deterministic simulation. No DOM, no Pixi, no floats in game logic |
| `server/` | Node WebSocket relay: rooms, input forwarding, hash comparison |
| `extract/` | ROM unpacking + format decoders. Runs in a Web Worker and in Node |
| `docs/re-notes/` | Reverse-engineering findings, function map, formats |
| `tests/` | Vitest: unit, determinism replays, repo hygiene |

## Rules

1. **Determinism.** `/sim` uses Q16.16 fixed point (`sim/src/fixed.ts`), the seeded RNG
   in world state, and arrays sorted by id. No `Math.random`, `Date.now`, trig, or
   `for..in`. `tests/sim/purity.test.ts` enforces the obvious ones.
2. **Sim/render split.** The client reads sim state and interpolates; it never writes to it
   except via commands.
3. **Fixed tick** (`TICK_HZ`, currently 15) with inputs scheduled `INPUT_DELAY_TICKS` ahead.
4. **Desync detection.** Clients send `hashWorld()` every `HASH_INTERVAL_TICKS`; the relay
   broadcasts `desync` on mismatch.
5. **No game data in git.** `.gitignore` covers ROMs and `out/`;
   `tests/repo-hygiene.test.ts` fails on anything that looks like a ROM or Nitro asset.

## Milestones

- **M0 Recon** (done): see [docs/re-notes/m0-recon.md](docs/re-notes/m0-recon.md) and [formats.md](docs/re-notes/formats.md)
- **M1 Assets** (in progress): load your ROM in the sidebar, pick a map and two factions, and all 36 sprite units walk on it. Still missing: 3D-model units (siege, flyers, ships)
- M2 Sandbox: gather, build, train, move, attack
- M3 Lockstep: two browsers in one room, in sync
- M4 Faithful rules for one faction
- M5 Full skirmish

## Legal

OpenBattles is an unofficial fan project, not affiliated with or endorsed by the LEGO Group,
Warner Bros. Games, TT Games, Hellbent Games, or Nintendo. It contains no game code or assets;
you need your own legally obtained copy of the game.
