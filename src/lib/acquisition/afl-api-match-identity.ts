/**
 * AFLDB-ISSUE-228 S6 (read-only settle planning) — the match identity
 * CONTEXT `resolveAflApiMatch()` (S6-D1) needs, built from an already-valid
 * `AflApiMatchBundle` (S3/S6-B). Read-only: this module only ever issues
 * `SELECT`s. It never inserts, updates or deletes anything, and it never
 * itself decides which canonical `matches` row (if any) the match is — that
 * is `resolveAflApiMatch()`'s job (`afl-api-match-resolver.ts`), which
 * consumes the `AflApiMatchIdentity` this module produces.
 *
 * Three things happen here, all §6-authorised, none of them a guess:
 *
 *   1. **Source id** (`resolveAflApiSourceId`): `sources.id` for
 *      `sources.key = 'afl_api'` (migration 077). Caller-resolved ONCE per
 *      run in every other module this stage touches
 *      (`afl-api-match-resolver.ts`, `afl-api-player-resolver.ts` both take
 *      `sourceId` as a parameter) — this module keeps that convention rather
 *      than looking it up again per match.
 *   2. **Club identity** (`resolveAflApiMatchClubs`, §6.2): `CD_T` has
 *      already been resolved to a historical `hist` string by the emitter
 *      (`afl-api-bundle.ts`'s `resolveTeam()`, against
 *      `afl-api-identities.json`, refusing on drift). This module's own job
 *      is the SECOND resolution step §6.2 requires: `hist` -> canonical
 *      `clubs.legacy_club_hist`, map-only, never by name or abbreviation. A
 *      miss here means the identities map names a historical identity the
 *      database itself does not carry — a genuine data-integrity gap, not a
 *      fuzzy-matching opportunity, so it fails closed.
 *   3. **Match key** (§6.1, §16 S6 row): `renderMatchKey()`
 *      (`settle-core.ts`) needs the canonical `clubs.name` for each side —
 *      exactly `import_fitzroy_core.py::match_key_of()`'s `clubs.name_of()`
 *      — which the same club query already returns, and the validated
 *      LOCAL `match_date` §11.1 requires: this module never falls back to a
 *      UTC-derived date. `bundle.localMatchDateTime` is `null` whenever the
 *      S6-D3a roster/timezone cross-check could not prove one (roster
 *      `venueLocalStartTime` absent, or an unrecognised/absent
 *      `venue.timezone`); that is fail-closed identity CONSTRUCTION, not a
 *      resolution HALT — the caller decides how to classify it (a settle
 *      planner refuses the unit; it is never a run-level HALT, which §14
 *      reserves for the named conditions there, none of which is this one).
 */
import type postgres from 'postgres';

import type { AflApiMatchBundle } from './afl-api-bundle';
import type { AflApiMatchIdentity } from './afl-api-match-resolver';
import { renderMatchKey } from './settle-core';

type Sql = postgres.Sql | postgres.TransactionSql;

export class AflApiMatchIdentityError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AflApiMatchIdentityError';
  }
}

function fail(code: string, message: string): never {
  throw new AflApiMatchIdentityError(code, message);
}

/** §5.1: `sources.key = 'afl_api'` (migration 077). Never a hard-coded id. */
export async function resolveAflApiSourceId(sql: Sql): Promise<number> {
  const rows = await sql<{ id: number }[]>`SELECT id FROM sources WHERE key = 'afl_api'`;
  if (rows.length === 0) {
    fail('afl_api_source_missing', "sources.key = 'afl_api' has no row (expected from migration 077).");
  }
  return rows[0].id;
}

export type AflApiMatchClubResolution = { clubId: number; clubName: string };

/**
 * §6.2: `CD_T` (already resolved to a `hist` string by the emitter) ->
 * `clubs.legacy_club_hist`, map-only. Both sides resolved in one query;
 * either miss fails closed rather than guessing by name.
 */
export async function resolveAflApiMatchClubs(
  sql: Sql,
  homeClubHist: string,
  awayClubHist: string,
): Promise<{ home: AflApiMatchClubResolution; away: AflApiMatchClubResolution }> {
  const rows = await sql<{ legacyClubHist: string; id: number; name: string }[]>`
    SELECT legacy_club_hist AS "legacyClubHist", id, name
      FROM clubs
     WHERE legacy_club_hist IN (${homeClubHist}, ${awayClubHist})
  `;
  const byHist = new Map(rows.map((row) => [row.legacyClubHist, row]));
  const home = byHist.get(homeClubHist);
  const away = byHist.get(awayClubHist);
  if (!home) fail('unmapped_club_hist', `clubs.legacy_club_hist has no row for '${homeClubHist}' (home).`);
  if (!away) fail('unmapped_club_hist', `clubs.legacy_club_hist has no row for '${awayClubHist}' (away).`);
  return {
    home: { clubId: home.id, clubName: home.name },
    away: { clubId: away.id, clubName: away.name },
  };
}

/**
 * Builds the full `AflApiMatchIdentity` §6.1 resolution needs, from an
 * already-built `AflApiMatchBundle` (S6-B) and a caller-resolved `sourceId`.
 *
 * Fails closed (never silently substitutes) when:
 * - `bundle.localMatchDateTime` is `null` (§11.1: the local date/time cross-
 *   check is unproved) — `unproved_match_date`;
 * - either club's `hist` string has no `clubs.legacy_club_hist` row —
 *   `unmapped_club_hist`.
 *
 * Never called for a deferred record (§7.3): a unit whose `match` settle
 * record already carries a `deferral` has nothing to resolve identity for —
 * the caller is expected to check that first, exactly as the settle planner
 * (`afl-api-settle-plan.ts`) does.
 */
export async function buildAflApiMatchIdentity(
  sql: Sql,
  sourceId: number,
  bundle: AflApiMatchBundle,
): Promise<AflApiMatchIdentity> {
  if (bundle.localMatchDateTime === null) {
    fail(
      'unproved_match_date',
      `Match ${bundle.match.sourceRecordId}: no validated local match date/time (the S6-D3a `
      + 'roster/timezone cross-check is unproved); §11.1 requires one before identity can be '
      + 'constructed. Never derived from utcStartTime alone.',
    );
  }

  const clubs = await resolveAflApiMatchClubs(sql, bundle.match.homeClubHist, bundle.match.awayClubHist);
  const matchDate = bundle.localMatchDateTime.matchDate;
  const matchKey = renderMatchKey(
    bundle.match.season,
    bundle.match.roundCode,
    matchDate,
    clubs.home.clubName,
    clubs.away.clubName,
  );

  return {
    sourceId,
    providerId: bundle.match.sourceRecordId,
    season: bundle.match.season,
    roundCode: bundle.match.roundCode,
    matchDate,
    homeClubId: clubs.home.clubId,
    awayClubId: clubs.away.clubId,
    matchKey,
  };
}
