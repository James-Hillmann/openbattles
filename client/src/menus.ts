import { BANKS, GAME_TYPES, type Bank, type GameType } from '@lbw/server/protocol';
import type { ArmyBundle } from '@lbw/extract';
import { canvasOf, defaultPick, mountArmySelect, type ArmyPick } from './armySelect';
import { GAME_HELP, GAME_NAMES } from './lobby';
import { mountMapPicker } from './mapPicker';

/**
 * The front end: load the ROM, the main menu (Single Player / Multiplayer, as the DS's), the
 * skirmish setup (map, game type, prebase, bank, opponent's army) and the army screen. The
 * multiplayer screens live in lobby.ts and draw into the same element.
 */
export interface SkirmishSetup {
  map: string;
  game: GameType;
  prebase: boolean;
  randomStart: boolean;
  bank: Bank;
  /** Army name of the computer's side. */
  opponent: string;
}

export interface MenuContext {
  army(): ArmyBundle | null;
  /** Skirmish maps of the loaded ROM (mp01..), empty without one. */
  maps(): string[];
  /** Load ROM bytes; rejects with a readable message. */
  loadRom(bytes: ArrayBuffer): Promise<void>;
  /** The ROM kept from an earlier visit, if any. */
  savedRom(): Promise<ArrayBuffer | null>;
  forgetRom(): Promise<void>;
  pick(): ArmyPick | null;
  setPick(p: ArmyPick): void;
  startSkirmish(s: SkirmishSetup): void;
  /** Play on the bare test field (no ROM). */
  startBare(): void;
  openLobby(): void;
}

export interface Menus {
  /** First screen: the saved ROM, or the ROM picker. */
  boot(): Promise<void>;
  main(): void;
  chooseArmy(done: (p: ArmyPick | null) => void): void;
}

export function mountMenus(el: HTMLElement, ctx: MenuContext): Menus {
  const setup: SkirmishSetup = { map: 'mp01', game: 'hunt-the-hero', prebase: false, randomStart: false, bank: 500, opponent: 'Wizard' };

  function load(note = '') {
    el.innerHTML = `
      <div class="screen" style="width:min(720px,100%)">
        <div class="logo">OpenBattles<small>LEGO BATTLES (DS) IN YOUR BROWSER</small></div>
        <div class="panel" style="text-align:center">
          <p>Load your own LEGO Battles cartridge dump (.nds) to play.</p>
          <label class="brick red" style="display:inline-block">Load ROM<input id="rom" type="file" accept=".nds" hidden /></label>
          <p class="muted">It's read in this browser and never uploaded. We keep a copy in this browser so you only pick it once.</p>
          <p class="err" id="romNote">${esc(note)}</p>
        </div>
        <div class="row"><button class="brick small" id="playBare">No ROM? Try the test field</button></div>
      </div>`;
    const input = el.querySelector<HTMLInputElement>('#rom')!;
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      await read(await file.arrayBuffer());
    });
    el.querySelector<HTMLButtonElement>('#playBare')!.onclick = () => main();
  }

  async function read(bytes: ArrayBuffer) {
    el.innerHTML = `<div class="screen" style="width:min(720px,100%)"><div class="logo">OpenBattles</div><div class="panel"><h2>Reading your ROM...</h2></div></div>`;
    try {
      await ctx.loadRom(bytes);
      main();
    } catch (e) {
      await ctx.forgetRom();
      load(`That file didn't load: ${(e as Error).message}`);
    }
  }

  function main() {
    const b = ctx.army();
    el.innerHTML = `
      <div class="screen" style="width:min(720px,100%)">
        <div class="logo">OpenBattles</div>
        <div class="row" style="gap:28px">
          <button class="tile" id="menuSp"><span class="cards"></span>Single Player</button>
          <button class="tile" id="menuMp"><span class="cards"></span>Multiplayer</button>
        </div>
        <div class="row">${b ? '<button class="brick small" id="menuRom">Change ROM</button>' : '<button class="brick small" id="menuRom">Load ROM</button>'}</div>
      </div>`;
    if (b) {
      el.querySelector('#menuSp .cards')!.append(canvasOf(b.cards[b.armies.King?.units[0] ?? '']));
      for (const a of ['Pirates', 'King', 'Earth']) el.querySelector('#menuMp .cards')!.append(canvasOf(b.cards[b.armies[a]?.units[0] ?? '']));
    }
    el.querySelector<HTMLButtonElement>('#menuSp')!.onclick = () => (b ? skirmish() : ctx.startBare());
    el.querySelector<HTMLButtonElement>('#menuMp')!.onclick = () => ctx.openLobby();
    el.querySelector<HTMLButtonElement>('#menuRom')!.onclick = async () => {
      await ctx.forgetRom();
      load();
    };
  }

  function skirmish() {
    const b = ctx.army()!;
    const maps = ctx.maps();
    if (!maps.includes(setup.map)) setup.map = maps[0] ?? 'mp01';
    el.innerHTML = `
      <div class="screen" style="width:min(820px,100%)">
        <h1>Skirmish Setup</h1>
        <div class="panel">
          <div id="spMapPick"></div>
          <div class="row" style="margin-top:12px">${GAME_TYPES.map((g) => `<button data-game="${g}" class="opt ${setup.game === g ? 'on' : ''}">${GAME_NAMES[g]}</button>`).join('')}</div>
          <p class="help muted">${GAME_HELP[setup.game]}</p>
          <div class="row">
            <button id="spPrebase" class="opt ${setup.prebase ? 'on' : ''}">Prebase</button>
            <button id="spRandom" class="opt ${setup.randomStart ? 'on' : ''}">Random Start</button>
            <button id="spBank" class="opt">Bank ${setup.bank}</button>
          </div>
        </div>
        <div class="panel">
          <h2>Opponent</h2>
          <div class="armies" id="spOpp"></div>
          <p class="muted" style="text-align:center;margin:0">The computer side doesn't play yet: its units hold their ground.</p>
        </div>
        <div class="row spread">
          <button class="brick small" id="spBack">&#x2190; Back</button>
          <button class="brick" id="spNext">Continue</button>
        </div>
      </div>`;
    const opp = el.querySelector('#spOpp')!;
    for (const name of Object.keys(b.armies)) {
      const btn = document.createElement('button');
      btn.className = `coin ${setup.opponent === name ? 'cur' : ''}`;
      btn.title = name;
      btn.appendChild(canvasOf(b.heads[b.armies[name]!.units[0]!]));
      btn.appendChild(Object.assign(document.createElement('small'), { textContent: name }));
      btn.onclick = () => {
        setup.opponent = name;
        skirmish();
      };
      opp.appendChild(btn);
    }
    mountMapPicker(el.querySelector('#spMapPick')!, b, maps, setup.map, 'spMap', (m) => {
      setup.map = m;
      skirmish();
    });
    el.querySelectorAll<HTMLButtonElement>('[data-game]').forEach(
      (btn) =>
        (btn.onclick = () => {
          setup.game = btn.dataset.game as GameType;
          skirmish();
        }),
    );
    el.querySelector<HTMLButtonElement>('#spPrebase')!.onclick = () => {
      setup.prebase = !setup.prebase;
      skirmish();
    };
    el.querySelector<HTMLButtonElement>('#spRandom')!.onclick = () => {
      setup.randomStart = !setup.randomStart;
      skirmish();
    };
    el.querySelector<HTMLButtonElement>('#spBank')!.onclick = () => {
      setup.bank = BANKS[(BANKS.indexOf(setup.bank) + 1) % BANKS.length]!;
      skirmish();
    };
    el.querySelector<HTMLButtonElement>('#spBack')!.onclick = () => main();
    el.querySelector<HTMLButtonElement>('#spNext')!.onclick = () =>
      chooseArmy((p) => {
        if (p) ctx.startSkirmish({ ...setup });
        else skirmish();
      }, 'Start');
  }

  function chooseArmy(done: (p: ArmyPick | null) => void, confirm?: string) {
    const b = ctx.army();
    if (!b) return done(null);
    mountArmySelect(el, b, ctx.pick() ?? defaultPick(b), {
      confirm,
      done: (p) => {
        ctx.setPick(p);
        done(p);
      },
      back: () => done(null),
    });
  }

  return {
    async boot() {
      const saved = await ctx.savedRom();
      if (saved) await read(saved);
      else load();
    },
    main,
    chooseArmy: (done) => chooseArmy(done),
  };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
