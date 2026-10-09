import type { Pickup, Unit, World } from './state';
import { earnBricks, getPlayer } from './economy';

/**
 * Map pickups (game: Sim::CollectableItem), ported from 0x0205923C (who may pick one up),
 * 0x020593A0 (what it does, by collectable type) and the per-type handlers at 0x0205ED5C..0x0205F018.
 * See docs/re-notes/pickups.md.
 */

/** Collectable types the sim knows (blueprint record's type byte; names from the table at 0x02149404). */
export const PICKUP_HEALTH = 0;
export const PICKUP_MANA = 1;
export const PICKUP_STUD = 10;

/** A Blue Stud pays its finder's player 1000 bricks, 150 in a "Collect 10000 LEGO Bricks" game (0x0205F018). */
export const STUD_BRICKS = 1000;
export const STUD_BRICKS_GOLD_RUSH = 150;
/** Health and Mana Powerups add this much HP or magic charge, up to the most (0x0205ED5C / 0x0205EDA0). */
export const POWERUP_AMOUNT = 100;

/** Pickup modes (CollectableItem +0x174): 1 only the pickup's owner's units, 2 anyone's. */
export const PICKUP_ANYONE = 2;
/** Role filter (CollectableItem +0x178) that lets every role collect; otherwise only that role may. */
export const ANY_ROLE = 20;

/** Put a pickup on the map at cell (cx, cy). Skirmish maps place 10 Blue Studs (EVNT pickup records). */
export function addPickup(w: World, type: number, cx: number, cy: number, owner = 0, mode = PICKUP_ANYONE, role = ANY_ROLE): Pickup {
  const p: Pickup = { id: w.nextPickup++, type, cell: cy * (w.grid?.width ?? 0) + cx, owner, mode, role };
  w.pickups.push(p);
  return p;
}

/** May unit u pick up p (0x0205923C)? Its cell must be the pickup's, and the role and owner filters must pass. */
function canCollect(p: Pickup, u: Unit): boolean {
  if (u.hp === 0 || u.cell !== p.cell) return false;
  if (p.role !== ANY_ROLE && p.role !== u.role) return false;
  if (p.mode === PICKUP_ANYONE) return true;
  return p.mode === 1 && u.owner === p.owner;
}

/**
 * What picking up does (0x020593A0); false leaves the pickup on the map. A powerup that would change
 * nothing (full HP, full charge, or a unit without magic) is not taken.
 */
function collect(w: World, p: Pickup, u: Unit): boolean {
  switch (p.type) {
    case PICKUP_HEALTH: {
      const hp = Math.min(u.maxHp, u.hp + POWERUP_AMOUNT);
      if (hp === u.hp) return false;
      u.hp = hp;
      return true;
    }
    case PICKUP_MANA: {
      // The game also needs unit +0x227 set; only heroes carry charge here, which stands in for it (guess).
      const charge = Math.min(u.maxCharge, u.charge + POWERUP_AMOUNT);
      if (u.maxCharge === 0 || charge === u.charge) return false;
      u.charge = charge;
      return true;
    }
    case PICKUP_STUD: {
      const player = getPlayer(w, u.owner);
      if (!player) return false;
      const n = w.rules?.mode === 2 ? STUD_BRICKS_GOLD_RUSH : STUD_BRICKS;
      earnBricks(player, n);
      return true;
    }
    default:
      return true; // story items: taken, no effect in a skirmish
  }
}

/**
 * Units standing on a pickup's cell take it. The game checks when a unit claims a new cell
 * (event handler 0x0205923C); here every pickup is checked after the move phase, units in id order.
 */
export function pickupsStep(w: World): void {
  if (w.pickups.length === 0) return;
  const keep: Pickup[] = [];
  for (const p of w.pickups) {
    const u = w.units.find((o) => canCollect(p, o));
    if (!u || !collect(w, p, u)) keep.push(p);
  }
  w.pickups = keep;
}
