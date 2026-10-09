# Orders and stances: Stop, Stand Ground, Patrol, rally points, selection, battle alert

Sim: `sim/src/orders.ts`, `sim/src/combat.ts`. Client: `client/src/main.ts` (Actions strip),
`client/src/selection.ts`, `client/src/battleAlert.ts`. Icons: `extract/src/actions.ts`.

Confidence: **confirmed** = read in the code and/or seen in DeSmuME; **likely** = strong evidence,
one link missing; **guess** = ours.

## How the game gives orders

ARM9 has one class per player order (RTTI names `N7Battles...CommandE`). Each is built with a type
id (passed in `r1` to the shared constructor `0x02004350`) and run by one dispatcher,
`0x02083830`, a jump table on the id (`cmp r1, #0x21`). Each handler turns the order into an
**entity command** per selected unit and installs it (`0x0205A01C`). A unit runs one entity
command at a time: current at unit +0xF4, next at +0xF8; the type id is at command +4.

| order id | order | handler | entity command it gives (type id) | confidence |
|---|---|---|---|---|
| 0x0F | Attack | | CombatAttack | confirmed (code) |
| 0x11 | Hold position | `0x020844C8` | CombatHoldPosition (2) | confirmed (code) |
| 0x12 | Stand Ground | `0x0208455C` | CombatStandGround (4) | confirmed (code) |
| 0x17 | Move | `0x0208488C` | CombatMove (3); MoveEngineer (0x10) for Builders | confirmed (code) |
| 0x18 | Patrol | `0x02084974` | Patrol (0x14) | confirmed (code) |
| 0x1A | Cancel queued unit | `0x02084A60` | (production) | confirmed (code) |
| 0x1B | Set Rally Point | `0x02084B1C` | none: writes the building | confirmed (code) |
| 0x1F | Stop | `0x02084D68` | Stop (0x19) | confirmed (code) |

Other entity command ids seen: 0x0E IdleNoAction, 0x0F IdleProductionStructure, 0x15 ProduceUnit,
0x18 Retire.

## Hold position: what every idle fighter does

When an order ends (a move arrives, an attack's target dies, Stop), a fighting unit gets
CombatHoldPosition (type 2) on the cell it stands on: its **post**. confirmed (emulator: idle
units' +0xF4 command has type 2). Constructor `0x0206244C`, update `0x020629DC`, a small state
machine:

| state | does | code |
|---|---|---|
| 0 | walk back to the post | `0x02063DE0` |
| 1 | chase the target | `0x02063F60` |
| 2 | attack | `0x02063BE0` |
| 3 | stand at the post | |
| 4 | target lost: wait 20 updates, then state 0 | `0x02063634` |
| 5 / 6 | finished / target died | |

- Scans for a target when `(counter + 28) % 30 == 0`, the counter (+0x48) starting at 0 with each
  new command. So a unit scans 2 ticks after any new order, then once a second. confirmed (code)
- Search radius: sight (+0x71); max range (+0x6F) for buildings. confirmed (code)
- The pick (`0x020638A8`) measures candidates with the range check `0x0207F640` **from the post**
  (+0x20), keeping those between min range and sight + max range of it: this is the leash. A unit
  far from its post won't take enemies near itself. confirmed (code)
- No candidates: it keeps chasing what it has. confirmed (code)
- Sim: stance `STANCE_HOLD`, `post`, `back` (the end of the 20-tick wait). The patrol stance uses
  the unit's own cell as the leash centre. guess: the patrol command's own scan was not traced.

## Stand Ground

CombatStandGround (type 4, `0x02066530`; scan `0x02067258` / `0x020673FC`): search radius is max
range and every candidate must already be in attack range; highest priority wins. The unit never
moves. confirmed (code; emulator: the King on Stand Ground stood still while swordsmen hit him;
an idle King chased them). Tie-break by nearer, then lower id: guess.

## Patrol

The strip's Patrol takes two taps on the map, A then B; the command keeps the points in a list
(command +0x2C). Units walk to A first, then turn at each end without pausing. They fight what
they meet and then pick the route up again. confirmed (emulator: route (12,15) to (9,15); a unit
left it to fight at (7,16) and came back). Sim: stance `STANCE_PATROL`, `route`, `leg`.

## Move

A move order (CombatMove) walks without scanning; on arrival the unit holds its new cell.
confirmed (emulator: units walked past enemies in sight).

## Stop

StopEntityCommand's start calls the unit's stop (`0x0205AE3C`) and finishes at once, so the unit
goes back to hold position on the cell where it stopped. Builders drop their job too. confirmed
(code). On a building, Stop replaces the production command: the unit in training is cancelled
and refunded (emulator: 450 back to 500 bricks, the pop slot freed). With more queued behind it,
only the front one going is likely (one item was tested).

## Rally points

Set Rally Point stores a cell on the building (+0x1AC x, +0x1AD y); (0, 0) means none, which is
also the default. When ProduceUnit (`0x020724F4`..`0x02072560`) spawns a unit and a rally point
is set, it gives the unit a move there (MoveEngineer for Builders). confirmed (code; emulator:
the Castle stored (14,19) and the new Builder walked to it). Tapping the map with the building
selected also sets it. confirmed (emulator). Ours: a right-click on the ground does the same,
and the rally cell shows a small arrow while the building is selected (the game shows nothing we
found).

## Actions strip (blue tab)

Strip contents seen in the emulator: the King's is Attack, Repair, Stand Ground, Patrol, Load,
Stop; the Castle's is Set Rally Point, Stop. confirmed. The fifth (stairs) button was first read as
Move; the transport work showed it is Load: tapping it and then a ship put the King aboard
(transports.md). A transport's strip has Unload (box on a crane, x 144) next to it. Other units: the same list less what they
can't do (likely): Attack and Stand Ground need a weapon, Repair a Builder or hero.

Icons: `UI/AllInOne/UI_MainCastle`, palette bank 1 (blue), the row at y 144, 24 px apart:
attack (x 0), rally (24), patrol (48), harvest (72), load (96, stairs; we also use it for the move
tap mark), repair (120), unload (144, likely), one not placed (168), stop (192), stand ground (216). confirmed by matching the emulator's strips.

Every order given on the map shows its icon at the tapped spot for 50 VBlanks (833 ms), a plain
move included. confirmed (emulator); the exact image is likely (we draw the 24 px strip icon).

Labels (lang): 305 Attack, 306 Patrol, 307 Move, 308 Retire, 309 Stop, 314 Stand Ground,
315 Set Rally Point.

## Selection limit: 9

The box select (Thumb, `0x020E2480`..`0x020E2834`) sorts the units in the box into lists by role
and fills the selection from them in this order until it has 9: hero (role 0), roles 5-6
(transports, specials), mounted (4), melee (2), ranged (3), Builders (1), the rest. A box with
buildings and no units selects one building. Adding a unit to a full selection (`0x020E339C`) is
refused. confirmed (code). Order within one role: entity-list order, likely.

## Battle alert ("Alert Notice")

- `Unit_setHp` (`0x0205E7D4`): when HP goes down, the unit lives, its attacker count (+0x1D4) is
  above 0 and its command isn't Retire or Stop, it reports the hit. If more than 450 ticks have
  passed since +0x1A4 it stamps the time and posts event 0x36 (likely a sound or notice; not
  ported). Otherwise it calls the UI directly. confirmed (code)
- UI `0x020D9D74`: at most once every 2000 ms of real time; only when the unit is the local
  player's or one of its attackers (list at +0x1CC) is. It stores the time (ui +0x1FC) and the
  camera spot (ui +0x224/+0x226: unit position minus (128, 96), half a screen). confirmed (code)
- The crossed-swords icon (texture cell (136, 24), bank 1) shows at the bottom right of the touch
  screen until 7500 ms after the last refresh (`0x020DD6A2` compares with 0x1D4C). confirmed (code;
  emulator: gone 449 frames after the last hit). Tapping it moves the camera to the battle:
  likely (lang 297 "View Battle").
- Ours: the client computes it from the sim; "attackers" are live units whose target is the unit.
  likely to match the game's list.
