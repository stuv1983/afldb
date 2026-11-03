import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { captaincyEntryProblem, naturalKey, rowDigest, type Entry, type Existing, type Live } from '../tools/v2/gap029-captaincy-additions-production';

const evidence = JSON.parse(readFileSync(join(__dirname, '../docs/v2/evidence/gap-029-captaincy-additions-2026-11-03.json'), 'utf8')) as { entries: Entry[]; trackedManifest: { rows: number } };
const clubs: Record<string, number> = { Melbourne: 15, 'Gold Coast': 11 };
const players: Record<string, number> = { 'players/C/Cameron_Bruce.html': 2489, 'players/J/James_McDonald.html': 6730, 'players/S/Steven_May.html': 12093, 'players/J/Jarrod_Witts.html': 6815 };

function live(over: Partial<Live> = {}): Live {
  return { sourceId: 11, seasons: new Set([2008, 2017, 2018, 2019, 2020, 2021]),
    clubIds: new Map(Object.entries(clubs).map(([k, v]) => [k, [v]])), playerIds: new Map(Object.entries(players).map(([k, v]) => [k, [v]])),
    bySourceKey: new Map(), byNaturalKey: new Map(), ...over };
}
const held = (e: Entry, over: Partial<Existing> = {}): Existing => ({ id: 1, season: e.season, club_id: clubs[e.club], player_id: players[e.afltablesProfile], player_name_raw: e.player,
  link_status_value: e.linkStatus, role: e.role, period: e.period, notes: e.note, source_id: 11, source_record_id: e.sourceKey, ...over });

describe('GAP-029 D1 captaincy additions (pure validation)', () => {
  it('names exactly the seven reviewed rows and their digests are intact', () => {
    expect(evidence.entries).toHaveLength(7);
    expect(new Set(evidence.entries.map((e) => e.sourceKey)).size).toBe(7);
    expect(evidence.trackedManifest.rows).toBe(1781);
    for (const e of evidence.entries) expect(rowDigest(e)).toBe(e.rowSha256);
    expect(evidence.entries.map((e) => `${e.season} ${e.club} ${e.player}`)).toEqual([
      '2008 Melbourne Cameron Bruce', '2008 Melbourne James McDonald', '2017 Gold Coast Steven May', '2018 Gold Coast Steven May',
      '2019 Gold Coast Jarrod Witts', '2020 Gold Coast Jarrod Witts', '2021 Gold Coast Jarrod Witts']);
  });
  it('resolves every row to an insert against a target that lacks them', () => {
    for (const e of evidence.entries) {
      expect(captaincyEntryProblem(e, live())).toEqual({ clubId: clubs[e.club], playerId: players[e.afltablesProfile], action: 'to insert' });
    }
  });
  it('treats an exactly equal existing row as already present and any difference as a refusal', () => {
    const e = evidence.entries[0];
    const l = (row: Existing) => live({ bySourceKey: new Map([[e.sourceKey, row]]) });
    expect(captaincyEntryProblem(e, l(held(e)))).toMatchObject({ action: 'already present' });
    for (const over of [{ period: 'other' }, { notes: null }, { player_id: 1 }, { club_id: 1 }, { role: 'Vice-Captain' }, { source_id: 1 }]) {
      expect(captaincyEntryProblem(e, l(held(e, over)))).toMatch(/held by row 1 with different content/);
    }
  });
  it('refuses a natural-key clash with a foreign row and never adopts it', () => {
    const e = evidence.entries[2];
    const clash = held(e, { id: 9, source_record_id: 'someone-else' });
    const result = captaincyEntryProblem(e, live({ byNaturalKey: new Map([[naturalKey(e.season, clubs[e.club], e.player, e.role), clash]]) }));
    expect(result).toMatch(/natural key .* held by row 9/);
  });
  it('refuses ambiguous or missing identities, unknown seasons, a tampered row and an unregistered source', () => {
    const e = evidence.entries[1];
    expect(captaincyEntryProblem(e, live({ playerIds: new Map() }))).toMatch(/0 players/);
    expect(captaincyEntryProblem(e, live({ playerIds: new Map([[e.afltablesProfile, [1, 2]]]) }))).toMatch(/2 players/);
    expect(captaincyEntryProblem(e, live({ clubIds: new Map([[e.club, [1, 2]]]) }))).toMatch(/2 clubs/);
    expect(captaincyEntryProblem(e, live({ seasons: new Set() }))).toMatch(/season 2008 is not registered/);
    expect(captaincyEntryProblem(e, live({ sourceId: null }))).toMatch(/not registered/);
    expect(captaincyEntryProblem({ ...e, period: 'changed' }, live())).toMatch(/digest differs/);
    expect(captaincyEntryProblem({ ...e, linkStatus: 'resolved', rowSha256: rowDigest({ ...e, linkStatus: 'resolved' }) }, live())).toMatch(/only a unique-linked row/);
  });
});
