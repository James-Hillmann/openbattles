import { miniCell, type Rgba } from '@lbw/extract';
import type { Fog } from '@lbw/sim';

/**
 * The minimap under fog (0x02026900, docs/re-notes/fog.md): a pixel shows `full` where its cell is
 * seen now, `shroud` (the darker remap) where it was seen before, and nothing (the panel) where it
 * was never seen. The game redraws a quarter of the rows per call; we redraw it all.
 */
export function fogMinimap(full: Rgba, shroud: Rgba | undefined, f: Fog): Rgba {
  const out: Rgba = { width: full.width, height: full.height, data: new Uint8ClampedArray(full.data.length) };
  for (let y = 0; y < full.height; y++) {
    const cy = Math.min(f.height - 1, miniCell(y));
    for (let x = 0; x < full.width; x++) {
      const c = cy * f.width + Math.min(f.width - 1, miniCell(x));
      const src = f.visible[c] ? full : f.explored[c] ? shroud : undefined;
      if (!src) continue;
      const o = (y * full.width + x) * 4;
      out.data.set(src.data.subarray(o, o + 4), o);
    }
  }
  return out;
}
