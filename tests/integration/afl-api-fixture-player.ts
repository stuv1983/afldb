// tests | shared helpers for the AFL API settle suites: keep the real provider player id out, restore season coverage
// Soft size threshold: 500 LOC. Run `phaneslight loc-check` if uncertain.

import type postgres from 'postgres';

/**
 * ISSUE-363 (remediation run 4, `brownlow` scope; owner item 3): suites that settle the shared AFL API match
 * fixtures must not let the REAL provider player id those files name reach a settle.
 *
 * `tests/fixtures/afl_api/match/03-match-roster.raw.json` (once) and `02-player-stats.raw.json` (twice) name the
 * provider player `CD_I297354`, a REAL id: the 4 Nov production snapshot holds a real `afl_api`
 * `external_identities` row for it (player 7974). A suite that settles the fixture unchanged resolves that id to the
 * real player and writes real-player rows against its synthetic matches. The suites rename it, in an in-memory
 * copy, onto an id they own, and assert that the real row is exactly as they found it.
 *
 * This is the same pattern `settle-afl-api.test.ts` and `settle-afl-api-state-b.test.ts` carry inline (their own
 * `renameFixturePlayer`); this module is the shared form for the Brownlow suites, which keeps one copy of the
 * occurrence counts and of the real-row probe. The shared fixture files are never edited.
 */

/** The provider player id the shared fixture files name. It is REAL; it is only ever READ, never written. */
export const FIXTURE_FILE_PROVIDER_PLAYER_ID = 'CD_I297354';

/** How many times the shared fixture files name it: the roster once, the player stats twice. A change fails loudly. */
export const FIXTURE_FILE_PLAYER_ID_OCCURRENCES = { roster: 1, stats: 2 } as const;

/**
 * A provider player id a suite owns: `CD_I4010` + a six-digit serial. Every real `afl_api` provider player id on the
 * production snapshot is `CD_I` followed by 6 or 7 digits; this one has 10, so no real row can hold it.
 * Each suite takes its own serial, so two suites can never share one.
 */
export function ownedFixtureProviderPlayerId(serial: number): string {
  if (!Number.isInteger(serial) || serial < 1 || serial > 999_999) throw new Error(`bad serial ${serial}`);
  return `CD_I4010${String(serial).padStart(6, '0')}`;
}

/**
 * Rename the real provider player id to `ownId` in a copy of one shared fixture file. `expected` is the number of
 * times the file names it; any other count throws, so a fixture that gains or loses one fails here instead of
 * leaving the real id in.
 */
export function renameFixturePlayer<T>(raw: T, label: string, expected: number, ownId: string): T {
  if (!/^CD_I[0-9]{10}$/.test(ownId)) throw new Error(`'${ownId}' is not a 10-digit owned provider player id`);
  const parts = JSON.stringify(raw).split(`"${FIXTURE_FILE_PROVIDER_PLAYER_ID}"`);
  if (parts.length - 1 !== expected) {
    throw new Error(
      `The shared fixture ${label} names ${FIXTURE_FILE_PROVIDER_PLAYER_ID} ${parts.length - 1} time(s), expected ${expected}; `
      + `this suite cannot rename it onto its own provider player id ${ownId}.`,
    );
  }
  return JSON.parse(parts.join(`"${ownId}"`)) as T;
}

/**
 * The full content of the snapshot's real `(afl_api, CD_I297354)` identity row as one JSON string, or `null` when no
 * such row exists (the accepted rebuild holds none). `(source_id, external_id)` is unique (migration 002).
 * Read only; compared before and after a suite to prove it neither created, changed nor deleted the row.
 */
export async function realFixtureIdentityRow(sql: postgres.Sql): Promise<string | null> {
  const rows = await sql<{ row: string }[]>`
    SELECT to_jsonb(e)::text AS row
      FROM external_identities e
     WHERE e.source_id = (SELECT id FROM sources WHERE key = 'afl_api')
       AND e.external_id = ${FIXTURE_FILE_PROVIDER_PLAYER_ID}
  `;
  return rows.length === 0 ? null : rows[0].row;
}

/**
 * How many `player_match_stats` rows the player the real `(afl_api, CD_I297354)` identity names holds in the matches
 * with these keys. 0 when no such identity exists (the accepted rebuild) or when the real id never reached a settle.
 * Read only. A suite whose fixture still names the real id counts > 0 on the snapshot.
 */
export async function realFixturePlayerStatRowsIn(sql: postgres.Sql, matchKeys: readonly string[]): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n
      FROM player_match_stats s
      JOIN matches m ON m.id = s.match_id
      JOIN external_identities e ON e.player_id = s.player_id
     WHERE e.source_id = (SELECT id FROM sources WHERE key = 'afl_api')
       AND e.external_id = ${FIXTURE_FILE_PROVIDER_PLAYER_ID}
       AND m.match_key = ANY(${[...matchKeys]}::text[])
  `;
  return row.n;
}

/**
 * ISSUE-363 / ISSUE-365 (run 4, `brownlow` scope) TEST HYGIENE, the form `settle-afl-api-brownlow.test.ts` introduced
 * in run 3 (`6edf4f99`), shared with the two sibling Brownlow settle suites. Those suites apply a Brownlow settle to
 * the real SEASON, and the settle recomputes SEASON's `stat_availability` rows inside its committed transaction
 * (`recomputeBrownlowCoverage`). Their cleanup removes the matches and votes those rows were computed from but never
 * the rows, so a shared run left SEASON's rows describing deleted fixtures (match grain `0/<n + fixtures>`, round
 * grain `partial`) and every later file read them. A suite captures SEASON's rows before anything writes and puts back
 * exactly that content afterwards.
 */
export type SeasonCoverageRow = {
  statKey: string; isRecorded: boolean; coverage: string; populatedRows: number | null; totalRows: number | null;
};

/** Every `stat_availability` row of `season`, as plain objects (the postgres.js result array carries extra members). */
export async function readSeasonCoverage(sql: postgres.Sql, season: number): Promise<SeasonCoverageRow[]> {
  const rows = await sql<SeasonCoverageRow[]>`
    SELECT stat_key AS "statKey", is_recorded AS "isRecorded", coverage::text AS coverage,
           populated_rows AS "populatedRows", total_rows AS "totalRows"
      FROM stat_availability
     WHERE season = ${season}
     ORDER BY stat_key
  `;
  return rows.map((r) => ({ ...r }));
}

/** Puts `season`'s `stat_availability` back to exactly `rows` (rows added go, changed rows revert) and verifies it. */
export async function restoreSeasonCoverage(
  sql: postgres.Sql, season: number, rows: readonly SeasonCoverageRow[],
): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`
      DELETE FROM stat_availability
       WHERE season = ${season} AND NOT (stat_key = ANY(${rows.map((r) => r.statKey)}::text[]))
    `;
    for (const r of rows) {
      await tx`
        INSERT INTO stat_availability (stat_key, season, is_recorded, coverage, populated_rows, total_rows)
        VALUES (${r.statKey}, ${season}, ${r.isRecorded}, ${r.coverage}::coverage_status, ${r.populatedRows}, ${r.totalRows})
        ON CONFLICT (stat_key, season) DO UPDATE
           SET is_recorded = EXCLUDED.is_recorded, coverage = EXCLUDED.coverage,
               populated_rows = EXCLUDED.populated_rows, total_rows = EXCLUDED.total_rows
      `;
    }
  });
  const after = JSON.stringify(await readSeasonCoverage(sql, season));
  if (after !== JSON.stringify(rows)) {
    throw new Error(`season ${season} stat_availability was not restored exactly: expected ${JSON.stringify(rows)}, found ${after}`);
  }
}
