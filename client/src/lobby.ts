import {
  BANKS,
  FACTION_PREFIXES,
  GAME_TYPES,
  PROTOCOL_VERSION,
  TEAM_COLORS,
  type GameSettings,
  type GameType,
  type ServerMsg,
} from '@lbw/server/protocol';
import { RelayClient, type MatchStart } from './match';

/**
 * Multiplayer sidebar panel, following the DS game's wireless screens
 * (docs/re-notes/multiplayer.md): Multiplayer -> Host / Join; the host picks the map
 * and the lobby settings; everyone picks a team color (and here, a faction) and gets
 * ready; the host launches. The DS finds games by scanning; we join with a room code.
 */

/** Names as the DS shows them. */
const GAME_NAMES: Record<GameType, string> = { 'hunt-the-hero': 'Hunt the Hero', 'gold-rush': 'LEGO Gold Rush', elimination: 'Elimination' };
/** Our own wording of what each mode is for. */
const GAME_HELP: Record<GameType, string> = {
  'hunt-the-hero': "Win by beating the other side's hero.",
  'gold-rush': 'Win by banking 10000 bricks first.',
  elimination: 'Win by wiping out every enemy unit.',
};
const FACTION_NAMES: Record<string, string> = { K: 'King', W: 'Wizard', P: 'Pirates', I: 'Imperial', E: 'Astronauts', A: 'Aliens' };
/** Lobby chip colors (approximate team colors: red, blue, green, orange, magenta, grey). */
export const CHIP_RGB = ['#c00000', '#0030c8', '#008000', '#f07000', '#b030b0', '#404040'];

export interface LobbyHooks {
  /** ROM fingerprint (or null without a ROM) and its skirmish maps. */
  rom(): { fingerprint: string; maps: string[] } | null;
  /** The match is on: build the world and start ticking. */
  start(relay: RelayClient, start: MatchStart, you: number): void;
  /** Left the room or lost the connection. */
  ended(reason: string): void;
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

export function mountLobby(el: HTMLElement, hooks: LobbyHooks, relayUrl: string): void {
  let relay: RelayClient | null = null;
  let lobby: LobbyMsg | null = null;
  let inGame = false;
  let note = '';
  let name = 'Player';
  try {
    name = localStorage.getItem('ob.name') ?? name;
  } catch {
    /* storage blocked: keep the default */
  }

  const compat = () => `${PROTOCOL_VERSION}/${hooks.rom()?.fingerprint ?? 'none'}`;

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

  function render() {
    const yes = (b: boolean) => (b ? 'Yes' : 'No');
    if (!lobby) {
      el.innerHTML = `
        <label>Name <input id="mpName" maxlength="10" size="10" value="${esc(name)}" /></label>
        <p><button id="mpHost">Host</button>
        <input id="mpCode" maxlength="4" size="5" placeholder="Code" style="text-transform:uppercase" />
        <button id="mpJoin">Join</button></p>
        <p class="muted">Both players need the same ROM dump loaded${hooks.rom() ? '' : ' (or none, for the bare test field)'}.</p>
        ${note ? `<p class="err" id="mpNote">${esc(note)}</p>` : ''}`;
      const nameEl = el.querySelector<HTMLInputElement>('#mpName')!;
      nameEl.addEventListener('change', () => {
        name = nameEl.value.trim() || 'Player';
        try {
          localStorage.setItem('ob.name', name);
        } catch {
          /* ignore */
        }
      });
      el.querySelector('#mpHost')!.addEventListener('click', () => {
        name = nameEl.value.trim() || name;
        connect((r) => {
          r.send({ t: 'host', name, rom: compat() });
        });
      });
      el.querySelector('#mpJoin')!.addEventListener('click', () => {
        name = nameEl.value.trim() || name;
        const code = el.querySelector<HTMLInputElement>('#mpCode')!.value.trim().toUpperCase();
        if (code) connect((r) => r.send({ t: 'join', code, name, rom: compat() }));
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
    if (inGame) {
      el.innerHTML = `<p>Room <code>${esc(l.code)}</code></p>${summary}
        <p id="mpNote" class="${note ? 'err' : 'muted'}">${esc(note || 'Playing.')}</p>
        <p><button id="mpLeave">Leave</button></p>`;
      el.querySelector('#mpLeave')!.addEventListener('click', leave);
      return;
    }
    const settings = host
      ? `<div class="mpSettings">
          ${GAME_TYPES.map((g) => `<button data-game="${g}" class="${s.game === g ? 'on' : ''}">${GAME_NAMES[g]}</button>`).join('')}
          <p class="muted">${GAME_HELP[s.game]} (Win conditions aren't in the sim yet.)</p>
          ${maps.length ? `<label>Map <select id="mpMap">${maps.map((m) => `<option ${m === s.map ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label>` : ''}
          <button id="mpRandom" class="${s.randomStart ? 'on' : ''}">Random Start</button>
          <button id="mpPrebase" class="${s.prebase ? 'on' : ''}">Prebase</button>
          <button id="mpBank">Bank ${s.bank}</button>
        </div>`
      : '';
    const rows = l.players
      .map(
        (p) => `<tr data-slot="${p.slot}"><td><span class="chip" style="background:${CHIP_RGB[p.color]}"></span></td>
          <td>${esc(p.name)}${p.slot === l.you ? ' (you)' : ''}</td><td>${FACTION_NAMES[p.faction] ?? p.faction}</td>
          <td>${p.slot === l.host ? 'Host' : p.ready ? 'Ready' : 'Not Ready'}</td>
          <td>${host && p.slot !== l.you ? `<button data-kick="${p.slot}">Remove</button>` : ''}</td></tr>`,
      )
      .join('');
    const chips = Array.from({ length: TEAM_COLORS }, (_, c) => {
      const owner = l.players.find((p) => p.color === c);
      return `<button class="chip big" data-color="${c}" style="background:${CHIP_RGB[c]}" title="Team color">${owner ? owner.slot + 1 : ''}</button>`;
    }).join('');
    const canLaunch = l.players.length >= 2 && l.players.every((p) => p.slot === l.host || p.ready);
    el.innerHTML = `
      <p>Room code <code id="mpRoom" class="big">${esc(l.code)}</code> <span class="muted">${l.players.length}/${l.maxPlayers}</span></p>
      ${summary}${settings}
      <h3>Game Lobby</h3>
      <table id="mpPlayers">${rows}</table>
      <p>${chips}</p>
      <label>Army <select id="mpFaction">${FACTION_PREFIXES.map((f) => `<option value="${f}" ${mine?.faction === f ? 'selected' : ''}>${FACTION_NAMES[f]}</option>`).join('')}</select></label>
      <p>${
        host
          ? `<button id="mpLaunch" ${canLaunch ? '' : 'disabled'}>Launch</button> ${l.players.length < 2 ? '<span class="muted">Waiting...</span>' : ''}`
          : `<button id="mpReady">${mine?.ready ? 'Not Ready' : 'Ready'}</button>`
      } <button id="mpLeave">Leave</button></p>
      ${note ? `<p class="err" id="mpNote">${esc(note)}</p>` : ''}`;

    el.querySelectorAll<HTMLButtonElement>('[data-game]').forEach((b) => b.addEventListener('click', () => set({ game: b.dataset.game as GameType })));
    el.querySelector<HTMLSelectElement>('#mpMap')?.addEventListener('change', (e) => set({ map: (e.target as HTMLSelectElement).value }));
    el.querySelector('#mpRandom')?.addEventListener('click', () => set({ randomStart: !s.randomStart }));
    el.querySelector('#mpPrebase')?.addEventListener('click', () => set({ prebase: !s.prebase }));
    // The DS cycles 500 -> 1000 -> 2500 on each tap.
    el.querySelector('#mpBank')?.addEventListener('click', () => set({ bank: BANKS[(BANKS.indexOf(s.bank) + 1) % BANKS.length]! }));
    el.querySelectorAll<HTMLButtonElement>('[data-color]').forEach((b) => b.addEventListener('click', () => relay?.send({ t: 'me', color: Number(b.dataset.color) })));
    el.querySelectorAll<HTMLButtonElement>('[data-kick]').forEach((b) => b.addEventListener('click', () => relay?.send({ t: 'kick', slot: Number(b.dataset.kick) })));
    el.querySelector<HTMLSelectElement>('#mpFaction')!.addEventListener('change', (e) => relay?.send({ t: 'me', faction: (e.target as HTMLSelectElement).value }));
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
    if (wasInGame) hooks.ended('');
    render();
  }

  render();
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
