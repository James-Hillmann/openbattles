import { describe, expect, it } from 'vitest';
import { cloneWorld, createWorld, fx, spawnUnit } from '@lbw/sim';
import {
  MUSIC_BATTLE,
  MUSIC_CALM,
  MUSIC_VICTORY,
  MusicPlan,
  ON_DEATH,
  ON_SELECT,
  ON_STRIKE,
  UI_BACK1,
  UI_COINS,
  entitySeqArc,
  selectionSounds,
  spellSeqArc,
  tickSounds,
} from '../../client/src/soundRules';

describe('which SEQARC an entity uses', () => {
  it('follows Snd_entitySeqArc, bugs included', () => {
    expect(entitySeqArc(0, 0)).toBe(2); // King hero -> SEQARC__KING_HEROM
    expect(entitySeqArc(23, 2)).toBe(15); // Wizard slot 3 (melee) -> SEQARC__WIZARD_MELEE
    expect(entitySeqArc(10, 7)).toBe(62); // King base -> SEQARC__KING_BASE
    expect(entitySeqArc(118, 15)).toBe(120); // Alien Tower 3
    expect(entitySeqArc(119, 16)).toBe(-1); // Alien Shipyard: silent in the game
    expect(entitySeqArc(120, 19)).toBe(122); // Wall
    expect(entitySeqArc(124, 17)).toBe(123); // a bridge
    expect(entitySeqArc(128, 18)).toBe(124); // a gate
    expect(entitySeqArc(129, 0)).toBe(125); // SpacePoliceCaptain
    expect(entitySeqArc(165, 0)).toBe(164); // Troll King plays TROLLBASE
    expect(entitySeqArc(181, 0)).toBe(177); // Santa
    expect(entitySeqArc(182, 0)).toBe(-1);
    expect(spellSeqArc(14)).toBe(197);
    expect(spellSeqArc(34)).toBe(198);
    expect(spellSeqArc(22)).toBe(-1);
  });
});

describe('sounds from a sim tick', () => {
  const world = () => createWorld({ seed: 1, players: [{ id: 0, team: 0, bricks: 100, status: 0, start: -1, reservedPop: 0, reservedStars: 0 }] });

  it('plays strikes, deaths, trained units and brick changes', () => {
    const w = world();
    const king = spawnUnit(w, 0, fx(10), fx(10), { kind: 0, role: 0 });
    const sword = spawnUnit(w, 1, fx(20), fx(10), { kind: 23, role: 2 });
    const before = cloneWorld(w);
    king.lastAttack = 5;
    sword.hp = 0;
    const trained = spawnUnit(w, 0, fx(30), fx(10), { kind: 3, role: 2 });
    w.players[0]!.bricks = 105;
    const ev = tickSounds(before, w, 0, new Map());
    expect(ev).toEqual([
      { arc: 2, index: ON_STRIKE, at: king.id },
      { arc: 15, index: ON_DEATH, at: sword.id },
      { arc: 5, index: ON_SELECT, at: trained.id },
      { ...UI_COINS, at: 0 },
    ]);
  });

  it('a new selection plays BACK1 then each unit; re-tapping plays BACK1 only', () => {
    const w = world();
    const a = spawnUnit(w, 0, fx(10), fx(10), { kind: 2, role: 1 });
    expect(selectionSounds(new Set(), new Set([a.id]), w.units)).toEqual([{ ...UI_BACK1, at: 0 }, { arc: 4, index: ON_SELECT, at: 0 }]);
    expect(selectionSounds(new Set([a.id]), new Set([a.id]), w.units)).toEqual([{ ...UI_BACK1, at: 0 }]);
    expect(selectionSounds(new Set([a.id]), new Set(), w.units)).toEqual([]);
  });
});

describe('music plan', () => {
  it('walks the King playlists and restarts at the second-half offset every other change', () => {
    MusicPlan.reset();
    const m = new MusicPlan();
    m.setFaction(0);
    m.setType(MUSIC_CALM);
    // Calm 1, 2, 1, 2 -> STRM_KING_CAMPAIGN_1 (4), _2 (5), ... (seen in the emulator).
    expect([m.next(), m.next(), m.next(), m.next()]).toEqual([4, 5, 4, 5]);
    m.setType(MUSIC_BATTLE);
    expect([m.next(), m.next()]).toEqual([10, 10]); // BATTLE_1, BATTLE_1
    m.setType(MUSIC_CALM);
    expect(m.next()).toBe(8); // position 10 = CAMPAIGN_5
    m.setType(MUSIC_VICTORY);
    expect([m.next(), m.next()]).toEqual([16, 16]);
  });
});

describe('on-screen volume', () => {
  it('starts at 40% (-16 dB) and maps the slider squared', async () => {
    const { DEFAULT_VOLUME, masterGain } = await import('../../client/src/audio');
    expect(DEFAULT_VOLUME).toBe(40);
    expect(20 * Math.log10(masterGain(DEFAULT_VOLUME))).toBeCloseTo(-15.9, 1);
    expect([masterGain(0), masterGain(100), masterGain(150), masterGain(-5)]).toEqual([0, 1, 1, 0]);
  });
});
