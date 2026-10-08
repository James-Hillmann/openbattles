import {
  BANKS,
  FACTION_PREFIXES,
  GAME_TYPES,
  PROTOCOL_VERSION,
  TEAM_COLORS,
  type GameSettings,
  type GameType,
  type LobbyPlayer,
  type ServerMsg,
} from '@lbw/server/protocol';
import type { ArmyBundle } from '@lbw/extract';
import { RelayClient, type MatchStart } from './match';
import { canvasOf, isStock, type ArmyPick } from './armySelect';

/**
 * Multiplayer screens, following the DS game's wireless screens (docs/re-notes/multiplayer.md):
 * Multiplayer -> Host / Join; the host picks the map and the lobby settings; everyone picks a
 * team color and an army and gets ready; the host launches. The DS finds games by scanning;
 * we join with a room code.
 */

/** Names as the DS shows them. */
export const GAME_NAMES: Record<GameType, string> = { 'hunt-the-hero': 'Hunt the Hero', 'gold-rush': 'LEGO Gold Rush', elimination: 'Elimination' };
/** The DS's help line for each game type (LOC 105, 104, 102). */
export const GAME_HELP: Record<GameType, string> = {
  'hunt-the-hero': "Defeat the enemy's Hero.",
  'gold-rush': 'Collect 10000 LEGO Bricks.',
  elimination: 'Defeat all enemy units.',
};
const FACTION_NAMES: Record<string, string> = { K: 'King', W: 'Wizard', P: 'Pirates', I: 'Imperial', E: 'Astronauts', A: 'Aliens' };
/** Lobby chip colors (approximate team colors: red, blue, green, orange, magenta, grey). */
export const CHIP_RGB = ['#c00000', '#0030c8', '#008000', '#f07000', '#b030b0', '#404040'];

export interface LobbyHooks {
  /** ROM fingerprint (or null without a ROM) and its skirmish maps. */
  rom(): { fingerprint: string; maps: string[] } | null;
  /** The ROM's army data, once loaded. */
  army(): ArmyBundle | null;
  /** The army this player last picked. */
  pick(): ArmyPick | null;
  /** Open the army screen; `done` gets the new pick (or nothing on Back). */
  chooseArmy(done: (p: ArmyPick | null) => void): void;
  /** The match is on: build the world and start ticking. */
  start(relay: RelayClient, start: MatchStart, you: number): void;
  /** Left the room or lost the connection. */
  ended(reason: string): void;
  /** Back to the main menu. */
  back(): void;
}

type LobbyMsg = Extract<ServerMsg, { t: 'lobby' }>;

/**
 * `?relay=` wins, then a build-time VITE_RELAY_URL (client hosted apart from the relay).
 * A production build is served by the relay itself (`npm start`), so it dials its own origin;
 * `npm run dev` dials the separate relay on :8787.
 */
export function defaultRelayUrl(loc: Location, env: { PROD?: boolean; VITE_RELAY_URL?: string } = import.meta.env): string {
  const q = new URLSearchParams(loc.search).get('relay');
  if (q) return q;
  if (env.VITE_RELAY_URL) return env.VITE_RELAY_URL;
  const ws = loc.protocol === 'https:' ? 'wss' : 'ws';
  if (env.PROD) return `${ws}://${loc.host}/relay`;
  return `${ws}://${loc.hostname || 'localhost'}:8787`;
}

/** The faction prefix and army a pick is sent as: a stock army goes as no army at all. */
export function wireArmy(b: ArmyBundle, p: ArmyPick): { faction: string; army: string[] | null } {
  return { faction: b.prefixes[p.army] ?? 'K', army: isStock(b, p) ? null : [...p.units] };
}

export interface Lobby {
  /** Show the lobby (or the Host / Join screen when not in a room). */
  show(): void;
  /** In a match: the room is still open. */
  inGame(): boolean;
  leave(): void;
}

export function mountLobby(el: HTMLElement, hooks: LobbyHooks, relayUrl: string): Lobby {
  let relay: RelayClient | null = null;
  let lobby: LobbyMsg | null = null;
  let inGame = false;
  let note = '';
  let name = 'Player';
  let visible = false;
  try {
    name = localStorage.getItem('ob.name') ?? name;
  } catch {
    /* storage blocked: keep the default */
  }

  const compat = () => `${PROTOCOL_VERSION}/${hooks.rom()?.fingerprint ?? 'none'}`;
  const sendPick = (r: RelayClient) => {
    const b = hooks.army();
    const p = hooks.pick();
    if (b && p) r.send({ t: 'me', ...wireArmy(b, p) });
  };

  const connect = (first: (r: RelayClient) => void) => {
    relay?.socket.close();
    const r = new RelayClient(new WebSocket(relayUrl));
    relay = r;
    note = 'Connecting...';
    render();
    r.socket.addEventListener('close', () => {
      if (relay !== r) return;
      relay = null;
      lobby = null;
      note = inGame ? 'Connection Lost!' : note === 'Connecting...' ? `Can't reach the relay at ${relayUrl}.` : note;
      if (inGame) hooks.ended(note);
      inGame = false;
      render();
    });
    r.on((m) => {
      if (m.t === 'lobby') {
        if (!lobby) sendPick(r);
        lobby = m;
        note = '';
      } else if (m.t === 'error') {
        note = m.message;
        if (!lobby) r.socket.close();
      } else if (m.t === 'kicked') {
        note = 'The host removed you from the game.';
      } else if (m.t === 'start') {
        inGame = true;
        note = '';
        hooks.start(r, m, m.you);
      } else if (m.t === 'peer-left' && inGame) {
        note = `Player ${m.player + 1} has left the game.`;
      } else if (m.t === 'desync') {
        note = `Out of sync at tick ${m.tick}. The game stopped so neither side plays on a different battle.`;
      }
      render();
    });
    void r.opened.then(() => first(r));
  };

  const me = () => lobby?.players.find((p) => p.slot === lobby!.you);
  const isHost = () => !!lobby && lobby.host === lobby.you;
  const set = (patch: Partial<GameSettings>) => lobby && relay?.send({ t: 'settings', settings: { ...lobby.settings, ...patch } });

  /** A player's nine units as small heads (their own army, or their faction's). */
  function armyHeads(p: LobbyPlayer): HTMLElement {
    const box = document.createElement('span');
    box.className = 'minis';
    const b = hooks.army();
    if (!b) {
      box.textContent = FACTION_NAMES[p.faction] ?? p.faction;
      return box;
    }
    const stock = Object.entries(b.prefixes).find(([, pre]) => pre === p.faction)?.[0] ?? 'King';
    for (const n of p.army ?? b.armies[stock]!.units) {
      const c = canvasOf(b.heads[n]);
      c.title = b.units[n]?.name ?? n;
      box.appendChild(c);
    }
    return box;
  }

  function render() {
    if (!visible || inGame) return;
    const yes = (b: boolean) => (b ? 'Yes' : 'No');
    if (!lobby) {
      el.innerHTML = `
        <div class="screen" style="width:min(640px,100%)">
          <h1>Multiplayer</h1>
          <div class="panel">
            <div class="row"><label>Name <input type="text" id="mpName" maxlength="10" size="10" value="${esc(name)}" /></label></div>
            <div class="row" style="margin-top:14px">
              <button class="brick" id="mpHost">Host</button>
              <span class="muted">or</span>
              <input type="text" id="mpCode" maxlength="4" size="5" placeholder="CODE" style="text-transform:uppercase;letter-spacing:4px" />
              <button class="brick" id="mpJoin">Join</button>
            </div>
            <p class="muted" style="text-align:center">Both players need the same ROM dump loaded${hooks.rom() ? '' : ' (or none, for the bare test field)'}.</p>
            ${note ? `<p class="err" id="mpNote" style="text-align:center">${esc(note)}</p>` : ''}
          </div>
          <div class="row spread"><button class="brick small" id="mpBack">&#x2190; Back</button></div>
        </div>`;
      const nameEl = el.querySelector<HTMLInputElement>('#mpName')!;
      const keepName = () => {
        name = nameEl.value.trim() || 'Player';
        try {
          localStorage.setItem('ob.name', name);
        } catch {
          /* ignore */
        }
      };
      nameEl.addEventListener('change', keepName);
      el.querySelector('#mpHost')!.addEventListener('click', () => {
        keepName();
        connect((r) => r.send({ t: 'host', name, rom: compat() }));
      });
      el.querySelector('#mpJoin')!.addEventListener('click', () => {
        keepName();
        const code = el.querySelector<HTMLInputElement>('#mpCode')!.value.trim().toUpperCase();
        if (code) connect((r) => r.send({ t: 'join', code, name, rom: compat() }));
      });
      el.querySelector('#mpBack')!.addEventListener('click', () => {
        visible = false;
        hooks.back();
      });
      return;
    }

    const l = lobby;
    const s = l.settings;
    const mine = me();
    const maps = hooks.rom()?.maps ?? [];
    const host = isHost();
    // Top screen on the DS: the settings summary.
    const summary = `
      <table class="mpSummary">
        <tr><td>Game</td><td>${GAME_NAMES[s.game]}</td></tr>
        <tr><td>Map</td><td>${esc(maps.length ? s.map : 'bare test field')}</td></tr>
        <tr><td>Random Start</td><td>${yes(s.randomStart)}</td></tr>
        <tr><td>Prebase</td><td>${yes(s.prebase)}</td></tr>
        <tr><td>Bank</td><td>${s.bank}</td></tr>
      </table>`;
    const settings = host
      ? `<div class="row">${GAME_TYPES.map((g) => `<button data-game="${g}" class="opt ${s.game === g ? 'on' : ''}">${GAME_NAMES[g]}</button>`).join('')}</div>
         <p class="help muted">${GAME_HELP[s.game]}</p>
         <div class="row">
          ${maps.length ? `<label>Map <select id="mpMap">${maps.map((m) => `<option ${m === s.map ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label>` : ''}
          <button id="mpRandom" class="opt ${s.randomStart ? 'on' : ''}">Random Start</button>
          <button id="mpPrebase" class="opt ${s.prebase ? 'on' : ''}">Prebase</button>
          <button id="mpBank" class="opt">Bank ${s.bank}</button>
         </div>`
      : `<p class="help muted">${GAME_HELP[s.game]}</p>`;
    const chips = Array.from({ length: TEAM_COLORS }, (_, c) => {
      const owner = l.players.find((p) => p.color === c);
      return `<button class="chip big" data-color="${c}" style="background:${CHIP_RGB[c]}" title="Team color">${owner ? owner.slot + 1 : ''}</button>`;
    }).join('');
    const canLaunch = l.players.length >= 2 && l.players.every((p) => p.slot === l.host || p.ready);
    el.innerHTML = `
      <div class="screen">
        <h1>Game Lobby</h1>
        <div class="lobby">
          <div class="panel">
            <h2>Room code</h2>
            <div class="row"><span id="mpRoom" class="code">${esc(l.code)}</span><span class="muted">${l.players.length}/${l.maxPlayers}</span></div>
            ${summary}
          </div>
          <div class="panel">${settings}</div>
        </div>
        <div class="panel">
          <table id="mpPlayers" style="width:100%;border-collapse:collapse"></table>
          <div class="row" style="margin-top:10px">${chips}</div>
        </div>
        <div class="row spread">
          <button class="brick small" id="mpLeave">&#x2190; Leave</button>
          <span>
            ${hooks.army() ? `<button class="brick" id="mpArmy">Army</button>` : `<select id="mpFaction">${FACTION_PREFIXES.map((f) => `<option value="${f}" ${mine?.faction === f ? 'selected' : ''}>${FACTION_NAMES[f]}</option>`).join('')}</select>`}
            ${
              host
                ? `<button class="brick red" id="mpLaunch" ${canLaunch ? '' : 'disabled'}>Launch</button>`
                : `<button class="brick ${mine?.ready ? '' : 'red'}" id="mpReady">${mine?.ready ? 'Not Ready' : 'Ready'}</button>`
            }
          </span>
        </div>
        ${note ? `<p class="err" id="mpNote" style="text-align:center">${esc(note)}</p>` : host && l.players.length < 2 ? '<p class="muted" style="text-align:center">Waiting... Tell your friend the room code.</p>' : ''}
      </div>`;
    const table = el.querySelector('#mpPlayers')!;
    for (const p of l.players) {
      const tr = document.createElement('tr');
      tr.dataset.slot = String(p.slot);
      tr.innerHTML = `<td style="width:30px"><span class="chip" style="background:${CHIP_RGB[p.color]}"></span></td>
        <td style="width:140px">${esc(p.name)}${p.slot === l.you ? ' (you)' : ''}</td><td class="army"></td>
        <td style="width:90px">${p.slot === l.host ? 'Host' : p.ready ? 'Ready' : 'Not Ready'}</td>
        <td style="width:90px">${host && p.slot !== l.you ? `<button class="brick small" data-kick="${p.slot}">Remove</button>` : ''}</td>`;
      tr.querySelector('.army')!.appendChild(armyHeads(p));
      table.appendChild(tr);
    }

    el.querySelectorAll<HTMLButtonElement>('[data-game]').forEach((b) => b.addEventListener('click', () => set({ game: b.dataset.game as GameType })));
    el.querySelector<HTMLSelectElement>('#mpMap')?.addEventListener('change', (e) => set({ map: (e.target as HTMLSelectElement).value }));
    el.querySelector('#mpRandom')?.addEventListener('click', () => set({ randomStart: !s.randomStart }));
    el.querySelector('#mpPrebase')?.addEventListener('click', () => set({ prebase: !s.prebase }));
    // The DS cycles 500 -> 1000 -> 2500 on each tap.
    el.querySelector('#mpBank')?.addEventListener('click', () => set({ bank: BANKS[(BANKS.indexOf(s.bank) + 1) % BANKS.length]! }));
    el.querySelectorAll<HTMLButtonElement>('[data-color]').forEach((b) => b.addEventListener('click', () => relay?.send({ t: 'me', color: Number(b.dataset.color) })));
    el.querySelectorAll<HTMLButtonElement>('[data-kick]').forEach((b) => b.addEventListener('click', () => relay?.send({ t: 'kick', slot: Number(b.dataset.kick) })));
    el.querySelector<HTMLSelectElement>('#mpFaction')?.addEventListener('change', (e) => relay?.send({ t: 'me', faction: (e.target as HTMLSelectElement).value }));
    el.querySelector('#mpArmy')?.addEventListener('click', () => {
      visible = false;
      hooks.chooseArmy((p) => {
        visible = true;
        if (p && relay) sendPick(relay);
        render();
      });
    });
    el.querySelector('#mpReady')?.addEventListener('click', () => relay?.send({ t: 'me', ready: !mine?.ready }));
    el.querySelector('#mpLaunch')?.addEventListener('click', () => relay?.send({ t: 'launch' }));
    el.querySelector('#mpLeave')!.addEventListener('click', leave);
  }

  function leave() {
    const wasInGame = inGame;
    inGame = false;
    const r = relay;
    relay = null;
    lobby = null;
    note = '';
    r?.socket.close();
    if (wasInGame) {
      // Quitting a match goes back to the main menu, not the Host / Join screen.
      visible = false;
      hooks.ended('');
    }
    render();
  }

  return {
    show() {
      visible = true;
      render();
    },
    inGame: () => inGame,
    leave,
  };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
