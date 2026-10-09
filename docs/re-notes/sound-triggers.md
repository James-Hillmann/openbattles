# Sound triggers: when each effect and music track plays

Game: LEGO Battles (USA, `C5SE`). Found 2026-10-09 by reading ARM9 and logging exec hooks in DeSmuME
on a King skirmish on The Pond (mp01): selection, building a Farm, and the first fight against the
Wizard Swordsman (~5100 frames in). Sound labels and numbers come from your ROM's
`Sound/sound_data.sdat` (SEQARC = sound-effect archive, STRM = streamed music).

**DS background:** sound on the DS runs on the ARM7. The ARM9 game calls Nintendo's NitroSystem
sound library (`NNS_Snd*`), which reads the SDAT and sends commands to the ARM7. A *player* is a
group of hardware channels with its own sequence limit and volume; a *handle* is a small object
that lets the game refer to a sound it started. The game wraps all of this in one small Thumb
module at `0x02088400`..`0x02089D40` (one C++ object; `0x02088434` returns it). Thumb is the
16-bit ARM instruction set; addresses below are the function starts without the Thumb `+1`.
"Ticks" are the game's 30 Hz counter (`Game_get()+0x8B4`); "frames" are 60 Hz VBlanks.

## Entry points

| address | mode | name | what it does | confidence |
|---|---|---|---|---|
| `0x02089484` | Thumb | `Snd_init` | Allocates a 0xA7800-byte sound heap, calls `Snd_openArchive`, sets music type 5 / faction 6 | likely |
| `0x02089B44` | Thumb | `Snd_openArchive` | `NNS_SndArcInit(0x02155434, "Sound/sound_data.sdat", heap)`, player setup, stream setup (prio 10), inits the two stream handles at `0x021553EC` and the two SFX handles | likely |
| `0x02089AEC` / `0x02089B08` | Thumb | `Snd_loadSeqArc` / `Snd_loadBank` | Load one SEQARC / one bank into the sound heap; `0x02089BBC` saves the heap state after each | likely |
| `0x02088570` | Thumb | `Snd_onGameCreated` | Match start (event 0x0D): loads SEQARC 0, 1, the SEQARC and bank of every entity of all four players, each hero's spell SEQARCs and banks, then SEQARC 201, 202, 216 and banks 184, 185, 199, 1; then starts the music | confirmed (music start seen) |
| `0x02089A8C` | Thumb | `Snd_playSeqArc(arc, index)` | **The only place a sound effect starts.** Skips if this (arc, index) already started this frame; otherwise `NNS_SndArcPlaySeqArc` (`0x02107750`) on handle `0x021553BC` (arcs 0, 1) or `0x021553E0` (all others) | confirmed |
| `0x02088978` | Thumb | `Snd_play(this, arc, index)` | Calls `Snd_playSeqArc` only once the sound system is fully loaded (state >= 2) | confirmed |
| `0x02089250` | Thumb | `Snd_playUnitEvent(this, unit handle, event)` | Arc from the unit's entity record, index = event (table below); only if the unit is in the sound view | confirmed |
| `0x02089210` | Thumb | `Snd_playSpell(this, caster handle, spell id, second)` | Arc from the spell id, index = `second ? 1 : 0`; only if the caster is in the sound view | confirmed |
| `0x02089290` | Thumb | `Snd_playFe(this, code)` | SEQARC 0 (front end) by code | confirmed |
| `0x020892F4` | Thumb | `Snd_playUi(this, code)` | SEQARC 1 (in-game UI) by code | confirmed |
| `0x020890DC` | Thumb | `Snd_playCollectable(this, item handle)` | SEQARC 216 by pickup type; only if in the sound view | likely |
| `0x0208936C` | Thumb | `Snd_inView(this, unit)` | The view test, see "Positional?" | confirmed |
| `0x020889F8` | Thumb | `Snd_entitySeqArc(entity)` | Entity -> SEQARC number, see "Which SEQARC" | confirmed |
| `0x02088CC4` | Thumb | `Snd_entityBank(entity)` | Entity -> bank number (same shape) | likely |
| `0x02088F24` / `0x02089000` | Thumb | `Snd_spellSeqArc` / `Snd_spellBank` | Spell id -> SEQARC / bank | confirmed |
| `0x020897D4` | Thumb | `Snd_update` | Per frame: music hand-over, then clears the 217 x 20 "started this frame" table at `0x02155798` | confirmed |
| `0x02088994` | Thumb | `Snd_battleMusicTimeout` | Per frame: battle music back to calm music 450 ticks after the last "hero under attack" | confirmed |
| `0x02088538` | Thumb | `Snd_onEvent` | Event listener: 0x0D game created, 0x0F destroyed, 0x36 hero under attack, 0x39 team status | likely |
| `0x020888E8` | Thumb | `Snd_onHeroUnderAttack` | Event 0x36: records the time (`0x02155360`); calm -> battle music | confirmed |
| `0x0208885C` | Thumb | `Snd_onTeamStatus` | Event 0x39 for the local team: victory / defeat music | likely |
| `0x020898C8` / `0x020898E8` | Thumb | `Snd_setMusicFaction` / `Snd_setMusicType` | Music state, see "Music" | confirmed |
| `0x02089954` | Thumb | `Snd_prepareMusic` | Picks the next STRM and prepares it on the idle stream handle (`0x02107A60`, NNS stream start-with-prepare) | confirmed |
| `0x020899EC` | Thumb | `Snd_startPreparedMusic` | Starts the prepared stream, stops the old one, swaps handles, applies the music volume | confirmed |
| `0x02089A64` | Thumb | `Snd_stopMusic(frames)` | Stops the playing stream with a fade of `frames` (always 0 = cut in battle) | confirmed |
| `0x02089BD4` | Thumb | `Snd_nextPlaylistTrack(faction, type)` | Next entry of the faction's playlist for that music type | confirmed |
| `0x02089C18` | Thumb | `Snd_musicBase(faction, type)` | First STRM number for a faction and music type | confirmed |
| `0x02089860` / `0x020898A4` / `0x02089878` | Thumb | `Snd_setMasterVolume` / `Snd_setSfxVolume` / `Snd_setMusicVolume` | Clamp to 127; SFX volume goes to players 0 and 1 (`0x02105590`), music volume to both stream handles (`0x02107B14`) | likely |
| `0x02086614` | ARM | `Player_setBricks` | Plays UI code 12 (COINS) when the local player's bricks change | confirmed |

Wrapper calls the rest of the game uses (`this` = `0x02088434()`): `0x02088948` stop music,
`0x02088954` prepare + start music, `0x02088960` set faction, `0x0208896C` set type.

## Which SEQARC an entity uses (confirmed)

`Snd_entitySeqArc` keys on the **entity index** (record +0x04), not on the role byte. The role
(+0x5C) only decides unit vs building: roles 0-6 are units, 7-19 buildings.

- Index 0..119 (the six main factions, 20 entities each, in the order King, Wizard, Pirate, Imperial,
  Earth, Alien): `slot = index % 20`, `faction = index / 20`.
  - units (slots 0-9: hero, female hero, builder, melee, ranged, mounted, siege 1-3, transport):
    `arc = 2 + 10 * faction + slot`
  - buildings (slots 10-19: base, mill, mine, farm, barracks, special production, tower 1-3,
    shipyard): `arc = 62 + 10 * faction + (slot - 10)`
- Index 120..181 (walls, bridges, gates, bonus "colour faction" entities): a switch,
  `arc = 122 + (index - 120)` for most, with these exceptions: Wall 120 -> 122, all six bridges
  121-126 -> 123, both gates 127-128 -> 124, and from SpacePoliceCaptain (129) on
  `arc = index - 4` (129 -> 125 ... 181 Santa -> 177).
- Anything else: `0xFFFF` = silent.

Two bugs in the shipped game, both read from the code and reproduced by running the function:

- **Alien Shipyard (index 119) is silent.** The last range test is `index < 119` instead of `<= 119`,
  so it falls through to the colour-faction switch, which starts at 120. SEQARC 121
  (`SEQARC__ALIEN_SHIPYARD`) is never used.
- **Troll King (165) uses `SEQARC__TROLLBASE` (164)** instead of `TROLLHERO` (161): the switch
  has 164 written twice.

`extract` can compute the arc from the ROM's entity table with exactly this rule; no table needs
copying. Banks (`Snd_entityBank`) follow the same shape: unit `3 + 10*faction + slot`, building
`64 + 10*faction + slot - 10` (likely; many colour-faction entities have no bank and use
`BANK_COMMON`).

## Unit and building events

`Snd_playUnitEvent` passes the event straight through as the index inside the entity's SEQARC.
Unit SEQARCs have 5 entries (ONSELECT, ONDEATH, ONSTRIKE, ONHIT, ONSPECIAL), buildings 3
(ONSELECT, ONDEATH, ONHIT), colour factions 4 (ONSELECT, ONDEATH, ONSTRIKE, ONHIT).

| event | when | whose sound | where | confidence |
|---|---|---|---|---|
| 0 ONSELECT | the local player makes a new selection: tap, or drag box. Every unit in the new selection plays its own ONSELECT (with the frame de-dup, one per kind) after UI code 2. Tapping a unit that is already selected plays only UI code 3, no ONSELECT | each selected unit | `0x020E2F88` | confirmed (King, Builder, Castle, Builder + King drag) |
| 0 ONSELECT | a unit finishes training | the new unit | `ProduceUnitEntityCommand` `0x020724D0` | confirmed (CPU units logged, silent off-view) |
| 0 ONSELECT | a building finishes construction | the building | `ConstructStructureEntityCommand` `0x02069C98` | confirmed (King Farm) |
| 1 ONDEATH | an entity dies (start of its die command) | the dead entity | `DieEntityCommand` `0x0206A0D0` | confirmed (Wizard Swordsman) |
| 2 ONSTRIKE | every attack that lands (melee) or fires (ranged), on the attacker's cooldown: King every 20 ticks, Swordsman every 30 | the **attacker** | `0x020507xx` attack update: melee `0x02050BE4`, ranged `0x02050EE8`; attack-on-a-cell variant `0x020511CC` / `0x020514A4` | confirmed (melee); likely (ranged) |
| 2 ONSTRIKE | a Builder chopping a tree: at most once per 15 ticks of chopping | the builder | `HarvestAction` `0x0205333C` | confirmed |
| 4 ONSPECIAL | a Builder starts constructing (once, when work begins, not per hammer blow) | the builder | `ConstructStructureEntityCommand` `0x02069770`; also `ConstructMultipleEntityCommand` `0x0206847C` | confirmed (single building) |
| 3 ONHIT | **never**: nothing in ARM9 passes event 3 | - | - | likely (all 12 call sites read) |

Consequences of "index = event":

- A **building** that attacks (towers) plays index 2, which for buildings is `..._ONHIT`. So tower
  "ONHIT" is really their firing sound. likely (code; no tower fight was logged)
- Units' `_ONHIT` entries are dead data, and so are buildings' when they don't attack.
- Being hit makes no sound of its own; only the attacker's strike plays.

## Spells (confirmed for heal, likely for the rest)

`Snd_spellSeqArc` maps spell ids (see spells.md) to SEQARCs. The spell plays with the **caster's**
handle, so it is silent if the caster is out of view.

| spell id | SEQARC | | spell id | SEQARC |
|---|---|---|---|---|
| 1 | 201 HEALINGHERO | | 18 | 211 ROAR |
| 2 | 202 HEALINGUNITEFFECT | | 19 | 190 CHOPPINGBUFF |
| 3 | 200 HEALINGAREAEFFECT | | 20 | 209 MONKEYSWARM |
| 4 | 189 BUFFSPEEDINCREASEPERUNIT | | 21 | 192 CRABSWARM |
| 5 | 188 BUFFSPEEDINCREASEAREAEFFECT | | 23 | 183 ARTILLERY |
| 6 | 187 BUFFDAMAGEINCREASEPERUNIT | | 25 | 182 ARROWVOLLEY |
| 7 | 186 BUFFDAMAGEINCREASEAREAEFFECT | | 26 | 213 TELEPORT |
| 8 | 185 BUFFARMOURINCREASEPERUNIT | | 27 | 195 EMP |
| 9 | 184 BUFFARMOURINCREASEAREAEFFECT | | 28 | 212 SPACELASER |
| 10 | 199 FORESTSPAWN | | 29 | 196 ESPATTACK |
| 11 | 193 CRYSTALSPAWN | | 30 | 215 TRACKING |
| 12 | 205 JUNGLESPAWN | | 31 | 191 CLUSTERBOMB |
| 13 | 194 EARTHQUAKE | | 32 | 203 HOTWIRE |
| 14 | 197 FIREBALL | | 33 | 207 LIGHTNINGBOLTDAMAGE |
| 15 | 206 LIGHTNINGBOLT | | 34 | 198 FIREBALLEXPLOSION |
| 16 | 214 THUNDERHAMMER | | 0, 22, 24 | none |
| 17 | 208 MININGBUFF | | | |

When:

- **Cast:** `Spell_create` (`0x0207BBEC`) plays the spell's own id when the spell object is made, i.e.
  at cast time (sites `0x0207BD44`..`0x0207C124`). likely (the CPU Wizard's cast of spell 5 was
  logged and dropped as off-view)
- **Impact:** `ProjectileSpellFireBall` (`0x02079268`), `ProjectileSpellLightningBolt`
  (`0x02079C1C`) and `ProjectileSpellThunderHammer` (`0x0207A1C0`) play a second id when the
  projectile arrives; the damage-area ids 33 (LIGHTNINGBOLTDAMAGE) and 34 (FIREBALLEXPLOSION) fit
  this. So FIREBALL / LIGHTNINGBOLT play on cast, FIREBALLEXPLOSION / LIGHTNINGBOLTDAMAGE on impact.
  likely (code; the exact id comes from the spell object, not checked in the emulator)
- **Heal pulses:** `HealSpell` (`0x02078728`) plays its id every pulse in which it heals a damaged unit
  (not buildings). confirmed: a hero standing at its base logs spell 1 (HEALINGHERO) with the base as
  caster.
- **Crab Swarm:** `CrabSwarmEffect` (`0x02014000`) plays spell 21 index 1 (`SE_SPELL_CRABSWARM_ONSTRIKE`),
  the only use of the `second` flag. likely

## Projectiles: no impact sounds (likely)

SEQARCs 178-181 (ARROWSTRIKE, BOULDERSTRIKE, CANNONSTRIKE, FIREBALLSTRIKE) are never loaded and
never played: no mapping function returns them and `Snd_playSeqArc` has a single caller. A ranged
shot sounds only through the shooter's ONSTRIKE at the moment it fires.

## Collectables

`Snd_playCollectable`: Red Bricks (entity 441-458) -> index 2 `SE_REDBRICK_ONSELECT`, Minikits
(459-548) -> index 1 `SE_MINIKIT_ONSELECT`, everything else (studs/coins) -> index 0
`SE_COLLECTIBLES_ONSELECT`. Gated by the view test on the item. likely (code; one pickup was logged
off-view and stayed silent)

## UI sounds

In-game buttons use both SEQARC 0 (front end) and SEQARC 1 (UI). Code -> sound, from running the two
functions:

- `Snd_playFe` codes: 0 ACCEPT, 1/5/10/11/12 BACK1, 2 CLICK1, 3 CLICK2, 4 CLICK3, 6 ERROR, 7 MAGIC1,
  8 SELECT, 9 MAGIC2, 13 MAGIC3, 14 MISSIONLOCKED.
- `Snd_playUi` codes: 0-7, 10, 13, 14, 17 BACK1; 8 CLOCKTICK; 9 CLOCKTICKFAST; 11 OBJECTIVECOMPLETE;
  12 COINS; 15 MAGIC1; 16 MAGIC3; 18 MENUSLIDECLICK; 19 GROUPSET; 20 GROUPSELECT; 21 SCREENSWAP;
  22 FIREWORKS. Most of the UI SEQARC (ACCEPT, CLICKs, ERROR, SELECT...) is never used in battle.

| action | sound | caller | confidence |
|---|---|---|---|
| Any button on the touch screen (strip tab, build icon, check mark) | FE CLICK1 (code 2) | generic button `0x020E5624` | confirmed |
| New selection (tap or drag) | UI BACK1 (code 2), then each unit's ONSELECT | `0x020E2FA2` | confirmed |
| Tap an already selected unit | UI BACK1 (code 3) | `0x020E318C` | confirmed |
| Move order (tap ground with units selected, or confirm a building site) | UI BACK1 (code 4) | `0x02083C0C` | confirmed |
| Other order type (attack?) | UI BACK1 (code 6) | `0x02083C1C` | guess |
| Strip slides open | UI MENUSLIDECLICK (code 18), once per icon as it slides in (5-6 in a few frames) | `0x020D8D06` | confirmed |
| Build-strip icon you can't use (tapping the 1000-brick Castle with 500) | UI BACK1 (code 7) | `0x020DC1A8` (8 sites) | confirmed |
| Local player's bricks change (spend, harvest, the +5 trickle every 1800 ticks, start of match) | UI COINS (code 12) | `Player_setBricks` `0x020866B8` | confirmed |
| Group set / group select | UI GROUPSET (19) / GROUPSELECT (20) | `0x020E3256` / `0x020E3086` | likely (code; button not found) |
| Objective complete | UI OBJECTIVECOMPLETE (11) | `0x0204A020` | likely |
| Countdown timer ticking / last seconds | UI CLOCKTICK (8) / CLOCKTICKFAST (9) | `0x0204A5FE` / `0x0204A60E` | likely |
| Screen swap | UI SCREENSWAP (21) | `0x020DDD3A` | likely |
| Victory fireworks | UI FIREWORKS (22) | `0x020D9F56` | guess |
| Spell strip buttons | UI MAGIC1 (15) / MAGIC3 (16) | `0x020DBBBE`, `0x020D574E`.. | guess |
| Research/upgrade finishing (one branch spawns a unit and selects it) | UI BACK1 (code 17) | `0x02073618`, `0x02073778` | guess |
| Builder can't harvest (order refused) | FE ERROR (code 6) | `HarvestEngineerEntityCommand` `0x0206CA6C` | likely |
| Front-end menus | FE ACCEPT / BACK1 / CLICK1 / ERROR / SELECT / MISSIONLOCKED | `0x020AD...`-`0x020D...` | confirmed for CLICK1 |

## Positional? Limits?

- **Not positional.** Effects always play at the sequence's own volume and pan; nothing passes a pan
  or volume per sound (the reads after `NNS_SndArcPlaySeqArc` are unused debug getters). confirmed (code)
- **View gate instead:** unit, spell and collectable sounds play only if the unit's cell (+0x128, +0x129)
  is inside a rectangle around the camera: `(cx-2, cy-2)` to `(cx+13, cy+14)` inclusive, clamped to the
  map, where `(cx, cy)` comes from the camera (`0x02008570`); cached until the camera cell changes. At
  game start on The Pond this was cells (3,7)-(18,23): the 16 visible columns, and the visible rows plus
  a couple of rows above and below. confirmed (rectangle logged; off-view CPU units stayed silent)
- The view test does not check ownership or fog: enemy units in view play their sounds too (the Wizard
  Swordsman's strikes and death played). confirmed
- **De-dup:** each (SEQARC, index) starts at most once per frame (`0x02155798`, cleared in `Snd_update`).
  Ten King Swordsmen hitting in the same frame make one sound. confirmed (repeated MENUSLIDECLICK calls)
- No other rate limit, except the builder's 15-tick chop throttle and the hero-attack alert below.
- Handles: arcs 0-1 share one handle, everything else another. Starting a sound releases the handle
  from the previous one without stopping it, so sounds overlap. likely (NNS behavior)
- Real limits come from the SDAT players: every sequence in SEQARC 0 and 1 uses player 1
  `PLAYER_INTERFACE` (4 sequences at once, channels 0-3); all others use player 0 `PLAYER_EFFECTS`
  (8 sequences, channels 4, 5, 10-15). Every sequence has volume 127, channel priority 64 and player
  priority 64, except the 6 builders' ONSTRIKE (chop, volume 32) and FIREWORKS (channel priority 65).
  confirmed (SDAT)
- Music uses stream players BGM (channels 6, 7) and BGM1 (8, 9), alternating; stream priority 10.

## Volumes

| what | value | where | confidence |
|---|---|---|---|
| SFX volume | profile option byte 0, default 127; set on players 0 and 1 | `Snd_setSfxVolume` from `0x020AD688` (options) | confirmed (127 in RAM) |
| Music volume | profile option byte 1, **50** in a fresh profile; set on the playing stream handle (`0x02107B14`) every time a track starts | `Snd_setMusicVolume` | confirmed (`0x0214B350` = 50 in RAM) |
| Master volume | 127 | `Snd_setMasterVolume` | likely |
| STRM volume in the SDAT | 127 for all 98 streams | SDAT INFO | confirmed |

The music volume explains the quiet title music: 50/127 on the SDK's volume curve is -8.1 dB
(table at `0x02139928`, entry 50 = -81 in 0.1 dB). The measured -8.9 dB is close; the rest is
probably the SDK's channel volume rounding. likely

The settings block at `0x0214B33C`: +0 music state (2 playing, 3 stopping/stopped), +4 master volume,
+8 music type, +0xC music faction, +0x10 SFX volume, +0x14 music volume.

## Music

**Types** (`+8`): 0 front end, 1 calm (`CAMPAIGN_n` streams), 2 battle (`BATTLE_n`), 3 victory, 4 defeat.

**Faction** (`+0xC`): 0 King, 1 Wizard, 2 Pirate, 3 Imperial, 4 Earth, 5 Alien, 6 none/combined.
In a match it is the **local player's** faction (faction id 0x7C..0x81 minus 0x7C,
`0x020887BE`), not the map's. confirmed for King, likely for the rest.

`Snd_musicBase`: first STRM per faction for types 1-4 (calm, battle, victory, defeat): King 4, 10, 16,
17; Wizard 18, 24, 30, 31; Pirate 66, 72, 78, 79; Imperial 80, 87, 96, 97; Earth 32, 38, 47, 48;
Alien 49, 55, 64, 65. Type 0 ignores the base: factions 0-1 -> STRM 1 CASTLES_FE_THEME, 2-3 -> 2
PIRATES, 4-5 -> 3 MARS, else 0 COMBINED_FE_THEME. confirmed (code; King calm/battle and the combined
theme seen)

**Playlists, not random.** Calm and battle music walk a fixed list per faction (built at boot,
`0x021554C8 + faction*0x78 + type*0x18`, {vtable, byte pointer, count}); each entry is a 1-based
track number added to the base. The list position (`0x021553B4+0xC`) advances by one per track and
wraps at the end. Lists read from RAM (identical every boot, built by code):

| faction | calm (CAMPAIGN_n) | battle (BATTLE_n) |
|---|---|---|
| King | 1 2 1 2 3 4 2 4 6 6 5 5 3 2 2 3 4 6 6 5 5 6 6 | 1 1 2 1 2 3 4 5 5 6 6 4 5 5 3 6 6 2 |
| Wizard | 1 2 3 4 1 2 5 5 6 6 3 4 5 5 4 4 6 6 6 6 4 4 | 1 2 3 4 3 3 5 6 6 2 1 1 6 2 4 6 6 |
| Pirate | 1 2 2 1 3 4 5 5 1 1 2 2 6 6 4 5 6 3 6 3 4 6 | 1 2 3 4 5 7 7 2 3 4 5 5 6 7 8 8 8 9 7 7 4 4 5 5 6 7 7 8 8 8 9 |
| Imperial | 1 2 3 3 4 2 3 2 3 4 5 6 6 3 3 5 6 7 7 6 6 7 7 3 3 | 1 2 3 4 5 2 3 4 5 6 6 7 8 9 9 5 6 6 7 9 9 |
| Earth | 1 2 1 2 2 3 3 4 3 4 5 6 4 4 3 3 5 6 | 1 1 2 3 4 4 5 1 1 2 4 4 5 6 6 7 7 8 5 6 7 7 8 8 |
| Alien | 1 1 2 3 4 5 2 2 3 4 5 6 2 2 3 4 5 6 | 1 2 1 4 3 4 5 6 7 2 1 1 3 4 5 4 3 4 5 6 7 8 9 1 1 3 4 3 4 7 8 9 |

Every entry stays inside its faction's labels (Imperial has 7 calm and 9 battle tracks, Earth and
Alien 9 battle tracks) except the **Pirate battle list**: Pirates have only `BATTLE_1..6`, but the list
holds 7, 8 and 9, which land on STRM 78 `PIRATE_VICTORY`, 79 `PIRATE_DEFEAT` and 80
`IMPERIAL_CAMPAIGN_1`. Read from RAM; a game bug as stored, not checked by ear.

When the type changes (`Snd_setMusicType`), the position restarts: alternately at 0 and at a
per-faction "second half" offset (`0x0215540C + faction*5 + type`: calm King 10, Wizard 12, Pirate 12,
Imperial 9, Earth 12, Alien 11; battle King 7, Wizard 7, Pirate 18, Imperial 8, Earth 12, Alien 21),
toggled by a per-type flag at `0x0215542C`. The flags are global and survive between matches.
Changing faction resets the position to 0. confirmed (King: calm 1,2,1,2,3,4,2,4; battle at position
0 = BATTLE_1, BATTLE_1; back to calm at position 10 = CAMPAIGN_5)

**Track hand-over.** Tracks don't loop. When the playing stream passes half its length, the next
track is prepared on the other stream handle; when the playing one ends, the prepared one starts
(gapless) and the handles swap. The front-end theme is a list of one, so it repeats. Victory/defeat
have empty lists: they replay their single track. confirmed (logged)

**When the type changes:**

| moment | change | fade | confidence |
|---|---|---|---|
| Main menu / front end | type 0, faction 6 -> `COMBINED_FE_THEME` (faction set by the menus) | - | confirmed |
| Pressing Start on the skirmish setup | music stopped | 0 | confirmed |
| Match loaded (`Snd_onGameCreated`) | local faction, type 1 (calm) | - | confirmed |
| Event 0x36 "hero under attack" while calm | type 2 (battle), starts at once | cut (0 frames) | confirmed |
| 450 ticks after the last event 0x36 while battle | back to type 1 | cut | confirmed |
| Local team status changes (event 0x39): 1 defeated or 3 lost -> type 4; 2 won -> type 3; 4 -> type 1 | | cut | likely (code) |

Event 0x36 comes from `Unit_setHp` (`0x0205E7D4`): it is posted only when a game option byte
(`[0x020092A8]+0xD`) is set, the damaged unit is the **local player's hero** (role 0), its HP went down,
and either it was never damaged before or the last post was more than 450 ticks ago (time stored at
unit +0x1A4, only when posting). So only the local hero taking damage starts battle music, other
units fighting don't; and in a long fight the music falls back to calm 450 ticks after the first hit,
then flips to battle again (next playlist entry) on the next hit. confirmed: battle music started at
the Swordsman's first hit on the King, not at the King's first hit on the Swordsman; it returned to
calm ~690 frames after the last post.

## Not resolved

- Which button sets/selects groups and which code path hits GROUPSET/GROUPSELECT, SCREENSWAP and the
  clock ticks; spell cast and impact sounds were not heard in the emulator (a King spell cast would settle
  them).
- Whether `0x020511CC` / `0x020514A4` are tower attacks (index 2 = tower ONHIT) or attack-ground.
- Many SDAT sequences use `BANK_COMMON` (bank 1) instead of their own bank, e.g. every unit's ONDEATH
  and ONHIT; whether they are real sounds or empty placeholders wasn't checked.
- The faction id byte at player +0x31 for custom armies.
