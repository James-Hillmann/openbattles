/**
 * The "under attack" alert (game: "Alert Notice"). docs/re-notes/orders.md
 *
 * Game: whenever a unit loses HP and lives, while something is attacking it (attacker count,
 * unit +0x1D4, above 0), Unit_setHp (0x0205E7D4) tells the UI (0x020D9D74). The UI takes it
 * when the unit is the local player's, or one of its attackers is: a battle you're in, either
 * side. At most once every 2000 ms it stores the time and points "View Battle" at the unit
 * (the camera target: unit position minus half a screen). The crossed-swords icon shows at the
 * bottom right of the touch screen until 7500 ms after the last refresh; tapping it moves the
 * camera there. confirmed (code; emulator: icon showed when the King was hit and went 449 frames,
 * 7.5 s, after the last hit). Tapping it to jump the camera is likely (lang 297 "View Battle").
 * Not ported: the sound/notice event the game also posts when 450 ticks have gone by (0x36).
 */
export const ALERT_THROTTLE_MS = 2000;
export const ALERT_SHOW_MS = 7500;

export interface AlertUnit {
  id: number;
  owner: number;
  hp: number;
  x: number;
  y: number;
  target: number | null;
}

export class BattleAlert {
  /** When the alert was last refreshed (real ms), or -Infinity. */
  at = -Infinity;
  /** Where "View Battle" goes (fixed-point world position of the unit hit). */
  spot: { x: number; y: number } | null = null;

  /** Compare one sim tick's before and after and refresh the alert as the game does. */
  observe(before: readonly AlertUnit[], after: readonly AlertUnit[], local: number, now: number): void {
    if (now - this.at < ALERT_THROTTLE_MS) return;
    const was = new Map(before.map((u) => [u.id, u.hp]));
    for (const u of after) {
      const old = was.get(u.id);
      if (old === undefined || u.hp >= old || u.hp <= 0) continue;
      // Our stand-in for the game's attacker list: live units targeting this one.
      const attackers = after.filter((a) => a.target === u.id && a.hp > 0);
      if (!attackers.length) continue;
      if (u.owner !== local && !attackers.some((a) => a.owner === local)) continue;
      this.at = now;
      this.spot = { x: u.x, y: u.y };
      return;
    }
  }

  shown(now: number): boolean {
    return this.spot !== null && now - this.at < ALERT_SHOW_MS;
  }
}
