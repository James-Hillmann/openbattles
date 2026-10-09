import type { ArmyBundle } from '@lbw/extract';
import { canvasOf } from './armySelect';

/**
 * The DS map select (skirmish and multiplayer host): the map's minimap in a blue frame, its name
 * on a bar underneath, arrows either side to cycle (docs/re-notes/armies.md "Map select"). The
 * name bar is a <select> here too, so you can jump straight to a map. Without `onChange` (a
 * guest in the lobby) it only shows the host's pick.
 */
export function mountMapPicker(
  el: HTMLElement,
  b: ArmyBundle | null,
  maps: readonly string[],
  current: string,
  selectId: string,
  onChange?: (map: string) => void,
): void {
  const title = (m: string) => b?.maps[m]?.title ?? m;
  el.className = 'mappick';
  el.dataset.map = current;
  el.innerHTML = `
    <div class="mapframe"></div>
    <div class="mapbar">
      ${onChange ? '<button class="arrow" data-dir="-1" title="Previous map">&#x25C0;</button>' : ''}
      ${
        onChange
          ? `<select id="${selectId}">${maps.map((m) => `<option value="${m}" ${m === current ? 'selected' : ''}>${esc(title(m))}</option>`).join('')}</select>`
          : `<span class="mapname">${esc(title(current))}</span>`
      }
      ${onChange ? '<button class="arrow" data-dir="1" title="Next map">&#x25B6;</button>' : ''}
    </div>`;
  el.querySelector('.mapframe')!.appendChild(canvasOf(b?.maps[current]?.preview));
  if (!onChange) return;
  el.querySelector<HTMLSelectElement>('select')!.onchange = (e) => onChange((e.target as HTMLSelectElement).value);
  el.querySelectorAll<HTMLButtonElement>('[data-dir]').forEach(
    (btn) => (btn.onclick = () => onChange(maps[(maps.indexOf(current) + Number(btn.dataset.dir) + maps.length) % maps.length]!)),
  );
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
