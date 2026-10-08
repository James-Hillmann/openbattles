# Multiplayer (DS wireless) and how OpenBattles maps it online

The DS game has local wireless multiplayer (DS-to-DS, no internet). We rebuild the same
setup flow over a WebSocket relay. Everything below was found in the USA ROM (C5SE): screen
names from RTTI strings in ARM9, labels from `LOC/American_English.lng`, and the screens
themselves by driving the game in DeSmuME (tools/emu). DeSmuME has no wireless between two
instances, so nothing past the host's own lobby could be watched.

## Setup flow

| step | DS screen (layout file in `UI/FE/`) | what's on it | confidence | ours |
|---|---|---|---|---|
| 1 | `MultiplayerMenu.bin` | Two icons: Host and Join (label under the icon names the selected one; tap again to enter) | confirmed (emulator) | Host button, or a room code + Join |
| 2a | Host: map picker (same as skirmish) | Map preview, arrows to cycle maps, Continue | confirmed (emulator) | Host picks the map in the lobby |
| 3a | `LobbySettings.bin` | Three game-type icons (one selected): **Hunt the Hero** (default), **LEGO Gold Rush**, **Elimination**; a line of help text for the selected icon; toggles **Prebase** and **Random Start** (both off by default); **Bank** button cycling 500 → 1000 → 2500 per tap (default 500) | confirmed (emulator) | Same options and defaults, in `GameSettings` |
| 4a | `HostLobby.bin` ("Game Lobby") | Top screen: Game / Map / Random Start / Prebase / Bank summary. Bottom: player list (team-color square + profile name), a row of six team-color chips; the chip a player owns shows their player number | confirmed (emulator, host alone) | Same summary table, player list, six chips with the owner's number |
| 2b | `JoinWifiGame.bin` ("Join Game") | "Searching for Games..." box that lists hosts found nearby | confirmed (emulator; no hosts to find) | Room code instead of a radio scan |
| 4b | `ClientLobby.bin` | Client's view of the lobby | guess (not reachable without a second DS) | Same lobby view, minus host controls |
| 5 | `MultiplayerFactionSelect.bin` | Each player picks an army | guess: order relative to the lobby not seen | Army picker inside the lobby |
| 6 | in game, then `MultiplayerScore.bin` | Score screen | not traced | not built |

Lobby strings that tell us the rules (our paraphrase):

- Ready / Not Ready per player and a Launch button; a message for launching while some
  players aren't ready. We: guests toggle Ready, the host launches once every guest is ready.
- The host can remove a player (a confirmation names the player). We: Remove button.
- Messages for a player who left, a lost connection, a failed join, and the end of a
  battle closing the connection. We show the same situations in our own words.
- An achievement for winning a 3-player game, so the DS supports more than two players
  (likely up to 4 over DS wireless; not checked). We keep 1v1 for now (`ROOM_SIZE = 2`),
  but the protocol, relay and lockstep take any count up to the six team colors.
- Team colors: six, in chip order red, blue, green, orange, magenta, grey. That's the
  same order as the unit palette banks (formats.md, "team color = bank 2c"), so a chip
  index maps directly to a bank. Confirmed for red and blue; the rest is likely.
- Changing a setting clears everyone's Ready: **guess**, our choice.

## Netcode in the ROM: command lockstep

ARM9 RTTI names a `Battles::CommandBase` hierarchy covering every player action (move,
attack, patrol, produce, build, research, cast spell, garrison, stop, retire, rally point,
change alliance, ...) plus two that aren't player actions:

| class | factory type id | serialized fields | confidence |
|---|---|---|---|
| `SyncCheckCommand` | 5 | two u32 (+0x14, +0x18), written by `0x02007514`, read by `0x02007534` | likely (read from code) |
| `SyncStatusCommand` | 6 | one u32 (+0x14) and one u8 (+0x18), `0x020075BC` / `0x020075DC` | likely (read from code) |

The command factory at `0x02004E9C..` allocates a command object by type id (5 → ctor
`0x020074EC`, 6 → `0x02007594`). With every action going through serializable commands
and a dedicated sync-check command, the DS game is a **deterministic command lockstep**,
the same model we use. Our reading of the fields:

- `SyncCheckCommand` = (turn or tick, state checksum): **likely**; it has exactly the two
  words such a check needs. Our equivalent: the `hash` message every
  `HASH_INTERVAL_TICKS` (30 = once a second).
- `SyncStatusCommand` = (turn, ok/mismatch flag): **guess**.
- How often the DS sends a sync check, and its input delay / turn length: **unknown**.
  Only reachable with two linked DS units. Ours: 6 ticks (200 ms), `INPUT_DELAY_TICKS`.

Single-player games run through the same command objects: with an exec hook on the command
base constructor (`0x02004350`, type id in r1) during a skirmish, the CPU player's orders
show up as commands of ids 0x0E, 0x10, 0x14, 0x16, 0x17, 0x19 (emulator). No sync check
was created in single player.

## How ours works

- **Relay** (`server/src/relay.ts`): rooms with 4-letter codes, lobby state, ROM and
  build check (`rom` = `PROTOCOL_VERSION/<FNV-1a of the cartridge header>`; different
  dumps or builds would build different worlds), then input forwarding and hash compare.
  Not authoritative: it never runs the sim.
- **Lockstep** (`sim/src/lockstep.ts`): each player sends one input per tick for
  `tick + INPUT_DELAY_TICKS`; a tick runs once every player's input is in; wire commands
  are rebuilt by `sanitizeCommand` so bad input is dropped identically everywhere.
- **Client** (`client/src/match.ts`, `lobby.ts`): `Match` drives the sim from the render
  loop, stalls ("Waiting...") when the other side's input is late, and stops on a desync
  or a lost peer. Inputs that arrive while a client is still loading the map are kept
  (`RelayClient.claim`).
- **Tests**: `tests/sim/lockstep.test.ts`, `tests/server/*.test.ts` (two clients over the
  real relay with 0-40 ms jitter and reordering; drift detection; slow loader; leaving)
  and `npm run e2e` (two Chromium tabs of the real client; `OB_ROM=... npm run e2e` loads
  your dump in both and plays on mp02).

## To reproduce the screens

From a profile at the main menu (see tools/emu/README.md): tap Multiplayer at (168,48)
twice, then Host at (88,87) twice (Join is (175,87)). Map picker: Continue (215,165).
Lobby settings: game types at (48,23) (128,23) (208,23), Prebase (48,125), Random Start
(128,125), Bank (208,125), Continue (215,165). Lobby: color chips along y=135 from x=88,
16 px apart.

## Open

- Faction select order, client lobby, score screen, the DS turn length and sync interval.
- Win conditions (Hunt the Hero / Gold Rush / Elimination), Random Start, Prebase and Bank
  are carried through the lobby but the sim doesn't use them yet (bank only feeds the HUD).
- Map names (the lobby shows file names like mp02; the game shows names like The Pond).
