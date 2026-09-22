/**
 * AFLDB-ISSUE-228 S6-D1 — the `afl_api` provider-id-first MATCH resolver
 * (§6.1). Read-only: this module never inserts, updates or deletes anything.
 * It only answers "which existing canonical `matches` row, if any, is this
 * AFL.com.au match record?" — creation and mutation belong to the settle
 * engine and `applyCanonicalUnit()`, neither of which is implemented here.
 *
 * The lookup order is exactly §6.1's four steps, generalised only by adding
 * the provider-id step ahead of the AFL-Tables-proven match_key/retired-
 * identity pair that `settle-afltables.ts`'s `resolveTarget()` already
 * implements for family `'match'`:
 *
 *   1. Provider id: `matches WHERE source_id = <afl_api> AND
 *      source_record_id = <CD_M…>`. A hit is the canonical row regardless of
 *      its current `match_key`. A hit whose (season, home, away) disagree
 *      with the incoming record is a run-level HALT
 *      (`provider_identity_contradiction`) — never a silent rekey.
 *   2. `match_key` — rendered by the caller exactly as
 *      `import_fitzroy_core.py::match_key_of()` does. A hit is an existing
 *      row for the same real-world match (AFL-Tables-owned, manually
 *      created, or under an `afl_api` id this lookup did not find).
 *   3. The AFLDB-ISSUE-131 retired-identity search
 *      (`findRetiredMatchIdentities`), restricted to `afl_api`-owned rows by
 *      its own `source_id` filter.
 *   4. Otherwise `unresolved` — no SUPPORTED identity resolution succeeded
 *      (provider id, exact `match_key`, proven-retired identity). That does NOT
 *      mean no canonical fixture exists: a row another source owns is invisible
 *      to steps 1 and 3, and a one-component round/date disagreement misses step
 *      2. This module never proposes `new_target`; that classification (and any
 *      write) is the settle engine's job, and it must first ask whether an
 *      INSERT is safe (`findPlausibleCanonicalFixtures`, AFLDB-ISSUE-244
 *      I244-F030) — this resolver stays read-only and authority-free.
 *
 * Steps 2 and 3 run together, exactly as `resolveTarget()` runs them on both
 * its hit and miss paths: a `match_key` hit alongside a retired-identity hit
 * for a DIFFERENT row is two canonical rows for one fixture (§6.1's "two
 * canonical rows matching (1) and (2) with different ids"), refused as
 * `rekey_would_merge` rather than silently picked. More than one retired
 * candidate is `rekey_ambiguous`, matching the existing AFL Tables refusal.
 *
 * `provider_id_ambiguous` is a defensive addition beyond the literal §6.1
 * text: `matches.source_record_id` (migration 064) carries no DB-level
 * uniqueness constraint, so more than one canonical row sharing this
 * (source_id, providerId) pair is representable even though it should never
 * occur under correct writes. Fail-closed, not silently picking either row.
 */
import type postgres from 'postgres';

import {
  findRetiredMatchIdentities,
  type MatchRekeyIdentity,
  type MatchRetirementEvidence,
} from './match-rekey';

type Sql = postgres.Sql | postgres.TransactionSql;

/** The `'match'` family's registry key (§5.2) — not the dotted wire form. */
const MATCH_FAMILY = 'match';

/** The incoming AFL.com.au match record, already resolved to primitive identity fields. */
export type AflApiMatchIdentity = {
  /** `sources.id` for the `afl_api` row (`refs.sourceId`-shaped, caller-resolved). */
  sourceId: number;
  /** `CD_M…` — the match family's `providerId` / `external_record_id`. */
  providerId: string;
  season: number;
  roundCode: string;
  /** ISO `YYYY-MM-DD`, exactly as the `match_key` component renders it. */
  matchDate: string;
  /** Resolved canonical club ids (via `afl-api-identities.json` → `clubs`), never names. */
  homeClubId: number;
  awayClubId: number;
  /** `season|round_code|match_date|home hist|away hist`, rendered by the caller. */
  matchKey: string;
};

export type AflApiMatchResolution =
  | { outcome: 'resolved'; targetId: number; via: 'provider_id' | 'match_key' | 'retired_identity'; currentMatchKey: string }
  | { outcome: 'unresolved' }
  | {
      outcome: 'halt';
      reason: 'provider_identity_contradiction';
      targetId: number;
      observed: { season: number; homeClubId: number; awayClubId: number };
      incoming: { season: number; homeClubId: number; awayClubId: number };
    }
  | { outcome: 'refused'; reason: 'provider_id_ambiguous' | 'rekey_ambiguous' | 'rekey_would_merge'; candidateIds: readonly number[] };

type ProviderIdRow = {
  id: number;
  season: number;
  homeClubId: number;
  awayClubId: number;
  matchKey: string;
};

async function lookupByProviderId(sql: Sql, identity: AflApiMatchIdentity): Promise<ProviderIdRow[]> {
  const rows = await sql<ProviderIdRow[]>`
    SELECT id::int AS id,
           season,
           home_club_id AS "homeClubId",
           away_club_id AS "awayClubId",
           match_key AS "matchKey"
      FROM matches
     WHERE source_id = ${identity.sourceId}
       AND source_record_id = ${identity.providerId}
  `;
  return [...rows];
}

async function lookupByMatchKey(sql: Sql, matchKey: string): Promise<{ id: number }[]> {
  const rows = await sql<{ id: number }[]>`
    SELECT id::int AS id FROM matches WHERE match_key = ${matchKey}
  `;
  return [...rows];
}

function rekeyIdentityOf(identity: AflApiMatchIdentity): MatchRekeyIdentity {
  return {
    season: identity.season,
    sourceId: identity.sourceId,
    family: MATCH_FAMILY,
    matchKey: identity.matchKey,
    roundCode: identity.roundCode,
    matchDate: identity.matchDate,
    homeClubId: identity.homeClubId,
    awayClubId: identity.awayClubId,
  };
}

/**
 * Resolve one AFL.com.au match record to an existing canonical `matches`
 * row. Never creates, never mutates, never writes.
 *
 * `evidence` is the AFLDB-ISSUE-131 retirement proof (§ match-rekey.ts):
 * pass a run's `{ kind: 'run_enumeration', scope }` mid-settle, or
 * `NO_MATCH_REKEY_SCOPE` (`{ kind: 'run_enumeration', scope:
 * NO_MATCH_REKEY_SCOPE }`) for a standalone caller that proves nothing —
 * the retired-identity step then correctly finds nothing rather than
 * guessing.
 */
export async function resolveAflApiMatch(
  sql: Sql,
  identity: AflApiMatchIdentity,
  evidence: MatchRetirementEvidence,
): Promise<AflApiMatchResolution> {
  const providerHits = await lookupByProviderId(sql, identity);

  if (providerHits.length > 1) {
    return {
      outcome: 'refused',
      reason: 'provider_id_ambiguous',
      candidateIds: providerHits.map((row) => row.id),
    };
  }

  if (providerHits.length === 1) {
    const hit = providerHits[0];
    const contradicts = hit.season !== identity.season
      || hit.homeClubId !== identity.homeClubId
      || hit.awayClubId !== identity.awayClubId;
    if (contradicts) {
      return {
        outcome: 'halt',
        reason: 'provider_identity_contradiction',
        targetId: hit.id,
        observed: { season: hit.season, homeClubId: hit.homeClubId, awayClubId: hit.awayClubId },
        incoming: { season: identity.season, homeClubId: identity.homeClubId, awayClubId: identity.awayClubId },
      };
    }
    // §6.1 step 1: a provider-id hit is THE canonical row regardless of its
    // current match_key. Steps 2/3 never run once step 1 has resolved.
    return { outcome: 'resolved', targetId: hit.id, via: 'provider_id', currentMatchKey: hit.matchKey };
  }

  const [matchKeyHits, retired] = await Promise.all([
    lookupByMatchKey(sql, identity.matchKey),
    findRetiredMatchIdentities(sql, rekeyIdentityOf(identity), evidence),
  ]);

  if (matchKeyHits.length > 0) {
    if (retired.length > 0) {
      return {
        outcome: 'refused',
        reason: 'rekey_would_merge',
        candidateIds: [matchKeyHits[0].id, ...retired.map((row) => row.id)],
      };
    }
    return { outcome: 'resolved', targetId: matchKeyHits[0].id, via: 'match_key', currentMatchKey: identity.matchKey };
  }

  if (retired.length > 1) {
    return { outcome: 'refused', reason: 'rekey_ambiguous', candidateIds: retired.map((row) => row.id) };
  }
  if (retired.length === 1) {
    return {
      outcome: 'resolved',
      targetId: retired[0].id,
      via: 'retired_identity',
      currentMatchKey: retired[0].matchKey,
    };
  }

  return { outcome: 'unresolved' };
}
