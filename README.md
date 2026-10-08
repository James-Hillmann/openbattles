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
npm run e2e        # two browser tabs play one online match (OB_ROM=your.nds to use your dump)
npm run m0 -- path/to/your.nds   # M0 recon: unpack into ./out (gitignored)
```

## Play online

Host one server that serves the page and the relay, then share the link: see
[docs/hosting.md](docs/hosting.md) (free Render service, or your own machine through a
Cloudflare quick tunnel).

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
3. **Fixed tick** (`TICK_HZ`, currently 30) with inputs scheduled `INPUT_DELAY_TICKS` ahead.
4. **Desync detection.** Clients send `hashWorld()` every `HASH_INTERVAL_TICKS`; the relay
   broadcasts `desync` on mismatch and both clients stop.
5. **Lockstep.** Every player sends one input per tick (`sim/src/lockstep.ts`); a tick runs only
   when all inputs for it are in. Commands from the wire go through `sanitizeCommand`. Bump
   `PROTOCOL_VERSION` (server/src/protocol.ts) when sim rules change, so old and new builds
   don't get paired.
6. **No game data in git.** `.gitignore` covers ROMs and `out/`;
   `tests/repo-hygiene.test.ts` fails on anything that looks like a ROM or Nitro asset.

## Milestones

- **M0 Recon** (done): see [docs/re-notes/m0-recon.md](docs/re-notes/m0-recon.md) and [formats.md](docs/re-notes/formats.md)
- **M1 Assets** (in progress): load your ROM in the sidebar, pick a map and two factions, and every unit of both factions walks on it: 36 sprite units plus 24 drawn from the game's 3D models (siege, flyers, ships, the Giant). Ships still walk on land until the sim knows water
- M2 Sandbox: gather, build, train, move, attack
- **M3 Lockstep** (done): Host or join a room by code, pick team color and army, ready up,
  launch; both browsers run the same match. See [docs/re-notes/multiplayer.md](docs/re-notes/multiplayer.md).
  To try it: `npm run server` and `npm run dev`, open two tabs, Host in one, Join with the code
  in the other. Point the client at another relay with `?relay=wss://host:port`.
- M4 Faithful rules for one faction
- M5 Full skirmish

## Legal

OpenBattles is an unofficial fan project, not affiliated with or endorsed by the LEGO Group,
Warner Bros. Games, TT Games, Hellbent Games, or Nintendo. It contains no game code or assets;
you need your own legally obtained copy of the game.
