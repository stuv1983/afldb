import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { entryProblem, type Entry, type Row } from '../tools/v2/gap029-label-checks';
import {
  EVIDENCE_PATH_PATTERN, REKEY_KEY, TIER_P_DATABASE_PATTERN, TOKEN_PATTERN, VOLATILE_COLUMNS, fingerprintDigest, fingerprintSql, rekeyEntries, rekeyedDocument, soleResolution, targetProblems,
  type LabelEntry, type TargetFacts,
} from '../tools/v2/rebuild-tier-p';

const entry = (venueRaw: string | null | undefined = 'M.C.G.'): Entry => ({
  family: 'Anzac Day', label: 'Anzac Day', year: 1995, matchId: 10834,
  expect: { season: 1995, matchDate: '1995-04-25', roundCode: '4', venueRaw: venueRaw as string | null, homeClub: 'Collingwood', awayClub: 'Essendon', homeScore: 111, awayScore: 111 },
});
const row = (over: Partial<Row> = {}): Row => ({ id: 10834, season: 1995, match_date: '1995-04-25', round_code: '4', venue_raw: 'M.C.G.', hn: 'Collingwood', an: 'Essendon', hs: 111, aws: 111, match_event: null, ...over });

describe('GAP-029 label identity check', () => {
  it('accepts an unlabelled row and an already-labelled row that match every identity field', () => {
    expect(entryProblem(entry(), row())).toBeNull();
    expect(entryProblem(entry(), row({ match_event: 'Anzac Day' }))).toBeNull();
  });
  it('refuses a missing row, a different event and each changed identity field', () => {
    expect(entryProblem(entry(), undefined)).toMatch(/not found/);
    expect(entryProblem(entry(), row({ match_event: "King's Birthday" }))).toMatch(/different event/);
    for (const over of [{ season: 1996 }, { match_date: '1995-04-26' }, { round_code: '5' }, { hn: 'Essendon' }, { an: 'Carlton' }, { hs: 112 }, { aws: 110 }] as Partial<Row>[]) {
      expect(entryProblem(entry(), row(over)), JSON.stringify(over)).toMatch(/expected identity/);
    }
  });
  it('refuses a changed venue identity, including a venue that has become NULL', () => {
    expect(entryProblem(entry(), row({ venue_raw: 'Waverley Park' }))).toMatch(/expected identity/);
    expect(entryProblem(entry(), row({ venue_raw: 'm.c.g.' }))).toMatch(/expected identity/);
    expect(entryProblem(entry(), row({ venue_raw: null }))).toMatch(/expected identity/);
  });
  it('keeps NULL meaning: an evidenced NULL venue matches only a live NULL, and a missing evidence key refuses', () => {
    expect(entryProblem(entry(null), row({ venue_raw: null }))).toBeNull();
    expect(entryProblem(entry(null), row({ venue_raw: 'M.C.G.' }))).toMatch(/expected identity/);
    expect(entryProblem(entry(undefined), row({ venue_raw: null }))).toMatch(/expected identity/);
  });
});

/* ISSUE-363 (Q9 "S + P-full"): the opt-in tier P overlay. The database-backed run is recorded in docs/v2/evidence/backlog-20261121/issue363-tierp/. */
describe('tier P overlay: target refusals', () => {
  const good = (over: Partial<TargetFacts> = {}): TargetFacts => ({
    dsn: 'postgresql://afldb_owner:s3cret@127.0.0.1:61530/afldb_v2_rb_p1_overlay_test',
    importDsn: 'postgresql://afldb_import:s3cret@127.0.0.1:61530/afldb_v2_rb_p1_overlay_test', port: 61530,
    clusterName: 'afldb_v2_isolated', databaseComment: 'afldb-v2-isolated-test', currentDatabase: 'afldb_v2_rb_p1_overlay_test',
    isTemplate: false, templateName: 'afldb_v2_rb_tpl_test', templateMarker: 'afldb-v2-isolated-test', authUsers: 0, ...over,
  });
  it('accepts a fresh, marked, loopback copy of a marked template with no accounts', () => {
    expect(targetProblems(good())).toEqual([]);
  });
  it.each([
    ['a non-loopback host', { dsn: 'postgresql://afldb_owner:s3cret@10.0.0.5:61530/afldb_v2_rb_p1_overlay_test' }, /owner DSN loopback_host/],
    ['a non-loopback import host', { importDsn: 'postgresql://afldb_import:s3cret@10.0.0.5:61530/afldb_v2_rb_p1_overlay_test' }, /import DSN loopback_host/],
    ['the wrong port', { port: 55432 }, /port/],
    ['a database that is not an overlay copy', { dsn: 'postgresql://u:p@127.0.0.1:61530/afldb_v2_rb_p1_test', currentDatabase: 'afldb_v2_rb_p1_test' }, /afldb_v2_rb_\*_overlay_test/],
    ['an import DSN naming another database', { importDsn: 'postgresql://u:p@127.0.0.1:61530/afldb_v2_rb_p2_overlay_test' }, /same database/],
    ['a server that is not the isolated cluster', { clusterName: 'main' }, /cluster_name/],
    ['an unmarked database', { databaseComment: null }, /database_marker/],
    ['a template database', { isTemplate: true }, /is a template database/],
    ['an unreadable template flag', { isTemplate: null }, /not a template/],
    ['a target equal to its template', { templateName: 'afldb_v2_rb_p1_overlay_test' }, /IS the template/],
    ['a missing template name', { templateName: null }, /--template-name is required/],
    ['an unmarked or missing template', { templateMarker: null }, /does not exist or does not carry/],
    ['a template that is not an isolated name', { templateName: 'postgres' }, /not an afldb_v2_\*_test name/],
    ['a pre-existing auth_users row', { authUsers: 1 }, /already holds 1 auth_users/],
    ['an unreadable auth_users count', { authUsers: null }, /could not count auth_users/],
  ] as [string, Partial<TargetFacts>, RegExp][])('refuses %s', (_name, over, message) => {
    expect(targetProblems(good(over)).join('\n')).toMatch(message);
  });
  it('never echoes a host, role or password', () => {
    const text = targetProblems(good({ dsn: 'postgresql://afldb_owner:s3cret@10.0.0.5:61530/other_db', authUsers: 3 })).join('\n');
    expect(text).not.toMatch(/s3cret|10\.0\.0\.5|afldb_owner/);
  });
});

describe('tier P overlay: label rekey by natural key', () => {
  const evidence = JSON.parse(readFileSync(join(__dirname, '..', 'docs/v2/evidence/gap-029-match-event-correction-2026-11-01-r2.json'), 'utf8')) as { entries: LabelEntry[] };
  const three = evidence.entries.slice(0, 3);
  it('keeps every entry that matches exactly one match and records the source id', () => {
    const r = rekeyEntries(three, [[900001], [three[1].matchId], [900003]]);
    expect(r.entries.map((e) => e.matchId)).toEqual([900001, three[1].matchId, 900003]);
    expect(r.entries.map((e) => e.sourceMatchId)).toEqual(three.map((e) => e.matchId));
    expect(r.idChanged).toBe(2);
    expect(r.entries[0].expect).toEqual(three[0].expect);
  });
  it('the tracked evidence holds the 64 reviewed entries and rekeys to itself when ids already agree', () => {
    expect(evidence.entries).toHaveLength(64);
    const r = rekeyEntries(evidence.entries, evidence.entries.map((e) => [e.matchId]));
    expect(r.idChanged).toBe(0);
    expect(r.entries).toHaveLength(64);
  });
  it('refuses the WHOLE run when any entry matches no match', () => {
    expect(() => rekeyEntries(three, [[1], [], [3]])).toThrow(/exactly one match.*0 matches/);
  });
  it('refuses the WHOLE run when any entry matches more than one match', () => {
    expect(() => rekeyEntries(three, [[1], [2, 22], [3]])).toThrow(/exactly one match.*2 matches/);
  });
  it('refuses two entries that land on one target match, and empty evidence', () => {
    expect(() => rekeyEntries(three, [[1], [1], [3]])).toThrow(/same target match/);
    expect(() => rekeyEntries([], [])).toThrow(/no entries/);
  });
  it('writes a deterministic document: counts by label, the source digest, and no clock, host or path', () => {
    const r = rekeyEntries(three, [[11], [12], [13]]);
    const a = rekeyedDocument({ version: 2, entries: [], counts: {} }, r, 'a'.repeat(64));
    expect(rekeyedDocument({ version: 2, entries: [], counts: {} }, r, 'a'.repeat(64))).toBe(a);
    const parsed = JSON.parse(a) as { counts: Record<string, number>; rekeyed: Record<string, unknown> };
    expect(Object.values(parsed.counts).reduce((x, y) => x + y, 0)).toBe(3);
    expect(parsed.rekeyed).toMatchObject({ kept: 3, idChanged: 3, key: REKEY_KEY, sourceSha256: 'a'.repeat(64) });
    expect(a).not.toMatch(/\/mnt\/|\/home\/|[A-Z]:\\|20\d\d-\d\d-\d\dT/);
  });
});

describe('tier P overlay: rookie resolution and the content fingerprint', () => {
  it('resolves a profile only to exactly one player', () => {
    expect(soleResolution('players/H/x.html', [8388])).toBe(8388);
    expect(soleResolution('players/H/x.html', [8388, 8388])).toBe(8388);
    expect(() => soleResolution('players/H/x.html', [])).toThrow(/0 players.*not exactly one/);
    expect(() => soleResolution('players/H/x.html', [1, 2])).toThrow(/2 players.*not exactly one/);
  });
  it('hashes an untouched table whole and a written table without its declared volatile columns', () => {
    expect(fingerprintSql('public', 'players')).toContain('hashtextextended(x::text, 0)');
    const edits = fingerprintSql('public', 'data_edits');
    expect(edits).toContain("ARRAY['created_at']::text[]");
    expect(edits).toContain("regexp_replace(to_jsonb(x) ->> 'new_values'");
    expect(edits).toContain(`regexp_replace(to_jsonb(x) ->> 'note', '${EVIDENCE_PATH_PATTERN}', 'see <rekeyed-evidence>', 'g')`);
    expect(`${TOKEN_PATTERN}${EVIDENCE_PATH_PATTERN}`).not.toContain('\\');
    expect(fingerprintSql('public', 'data_overrides')).toContain("ARRAY['created_at', 'updated_at']::text[]");
    expect(fingerprintSql('staging', 'we"ird')).toContain('"staging"."we""ird"');
  });
  it('declares the written tables only, and a digest that ignores key order', () => {
    expect(Object.keys(VOLATILE_COLUMNS).sort()).toEqual(['public.auth_users', 'public.data_edits', 'public.data_overrides', 'public.draft_picks']);
    expect(fingerprintDigest({ b: '1:2', a: '3:4' })).toBe(fingerprintDigest({ a: '3:4', b: '1:2' }));
    expect(fingerprintDigest({ a: '3:4' })).not.toBe(fingerprintDigest({ a: '3:5' }));
    expect(TOKEN_PATTERN).toMatch(/\{8\}-.*\{12\}/);
    expect(TIER_P_DATABASE_PATTERN.test('afldb_v2_rb_p1_overlay_test')).toBe(true);
    expect(TIER_P_DATABASE_PATTERN.test('afldb_v2_rb_overlay_test')).toBe(false);
  });
});
