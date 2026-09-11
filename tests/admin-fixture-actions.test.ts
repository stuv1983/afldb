/**
 * The pure half of fixture administration (AFLDB-ISSUE-162 Stage 1).
 *
 * Everything here is a decision the code makes BEFORE it writes anything: the
 * durable key shape and its parser, the round rendering, the TBC rules, the
 * season-bound arithmetic, the played-resolution truth table, the edit
 * lifecycle matrix, the batch preview fingerprint — and, driven over a fake
 * transaction, the proof that every precondition refusal really does happen
 * with no statement written. No database, so each rule is exercised in
 * isolation from whatever rows happen to exist.
 *
 * The half that genuinely needs PostgreSQL — that a mutation writes the
 * canonical row, the durable override and the audit row TOGETHER and rolls all
 * three back on any failure, that a fixture survives a real replay including
 * its cancelled and void states, and that entering a fixture moves no derived
 * statistic — is `tests/integration/admin-fixtures.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ postgres: vi.fn(), sql: vi.fn() }));
vi.mock('postgres', () => ({ default: mocks.postgres }));
vi.mock('@/db/client', () => ({ sql: mocks.sql }));

import {
  FINALS_ROUND_CODES,
  FIXTURE_ENTITY_TYPE,
  FIXTURE_FIELD_GROUP,
  FIXTURE_ROUND_TYPES,
  FIXTURE_STATUSES,
  MAX_BATCH_ROWS,
  MAX_HOME_AND_AWAY_ROUND,
  cancelFixture,
  classifyFixtureDiagnostics,
  createFixture,
  createFixtures,
  fixtureBatchFingerprint,
  fixtureEntityKey,
  fixtureOverridePayload,
  fixtureSeasonBounds,
  isAdministrableFixtureSeason,
  isFixtureEditAllowed,
  normaliseSchedule,
  parseFixtureEntityKey,
  renderRound,
  resolvePlayed,
  voidFixture,
  type FixtureRoundType,
} from '@/db/queries/admin-fixtures';

const root = process.cwd();
const readSource = (relative: string) =>
  readFileSync(join(root, relative), 'utf8').replace(/\r\n/g, '\n');

const migration = readSource('src/db/migrations/097_fixtures.sql');
const moduleSource = readSource('src/db/queries/admin-fixtures.ts');
/** The module with every comment removed, for "the CODE never does X" claims. */
const moduleCode = moduleSource
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
/** Just the CREATE TABLE body, for column-level claims. */
const tableDdl = migration.slice(
  migration.indexOf('CREATE TABLE fixtures'), migration.indexOf('CREATE INDEX'),
);

type Responder = (text: string) => unknown[];

/** A postgres.js-shaped tagged template that answers from `respond`. */
type FakeTx = ((first: TemplateStringsArray | string) => unknown) & {
  json: (value: unknown) => unknown;
  unsafe: (text: string) => Promise<unknown>;
};

/**
 * Every jsonb value the current fake transaction has been handed, in order: the
 * durable `data_overrides` payload first, then the audit snapshots. Values are
 * BOUND, so the statement text cannot show what was written and this is the only
 * way to assert on the durable record without a database.
 */
const jsonPayloads: unknown[] = [];

function fakeTx(respond: Responder) {
  const seen: string[] = [];
  const tx = ((first: TemplateStringsArray | string) => {
    if (typeof first === 'string') return { identifier: first };
    const text = first.join('?').replace(/\s+/g, ' ').trim();
    seen.push(text);
    return Promise.resolve(respond(text));
  }) as FakeTx;
  tx.json = (value: unknown) => {
    jsonPayloads.push(value);
    return { json: value };
  };
  tx.unsafe = (text: string) => {
    seen.push(text.replace(/\s+/g, ' ').trim());
    return Promise.resolve(respond(text));
  };
  return { tx, seen };
}

/**
 * Stand in for the import-role connection `withImportConnection()` opens, so a
 * mutation can be driven to its refusal without a database. `seen` is every
 * statement the mutation actually issued — which is how "refused before any
 * write" is PROVED rather than asserted.
 */
function fakeImportConnection(respond: Responder) {
  jsonPayloads.length = 0;
  const { tx, seen } = fakeTx(respond);
  mocks.postgres.mockReturnValue({
    begin: (fn: (t: unknown) => Promise<unknown>) => fn(tx),
    end: async () => {},
  });
  return seen;
}

const CLUBS = [
  { id: 7, slug: 'richmond', name: 'Richmond', organizationId: 7, eligible: true },
  { id: 8, slug: 'carlton', name: 'Carlton', organizationId: 8, eligible: true },
  { id: 9, slug: 'fitzroy', name: 'Fitzroy', organizationId: 9, eligible: false },
  { id: 10, slug: 'geelong', name: 'Geelong', organizationId: 10, eligible: true },
];

/** The default answers: a 2026 register, three eligible clubs, an empty schedule. */
function defaultDb(overrides: Record<string, unknown[]> = {}): Responder {
  return (text) => {
    const flat = text.replace(/\s+/g, ' ');
    for (const [needle, rows] of Object.entries(overrides)) {
      if (flat.includes(needle)) return rows;
    }
    if (flat.includes('max(year)::int')) return [{ maxYear: 2026 }];
    if (flat.includes('pg_advisory_xact_lock')) return [];
    if (flat.includes('FROM clubs c')) return CLUBS;
    if (flat.includes('FROM venues WHERE id')) {
      return [{ id: 55, slug: 'mcg', canonicalName: 'Melbourne Cricket Ground' }];
    }
    if (flat.includes('"exactCount"')) {
      return [{ exactCount: 0, exactMatchId: null, swappedCount: 0, swappedMatchId: null }];
    }
    if (flat.includes('SELECT fixture_key AS "fixtureKey" FROM fixtures')) return [];
    if (flat.includes('END AS "clubId"')) return [];
    if (flat.includes('SELECT id::int AS id FROM fixtures WHERE fixture_key')) return [];
    if (flat.includes('FROM sources WHERE key')) return [{ id: 3 }];
    if (flat.includes('INSERT INTO fixtures')) return [{ id: 900 }];
    return [];
  };
}

const wrote = (seen: string[]) =>
  seen.filter((s) => /INSERT INTO|UPDATE |DELETE FROM/i.test(s));

const VALID: Parameters<typeof createFixture>[0] = {
  season: 2027,
  roundType: 'home_and_away',
  roundNumber: 1,
  homeClubId: 7,
  awayClubId: 8,
  matchDate: '2027-03-18',
  matchTime: '19:20',
  venueId: 55,
  adminUserId: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AFLDB_IMPORT_DATABASE_URL = 'postgresql://fake@127.0.0.1:5432/afldb_test';
});

// -------------------------------------------------------------------------

describe('the durable key shape (§20)', () => {
  it('is a minted token under the manual namespace, and round-trips', () => {
    const token = '3f8c2b1e-0a4d-4c9b-9f11-2b7d6e5a9d2a';
    expect(fixtureEntityKey(token)).toBe(`manual_admin_edit:${token}`);
    expect(parseFixtureEntityKey(fixtureEntityKey(token))).toBe(token);
  });

  it('refuses every shape that is not one', () => {
    for (const bad of ['', 'manual_admin_edit', 'manual_admin_edit:', 'afltables:x', 'token']) {
      expect(parseFixtureEntityKey(bad), bad).toBeNull();
    }
  });

  it('is a token rather than a natural key, so no schedule fact can be in it', () => {
    // §6. The opposite choice to AFLDB-ISSUE-161's natural membership key, and
    // for the opposite reason: every candidate natural key for a fixture — the
    // date, the venue, even the round and the club pair — is a fact an
    // administrator is EXPECTED to correct, so a natural key would change
    // identity on a reschedule.
    const key = fixtureEntityKey('a-token');
    for (const scheduleFact of ['2027-03-18', '19:20', 'mcg', 'richmond', 'carlton']) {
      expect(key, scheduleFact).not.toContain(scheduleFact);
    }
  });
});

describe('the round model (§9)', () => {
  it('renders a home-and-away round as the decimal round code matches uses', () => {
    expect(renderRound({ roundType: 'home_and_away', roundNumber: 1 }))
      .toEqual({ roundType: 'home_and_away', roundNumber: 1, roundCode: '1' });
    expect(renderRound({ roundType: 'home_and_away', roundNumber: 24 }))
      .toEqual({ roundType: 'home_and_away', roundNumber: 24, roundCode: '24' });
    // NOT createMatch()'s `R<n>` rendering (match-admin.ts:146), which the
    // applier itself calls one of three incompatible renderings: the played
    // resolution compares this string to matches.round_code verbatim.
    expect(renderRound({ roundType: 'home_and_away', roundNumber: 5 }))
      .not.toMatchObject({ roundCode: 'R5' });
  });

  it('numbers the Opening Round as round 1 and offers no round 0', () => {
    // AFLDB's convention since 2024 (§2.3). Squiggle and Kali number it 0; the
    // difference is what produced ISSUE-140's 17 duplicate 2026 matches rows.
    expect(renderRound({ roundType: 'home_and_away', roundNumber: 0 }))
      .toMatchObject({ error: expect.stringContaining('Opening Round') });
  });

  it('renders each finals type as its FINALS_CODES key, with no round number', () => {
    for (const [type, code] of Object.entries(FINALS_ROUND_CODES)) {
      expect(renderRound({ roundType: type as FixtureRoundType }))
        .toEqual({ roundType: type, roundNumber: null, roundCode: code });
    }
    // The Wildcard Final is its own type, never collapsed into another (084/085).
    expect(FINALS_ROUND_CODES.wildcard_final).toBe('WF');
    expect(new Set(Object.values(FINALS_ROUND_CODES)).size)
      .toBe(Object.keys(FINALS_ROUND_CODES).length);
  });

  it('refuses a finals fixture that carries a round number, and a bad number', () => {
    expect(renderRound({ roundType: 'grand_final', roundNumber: 25 }))
      .toMatchObject({ error: expect.stringContaining('no round number') });
    for (const n of [null, undefined, -1, 0, MAX_HOME_AND_AWAY_ROUND + 1, 1.5]) {
      expect(
        renderRound({ roundType: 'home_and_away', roundNumber: n as unknown as number }),
        String(n),
      ).toHaveProperty('error');
    }
  });

  it('hard-codes no season shape', () => {
    // §9: no "24 rounds", no "18 clubs", no "9 games per round". The round set
    // for a season is whatever fixtures exist; shape is reported by the
    // diagnostics, never enforced.
    expect(renderRound({ roundType: 'home_and_away', roundNumber: 27 }))
      .toMatchObject({ roundCode: '27' });
    expect(moduleCode).not.toMatch(/\b(?:18|24)\b\s*(?:clubs|rounds)/);
  });
});

describe('the TBC model (§10, D-5)', () => {
  it('treats a blank date, time and venue as genuinely unknown', () => {
    expect(normaliseSchedule({})).toEqual({ matchDate: null, matchTime: null });
    expect(normaliseSchedule({ matchDate: '', matchTime: '' }))
      .toEqual({ matchDate: null, matchTime: null });
    expect(normaliseSchedule({ matchDate: '2027-03-18' }))
      .toEqual({ matchDate: '2027-03-18', matchTime: null });
  });

  it('never invents a midnight, a sentinel date or a TBC venue', () => {
    expect(normaliseSchedule({})).toEqual({ matchDate: null, matchTime: null });
    expect(moduleCode).not.toContain("'00:00'");
    expect(moduleCode).not.toMatch(/1900-01-01|9999-12-31|'TBC'/);
    expect(moduleCode).not.toMatch(/INSERT\s+INTO\s+venues/i);
    expect(migration).not.toMatch(/INSERT\s+INTO\s+venues/i);
  });

  it('refuses a time with no date: that is not a fact, it is two halves of one', () => {
    expect(normaliseSchedule({ matchTime: '19:20' }))
      .toMatchObject({ error: expect.stringContaining('needs a date') });
    // And the database carries the same rule, so no writer, replay or future
    // importer can bypass it.
    expect(tableDdl).toContain('fixtures_time_needs_date_ck');
  });

  it('accepts only HH:MM 24-hour local time and only YYYY-MM-DD dates', () => {
    for (const good of ['00:00', '09:05', '13:40', '19:20', '23:59']) {
      expect(normaliseSchedule({ matchDate: '2027-03-18', matchTime: good }), good)
        .toEqual({ matchDate: '2027-03-18', matchTime: good });
    }
    for (const bad of ['7:20pm', '24:00', '19:60', '1920', '19.20', '7:20']) {
      expect(normaliseSchedule({ matchDate: '2027-03-18', matchTime: bad }), bad)
        .toHaveProperty('error');
    }
    for (const bad of ['18/03/2027', '2027-3-18', 'March 18', '2027-02-30']) {
      expect(normaliseSchedule({ matchDate: bad }), bad).toHaveProperty('error');
    }
  });

  it('refuses a date the CALENDAR does not have, not merely a badly shaped one', () => {
    // The defect this pins: the shape regex plus Date.parse() accepted
    // '2027-02-30', because Date.parse normalises an impossible day rather than
    // rejecting it — it reads as 2 March. A fixture would have been stored on a
    // day that does not exist, or silently moved to one that does.
    // Every string here is well-shaped YYYY-MM-DD, and none of them is a day.
    for (const bad of [
      '2027-02-30', '2027-02-29', '2027-04-31', '2027-06-31', '2027-09-31',
      '2027-11-31', '2027-00-10', '2027-13-01', '2027-01-00', '2027-01-32',
    ]) {
      expect(normaliseSchedule({ matchDate: bad }), bad).toHaveProperty('error');
    }
    // Real days, including a real leap day, are accepted unchanged.
    for (const good of ['2028-02-29', '2000-02-29', '2027-02-28', '2027-12-31']) {
      expect(normaliseSchedule({ matchDate: good }), good)
        .toEqual({ matchDate: good, matchTime: null });
    }
    // A refused date takes its time with it: neither half is stored.
    expect(normaliseSchedule({ matchDate: '2027-02-30', matchTime: '19:20' }))
      .toHaveProperty('error');
    // TBC is untouched by the calendar rule: NULL is not a date to check (D-5).
    expect(normaliseSchedule({ matchDate: null, matchTime: null }))
      .toEqual({ matchDate: null, matchTime: null });
    // And the check is calendar arithmetic, not a time-zone conversion: the
    // value stored is the operator's string, unchanged.
    expect(normaliseSchedule({ matchDate: '2027-03-18', matchTime: '00:30' }))
      .toEqual({ matchDate: '2027-03-18', matchTime: '00:30' });
    expect(moduleCode).not.toContain('Date.parse');
    expect(moduleCode).not.toMatch(/toISOString|getTimezoneOffset|toLocale/);
  });

  it('stores the schedule as a date and local-time TEXT, inventing no second convention', () => {
    // §10: matches.match_time is AFL Tables' Local.start.time verbatim, and
    // matches.scheduled_at has had no reader or writer since migration 003, so
    // no timestamptz scheduling column is added here.
    expect(tableDdl).toMatch(/match_date\s+date,/);
    expect(tableDdl).toMatch(/match_time\s+text,/);
    expect(tableDdl).not.toMatch(/^\s*scheduled_at\s/m);
    expect(tableDdl).not.toMatch(/match_(?:date|time)\s+timestamptz/);
  });
});

describe('the season window (§8, D-3)', () => {
  it('admits the in-progress season and the next one, and nothing else', () => {
    const bounds = fixtureSeasonBounds(2026);
    expect(bounds).toEqual({ first: 2026, last: 2027 });
    expect(isAdministrableFixtureSeason(2026, bounds)).toBe(true);
    expect(isAdministrableFixtureSeason(2027, bounds)).toBe(true);
    expect(isAdministrableFixtureSeason(2025, bounds)).toBe(false);
    expect(isAdministrableFixtureSeason(2028, bounds)).toBe(false);
  });

  it('is EMPTY rather than open when the register says nothing', () => {
    const bounds = fixtureSeasonBounds(null);
    expect(bounds.first).toBeGreaterThan(bounds.last);
    for (const season of [1897, 2026, 2027, 2100]) {
      expect(isAdministrableFixtureSeason(season, bounds), String(season)).toBe(false);
    }
  });

  it('refuses a season outside the window before issuing any statement', async () => {
    const seen = fakeImportConnection(defaultDb());
    const result = await createFixture({ ...VALID, season: 2025 });
    expect(result).toMatchObject({ ok: false, reason: 'season_out_of_window' });
    expect(wrote(seen)).toEqual([]);
  });

  it('writes no seasons, clubs, club_seasons or venues row anywhere (D-3, §11)', () => {
    for (const table of ['seasons', 'clubs', 'club_seasons', 'venues', 'venue_aliases']) {
      expect(moduleCode, table).not.toMatch(new RegExp(
        `INSERT\\s+INTO\\s+${table}\\b|UPDATE\\s+${table}\\b|DELETE\\s+FROM\\s+${table}\\b`, 'i',
      ));
    }
    // It reuses AFLDB-ISSUE-161's ONE eligibility rule rather than adding a
    // second, so the two issues cannot disagree about which clubs exist, and
    // the migration neither defines nor alters a function.
    expect(moduleCode).toContain('afldb_season_list_clubs');
    expect(migration).not.toMatch(/(?:CREATE|CREATE OR REPLACE|ALTER|DROP)\s+FUNCTION/i);
    // And no FK to seasons, for migration 096's reason (§8).
    expect(tableDdl).not.toMatch(/REFERENCES\s+seasons/i);
  });
});

describe('scheduled is not played (§3, §21, S-1)', () => {
  it('never writes matches or any table derived from one', () => {
    for (const table of [
      'matches', 'match_period_scores', 'player_match_stats', 'brownlow_round_votes',
      'club_seasons', 'player_club_season_stats', 'player_season_stats', 'player_career_stats',
      'player_clubs',
    ]) {
      expect(moduleCode, table).not.toMatch(new RegExp(
        `INSERT\\s+INTO\\s+${table}\\b|UPDATE\\s+${table}\\b|DELETE\\s+FROM\\s+${table}\\b`, 'i',
      ));
    }
    expect(moduleCode).not.toMatch(/recomputeClubSeasons|recomputeSeasonMetadata|rebuild_derived/);
  });

  it('has no column a score, result or attendance could ever live in', () => {
    for (const column of [
      'home_score', 'away_score', 'home_goals', 'away_goals', 'home_behinds', 'away_behinds',
      'result', 'margin', 'winner_club_id', 'attendance', 'match_event',
    ]) {
      expect(tableDdl, column).not.toMatch(new RegExp(`^\\s*${column}\\s`, 'm'));
    }
  });

  it('carries no match_id and no match_key, and compares no match_key (D-6)', () => {
    // The operator constraint of 2026-09-11: a played-match association never
    // replaces fixture_key with match_key, so neither may even be storable.
    expect(tableDdl).not.toMatch(/^\s*match_id\s/m);
    expect(tableDdl).not.toMatch(/^\s*match_key\s/m);
    expect(tableDdl).not.toMatch(/REFERENCES\s+matches/i);
    // The prose may NAME match_key; the code may never render or compare one.
    expect(moduleCode).not.toContain('match_key');
    expect(moduleCode).not.toContain('matchKey');
  });
});

describe('the played resolution (§18, D-6)', () => {
  const base = { status: 'scheduled' as const, exactMatchId: 11, swappedMatchId: 22 };

  it('is played on exactly one exact row', () => {
    expect(resolvePlayed({ ...base, exactCount: 1, swappedCount: 0 }))
      .toEqual({ state: 'played', matchId: 11 });
  });

  it('warns, but still links, when only the home/away designation differs', () => {
    expect(resolvePlayed({ ...base, exactCount: 0, swappedCount: 1 }))
      .toEqual({ state: 'played_home_away_differs', matchId: 22 });
  });

  it('is unplayed when nothing matches', () => {
    expect(resolvePlayed({ ...base, exactCount: 0, swappedCount: 0 }))
      .toEqual({ state: 'unplayed', matchId: null });
  });

  it('FAILS CLOSED on every ambiguous shape, linking nothing', () => {
    for (const counts of [
      { exactCount: 2, swappedCount: 0 },
      { exactCount: 1, swappedCount: 1 },
      { exactCount: 0, swappedCount: 2 },
      { exactCount: 2, swappedCount: 1 },
      { exactCount: 1, swappedCount: 2 },
      { exactCount: 3, swappedCount: 5 },
    ]) {
      expect(resolvePlayed({ ...base, ...counts }), JSON.stringify(counts))
        .toEqual({ state: 'ambiguous', matchId: null });
    }
  });

  it('never prefers the exact candidate merely because there is one of it', () => {
    // The defect this pins: `exactCount === 1` alone returned `played`, so a
    // fixture with one exact AND one swapped candidate claimed the exact row.
    // D-6 admits no tie-break. Any competing candidate means two different
    // matches rows could each be this fixture, and guessing would lock the
    // fixture against edits, claim a result it may not have, and compare its
    // schedule against a row chosen by id order rather than by identity.
    for (const swappedCount of [1, 2, 7]) {
      expect(resolvePlayed({ ...base, exactCount: 1, swappedCount }), String(swappedCount))
        .toEqual({ state: 'ambiguous', matchId: null });
    }
    // The only two linking shapes, restated exactly: one candidate in total.
    expect(resolvePlayed({ ...base, exactCount: 1, swappedCount: 0 }))
      .toEqual({ state: 'played', matchId: 11 });
    expect(resolvePlayed({ ...base, exactCount: 0, swappedCount: 1 }))
      .toEqual({ state: 'played_home_away_differs', matchId: 22 });
  });

  it('reads result facts ONLY for the uniquely resolved match, never an arbitrary row', () => {
    // The defect this pins: the result-facts LATERAL picked `ORDER BY m.id
    // LIMIT 1` over every candidate, decided independently of the resolution.
    // An ambiguous fixture could therefore be reported as "the result disagrees
    // with the schedule" against a row chosen by a tie-break.
    const fragment = /const PLAYED_RESULT_FACTS = `([\s\S]*?)`;/.exec(moduleSource)![1];
    expect(fragment).toContain('pl."exactCount" + pl."swappedCount" = 1');
    expect(fragment).not.toMatch(/ORDER BY|LIMIT/i);
    expect(fragment).not.toMatch(/INSERT|UPDATE|DELETE/i);
    // And the TypeScript side refuses to compare anything without a linked match.
    expect(moduleCode)
      .toMatch(/isPlayedState\(resolution\.state\)\s*&&\s*resolution\.matchId !== null/);
  });

  it('never claims a result for a fixture that was entered in error', () => {
    expect(resolvePlayed({ ...base, status: 'void', exactCount: 1, swappedCount: 0 }))
      .toEqual({ state: 'unplayed', matchId: null });
  });

  it('compares season, round code and club ids and nothing else', () => {
    // Date, venue and time are deliberately absent: they are precisely the facts
    // a reschedule changes, so a resolution that used them would stop resolving
    // at the moment it was most needed. No name matching, no date tolerance, no
    // fuzzy fallback — and it is a SELECT, so it never writes.
    const fragment = /export const PLAYED_RESOLUTION_LATERAL = `([\s\S]*?)`;/
      .exec(moduleSource)![1];
    expect(fragment).toContain('m.season = f.season');
    expect(fragment).toContain('m.round_code = f.round_code');
    expect(fragment).toContain('m.home_club_id = f.home_club_id');
    expect(fragment).toContain('m.away_club_id = f.away_club_id');
    for (const forbidden of [
      'match_date', 'match_time', 'venue', 'name', 'similarity', 'ILIKE', 'LIKE ', '%',
    ]) {
      expect(fragment, forbidden).not.toContain(forbidden);
    }
    expect(fragment).not.toMatch(/INSERT|UPDATE|DELETE/i);
  });
});

describe('the edit lifecycle matrix (§15, §16)', () => {
  const groups = [
    'fixture_schedule', 'fixture_venue', 'fixture_round', 'fixture_clubs',
  ] as const;

  it('allows every schedule edit while scheduled and unplayed', () => {
    for (const fieldGroup of groups) {
      expect(isFixtureEditAllowed({ fieldGroup, status: 'scheduled', played: 'unplayed' }))
        .toEqual({ allowed: true });
    }
  });

  it('locks every schedule edit once the fixture resolves to a played match', () => {
    for (const played of ['played', 'played_home_away_differs'] as const) {
      for (const fieldGroup of groups) {
        expect(isFixtureEditAllowed({ fieldGroup, status: 'scheduled', played }), fieldGroup)
          .toMatchObject({ allowed: false, reason: 'played_locked' });
      }
      // Notes are the ONE edit a played fixture accepts.
      expect(isFixtureEditAllowed({ fieldGroup: 'fixture_notes', status: 'scheduled', played }))
        .toEqual({ allowed: true });
    }
  });

  it('does not lock on an AMBIGUOUS resolution, which links nothing', () => {
    expect(isFixtureEditAllowed({
      fieldGroup: 'fixture_schedule', status: 'scheduled', played: 'ambiguous',
    })).toEqual({ allowed: true });
  });

  it('keeps a cancelled fixture editable and a void one frozen', () => {
    for (const fieldGroup of groups) {
      expect(isFixtureEditAllowed({ fieldGroup, status: 'cancelled', played: 'unplayed' }))
        .toEqual({ allowed: true });
      expect(isFixtureEditAllowed({ fieldGroup, status: 'void', played: 'unplayed' }), fieldGroup)
        .toMatchObject({ allowed: false, reason: 'invalid_transition' });
    }
    // Notes stay writable even on a void row, so the record of WHY can be completed.
    expect(isFixtureEditAllowed({
      fieldGroup: 'fixture_notes', status: 'void', played: 'unplayed',
    })).toEqual({ allowed: true });
  });

  it('never deletes a fixture: there is no DELETE FROM fixtures anywhere (D-2)', () => {
    expect(moduleCode).not.toMatch(/DELETE\s+FROM\s+fixtures/i);
    expect(readSource('tools/migration/common.py')).not.toMatch(/DELETE\s+FROM\s+fixtures/i);
  });

  it('requires a reason for both terminal states, before writing anything', async () => {
    for (const fn of [cancelFixture, voidFixture]) {
      const seen = fakeImportConnection(defaultDb());
      const result = await fn({
        fixtureKey: 'k', expectedUpdatedAt: 't', adminUserId: 1, reason: '   ',
      });
      expect(result).toMatchObject({ ok: false, reason: 'validation' });
      expect(wrote(seen)).toEqual([]);
    }
    // And the database carries the same rule.
    expect(tableDdl).toContain('fixtures_status_reason_ck');
  });
});

describe('create preconditions refuse before the first write (§13, §25)', () => {
  it('refuses a fixture between one club and itself', async () => {
    const seen = fakeImportConnection(defaultDb());
    const result = await createFixture({ ...VALID, awayClubId: 7 });
    expect(result).toMatchObject({ ok: false, reason: 'same_club' });
    expect(wrote(seen)).toEqual([]);
  });

  it('refuses an unknown club', async () => {
    const seen = fakeImportConnection(defaultDb());
    const result = await createFixture({ ...VALID, awayClubId: 4242 });
    expect(result).toMatchObject({ ok: false, reason: 'club_ineligible' });
    expect(wrote(seen)).toEqual([]);
  });

  it('refuses a club that is not eligible for the season', async () => {
    const seen = fakeImportConnection(defaultDb());
    const result = await createFixture({ ...VALID, awayClubId: 9 });
    expect(result).toMatchObject({ ok: false, reason: 'club_ineligible', subjects: ['fitzroy'] });
    expect(wrote(seen)).toEqual([]);
  });

  it('refuses an unknown venue rather than inventing one', async () => {
    const seen = fakeImportConnection(defaultDb({ 'FROM venues WHERE id': [] }));
    const result = await createFixture({ ...VALID, venueId: 4242 });
    expect(result).toMatchObject({ ok: false, reason: 'invalid_venue' });
    expect(wrote(seen)).toEqual([]);
  });

  it('refuses the same pair already scheduled in that round', async () => {
    const seen = fakeImportConnection(defaultDb({
      'SELECT fixture_key AS "fixtureKey" FROM fixtures': [{ fixtureKey: 'existing' }],
    }));
    expect(await createFixture(VALID)).toMatchObject({
      ok: false, reason: 'duplicate_fixture',
    });
    expect(wrote(seen)).toEqual([]);
  });

  it('refuses a club that already has a fixture in that round', async () => {
    const seen = fakeImportConnection(defaultDb({
      'END AS "clubId"': [{ clubId: 7, fixtureKey: 'other' }],
    }));
    expect(await createFixture(VALID)).toMatchObject({
      ok: false, reason: 'club_already_scheduled',
    });
    expect(wrote(seen)).toEqual([]);
  });

  it('refuses a game AFLDB already holds as a result', async () => {
    const seen = fakeImportConnection(defaultDb({
      '"exactCount"': [{ exactCount: 1, exactMatchId: 5, swappedCount: 0, swappedMatchId: null }],
    }));
    expect(await createFixture(VALID)).toMatchObject({ ok: false, reason: 'already_played' });
    expect(wrote(seen)).toEqual([]);
  });

  it('writes the canonical row, the durable record and the audit row together', async () => {
    const seen = fakeImportConnection(defaultDb());
    expect(await createFixture(VALID)).toMatchObject({ ok: true, fixtureId: 900 });
    const writes = wrote(seen);
    expect(writes).toHaveLength(3);
    expect(writes[0]).toContain('INSERT INTO fixtures');
    expect(writes[1]).toContain('INSERT INTO data_overrides');
    expect(writes[2]).toContain('INSERT INTO data_edits');
    // And it took the season lock before deciding anything.
    expect(seen.findIndex((s) => s.includes('pg_advisory_xact_lock')))
      .toBeLessThan(seen.findIndex((s) => s.includes('INSERT INTO fixtures')));
  });

  it('audits the fixture itself, not a parent row (§24)', async () => {
    const seen = fakeImportConnection(defaultDb());
    await createFixture(VALID);
    const audit = seen.find((s) => s.includes('INSERT INTO data_edits'))!;
    expect(audit).toContain('table_name');
    // The value is bound, so the statement text alone cannot prove which table
    // name went in; what it CAN prove is that the audit is in the same
    // transaction as the canonical write, which is the ISSUE-027 contract.
    expect(seen.indexOf(audit)).toBeGreaterThan(
      seen.findIndex((s) => s.includes('INSERT INTO fixtures')),
    );
  });
});

describe('the round batch (§14, D-4)', () => {
  const batch = {
    season: 2027,
    roundType: 'home_and_away' as const,
    roundNumber: 5,
    adminUserId: 1,
    rows: [
      { homeClubId: 7, awayClubId: 8, matchDate: '2027-05-01', matchTime: '13:20', venueId: 55 },
    ],
  };

  it('writes NOTHING at all on a preview', async () => {
    const seen = fakeImportConnection(defaultDb());
    expect(await createFixtures({ ...batch, dryRun: true }))
      .toMatchObject({ ok: true, dryRun: true, created: 0 });
    expect(wrote(seen)).toEqual([]);
  });

  it('refuses a confirm whose rows are not the ones that were previewed', async () => {
    const seen = fakeImportConnection(defaultDb());
    const preview = await createFixtures({ ...batch, dryRun: true });
    expect(preview).toMatchObject({ ok: true });
    const { fingerprint } = preview as { fingerprint: string };

    expect(await createFixtures({
      ...batch,
      rows: [{ ...batch.rows[0], venueId: 56 }],
      dryRun: false,
      previewFingerprint: fingerprint,
    })).toMatchObject({ ok: false, reason: 'stale_preview' });

    // A confirm with no fingerprint at all is refused the same way.
    expect(await createFixtures({ ...batch, dryRun: false }))
      .toMatchObject({ ok: false, reason: 'stale_preview' });
    expect(wrote(seen)).toEqual([]);
  });

  it('commits when the confirm carries the preview it was given', async () => {
    const seen = fakeImportConnection(defaultDb());
    const preview = await createFixtures({ ...batch, dryRun: true }) as { fingerprint: string };
    const result = await createFixtures({
      ...batch, dryRun: false, previewFingerprint: preview.fingerprint,
    });
    expect(result).toMatchObject({ ok: true, dryRun: false, created: 1 });
    expect(wrote(seen)).toHaveLength(3);
  });

  it('fingerprints exactly what was submitted, in order', () => {
    const a = fixtureBatchFingerprint(batch);
    expect(fixtureBatchFingerprint({ ...batch })).toBe(a);
    expect(fixtureBatchFingerprint({ ...batch, roundNumber: 6 })).not.toBe(a);
    expect(fixtureBatchFingerprint({
      ...batch, rows: [{ ...batch.rows[0], matchTime: '19:20' }],
    })).not.toBe(a);

    // EVERY material part of the submission is in it, not only the round
    // number and the time. The season in particular: the client's Confirm is
    // additionally gated on a snapshot that omits it (it is a route prop, not
    // an editable field), so the fingerprint is the ONLY thing standing
    // between a re-targeted season and a silent write.
    expect(fixtureBatchFingerprint({ ...batch, season: 2028 })).not.toBe(a);
    expect(fixtureBatchFingerprint({ ...batch, roundType: 'grand_final', roundNumber: null })).not.toBe(a);
    expect(fixtureBatchFingerprint({
      ...batch, rows: [{ ...batch.rows[0], homeClubId: 9 }],
    })).not.toBe(a);
    expect(fixtureBatchFingerprint({
      ...batch, rows: [{ ...batch.rows[0], awayClubId: 9 }],
    })).not.toBe(a);
    expect(fixtureBatchFingerprint({
      ...batch, rows: [{ ...batch.rows[0], matchDate: '2027-05-02' }],
    })).not.toBe(a);
    expect(fixtureBatchFingerprint({
      ...batch, rows: [{ ...batch.rows[0], venueId: 56 }],
    })).not.toBe(a);
    expect(fixtureBatchFingerprint({
      ...batch, rows: [{ ...batch.rows[0], venueId: null, venueRaw: 'A ground not in the register' }],
    })).not.toBe(a);
    expect(fixtureBatchFingerprint({
      ...batch, rows: [{ ...batch.rows[0], notes: 'Gather Round' }],
    })).not.toBe(a);
    // Adding or removing a row is a different submission too.
    expect(fixtureBatchFingerprint({
      ...batch, rows: [...batch.rows, { homeClubId: 9, awayClubId: 10 }],
    })).not.toBe(a);
    // Order is part of the submission: two rows swapped are a different preview.
    const two = { ...batch, rows: [batch.rows[0], { homeClubId: 8, awayClubId: 10 }] };
    const swapped = { ...batch, rows: [{ homeClubId: 8, awayClubId: 10 }, batch.rows[0]] };
    expect(fixtureBatchFingerprint(two)).not.toBe(fixtureBatchFingerprint(swapped));
    // Blank and absent are the same submission: both mean TBC.
    expect(fixtureBatchFingerprint({
      ...batch, rows: [{ ...batch.rows[0], notes: '' }],
    })).toBe(a);
  });

  it('refuses the whole round when the same pair appears twice', async () => {
    const seen = fakeImportConnection(defaultDb());
    const result = await createFixtures({
      ...batch,
      rows: [{ homeClubId: 7, awayClubId: 8 }, { homeClubId: 8, awayClubId: 7 }],
      dryRun: true,
    });
    expect(result).toMatchObject({ ok: false, reason: 'duplicate_fixture' });
    expect((result as { rows: unknown[] }).rows).toHaveLength(2);
    expect(wrote(seen)).toEqual([]);
  });

  it('refuses the whole round when one club appears in two fixtures', async () => {
    const seen = fakeImportConnection(defaultDb());
    expect(await createFixtures({
      ...batch,
      rows: [{ homeClubId: 7, awayClubId: 8 }, { homeClubId: 7, awayClubId: 10 }],
      dryRun: true,
    })).toMatchObject({ ok: false, reason: 'club_already_scheduled' });
    expect(wrote(seen)).toEqual([]);
  });

  it('reports every row, not only the failing one', async () => {
    fakeImportConnection(defaultDb());
    const result = await createFixtures({
      ...batch,
      rows: [
        { homeClubId: 7, awayClubId: 8 },
        { homeClubId: 10, awayClubId: 10 },
        { homeClubId: 9, awayClubId: 10 },
      ],
      dryRun: true,
    }) as unknown as { rows: { index: number; ok: boolean }[] };
    expect(result.rows.map((r) => [r.index, r.ok]))
      .toEqual([[0, true], [1, false], [2, false]]);
  });

  it('caps a submission at one round, not a whole season', async () => {
    const seen = fakeImportConnection(defaultDb());
    const rows = Array.from({ length: MAX_BATCH_ROWS + 1 },
      (_unused, i) => ({ homeClubId: 7, awayClubId: 8 + i }));
    expect(await createFixtures({ ...batch, rows, dryRun: true }))
      .toMatchObject({ ok: false, reason: 'validation' });
    expect(await createFixtures({ ...batch, rows: [], dryRun: true }))
      .toMatchObject({ ok: false, reason: 'validation' });
    expect(wrote(seen)).toEqual([]);
  });

  it('creates no bye row and imposes no "every club once per round" rule', () => {
    // §14, §2.3: a bye is the ABSENCE of a fixture and is never a row, and AFL
    // round shapes vary, so nothing counts games per round. Every mutation in
    // this module precedes the diagnostics, and none of them knows the word.
    const mutations = moduleCode.slice(0, moduleCode.indexOf('classifyFixtureDiagnostics'));
    expect(mutations.length).toBeGreaterThan(0);
    expect(mutations).not.toMatch(/bye/i);
    // It exists only as INFORMATION: reported, never judged, never written.
    expect(moduleCode).toMatch(/severity: 'info',[\s\S]{0,60}code: 'round_byes'/);
  });
});

describe('the durable payload (§20)', () => {
  const scheduled = fixtureOverridePayload({
    fixtureKey: 'token-1',
    season: 2027,
    roundType: 'home_and_away',
    roundNumber: 1,
    roundCode: '1',
    matchDate: null,
    matchTime: null,
    homeClubSlug: 'richmond',
    awayClubSlug: 'carlton',
    venueSlug: null,
    venueRaw: null,
    status: 'scheduled',
  });

  it('names clubs and venues by slug, never by id', () => {
    expect(scheduled).toMatchObject({ home_club_slug: 'richmond', away_club_slug: 'carlton' });
    expect(JSON.stringify(scheduled)).not.toMatch(/club_id|venue_id/);
  });

  it('writes TBC facts as explicit nulls and omits keys that carry nothing', () => {
    // For date and time the null IS the fact (D-5); for the optional keys an
    // absent key and an explicit null are different things to the replay.
    expect(scheduled.match_date).toBeNull();
    expect(scheduled.match_time).toBeNull();
    expect(Object.keys(scheduled)).not.toContain('venue_slug');
    expect(Object.keys(scheduled)).not.toContain('venue_raw');
    expect(Object.keys(scheduled)).not.toContain('notes');
    expect(Object.keys(scheduled)).not.toContain('status_reason');
  });

  it('carries the lifecycle in the payload, so a cancelled row replays as cancelled', () => {
    const cancelled = fixtureOverridePayload({
      fixtureKey: 'token-1',
      season: 2027,
      roundType: 'grand_final',
      roundNumber: null,
      roundCode: 'GF',
      matchDate: '2027-09-25',
      matchTime: null,
      homeClubSlug: 'richmond',
      awayClubSlug: 'carlton',
      venueSlug: 'mcg',
      venueRaw: 'Melbourne Cricket Ground',
      status: 'cancelled',
      statusReason: 'Abandoned: unplayable ground',
    });
    expect(cancelled).toMatchObject({
      status: 'cancelled',
      status_reason: 'Abandoned: unplayable ground',
      round_type: 'grand_final',
      round_number: null,
      round_code: 'GF',
      venue_slug: 'mcg',
    });
  });

  it('carries no result fact of any kind', () => {
    for (const key of Object.keys(scheduled)) {
      expect(key).not.toMatch(/score|goal|behind|margin|winner|attendance|result/);
    }
  });

  it('carries a mapped venue as BOTH its slug and its canonical NAME', async () => {
    // §11, §20, operator clarification 2026-09-11. The replay resolves
    // venue_slug; a database that does not have that venue keeps the fixture,
    // keeps venue_raw and leaves venue_id NULL, warning loudly. That degradation
    // only preserves the venue FACT because the payload always carries the
    // canonical NAME alongside the slug — a payload holding a slug and no name
    // would lose the human-readable venue outright the moment the slug stopped
    // resolving, and this is the assertion that stops that shape existing.
    fakeImportConnection(defaultDb());
    expect(await createFixture(VALID)).toMatchObject({ ok: true });
    // The durable payload is bound as jsonb, so it is asserted as the value it
    // is; index 0 is writeFixtureOverride's, before the two audit snapshots.
    expect(jsonPayloads[0]).toMatchObject({
      venue_slug: 'mcg',
      venue_raw: 'Melbourne Cricket Ground',
    });
  });

  it('carries a typed, unmapped venue as a name with no slug, inventing no venue', async () => {
    fakeImportConnection(defaultDb());
    expect(await createFixture({ ...VALID, venueId: null, venueRaw: '  Norwood Oval  ' }))
      .toMatchObject({ ok: true });
    const payload = jsonPayloads[0] as Record<string, unknown>;
    expect(payload.venue_raw).toBe('Norwood Oval');
    expect(Object.keys(payload)).not.toContain('venue_slug');
  });
});

describe('the diagnostics report and never refuse (§27)', () => {
  const fixture = (over: Partial<Parameters<typeof classifyFixtureDiagnostics>[0]['fixtures'][number]> = {}) => ({
    id: 1,
    fixtureKey: 'k1',
    season: 2027,
    roundCode: '1',
    roundNumber: 1,
    roundType: 'home_and_away' as const,
    isFinal: false,
    matchDate: '2027-03-18',
    matchTime: '19:20',
    venueId: 55,
    venueSlug: 'mcg',
    venueRaw: 'Melbourne Cricket Ground',
    homeClubId: 7,
    homeClubSlug: 'richmond',
    homeClubName: 'Richmond',
    awayClubId: 8,
    awayClubSlug: 'carlton',
    awayClubName: 'Carlton',
    status: 'scheduled' as const,
    statusReason: null,
    notes: null,
    createdAt: 't',
    updatedAt: 't',
    playedState: 'unplayed' as const,
    playedMatchId: null,
    scheduleDiffersFromResult: false,
    ...over,
  });
  const clubs = [
    { id: 7, slug: 'richmond', name: 'Richmond', organizationId: 7 },
    { id: 8, slug: 'carlton', name: 'Carlton', organizationId: 8 },
    { id: 9, slug: 'geelong', name: 'Geelong', organizationId: 9 },
  ];
  const run = (fixtures: ReturnType<typeof fixture>[]) => classifyFixtureDiagnostics({
    fixtures, playedWithoutFixture: [], eligibleClubs: clubs,
  });
  const codes = (fixtures: ReturnType<typeof fixture>[]) => run(fixtures).map((d) => d.code);

  it('reports a club with no fixture in a round as INFORMATION, never as an error', () => {
    const report = run([fixture()]);
    const byes = report.find((d) => d.code === 'round_byes')!;
    expect(byes.severity).toBe('info');
    expect(byes.message).toContain('Geelong');
    expect(report.some((d) => d.severity === 'invalid')).toBe(false);
  });

  it('flags an ambiguous played resolution as invalid and links nothing', () => {
    const report = run([fixture({ playedState: 'ambiguous' })]);
    const bad = report.find((d) => d.code === 'ambiguous_played_resolution')!;
    expect(bad.severity).toBe('invalid');
    expect(bad.fixtureKeys).toEqual(['k1']);
  });

  it('warns on a swapped result, a disagreeing schedule and an unmapped venue', () => {
    expect(codes([fixture({ playedState: 'played_home_away_differs' })]))
      .toContain('played_home_away_differs');
    expect(codes([fixture({ playedState: 'played', scheduleDiffersFromResult: true })]))
      .toContain('schedule_differs_from_result');
    expect(codes([fixture({ venueId: null, venueSlug: null, venueRaw: 'Some Oval' })]))
      .toContain('unmapped_venue');
    // A TBC venue is not "unmapped": nothing has been said about it yet.
    expect(codes([fixture({ venueId: null, venueSlug: null, venueRaw: null })]))
      .not.toContain('unmapped_venue');
  });

  it('reports the impossible states rather than trusting they cannot happen', () => {
    expect(codes([fixture(), fixture({ fixtureKey: 'k2', awayClubId: 9, awayClubSlug: 'geelong' })]))
      .toContain('club_twice_in_round');
    expect(codes([fixture(), fixture({ fixtureKey: 'k2' })]))
      .toContain('pair_twice_in_round');
    expect(codes([fixture({ roundType: 'grand_final', roundNumber: 1, roundCode: 'GF' })]))
      .toContain('round_number_mismatch');
  });

  it('ignores cancelled and void rows in the scheduling rules', () => {
    // A cancelled game did not happen and a void row never was one, so neither
    // occupies its clubs' place in a round.
    expect(codes([fixture(), fixture({ fixtureKey: 'k2', status: 'cancelled' })]))
      .not.toContain('pair_twice_in_round');
    expect(codes([fixture(), fixture({ fixtureKey: 'k3', status: 'void' })]))
      .not.toContain('pair_twice_in_round');
  });

  it('never proposes a change and never refuses', () => {
    for (const d of run([fixture({ playedState: 'ambiguous', scheduleDiffersFromResult: true })])) {
      expect(['invalid', 'warning', 'info']).toContain(d.severity);
    }
    // There is no severity that stops anything: the classifier returns a list.
    expect(Array.isArray(run([fixture()]))).toBe(true);
  });
});

describe('the frozen vocabularies equal the migration', () => {
  it('pins fixtures.status', () => {
    const check = /status\s+text\s+NOT NULL DEFAULT 'scheduled'\s*\n\s*CHECK \(status IN \(([^)]*)\)\)/
      .exec(migration)![1];
    expect([...check.matchAll(/'([a-z]+)'/g)].map((m) => m[1])).toEqual([...FIXTURE_STATUSES]);
  });

  it('pins the round_type enum against migrations 003 and 084', () => {
    const enumBody = /CREATE TYPE round_type AS ENUM \(([\s\S]*?)\)/
      .exec(readSource('src/db/migrations/003_matches.sql'))![1];
    const declared = [...enumBody.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    const added = [...readSource('src/db/migrations/084_round_type_wildcard_final.sql')
      .matchAll(/ALTER TYPE round_type ADD VALUE IF NOT EXISTS '([a-z_]+)'/g)].map((m) => m[1]);
    expect([...FIXTURE_ROUND_TYPES].sort()).toEqual([...declared, ...added].sort());
    // Every finals type has a code, and home_and_away has none.
    expect(Object.keys(FINALS_ROUND_CODES).sort())
      .toEqual(FIXTURE_ROUND_TYPES.filter((t) => t !== 'home_and_away').slice().sort());
  });

  it('pins the entity type and field group the replay decodes', () => {
    expect(FIXTURE_ENTITY_TYPE).toBe('fixtures');
    expect(FIXTURE_FIELD_GROUP).toBe('fixture');
    const py = readSource('tools/migration/common.py');
    expect(py).toContain("WHERE o.entity_type = 'fixtures'");
    expect(py).toContain("AND o.field_group = 'fixture'");
  });

  it('pins the Python copies of both enumerations', () => {
    const py = readSource('tools/migration/common.py');
    const statuses = py.slice(py.indexOf('FIXTURE_STATUSES = ('));
    expect([...statuses.slice(0, statuses.indexOf(')')).matchAll(/"([a-z_]+)"/g)].map((m) => m[1]))
      .toEqual([...FIXTURE_STATUSES]);
    const types = py.slice(py.indexOf('FIXTURE_ROUND_TYPES = ('));
    expect([...types.slice(0, types.indexOf(')')).matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort())
      .toEqual([...FIXTURE_ROUND_TYPES].sort());
  });
});
