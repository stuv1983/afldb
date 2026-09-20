#!/usr/bin/env node
/**
 * AFLDB-ISSUE-228 — read-only 2025 Brownlow canonical-equality audit
 * (operator request, 2026-09-20).
 *
 * Diagnostic only: SELECT-only. Never writes to `brownlow_round_votes`,
 * `canonical_applications`, `data_issues`, the staging spine, or any other
 * table. Never touches the Brownlow settle, the fixture resolver, matching/
 * linking behaviour, or migrations.
 *
 * This exists because the real 2025 progressive/backtest settle reached
 * canonical ownership and was refused `ownership_indeterminate`: every
 * `brownlow_round_votes` row for season 2025 already exists as a LEGACY
 * canonical row with no `source_id` / `source_record_id` / `import_batch_id`
 * provenance and no `canonical_applications` history, so the settle correctly
 * refuses to re-own it (`applyCanonicalUnit()`, ownership check). This tool
 * does not touch that refusal or the ownership policy at all; it only proves,
 * independently and read-only, whether the AFL.com.au captured source and
 * the existing legacy canonical rows AGREE on the known-answer 2025 Brownlow
 * population (621 positive vote rows, 207 matches, 188 distinct players).
 *
 * Trust rule: every identity and round decision is made by the exact
 * production functions the real settle (`afl-api-brownlow.ts` /
 * `settle-afl-api-brownlow.ts`) calls — reused verbatim, never
 * reimplemented:
 *   - `emitAflApiBrownlowMatchVotes()` (afl-api-bundle.ts) — parse + §10
 *     shape validation (3-2-1 vote sets, no duplicate match/player ids).
 *   - `resolveAflApiSourceId()` / `resolveAflApiPlayer()`
 *     (afl-api-match-identity.ts / afl-api-player-resolver.ts) — the §6.3 D2
 *     provider-player -> canonical player_id bridge.
 *   - `resolveAflApiBrownlowMatch()` (afl-api-brownlow.ts) — the §6.1
 *     provider-match -> canonical `matches` row bridge, including its own
 *     `round_number`.
 *   - `translateAflApiBrownlowRound()` (afl-api-rounds.ts) — the §6.4 T4
 *     round contract, with its own defensive refusal of any non-H&A round.
 * No offset arithmetic, no name/team matching, no independent round mapping
 * is invented here.
 *
 * KEY CORRECTION (2026-09-20, AFLDB-ISSUE-228 S7). Comparing by
 * `(player_id, translated provider round)` is wrong for a rescheduled
 * fixture: the Brownlow feed groups a postponed match's votes under
 * whichever week it was actually played, while AFLDB's own `matches` row
 * keeps its ORIGINAL round (`admin-fixtures.ts`'s `rescheduleFixture()` only
 * ever moves date/time, never round). Two of 2025's real matches
 * (Gold Coast v Essendon's rescheduled Opening Round fixture, and
 * Brisbane v Geelong's) expose this: their translated provider round
 * disagrees with the canonical match's actual round, and one player
 * (Matt Rowell) legitimately holds two DIFFERENT round-24-labelled votes in
 * two DIFFERENT matches — a `(player_id, translated round)` key silently
 * collapses those into one, masking the discrepancy as a false "exact
 * match". This tool now keys by `(player_id, canonical match_id)` —
 * resolved via the SAME `resolveAflApiBrownlowMatch()` the real settle
 * calls — never by round number, so two genuine matches are never folded
 * into one key regardless of what round either one is labelled.
 *
 * Population: the tracked, immutable full-season capture at
 * data/sources/AFLWebsite/BrownlowSamples/brownlow-samples/<season>/, proven
 * complete against its own 06-validation.json exactly as
 * census-afl-api-brownlow-identities.ts already does (same guard, reused).
 *
 * Invariants enforced (never assumed):
 *   - Brownlow votes occur only during H&A: provider rounds 0-24, canonical
 *     rounds 1-25. `translateAflApiBrownlowRound()` itself refuses any
 *     non-home_and_away round, so a finals vote can never silently enter the
 *     comparison.
 *   - The known-answer population is the 621 POSITIVE vote rows. The ~8,901
 *     played-but-zero canonical rows are read (to detect an unexpected
 *     positive that the source does not carry) but are never treated as part
 *     of the source's known-answer set themselves.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

import {
  emitAflApiBrownlowMatchVotes, parseAflApiIdentities,
  type AflApiBrownlowMatchVoteRecord, type AflApiIdentities,
} from '../../src/lib/acquisition/afl-api-bundle';
import { resolveAflApiBrownlowMatch, type AflApiFixtureIdentityFallback } from '../../src/lib/acquisition/afl-api-brownlow';
import { resolveAflApiMatchViaFixtureObservation } from '../../src/lib/acquisition/afl-api-fixture-identity';
import { resolveAflApiSourceId } from '../../src/lib/acquisition/afl-api-match-identity';
import { resolveAflApiPlayer } from '../../src/lib/acquisition/afl-api-player-resolver';
import { translateAflApiBrownlowRound, AflRoundTranslationError } from '../../src/lib/acquisition/afl-api-rounds';
import { parseSourceFamilyRegistry, type SourceFamilyRegistry } from '../../src/lib/acquisition/source-families';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function loadEnv(): void {
  let contents: string;
  try {
    contents = readFileSync(join(PROJECT_ROOT, '.env'), 'utf8');
  } catch {
    return;
  }
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...rest] = trimmed.split('=');
    const name = key.trim();
    if (!process.env[name]) process.env[name] = rest.join('=').trim();
  }
}

function seasonDirOf(season: number): string {
  return join(PROJECT_ROOT, 'data', 'sources', 'AFLWebsite', 'BrownlowSamples', 'brownlow-samples', String(season));
}

function createReadOnlyClient(): postgres.Sql {
  const dsn = process.env.AFLDB_IMPORT_DATABASE_URL;
  if (!dsn) throw new Error('AFLDB_IMPORT_DATABASE_URL is not set.');
  return postgres(dsn, { max: 1, onnotice: () => {}, transform: { undefined: null } });
}

function parseArgs(argv: readonly string[]): { season: number; useFixtureIdentity: boolean } {
  const i = argv.indexOf('--season');
  const season = i >= 0 ? Number(argv[i + 1]) : 2025;
  if (!Number.isInteger(season)) throw new Error('--season must be an integer.');
  return { season, useFixtureIdentity: argv.includes('--use-fixture-identity') };
}

/** One resolved source-side key/value the audit will compare against canonical. */
type SourceVoteKey = {
  providerMatchId: string;
  providerPlayerId: string;
  playerId: number;
  playerName: string;
  apiRoundNumber: number;
  /** The resolved canonical match's OWN round_number — see the file header's
   * "KEY CORRECTION" note. What `brownlow_round_votes.round_number` should
   * hold; never the translated provider round below. */
  resolvedRoundNumber: number;
  /** `translateAflApiBrownlowRound()`'s round — retained for the divergence
   * report only, never used as (or compared into) the comparison key. */
  providerTranslatedRound: number;
  /** The resolved canonical `matches.id` this vote's match resolves to —
   * THE comparison key's second component, never round_number. */
  matchId: number;
  votes: number;
};

type CanonicalRow = { playerId: number; matchId: number | null; roundNumber: number; votes: number };

/** A single provider-player identity resolution outcome (AFLDB-ISSUE-228 S7
 * audit-accounting defect). Discriminated on `playerId` so a failed lookup
 * always carries its own `reason`, never a non-null assertion. */
export type PlayerVoteResolution = { playerId: number; reason: null } | { playerId: null; reason: string };

/**
 * Resolves one `providerPlayerId` via `resolveOutcome()`, calling it AT MOST
 * ONCE per distinct id (cached in `cache`) but returning the same outcome to
 * EVERY caller for that id, including every repeat/cached lookup — so a
 * caller iterating one row per physical vote can push one failure entry per
 * PHYSICAL row without re-querying the resolver for an id it has already
 * seen. Fixes the defect where a cached `null` was reused silently, so only
 * the FIRST physical row for a repeatedly-failing provider id was ever
 * reported to `identityFailures`.
 */
export async function resolvePlayerCached(
  providerPlayerId: string,
  cache: Map<string, PlayerVoteResolution>,
  resolveOutcome: (providerPlayerId: string) => Promise<PlayerVoteResolution>,
): Promise<PlayerVoteResolution> {
  const cached = cache.get(providerPlayerId);
  if (cached !== undefined) return cached;
  const outcome = await resolveOutcome(providerPlayerId);
  cache.set(providerPlayerId, outcome);
  return outcome;
}

function nameOf(seasonRaw: unknown, providerPlayerId: string): string {
  const matchVotes = (seasonRaw as { matchVotes?: unknown }).matchVotes;
  if (!Array.isArray(matchVotes)) return '';
  for (const entry of matchVotes) {
    const votes = (entry as { votes?: unknown }).votes;
    if (!Array.isArray(votes)) continue;
    for (const vote of votes) {
      const v = vote as { player?: { playerId?: unknown; givenName?: unknown; surname?: unknown } };
      if (v.player?.playerId === providerPlayerId) {
        const given = typeof v.player.givenName === 'string' ? v.player.givenName : '';
        const surname = typeof v.player.surname === 'string' ? v.player.surname : '';
        return `${given} ${surname}`.trim();
      }
    }
  }
  return '';
}

/**
 * Task B (AFLDB-ISSUE-228, 2026-09-20) — "clubs if present in source": the
 * distinct `providerTeamId`s carried by the vote rows THEMSELVES, mapped
 * through `afl-api-identities.json` (the same tracked reference data every
 * production resolver uses). This is reporting only, file-derived, never a
 * DB read and never a substitute for match resolution.
 */
function clubsFromVotes(record: AflApiBrownlowMatchVoteRecord, identities: AflApiIdentities): string {
  const teamIds = [...new Set(record.votes.map((v) => v.providerTeamId))];
  if (teamIds.length === 0) return '(none observed)';
  return teamIds.map((id) => identities.teams.get(id)?.hist ?? `${id} (unmapped)`).join(' v ');
}

/**
 * Task B — "translated round if available". Best-effort ONLY, for the
 * failure report: a match-resolution failure never reaches the production
 * round-translation call in the main loop (it `continue`s first), so this
 * re-attempts the SAME `translateAflApiBrownlowRound()` purely to annotate
 * the report. Its result never feeds back into any classification above.
 */
function translatedRoundReport(registry: SourceFamilyRegistry, season: number, apiRoundNumber: number): string {
  try {
    const translated = translateAflApiBrownlowRound(registry, season, apiRoundNumber);
    return translated.roundNumber === null ? 'non-home-and-away' : String(translated.roundNumber);
  } catch (error) {
    return error instanceof AflRoundTranslationError ? `unavailable (${error.code})` : 'unavailable (error)';
  }
}

/**
 * Task B — "fixture fallback outcome/reason if available". Calls the SAME
 * exported, read-only `resolveAflApiMatchViaFixtureObservation()` the real
 * settle (via `resolveAflApiBrownlowMatch()`) already consults internally —
 * never reimplemented — a second time, purely so the report can show its
 * OWN outcome rather than the collapsed `unknown_match` that
 * `resolveAflApiBrownlowMatch()` returns whenever the fallback's own reason
 * is `no_fixture_observation` (see that function's doc comment). Read-only,
 * idempotent, side-effect-free: calling it twice changes nothing.
 */
async function fixtureFallbackReport(
  sql: postgres.Sql, sourceId: number, providerMatchId: string,
  registry: SourceFamilyRegistry, identities: AflApiIdentities, enabled: boolean,
): Promise<string> {
  if (!enabled) return 'not attempted (--use-fixture-identity not supplied)';
  const result = await resolveAflApiMatchViaFixtureObservation(sql, sourceId, providerMatchId, registry, identities);
  return result.outcome === 'resolved'
    ? `resolved match_id=${result.matchId} (fixture-only identity succeeded; the failure above comes from a later check)`
    : `refused: ${result.reason}`;
}

async function main(): Promise<void> {
  const { season, useFixtureIdentity } = parseArgs(process.argv.slice(2));
  loadEnv();

  const seasonDir = seasonDirOf(season);
  const seasonRaw = readJson(join(seasonDir, '01-brownlow-season.raw.json'));
  const validation = readJson(join(seasonDir, '06-validation.json')) as {
    matchVoteRecords?: unknown;
    voteRows?: unknown;
    brownlowPlayers?: unknown;
  };

  const registry: SourceFamilyRegistry = parseSourceFamilyRegistry(
    readJson(join(PROJECT_ROOT, 'data', 'reference', 'source-families.json')),
  );

  // Identities are parsed unconditionally now (Task B, 2026-09-20): the
  // per-match-failure report below renders clubs from the source's own
  // `providerTeamId` regardless of `--use-fixture-identity`, which is a
  // read-only, file-only lookup and never affects match resolution itself.
  const identities = parseAflApiIdentities(
    readJson(join(PROJECT_ROOT, 'data', 'reference', 'afl-api-identities.json')),
  );

  // Mirrors `settle-afl-api-brownlow.ts`'s own `--use-fixture-identity` wiring
  // exactly: the SAME fallback shape (`{registry, identities}`), constructed
  // from the SAME `afl-api-identities.json`, passed into the SAME
  // `resolveAflApiBrownlowMatch()` the real settle calls. Off by default
  // (fail-closed) — omitting the flag keeps this audit's match resolution
  // limited to `staging.afl_api_match`, exactly as it was before this fallback
  // existed.
  let fixtureIdentityFallback: AflApiFixtureIdentityFallback | undefined;
  if (useFixtureIdentity) {
    fixtureIdentityFallback = { registry, identities };
  }
  console.log(
    `Fixture identity fallback: ${useFixtureIdentity ? 'ENABLED (--use-fixture-identity)' : 'DISABLED (default, fail-closed)'}`,
  );

  // Same production-validated parse/shape check the census tool performs,
  // reused verbatim: refuse to audit against a capture that does not prove
  // its own completeness.
  const { records } = emitAflApiBrownlowMatchVotes(seasonRaw, registry);
  const parsedVoteRows = records.reduce((n, r) => n + r.votes.length, 0);
  const distinctPlayers = new Set(records.flatMap((r) => r.votes.map((v) => v.providerPlayerId))).size;

  const mismatches: string[] = [];
  if (records.length !== validation.matchVoteRecords) {
    mismatches.push(`match vote records: parsed ${records.length}, validation.json says ${validation.matchVoteRecords}`);
  }
  if (parsedVoteRows !== validation.voteRows) {
    mismatches.push(`vote rows: parsed ${parsedVoteRows}, validation.json says ${validation.voteRows}`);
  }
  if (distinctPlayers !== validation.brownlowPlayers) {
    mismatches.push(`distinct players: parsed ${distinctPlayers}, validation.json says ${validation.brownlowPlayers}`);
  }
  if (mismatches.length > 0) {
    throw new Error(
      `Parsed population does not match ${join(seasonDir, '06-validation.json')}:\n  ${mismatches.join('\n  ')}\n`
      + 'Refusing to audit against a capture that does not prove itself complete.',
    );
  }

  console.log(`Full-source file: ${join(seasonDir, '01-brownlow-season.raw.json')}`);
  console.log(`Source positive vote rows (parsed, re-verified against 06-validation.json): ${parsedVoteRows}`);
  console.log('');

  const sql = createReadOnlyClient();
  try {
    const sourceId = await resolveAflApiSourceId(sql);

    // --- Resolve every source row to (canonical match identity, canonical
    // player_id) — never to round_number alone (file header's "KEY
    // CORRECTION"). Match resolution runs FIRST, once per record, exactly as
    // `planAflApiBrownlowMatchSet()` orders it: match -> final-exclusion ->
    // round-vocabulary validation -> players. ---
    const sourceKeys: SourceVoteKey[] = [];
    const identityFailures: { record: AflApiBrownlowMatchVoteRecord; providerPlayerId: string; reason: string }[] = [];
    const matchFailures: { record: AflApiBrownlowMatchVoteRecord; reason: string }[] = [];
    const roundFailures: { record: AflApiBrownlowMatchVoteRecord; reason: string }[] = [];
    const rescheduledRecords: { record: AflApiBrownlowMatchVoteRecord; matchId: number; providerTranslatedRound: number; resolvedRoundNumber: number }[] = [];
    const playerIdCache = new Map<string, PlayerVoteResolution>();

    for (const record of records) {
      const matchResolution = await resolveAflApiBrownlowMatch(sql, sourceId, record.providerMatchId, fixtureIdentityFallback);
      if (matchResolution.outcome !== 'resolved') {
        const reason = matchResolution.outcome === 'halt'
          ? `halt:${matchResolution.reason}`
          : matchResolution.reason;
        matchFailures.push({ record, reason });
        continue;
      }
      if (matchResolution.isFinal) {
        matchFailures.push({ record, reason: 'brownlow_final_match_excluded' });
        continue;
      }

      let providerTranslatedRound: number;
      try {
        providerTranslatedRound = translateAflApiBrownlowRound(registry, season, record.apiRoundNumber).roundNumber!;
      } catch (error) {
        const reason = error instanceof AflRoundTranslationError ? `${error.code}: ${error.message}` : String(error);
        roundFailures.push({ record, reason });
        continue;
      }

      // Unreachable in practice — `matchResolution.isFinal` is already
      // `false` here (`matches_is_final_ck`) — stated defensively rather
      // than asserted away with `!`, matching afl-api-brownlow.ts's own
      // production check.
      if (matchResolution.roundNumber === null) {
        matchFailures.push({ record, reason: 'brownlow_round_not_home_and_away' });
        continue;
      }
      const resolvedRoundNumber = matchResolution.roundNumber;
      if (resolvedRoundNumber !== providerTranslatedRound) {
        rescheduledRecords.push({
          record, matchId: matchResolution.matchId, providerTranslatedRound, resolvedRoundNumber,
        });
      }

      for (const vote of record.votes) {
        const outcome = await resolvePlayerCached(vote.providerPlayerId, playerIdCache, async (providerPlayerId) => {
          const resolution = await resolveAflApiPlayer(sql, sourceId, providerPlayerId);
          if (resolution.outcome === 'resolved') return { playerId: resolution.playerId, reason: null };
          const reason = resolution.outcome === 'refused'
            ? `${resolution.reason}: candidateIds=${resolution.candidateIds.join(',')}`
            : 'unresolved';
          return { playerId: null, reason };
        });
        if (outcome.playerId === null) {
          // Pushed for EVERY physical vote row whose cached/fresh resolution
          // is unresolved/refused — never once per distinct provider id —
          // so identityFailures.length stays at physical-row grain even
          // when resolvePlayerCached() reused a cached failure.
          identityFailures.push({ record, providerPlayerId: vote.providerPlayerId, reason: outcome.reason });
          continue;
        }

        sourceKeys.push({
          providerMatchId: record.providerMatchId,
          providerPlayerId: vote.providerPlayerId,
          playerId: outcome.playerId,
          playerName: nameOf(seasonRaw, vote.providerPlayerId),
          apiRoundNumber: record.apiRoundNumber,
          resolvedRoundNumber,
          providerTranslatedRound,
          matchId: matchResolution.matchId,
          votes: vote.votes,
        });
      }
    }

    // --- Task A (AFLDB-ISSUE-228, 2026-09-20): explicit accounting for every
    // physical source row EXCLUDED from `sourceGroups`, so the population
    // invariant below can state the full partition rather than silently
    // treating an excluded row as "missing from nowhere in particular".
    // Mutually exclusive BY CONTROL FLOW, never by post-hoc deduplication:
    //   - a record whose match resolution refused/halted, or whose resolved
    //     match turned out final (`matchFailures`), `continue`s the outer
    //     `for (const record of records)` loop BEFORE the round-translation
    //     step and BEFORE the per-vote loop — so every one of that record's
    //     physical vote rows is counted here and nowhere else;
    //   - a record whose round translation refused (`roundFailures`)
    //     likewise `continue`s BEFORE the per-vote loop — same reasoning;
    //   - only a record that cleared BOTH of the above reaches the per-vote
    //     loop, where a single vote's OWN player-identity refusal
    //     (`identityFailures`) is counted per vote, never per record, and
    //     that vote's `continue` is scoped to the inner loop only, so a
    //     sibling vote in the same record can still land in `sourceKeys`.
    // No physical row can therefore appear in more than one of
    // {sourceKeys, identityFailures, matchFailures-votes, roundFailures-votes}.
    const matchFailurePhysicalRows = matchFailures.reduce((n, f) => n + f.record.votes.length, 0);
    const roundFailurePhysicalRows = roundFailures.reduce((n, f) => n + f.record.votes.length, 0);
    const identityFailurePhysicalRows = identityFailures.length;

    // --- Canonical side: every positive-vote row for this season. SELECT-only. ---
    const allCanonicalRows = await sql<CanonicalRow[]>`
      SELECT player_id AS "playerId", match_id AS "matchId", round_number AS "roundNumber", votes
        FROM brownlow_round_votes
       WHERE season = ${season} AND votes > 0
    `;
    // A canonical row with no resolved match_id predates migration 094's
    // backfill resolving it (or genuinely could not resolve, §27.5) — it is
    // neither "matched", "missing" nor "unexpected" at the (player_id,
    // match_id) grain this audit now compares at, so it is reported on its
    // own rather than silently folded into either bucket.
    const canonicalRows = allCanonicalRows.filter((row): row is CanonicalRow & { matchId: number } => row.matchId !== null);
    const unresolvedCanonicalRows = allCanonicalRows.filter((row) => row.matchId === null);

    // --- Group BOTH sides by (player_id, match_id) BEFORE comparing — NEVER
    // by round_number (file header's "KEY CORRECTION"): a rescheduled
    // match's round can equal another genuine match's round for the same
    // player-team-season pairing is not possible under AFLDB's fixture rules
    // (a club plays each declared round exactly once), but round_number
    // alone is a DERIVED fact of the match, not the match itself, and using
    // it as the key is exactly what silently collapsed Matt Rowell's two
    // genuine 2025 Round-24-labelled votes into one key before this
    // correction. match_id is the match's own identity and is never
    // ambiguous this way.
    //
    // A naive per-row comparison (source rows iterated one at a time against a
    // canonical Map keyed by the same pair) silently double-counts an "exact
    // match" whenever two DIFFERENT source rows resolve to the same key (e.g.
    // a player wrongly carrying a vote in two different provider matchIds for
    // the same match): the Map dedupes canonical's contribution to the
    // "matched" set, but the row-level exactMatches counter does not dedupe
    // the source's contribution, so exactMatches can exceed the number of
    // distinct canonical rows actually consumed. Comparing key groups (never
    // raw rows) on both sides, and separately reporting each side's own
    // multiplicity, makes that kind of overcount structurally impossible
    // instead of merely unlikely. ---
    type KeyGroup<T> = { playerId: number; matchId: number; entries: T[] };
    function groupByKey<T extends { playerId: number; matchId: number }>(
      rows: readonly T[],
    ): Map<string, KeyGroup<T>> {
      const groups = new Map<string, KeyGroup<T>>();
      for (const row of rows) {
        const key = `${row.playerId}|${row.matchId}`;
        const group = groups.get(key);
        if (group) group.entries.push(row);
        else groups.set(key, { playerId: row.playerId, matchId: row.matchId, entries: [row] });
      }
      return groups;
    }

    const sourceGroups = groupByKey(sourceKeys);
    const canonicalGroups = groupByKey(canonicalRows);
    const duplicateSourceGroups = [...sourceGroups.entries()].filter(([, g]) => g.entries.length > 1);
    const duplicateCanonicalGroups = [...canonicalGroups.entries()].filter(([, g]) => g.entries.length > 1);

    // --- Key-level comparison: each (player_id, match_id) key is judged
    // exactly once, regardless of how many physical rows either side carries
    // for it. Multiplicity is reported separately above/below, never folded
    // silently into the match/mismatch/missing counts. ---
    const missingGroups: KeyGroup<SourceVoteKey>[] = [];
    const mismatchGroups: { group: KeyGroup<SourceVoteKey>; canonicalVotes: number[] }[] = [];
    const exactKeys = new Set<string>();
    const matchedKeys = new Set<string>();

    const roundDriftGroups: { key: string; group: KeyGroup<SourceVoteKey>; canonicalRoundNumbers: number[] }[] = [];

    for (const [key, group] of sourceGroups) {
      const canonicalGroup = canonicalGroups.get(key);
      if (!canonicalGroup) {
        missingGroups.push(group);
        continue;
      }
      matchedKeys.add(key);
      const sourceVotes = new Set(group.entries.map((e) => e.votes));
      const canonicalVotes = new Set(canonicalGroup.entries.map((r) => r.votes));
      if (sourceVotes.size === 1 && canonicalVotes.size === 1 && sourceVotes.has([...canonicalVotes][0]!)) {
        exactKeys.add(key);
      } else {
        mismatchGroups.push({ group, canonicalVotes: [...canonicalVotes] });
      }
      // The two sides share a match_id but disagree on round_number: since
      // both columns describe the SAME resolved match, this is never a
      // legitimate reschedule (that is already fully accounted for by
      // matching on match_id, not round_number) — it can only mean the
      // canonical row's round_number was written from something other than
      // its own match_id. Reported, never silently accepted as "exact"
      // merely because the vote counts happen to agree.
      const canonicalRoundNumbers = [...new Set(canonicalGroup.entries.map((r) => r.roundNumber))];
      const sourceRoundNumbers = new Set(group.entries.map((e) => e.resolvedRoundNumber));
      if (canonicalRoundNumbers.length !== 1 || !sourceRoundNumbers.has(canonicalRoundNumbers[0]!)) {
        roundDriftGroups.push({ key, group, canonicalRoundNumbers });
      }
    }

    const unexpectedGroups = [...canonicalGroups.entries()].filter(([key]) => !matchedKeys.has(key));
    const unexpectedRows = unexpectedGroups.flatMap(([, g]) => g.entries);

    console.log('=== Population ===');
    console.log(`  source positive vote rows (physical):        ${parsedVoteRows}`);
    console.log(`  source distinct (player,match) keys:         ${sourceGroups.size}`);
    console.log(`  source keys with >1 physical row:             ${duplicateSourceGroups.length}`);
    console.log(`  canonical positive vote rows (physical):     ${canonicalRows.length}`);
    console.log(`  canonical distinct (player,match) keys:      ${canonicalGroups.size}`);
    console.log(`  canonical keys with >1 physical row:          ${duplicateCanonicalGroups.length}`);
    console.log(`  canonical rows with no resolved match_id:    ${unresolvedCanonicalRows.length}`);
    console.log(`  source rows excluded (match-resolution failure):     ${matchFailurePhysicalRows} (${matchFailures.length} match(es))`);
    console.log(`  source rows excluded (round-translation failure):    ${roundFailurePhysicalRows} (${roundFailures.length} match(es))`);
    console.log(`  source rows excluded (identity-resolution failure):  ${identityFailurePhysicalRows}`);
    console.log('');

    console.log('=== Comparison (key-level: a (player_id, match_id) key is counted once) ===');
    console.log(`  exact matches:              ${exactKeys.size}`);
    console.log(`  missing keys:               ${missingGroups.length}`);
    console.log(`  vote-value mismatches:      ${mismatchGroups.length}`);
    console.log(`  unexpected canonical keys:  ${unexpectedGroups.length}  (${unexpectedRows.length} physical row(s))`);
    console.log(`  round_number drift (same match_id, different round_number): ${roundDriftGroups.length}`);
    console.log(`  identity failures:          ${identityFailures.length}`);
    console.log(`  match resolution failures:  ${matchFailures.length}`);
    console.log(`  round-translation failures: ${roundFailures.length}`);
    console.log(`  legitimate reschedules (translated round != canonical match round): ${rescheduledRecords.length}`);
    console.log('');

    // --- Invariant: the partition must reconcile exactly. A violation here
    // means this script's own bookkeeping has drifted from the data it just
    // read — HALT rather than print a self-contradictory report. ---
    const invariantErrors: string[] = [];
    if (sourceGroups.size !== exactKeys.size + missingGroups.length + mismatchGroups.length) {
      invariantErrors.push(
        `source unique keys (${sourceGroups.size}) != exact (${exactKeys.size}) + missing `
        + `(${missingGroups.length}) + mismatch (${mismatchGroups.length})`,
      );
    }
    if (canonicalGroups.size !== exactKeys.size + unexpectedGroups.length + mismatchGroups.length) {
      invariantErrors.push(
        `canonical unique keys (${canonicalGroups.size}) != exact (${exactKeys.size}) + unexpected `
        + `(${unexpectedGroups.length}) + mismatch (${mismatchGroups.length})`,
      );
    }
    // Task A (AFLDB-ISSUE-228, 2026-09-20): the full partition of every
    // parsed source row is resolved/grouped + excluded-by-identity +
    // excluded-by-match-resolution + excluded-by-round-translation — see the
    // mutual-exclusivity comment where these three exclusion counters are
    // computed, above. A run with unresolved matches legitimately fails the
    // COMPARISON (missing/unexpected/failure counts above are non-zero) but
    // must not ALSO fail this arithmetic check merely because the missing
    // rows are accounted for by a recorded failure rather than by a group.
    const sourcePhysicalFromGroups = [...sourceGroups.values()].reduce((n, g) => n + g.entries.length, 0);
    const sourcePhysicalAccountedFor = sourcePhysicalFromGroups
      + identityFailurePhysicalRows + matchFailurePhysicalRows + roundFailurePhysicalRows;
    if (sourcePhysicalAccountedFor !== parsedVoteRows) {
      invariantErrors.push(
        `source physical rows accounted for (${sourcePhysicalAccountedFor} = ${sourcePhysicalFromGroups} resolved `
        + `+ ${identityFailurePhysicalRows} identity-failure + ${matchFailurePhysicalRows} match-failure `
        + `+ ${roundFailurePhysicalRows} round-failure) != parsed source rows (${parsedVoteRows})`,
      );
    }
    const canonicalPhysicalFromGroups = [...canonicalGroups.values()].reduce((n, g) => n + g.entries.length, 0);
    if (canonicalPhysicalFromGroups !== canonicalRows.length) {
      invariantErrors.push(
        `canonical physical rows reconstructed from groups (${canonicalPhysicalFromGroups}) != canonical `
        + `positive rows read (${canonicalRows.length})`,
      );
    }
    if (invariantErrors.length > 0) {
      throw new Error(
        'Audit population arithmetic does not reconcile — refusing to report a result:\n  '
        + invariantErrors.join('\n  '),
      );
    }

    if (duplicateSourceGroups.length > 0) {
      console.log(`=== Source keys with >1 physical row (${duplicateSourceGroups.length}) ===`);
      for (const [key, g] of duplicateSourceGroups) {
        console.log(`  key=${key} (${g.entries.length} source rows):`);
        for (const e of g.entries) {
          console.log(
            `    match=${e.providerMatchId} provider_player_id=${e.providerPlayerId} name="${e.playerName}" `
            + `api_round=${e.apiRoundNumber} votes=${e.votes}`,
          );
        }
      }
      console.log('');
    }

    if (duplicateCanonicalGroups.length > 0) {
      console.log(`=== Canonical keys with >1 physical row (${duplicateCanonicalGroups.length}) ===`);
      for (const [key, g] of duplicateCanonicalGroups) {
        console.log(`  key=${key} (${g.entries.length} canonical rows): votes=[${g.entries.map((r) => r.votes).join(', ')}]`);
      }
      console.log('');
    }

    if (identityFailures.length > 0) {
      console.log(`=== Identity failures (${identityFailures.length}) ===`);
      for (const f of identityFailures) {
        console.log(
          `  match=${f.record.providerMatchId} provider_player_id=${f.providerPlayerId} `
          + `name="${nameOf(seasonRaw, f.providerPlayerId)}" reason=${f.reason}`,
        );
      }
      console.log('');
    }

    if (matchFailures.length > 0) {
      // Task B (AFLDB-ISSUE-228, 2026-09-20): one line per FAILED MATCH,
      // never per vote row — `matchFailures` already carries exactly one
      // entry per `matchVotes[]` record (pushed once, before the per-vote
      // loop even starts), so no explicit de-duplication is needed here.
      console.log(`=== Match resolution failures (${matchFailures.length} match(es), ${matchFailurePhysicalRows} vote row(s)) — resolveAflApiBrownlowMatch() refused/halted ===`);
      for (const f of matchFailures) {
        const clubs = clubsFromVotes(f.record, identities);
        const translatedRound = translatedRoundReport(registry, season, f.record.apiRoundNumber);
        const fallback = await fixtureFallbackReport(
          sql, sourceId, f.record.providerMatchId, registry, identities, useFixtureIdentity,
        );
        console.log(
          `  provider_match_id=${f.record.providerMatchId} provider_api_round=${f.record.apiRoundNumber} `
          + `translated_round=${translatedRound} clubs=${clubs} reason=${f.reason} fixture_fallback=${fallback}`,
        );
      }
      console.log('');
    }

    if (roundFailures.length > 0) {
      console.log(`=== Round-translation failures (${roundFailures.length}) ===`);
      for (const f of roundFailures) {
        console.log(`  match=${f.record.providerMatchId} api_round=${f.record.apiRoundNumber} reason=${f.reason}`);
      }
      console.log('');
    }

    if (rescheduledRecords.length > 0) {
      console.log(
        `=== Legitimate reschedules (${rescheduledRecords.length}) — translated provider round != resolved `
        + 'canonical match round; brownlow_round_votes.round_number is written from the canonical match, '
        + 'never the translated round. NOT a defect. ===',
      );
      for (const r of rescheduledRecords) {
        console.log(
          `  match=${r.record.providerMatchId} canonical_match_id=${r.matchId} api_round=${r.record.apiRoundNumber} `
          + `provider_translated_round=${r.providerTranslatedRound} canonical_match_round=${r.resolvedRoundNumber}`,
        );
      }
      console.log('');
    }

    if (unresolvedCanonicalRows.length > 0) {
      console.log(
        `=== Canonical rows with no resolved match_id (${unresolvedCanonicalRows.length}) — excluded from the `
        + '(player_id, match_id) comparison above; neither matched, missing nor unexpected ===',
      );
      for (const u of unresolvedCanonicalRows) {
        console.log(`  player_id=${u.playerId} round_number=${u.roundNumber} canonical_votes=${u.votes}`);
      }
      console.log('');
    }

    if (missingGroups.length > 0) {
      console.log(`=== Missing canonical keys (${missingGroups.length}) — source has a vote, canonical does not ===`);
      for (const g of missingGroups) {
        for (const m of g.entries) {
          console.log(
            `  match=${m.providerMatchId} match_id=${m.matchId} provider_player_id=${m.providerPlayerId} `
            + `name="${m.playerName}" player_id=${m.playerId} api_round=${m.apiRoundNumber} `
            + `canonical_round=${m.resolvedRoundNumber} source_votes=${m.votes}`,
          );
        }
      }
      console.log('');
    }

    if (unexpectedGroups.length > 0) {
      console.log(
        `=== Unexpected canonical keys (${unexpectedGroups.length}, ${unexpectedRows.length} physical row(s)) `
        + '— canonical has a vote, source does not ===',
      );
      for (const [key, g] of unexpectedGroups) {
        for (const u of g.entries) {
          console.log(`  key=${key} player_id=${u.playerId} match_id=${u.matchId} round_number=${u.roundNumber} canonical_votes=${u.votes}`);
        }
      }
      console.log('');
    }

    if (mismatchGroups.length > 0) {
      console.log(`=== Vote-value mismatches (${mismatchGroups.length}) ===`);
      for (const vm of mismatchGroups) {
        for (const e of vm.group.entries) {
          console.log(
            `  match=${e.providerMatchId} match_id=${e.matchId} provider_player_id=${e.providerPlayerId} `
            + `name="${e.playerName}" player_id=${e.playerId} api_round=${e.apiRoundNumber} `
            + `canonical_round=${e.resolvedRoundNumber} source_votes=${e.votes} canonical_votes=[${vm.canonicalVotes.join(', ')}]`,
          );
        }
      }
      console.log('');
    }

    if (roundDriftGroups.length > 0) {
      console.log(
        `=== round_number drift (${roundDriftGroups.length}) — same (player_id, match_id), canonical `
        + 'round_number disagrees with the resolved match\'s own round. This IS a defect (a canonical row\'s '
        + 'round_number was not derived from its own match_id). ===',
      );
      for (const d of roundDriftGroups) {
        for (const e of d.group.entries) {
          console.log(
            `  key=${d.key} match=${e.providerMatchId} player_id=${e.playerId} `
            + `source_canonical_round=${e.resolvedRoundNumber} canonical_round_numbers=[${d.canonicalRoundNumbers.join(', ')}]`,
          );
        }
      }
      console.log('');
    }

    console.log('=== Result ===');
    const clean = missingGroups.length === 0 && unexpectedGroups.length === 0 && mismatchGroups.length === 0
      && identityFailures.length === 0 && matchFailures.length === 0 && roundFailures.length === 0
      && roundDriftGroups.length === 0 && unresolvedCanonicalRows.length === 0
      && duplicateSourceGroups.length === 0 && duplicateCanonicalGroups.length === 0
      && exactKeys.size === sourceGroups.size && canonicalGroups.size === sourceGroups.size;
    console.log(clean ? '  PASS: exact equality between source and canonical for season ' + season : '  FAIL: see sections above.');
  } finally {
    await sql.end();
  }
}

const invokedDirectly = process.argv[1] !== undefined
  && relative(resolve(process.argv[1]), fileURLToPath(import.meta.url)) === '';

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
