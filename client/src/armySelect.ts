import { FE_TEXT, type ArmyBundle, type Rgba } from '@lbw/extract';

/**
 * The army screen, after the DS game's (docs/re-notes/armies.md): the top screen shows the
 * picked character's card and stats; the bottom screen lists the army's nine units (hero on
 * top, then builder / close combat, ranged / mounted, three specials, transport) and, for the
 * selected slot, every character that can fill it. Everything is unlocked.
 *
 * Ours puts both screens side by side. Clicking a character puts it in the slot (on the DS you
 * pick one and confirm; that step isn't traced). The six "armies" along the top reset every
 * slot to a faction's own army and set whose buildings you get.
 */
export interface ArmyPick {
  /** Army whose buildings you get, e.g. "King". */
  army: string;
  /** Entity name per unit slot. */
  units: string[];
}

export const defaultPick = (b: ArmyBundle, army = 'King'): ArmyPick => ({ army, units: [...(b.armies[army] ?? Object.values(b.armies)[0]!).units] });

/** Is this pick still the faction's own army (sent as no army at all)? */
export const isStock = (b: ArmyBundle, p: ArmyPick): boolean => b.armies[p.army]?.units.every((u, i) => u === p.units[i]) ?? false;

const canvases = new WeakMap<Rgba, HTMLCanvasElement>();
/** A canvas of the image (each call returns a fresh copy, so it can be placed anywhere). */
export function canvasOf(img: Rgba | undefined): HTMLCanvasElement {
  const c = document.createElement('canvas');
  if (!img) return c;
  let src = canvases.get(img);
  if (!src) {
    src = document.createElement('canvas');
    src.width = img.width;
    src.height = img.height;
    src.getContext('2d')!.putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
    canvases.set(img, src);
  }
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')!.drawImage(src, 0, 0);
  return c;
}

const pips = (n: number) => `<span class="pips">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`;

/** Stat icons in the spirit of the game's (lightning, heart, brick, boot). Ours, not the ROM's. */
const ICON = {
  attack: '<svg viewBox="0 0 16 16" width="22" height="22"><path d="M9 0 2 9h5l-2 7 8-10H8z" fill="#ffd400" stroke="#7a4b00"/></svg>',
  hp: '<svg viewBox="0 0 16 16" width="22" height="22"><path d="M8 15 1.5 8.5A4 4 0 0 1 8 3.5a4 4 0 0 1 6.5 5z" fill="#e01010" stroke="#600"/></svg>',
  cost: '<svg viewBox="0 0 16 16" width="22" height="22"><path d="M1 6l7-3 7 3v6l-7 3-7-3z" fill="#f8b800" stroke="#7a4b00"/><path d="M1 6l7 3 7-3M8 9v6" fill="none" stroke="#7a4b00"/></svg>',
  speed: '<svg viewBox="0 0 16 16" width="22" height="22"><path d="M6 2h4v6l5 2v4H5z" fill="#30c030" stroke="#0a4a0a"/><path d="M0 9h4M1 12h3" stroke="#f8d800"/></svg>',
};

export interface ArmySelectOptions {
  title?: string;
  /** Label of the confirm button. */
  confirm?: string;
  done(pick: ArmyPick): void;
  back(): void;
}

export function mountArmySelect(el: HTMLElement, b: ArmyBundle, start: ArmyPick, opts: ArmySelectOptions): void {
  let pick: ArmyPick = { army: start.army, units: [...start.units] };
  let slot = 0;
  /** Character shown on the card: the one hovered, else the slot's. */
  let shown = pick.units[0]!;
  let shownRole = 0;
  const t = (id: number) => b.text[id] ?? '';

  el.innerHTML = `
    <div class="screen">
      <h1>${opts.title ?? t(FE_TEXT.selectArmy)}</h1>
      <div class="panel"><div class="armies"></div></div>
      <div class="army">
        <div class="panel card"></div>
        <div class="panel"><div class="stats"></div><hr style="border-color:#ffffff22;margin:14px 0" /><div class="slots"></div></div>
        <div class="panel"><h2 class="slotname"></h2><div class="choices"></div></div>
      </div>
      <div class="row spread">
        <button class="brick small" data-act="back">&#x2190; ${t(FE_TEXT.back)}</button>
        <button class="brick" data-act="ok">${opts.confirm ?? t(FE_TEXT.continue)}</button>
      </div>
    </div>`;
  const $ = (s: string) => el.querySelector<HTMLElement>(s)!;
  $('[data-act=back]').onclick = () => opts.back();
  $('[data-act=ok]').onclick = () => opts.done(pick);

  /** `role`: the slot whose label the card shows for this character (the hero for the army coins). */
  const coin = (name: string, role: number, cls: string, onClick: () => void, label?: string) => {
    const btn = document.createElement('button');
    btn.className = `coin ${cls}`;
    btn.title = b.units[name]?.name ?? name;
    btn.appendChild(canvasOf(b.heads[name]));
    if (label) btn.appendChild(Object.assign(document.createElement('small'), { textContent: label }));
    btn.onclick = onClick;
    btn.onpointerenter = () => showCard(name, role);
    btn.onpointerleave = () => showCard(pick.units[slot]!, slot);
    return btn;
  };

  function showCard(name: string, role: number) {
    shown = name;
    shownRole = role;
    const u = b.units[name];
    $('.card').replaceChildren(canvasOf(b.cards[name]));
    $('.stats').innerHTML = u
      ? `<div class="name">${esc(u.name)}</div><div class="slot">${esc(b.slotLabels[role] ?? '')}</div>
         ${ICON.attack}${pips(u.attackPips)}${ICON.hp}<span>${u.hp}</span>${ICON.cost}<span>${u.cost}</span>${ICON.speed}${pips(u.speedPips)}`
      : '';
  }

  function render() {
    const armies = $('.armies');
    armies.replaceChildren(
      ...Object.keys(b.armies).map((name) => {
        const c = coin(b.armies[name]!.units[0]!, 0, pick.army === name ? 'cur' : '', () => {
          pick = { army: name, units: [...b.armies[name]!.units] };
          render();
        }, name);
        c.dataset.army = name;
        return c;
      }),
    );
    const slots = $('.slots');
    slots.replaceChildren(
      ...pick.units.map((name, i) => {
        const c = coin(name, i, i === slot ? 'sel' : '', () => {
          slot = i;
          render();
        });
        if (i === 0) c.classList.add('hero');
        return c;
      }),
    );
    $('.slotname').textContent = b.slotLabels[slot] ?? '';
    $('.choices').replaceChildren(
      ...(b.choices[slot] ?? []).map((name) =>
        coin(name, slot, name === pick.units[slot] ? 'cur' : '', () => {
          pick.units[slot] = name;
          render();
        }),
      ),
    );
    if (el.querySelector('.coin:hover')) showCard(shown, shownRole);
    else showCard(pick.units[slot]!, slot);
  }
  render();
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
