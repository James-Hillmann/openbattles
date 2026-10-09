# Score screen stats

Ported in `sim/src/stats.ts`; shown by `client/src/matchExtras.ts`. Traced 2026-10-09 on C5SE.

## Records (confirmed from RAM)

One 0xA4-byte record per player at `0x0215711C + p * 0xA4` (p = team +0x10):

| offset | size | stat | bumped by |
|---|---|---|---|
| +0x14 | u32 | Bricks Collected | `0x020A6660`: harvest drop-off (`0x0206D1xx`), Mine payout (`0x0206D8xx`), the trickle (`0x02083720`), Blue Studs |
| +0x4C / +0x4E / +0x50 | u16 | Minifigures / Specials / Buildings Built | `0x020A7A38`, from training (`0x02072228`) and construction finishing |
| +0x52 / +0x54 / +0x56 | u16 | ... Lost | `0x020A7E58`, in `DieEntityCommand` |
| +0x58 / +0x5A / +0x3E | u16 | ... Destroyed (towers also +0x3C) | `0x020A7C68`, in `DieEntityCommand` |

Classes by role (the switch tables): roles 0-4 minifigures, 5-6 specials, 7-16 buildings; walls and
up count nowhere. Counters stop at 0xFFFF. Starting units don't count as built (the CPU's +0x4C
read 3 after it trained three Builders). Refunds don't count as collected.

## Who gets "Destroyed" (confirmed code; our port differs, likely harmless)

`DieEntityCommand` (`0x0206A078`) walks the dead unit's list of current attackers (+0x1CC; melee
adds to it at `0x0205077C`, projectiles at `0x0206E950`) and credits each other team once. We
credit the player who dealt the last damage (`Unit.lastHitBy`). In 1v1 that is the same unless a
unit dies with nobody attacking it. There is also a hero-kills-hero call (`0x020A7F04`) whose stat
isn't on the score screen.

## Screen (labels confirmed, layout ours)

Classes `SkirmishScore` (vtable `0x0214D4FC`) and `SkirmishScoreTopScreen`. Labels are LANG
323-336: Minifigures Built, Specials Built, Buildings Built, Minifigures Lost, Specials Lost,
Buildings Lost, Minifigures Destroyed, Specials Destroyed, Buildings Destroyed, Time,
"<1>:<2>:<3>", Bricks Collected, Bricks Balance, Stats. Titles: 64 "Free Play Score",
65 "Multiplayer Score". We show them as one table with a column per player under the
Victory/Defeat banner; the game's own layout and "Bricks Balance" meaning (we show bricks in hand)
are **guess**, not yet reached in the emulator.
