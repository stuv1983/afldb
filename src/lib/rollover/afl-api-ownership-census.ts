/**
 * AFLDB-ISSUE-233 D-233-3 — the `afl_api` ownership census.
 *
 * A rebuild must preserve AFL API ownership or refuse. `npm run db:test:rebuild` recreates
 * every completed season's `matches` from the accepted fitzRoy baseline as AFL Tables rows,
 * so a canonical match that source `afl_api` owned first would be silently re-owned, which
 * breaks the acquisition doctrine that a later source corroborates and never re-owns. Until
 * an ownership-replay design exists, the only safe answer is to refuse.
 *
 * This module is the ONE definition of that census, shared by its four callers:
 *
 *   * the rebuild's `afl-api-ownership-census` stage (tools/db/rebuild-test.ts), which runs
 *     the ENFORCING form against the database about to be reset, before the adjudication
 *     capture and before the reset;
 *   * the read-only census CLI (tools/db/afl-api-ownership-census.ts), which runs the
 *     REPORTING form and writes an evidence record;
 *   * the season rollover (src/lib/rollover/season-rollover.ts), which requires that
 *     evidence for the successor rebuild scope and refuses on the same condition;
 *   * the promotion checker (tools/db/promotion-check.ts), which runs the SAME two queries
 *     (AFL_API_OWNERSHIP_SCHEMA_SQL, AFL_API_OWNERSHIP_COUNTS_SQL) against the LIVE target a
 *     promotion would replace, and judges them with `judgeCensusRows()`.
 *
 * Both SQL forms are one read-only transaction (`SET TRANSACTION READ ONLY`), report every
 * measured value through `RAISE WARNING` lines carrying CENSUS_MARKER, and count only
 * `matches` whose `source_id` resolves to `sources.key = 'afl_api'`. The DO block EXECUTEs
 * the two exported queries verbatim, so no caller carries its own copy of the SQL.
 *
 * Schema states. A database with no `public.matches` (an empty database after a halted
 * rehearsal, or one never migrated) holds no canonical match at all, so nothing in it can be
 * re-owned: the stream says `schema_absent`. Only the rebuild accepts that as a pass, for
 * the database it is about to reset (its DSN must name that database, resolveTarget()). The
 * rollover refuses `schema_absent` evidence, and the promotion checker refuses a live target
 * without the table. A database whose `matches` exists but whose `sources` table or
 * `matches.source_id` column does not is DAMAGED: the owner of its rows cannot be
 * determined, so every form refuses (`schema_incomplete`); it never passes.
 *
 * There is no override, no force flag and no allow-list: the refusal lifts only with an
 * ownership-replay design, which is a separate future change.
 *
 * Pure: no filesystem, no database, no clock.
 */

export const CENSUS_MARKER = 'AFLDB-AFL-API-OWNERSHIP-CENSUS';
export const CENSUS_CONTRACT = 'afldb.afl_api_ownership_census.v1';
export const OWNING_SOURCE_KEY = 'afl_api';

export class AflApiOwnershipCensusError extends Error {}

/** Which seasons the census judges: `first..last`, minus every excluded (in-progress) season. */
export type CensusScope = {
  firstSeason: number;
  lastSeason: number;
  excludedSeasons: number[];
};

export type SeasonCount = { season: number; aflApiMatches: number };

export type CensusResult = {
  database: string;
  scope: CensusScope;
  schemaPresent: boolean;
  /** Non-zero seasons inside the scope, ascending. Each one refuses. */
  inScope: SeasonCount[];
  /** Non-zero seasons outside the scope (in-progress or later), ascending. Reported only. */
  outsideScope: SeasonCount[];
};

type Json = Record<string, unknown>;

function fail(message: string): never {
  throw new AflApiOwnershipCensusError(message);
}

function season(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1800 || value > 2200) {
    fail(`${what} is not a season year (got ${JSON.stringify(value)}).`);
  }
  return value;
}

function seasonList(value: unknown, what: string): number[] {
  if (!Array.isArray(value)) fail(`${what} is not a list of seasons.`);
  return value.map((entry, i) => season(entry, `${what}[${i}]`));
}

/** Canonical form: ascending, unique. */
function normalise(seasons: number[]): number[] {
  return [...new Set(seasons)].sort((a, b) => a - b);
}

export function assertScope(scope: CensusScope): CensusScope {
  const firstSeason = season(scope.firstSeason, 'census scope first season');
  const lastSeason = season(scope.lastSeason, 'census scope last season');
  if (lastSeason < firstSeason) {
    fail(`census scope ${firstSeason}..${lastSeason} is empty.`);
  }
  return {
    firstSeason,
    lastSeason,
    excludedSeasons: normalise(seasonList(scope.excludedSeasons, 'census scope excluded seasons')),
  };
}

/** `1897..2025 excluding 2026`, for messages. */
export function describeScope(scope: CensusScope): string {
  const excluded = scope.excludedSeasons.length > 0
    ? ` excluding in-progress ${scope.excludedSeasons.join(', ')}` : '';
  return `${scope.firstSeason}..${scope.lastSeason}${excluded}`;
}

/**
 * The rebuild's scope, from the tracked documents the rebuild itself is bound to: the fitzRoy
 * contract's `full_history.season_range` (the completed seasons the accepted baseline
 * recreates), excluding every season that `seasons.json` declares in progress or the contract
 * declares `current_season_excluded`. An in-progress season is never treated as completed.
 */
export function rebuildCensusScope(contract: Json, seasons: Json): CensusScope {
  const fullHistory = contract.full_history as Json | undefined;
  const range = fullHistory?.season_range as Json | undefined;
  if (!range) fail('the fitzRoy contract declares no full_history.season_range.');
  const excludedBlock = fullHistory?.current_season_excluded as Json | undefined;
  const excluded = [
    ...seasonList(seasons.in_progress_seasons ?? [], 'seasons.json in_progress_seasons'),
    ...seasonList(excludedBlock?.seasons ?? [], 'full_history.current_season_excluded.seasons'),
  ];
  return assertScope({
    firstSeason: season(range.first_season, 'full_history.season_range.first_season'),
    lastSeason: season(range.last_season, 'full_history.season_range.last_season'),
    excludedSeasons: excluded,
  });
}

/**
 * The scope the rebuild will have AFTER a rollover completes `completingSeason`: the same
 * first season through the completing season, which is in progress today and therefore
 * deliberately INCLUDED. Any other in-progress season is still excluded.
 */
export function rolloverCensusScope(
  firstSeason: number, completingSeason: number, inProgressSeasons: number[],
): CensusScope {
  return assertScope({
    firstSeason,
    lastSeason: completingSeason,
    excludedSeasons: inProgressSeasons.filter((s) => s !== completingSeason),
  });
}

function intLiteral(value: number): string {
  if (!Number.isInteger(value)) fail(`not an integer: ${value}`);
  return String(value);
}

/**
 * The ONE schema probe: which database was read, and whether the three objects the census
 * needs exist. Every caller runs exactly this text (the DO block through EXECUTE).
 */
export const AFL_API_OWNERSHIP_SCHEMA_SQL = `SELECT current_database()::text AS current_database,
       to_regclass('public.matches') IS NOT NULL AS matches,
       to_regclass('public.sources') IS NOT NULL AS sources,
       EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'matches'
                  AND column_name = 'source_id') AS source_id`;

/** The ONE ownership count: canonical matches owned by source `afl_api`, per season. */
export const AFL_API_OWNERSHIP_COUNTS_SQL = `SELECT m.season::int AS season, count(*)::bigint AS n
  FROM public.matches m
  JOIN public.sources s ON s.id = m.source_id
 WHERE s.key = '${OWNING_SOURCE_KEY}'
 GROUP BY m.season
 ORDER BY m.season`;

/** A SQL string literal for EXECUTE: the query verbatim, quotes doubled. */
function sqlLiteral(text: string): string {
  return `'${text.replace(/'/g, "''")}'`;
}

/** Why a damaged schema can never satisfy the census. Identical wording in SQL and TypeScript. */
const SCHEMA_INCOMPLETE = 'public.matches exists but public.sources or matches.source_id does not, so '
  + 'the owner of its rows cannot be determined. A damaged schema never satisfies this census '
  + '(AFLDB-ISSUE-233 D-233-3). Nothing has been changed.';

export function schemaIncompleteMessage(database: string): string {
  return `${CENSUS_MARKER} REFUSED on ${database}: ${SCHEMA_INCOMPLETE}`;
}

/**
 * The census as one read-only psql stream.
 *
 * `enforce` ends in RAISE EXCEPTION when any in-scope season is non-zero, so under
 * `ON_ERROR_STOP=1` the stream exits non-zero and the rebuild stage fails before anything is
 * destroyed. `report` never raises on a finding; it reports the verdict as a line instead.
 * Every season and count is a WARNING line in both forms, so the output is the evidence.
 */
export function buildAflApiOwnershipCensusSql(
  rawScope: CensusScope, mode: 'enforce' | 'report',
): string {
  return `SET TRANSACTION READ ONLY;\n${aflApiOwnershipCensusBlock(rawScope, mode)}`;
}

/**
 * The census DO block alone, without the READ ONLY guard. Only the rollback-only integration
 * proof composes it (behind deliberate in-transaction edits that always roll back); every
 * operational caller uses `buildAflApiOwnershipCensusSql`.
 */
export function aflApiOwnershipCensusBlock(
  rawScope: CensusScope, mode: 'enforce' | 'report',
): string {
  const scope = assertScope(rawScope);
  const excluded = scope.excludedSeasons.length > 0
    ? `ARRAY[${scope.excludedSeasons.map(intLiteral).join(', ')}]::int[]`
    : "'{}'::int[]";
  const onRefuse = mode === 'enforce'
    ? `RAISE EXCEPTION '${CENSUS_MARKER} REFUSED: completed season(s) in rebuild scope % hold `
      + `canonical matches owned by source ${OWNING_SOURCE_KEY}: %. A rebuild recreates these `
      + 'seasons as AFL Tables rows and would silently re-own them (AFLDB-ISSUE-233 D-233-3). '
      + 'There is no override: the refusal lifts only with an ownership-replay design. '
      + "Nothing has been destroyed.', scope_text, array_to_string(refused, ', ');"
    : `RAISE WARNING '${CENSUS_MARKER} verdict=refuse total=%', total;`;

  return `DO $afldb_census$
DECLARE
  first_season int := ${intLiteral(scope.firstSeason)};
  last_season  int := ${intLiteral(scope.lastSeason)};
  excluded     int[] := ${excluded};
  scope_text   text := '${describeScope(scope)}';
  r            record;
  probe        record;
  refused      text[] := '{}';
  total        bigint := 0;
BEGIN
  RAISE WARNING '${CENSUS_MARKER} database=%', current_database();
  RAISE WARNING '${CENSUS_MARKER} scope first_season=% last_season=% excluded=%',
    first_season, last_season, array_to_string(excluded, ',');
  EXECUTE ${sqlLiteral(AFL_API_OWNERSHIP_SCHEMA_SQL)} INTO probe;
  IF NOT probe.matches THEN
    RAISE WARNING '${CENSUS_MARKER} schema_absent';
  ELSIF NOT (probe.sources AND probe.source_id) THEN
    RAISE EXCEPTION '${CENSUS_MARKER} REFUSED on %: ${SCHEMA_INCOMPLETE}', current_database();
  ELSE
    RAISE WARNING '${CENSUS_MARKER} schema_present';
    FOR r IN EXECUTE ${sqlLiteral(AFL_API_OWNERSHIP_COUNTS_SQL)}
    LOOP
      IF r.season BETWEEN first_season AND last_season AND NOT (r.season = ANY (excluded)) THEN
        RAISE WARNING '${CENSUS_MARKER} in_scope season=% afl_api_matches=%', r.season, r.n;
        refused := refused || format('%s (%s)', r.season, r.n);
        total := total + r.n;
      ELSE
        RAISE WARNING '${CENSUS_MARKER} outside_scope season=% afl_api_matches=%', r.season, r.n;
      END IF;
    END LOOP;
  END IF;
  IF total > 0 THEN
    ${onRefuse}
  ELSE
    RAISE WARNING '${CENSUS_MARKER} verdict=pass total=0';
  END IF;
END $afldb_census$;
`;
}

const LINE = new RegExp(`${CENSUS_MARKER} (\\S+)(.*)$`, 'gm');

/**
 * Read the WARNING lines a REPORT run printed back into a result. Strict: the database, the
 * scope echo (which must equal the scope that was asked for), the schema line and the verdict
 * line must each appear exactly once, and the verdict must agree with the counts.
 */
export function parseCensusOutput(output: string, rawScope: CensusScope): CensusResult {
  const scope = assertScope(rawScope);
  const lines = [...output.matchAll(LINE)].map((m) => ({ tag: m[1], rest: m[2].trim() }));
  const one = (tag: string): string => {
    const found = lines.filter((l) => l.tag === tag || l.tag.startsWith(`${tag}=`));
    if (found.length !== 1) fail(`census output carries ${found.length} '${tag}' lines, not 1.`);
    const head = found[0].tag;
    return head.includes('=') ? `${head.slice(head.indexOf('=') + 1)} ${found[0].rest}`.trim()
      : found[0].rest;
  };

  const database = one('database');
  if (!/^[A-Za-z0-9_]+$/.test(database)) fail(`census output names database ${JSON.stringify(database)}.`);

  const echo = one('scope');
  const wantEcho = `first_season=${scope.firstSeason} last_season=${scope.lastSeason} `
    + `excluded=${scope.excludedSeasons.join(',')}`;
  if (echo !== wantEcho) {
    fail(`census output scope '${echo}' is not the requested scope '${wantEcho}'.`);
  }

  const present = lines.filter((l) => l.tag === 'schema_present').length;
  const absent = lines.filter((l) => l.tag === 'schema_absent').length;
  if (present + absent !== 1) fail('census output does not say exactly once whether the schema is present.');

  const counts = (tag: 'in_scope' | 'outside_scope'): SeasonCount[] => lines
    .filter((l) => l.tag === tag)
    .map((l) => {
      const m = /^season=(\d{4}) afl_api_matches=(\d+)$/.exec(l.rest);
      if (!m) fail(`malformed census line: ${tag} ${l.rest}`);
      return { season: Number(m[1]), aflApiMatches: Number(m[2]) };
    });
  const inScope = counts('in_scope');
  const outsideScope = counts('outside_scope');
  if (absent === 1 && (inScope.length > 0 || outsideScope.length > 0)) {
    fail('census output reports counts for a database without the canonical schema.');
  }

  const verdict = one('verdict');
  const total = inScope.reduce((sum, c) => sum + c.aflApiMatches, 0);
  const wantVerdict = total > 0 ? `refuse total=${total}` : 'pass total=0';
  if (verdict !== wantVerdict) {
    fail(`census output verdict '${verdict}' disagrees with its own counts ('${wantVerdict}').`);
  }

  return assertResult({ database, scope, schemaPresent: present === 1, inScope, outsideScope });
}

function assertCounts(counts: SeasonCount[], what: string): SeasonCount[] {
  let previous = -1;
  for (const c of counts) {
    season(c.season, `${what} season`);
    if (!Number.isInteger(c.aflApiMatches) || c.aflApiMatches < 1) {
      fail(`${what} ${c.season} carries a count of ${JSON.stringify(c.aflApiMatches)}; only `
        + 'non-zero seasons are listed.');
    }
    if (c.season <= previous) fail(`${what} seasons are not strictly ascending.`);
    previous = c.season;
  }
  return counts;
}

function inScopeSeason(scope: CensusScope, s: number): boolean {
  return s >= scope.firstSeason && s <= scope.lastSeason && !scope.excludedSeasons.includes(s);
}

function assertResult(result: CensusResult): CensusResult {
  assertCounts(result.inScope, 'in-scope');
  assertCounts(result.outsideScope, 'outside-scope');
  for (const c of result.inScope) {
    if (!inScopeSeason(result.scope, c.season)) fail(`season ${c.season} is listed in scope but is not.`);
  }
  for (const c of result.outsideScope) {
    if (inScopeSeason(result.scope, c.season)) fail(`season ${c.season} is listed outside scope but is not.`);
  }
  return result;
}

export function censusTotal(result: CensusResult): number {
  return result.inScope.reduce((sum, c) => sum + c.aflApiMatches, 0);
}

/** `2024 (3), 2025 (1)`: every affected season with its exact count. */
export function describeAffected(counts: SeasonCount[]): string {
  return counts.map((c) => `${c.season} (${c.aflApiMatches})`).join(', ');
}

/**
 * The refusal, naming every affected season and its count. Identical wording everywhere; only
 * the operation that would re-own the rows differs. The rebuild's wording is unchanged.
 */
export function refusalMessage(result: CensusResult, operation: 'rebuild' | 'promotion' = 'rebuild'): string {
  const consequence = operation === 'rebuild'
    ? 'A rebuild recreates these seasons as AFL Tables rows and would silently re-own them'
    : 'A promotion replaces these seasons with a rebuilt candidate\'s AFL Tables rows, which no '
      + 'ownership replay carries over, and would silently re-own them';
  return `${CENSUS_MARKER} REFUSED on ${result.database}: completed season(s) in ${operation} scope `
    + `${describeScope(result.scope)} hold canonical matches owned by source `
    + `${OWNING_SOURCE_KEY}: ${describeAffected(result.inScope)}. ${consequence} `
    + '(AFLDB-ISSUE-233 D-233-3). There is no override: the refusal lifts only with an '
    + 'ownership-replay design.';
}

/** What AFL_API_OWNERSHIP_SCHEMA_SQL returned. */
export type CensusSchemaProbe = {
  currentDatabase: string;
  matches: boolean;
  sources: boolean;
  sourceId: boolean;
};

/**
 * Judge the two shared queries' rows in TypeScript, exactly as the DO block judges them in
 * PL/pgSQL: the database read must be the one expected; no `matches` table is
 * `schemaPresent: false` (the CALLER decides whether that may pass); a damaged schema
 * refuses; every non-zero season is classified by the scope, and the result is re-validated.
 */
export function judgeCensusRows(input: {
  expectedDatabase: string;
  scope: CensusScope;
  probe: CensusSchemaProbe;
  rows: Array<{ season: number; n: number }>;
}): CensusResult {
  const scope = assertScope(input.scope);
  const { probe } = input;
  if (probe.currentDatabase !== input.expectedDatabase) {
    fail(`the census read database '${probe.currentDatabase}', not '${input.expectedDatabase}'.`);
  }
  const base = { database: probe.currentDatabase, scope };
  if (!probe.matches) {
    if (input.rows.length > 0) fail('census rows were read from a database without public.matches.');
    return assertResult({ ...base, schemaPresent: false, inScope: [], outsideScope: [] });
  }
  if (!probe.sources || !probe.sourceId) fail(schemaIncompleteMessage(probe.currentDatabase));
  const counts = input.rows.map((r) => ({ season: r.season, aflApiMatches: r.n }));
  return assertResult({
    ...base,
    schemaPresent: true,
    inScope: counts.filter((c) => inScopeSeason(scope, c.season)),
    outsideScope: counts.filter((c) => !inScopeSeason(scope, c.season)),
  });
}

/** The evidence record the census CLI writes and the rollover reads. */
export function censusRecord(result: CensusResult, extra: { capturedAtUtc: string; sqlSha256: string }): Json {
  const total = censusTotal(result);
  return {
    contract: CENSUS_CONTRACT,
    issue: 'AFLDB-ISSUE-233 D-233-3',
    database: result.database,
    captured_at_utc: extra.capturedAtUtc,
    sql_sha256: extra.sqlSha256,
    owning_source_key: OWNING_SOURCE_KEY,
    scope: {
      first_season: result.scope.firstSeason,
      last_season: result.scope.lastSeason,
      excluded_seasons: result.scope.excludedSeasons,
    },
    schema_present: result.schemaPresent,
    in_scope: result.inScope.map((c) => ({ season: c.season, afl_api_matches: c.aflApiMatches })),
    outside_scope: result.outsideScope.map((c) => ({ season: c.season, afl_api_matches: c.aflApiMatches })),
    total_in_scope: total,
    verdict: total > 0 ? 'refuse' : 'pass',
  };
}

/**
 * Re-read an evidence record. Nothing in it is trusted as a verdict: the counts are
 * re-validated against the scope and the verdict and total are recomputed from them, so an
 * edited `verdict: "pass"` over non-zero counts is refused as inconsistent.
 */
export function readCensusRecord(record: unknown): CensusResult & { capturedAtUtc: string } {
  if (!record || typeof record !== 'object' || Array.isArray(record)) fail('census evidence is not a JSON object.');
  const doc = record as Json;
  if (doc.contract !== CENSUS_CONTRACT) {
    fail(`census evidence declares contract ${JSON.stringify(doc.contract)}, not '${CENSUS_CONTRACT}'.`);
  }
  if (doc.owning_source_key !== OWNING_SOURCE_KEY) fail('census evidence does not count source afl_api.');
  if (typeof doc.database !== 'string' || !/^[A-Za-z0-9_]+$/.test(doc.database)) {
    fail('census evidence names no database.');
  }
  if (typeof doc.captured_at_utc !== 'string' || doc.captured_at_utc === '') fail('census evidence carries no capture time.');
  if (typeof doc.schema_present !== 'boolean') fail('census evidence does not say whether the schema was present.');
  const rawScope = doc.scope as Json | undefined;
  if (!rawScope || typeof rawScope !== 'object') fail('census evidence carries no scope.');
  const scope = assertScope({
    firstSeason: rawScope.first_season as number,
    lastSeason: rawScope.last_season as number,
    excludedSeasons: rawScope.excluded_seasons as number[],
  });
  const list = (value: unknown, what: string): SeasonCount[] => {
    if (!Array.isArray(value)) fail(`census evidence ${what} is not a list.`);
    return value.map((entry) => {
      const e = (entry ?? {}) as Json;
      return { season: e.season as number, aflApiMatches: e.afl_api_matches as number };
    });
  };
  const result = assertResult({
    database: doc.database,
    scope,
    schemaPresent: doc.schema_present,
    inScope: list(doc.in_scope, 'in_scope'),
    outsideScope: list(doc.outside_scope, 'outside_scope'),
  });
  if (!result.schemaPresent && (result.inScope.length > 0 || result.outsideScope.length > 0)) {
    fail('census evidence reports counts for a database without the canonical schema.');
  }
  const total = censusTotal(result);
  if (doc.total_in_scope !== total || doc.verdict !== (total > 0 ? 'refuse' : 'pass')) {
    fail(`census evidence total/verdict (${JSON.stringify(doc.total_in_scope)}, `
      + `${JSON.stringify(doc.verdict)}) disagree with its own counts (${total}).`);
  }
  return { ...result, capturedAtUtc: doc.captured_at_utc };
}
