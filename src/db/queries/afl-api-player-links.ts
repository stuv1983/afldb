import 'server-only';

import postgres from 'postgres';

import { authSql } from '@/db/authClient';
import { sql } from '@/db/client';
import {
  adjudicationFingerprint,
  AFL_API_ADMIN_MATCH_METHOD,
  AFL_API_LEDGER_CHECKS,
  AFL_API_PLAYER_REFERENCE_MANIFEST,
  aflApiRefusalMessage,
  classifyAflApiIdentityState,
  decideAflApiLink,
  decideAflApiRevoke,
  evaluateNonUseProof,
  extractProviderClassification,
  reduceAdjudicationEvidence,
  validateAdjudicationInput,
  validateManifestAgainstCatalogue,
  type AflApiDecision,
  type AflApiRefusalCode,
  type AflApiIdentityRow,
  type AflApiIdentityState,
} from '@/lib/acquisition/afl-api-adjudication';
import {
  buildAflApiPlayerEvidence,
  normaliseSurname,
  type AflApiMatchEvidenceInput,
  type AflApiProviderClassification,
} from '@/lib/acquisition/afl-api-player-evidence';
import { readPlayerSummaries, type PlayerSummary } from '@/db/queries/player-match-candidates';

/**
 * AFLDB-ISSUE-235 §7.2 — the `afl_api` human identity adjudication query module.
 *
 * Reads run on the public/auth clients; writes run on a short-lived
 * `AFLDB_IMPORT_DATABASE_URL` connection, exactly the `resolveLink()` pattern
 * `player-links.ts` already establishes — one required audit row in the same
 * transaction as the statistical write (migration 066, AFLDB-ISSUE-027).
 */

type Sql = postgres.Sql;
type Tx = postgres.TransactionSql;

const AFL_API_SOURCE_KEY = 'afl_api';

async function fetchAflApiSourceId(db: Sql | Tx): Promise<number> {
  const [row] = await db<{ id: number }[]>`SELECT id FROM sources WHERE key = ${AFL_API_SOURCE_KEY}`;
  if (!row) throw new Error("sources.key = 'afl_api' not found; migration 077 must be applied.");
  return row.id;
}

async function readExistingIdentity(
  db: Sql | Tx, sourceId: number, providerId: string,
): Promise<AflApiIdentityRow | null> {
  const [row] = await db<AflApiIdentityRow[]>`
    SELECT id, status::text AS status, player_id AS "playerId", match_method AS "matchMethod"
      FROM external_identities
     WHERE source_id = ${sourceId} AND external_id = ${providerId}
  `;
  return row ?? null;
}

/** D6-3: the player's own stable identity, the same rule the promotion-inventory lineage ref uses. */
async function readPlayerStableIdentity(db: Sql | Tx, playerId: number): Promise<string | null> {
  const [row] = await db<{ identity: string }[]>`
    SELECT ei.external_id AS identity
      FROM external_identities ei
      JOIN sources s ON s.id = ei.source_id
     WHERE ((s.key = 'afltables' AND ei.match_method = 'afltables_profile_url')
            OR (s.key = 'manual_admin_edit' AND ei.match_method = 'manual_admin_edit'))
       AND ei.status IN ('unique', 'resolved')
       AND ei.player_id = ${playerId}
     ORDER BY (s.key <> 'afltables'), ei.external_id
     LIMIT 1
  `;
  return row?.identity ?? null;
}

/** D6-2: does this player already hold a DIFFERENT afl_api provider row? */
async function readPlayerOtherAflApiRow(
  db: Sql | Tx, sourceId: number, playerId: number, excludingProviderId?: string,
): Promise<{ externalId: string; status: string; matchMethod: string | null } | null> {
  const [row] = await db<{ externalId: string; status: string; matchMethod: string | null }[]>`
    SELECT external_id AS "externalId", status::text AS status, match_method AS "matchMethod"
      FROM external_identities
     WHERE source_id = ${sourceId} AND player_id = ${playerId}
       AND external_id <> ${excludingProviderId ?? ''}
  `;
  return row ?? null;
}

async function readPendingCandidates(
  db: Sql | Tx, sourceId: number, providerId: string,
): Promise<readonly { id: number; sourceVersionSeq: number; season: number }[]> {
  const rows = await db<{ id: number; sourceVersionSeq: number; season: number }[]>`
    SELECT id, source_version_seq AS "sourceVersionSeq", season
      FROM promotion_candidates
     WHERE source_id = ${sourceId} AND verb = 'unresolved_identity' AND status = 'pending'
       AND split_part(external_record_id, '|', 3) = ${providerId}
     ORDER BY id
  `;
  return rows;
}

async function readLatestAdjudicationId(db: Sql | Tx, providerId: string): Promise<number | null> {
  const [row] = await db<{ id: number }[]>`
    SELECT id FROM afl_api_identity_adjudications
     WHERE source_key = ${AFL_API_SOURCE_KEY} AND external_id = ${providerId}
     ORDER BY id DESC LIMIT 1
  `;
  return row?.id ?? null;
}

/* ------------------------------------------------------------------ *
 * Listing (§7.3 list page)
 * ------------------------------------------------------------------ */

export type AflApiUnresolvedProviderRow = {
  providerId: string;
  pendingCount: number;
  seasons: readonly number[];
  existing: AflApiIdentityRow | null;
  state: AflApiIdentityState;
};

/**
 * Every afl_api provider with at least one pending `unresolved_identity`
 * candidate: U1 (no row yet) and "awaiting settle" L-I/L-H (a trusted row
 * exists, but a settle has not yet caught up). Candidates read via authSql
 * (the admin-only queue); the identity rows via the public client, the same
 * table every settle reads.
 */
export async function listAflApiUnresolvedProviders(): Promise<readonly AflApiUnresolvedProviderRow[]> {
  const sourceId = await fetchAflApiSourceId(sql);
  const candidateRows = await authSql<{ providerId: string; season: number; n: string }[]>`
    SELECT split_part(c.external_record_id, '|', 3) AS "providerId", c.season, count(*)::text AS n
      FROM promotion_candidates c
     WHERE c.source_id = ${sourceId} AND c.verb = 'unresolved_identity' AND c.status = 'pending'
     GROUP BY 1, 2
  `;
  if (candidateRows.length === 0) return [];

  const providerIds = [...new Set(candidateRows.map((r) => r.providerId))];
  // external_id is not part of AflApiIdentityRow (readExistingIdentity's per-provider shape),
  // so it is read alongside here and used only as the map key.
  const existingByProvider = new Map<string, AflApiIdentityRow>();
  const existingRows = await sql<(AflApiIdentityRow & { externalId: string })[]>`
    SELECT id, external_id AS "externalId", status::text AS status, player_id AS "playerId", match_method AS "matchMethod"
      FROM external_identities
     WHERE source_id = ${sourceId} AND external_id = ANY(${providerIds})
  `;
  for (const row of existingRows) existingByProvider.set(row.externalId, row);

  const byProvider = new Map<string, { seasons: Set<number>; count: number }>();
  for (const row of candidateRows) {
    const entry = byProvider.get(row.providerId) ?? { seasons: new Set<number>(), count: 0 };
    entry.seasons.add(row.season);
    entry.count += Number(row.n);
    byProvider.set(row.providerId, entry);
  }

  return [...byProvider.entries()]
    .map(([providerId, agg]) => {
      const existing = existingByProvider.get(providerId) ?? null;
      return {
        providerId,
        pendingCount: agg.count,
        seasons: [...agg.seasons].sort((a, b) => a - b),
        existing,
        state: classifyAflApiIdentityState({ row: existing, hasPendingCandidate: true }),
      };
    })
    .sort((a, b) => a.providerId.localeCompare(b.providerId));
}

/* ------------------------------------------------------------------ *
 * Detail evidence (§6)
 * ------------------------------------------------------------------ */

type RawPlayerStatsPayload = {
  teamId?: unknown;
  playerStats?: {
    player?: {
      playerId?: unknown;
      playerJumperNumber?: unknown;
      playerName?: { givenName?: unknown; surname?: unknown };
    };
    stats?: Record<string, unknown>;
  };
};

function numOrNull(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

/**
 * The AFL API's raw camelCase stat names -> the canonical snake_case
 * `AflApiEvidenceStatColumn` set (`afl-api-player-evidence.ts`), mirroring
 * `build_afl_api_player_bridge.py`'s `parse_player_stats()` field mapping
 * exactly (pinned there by `tests/python/afl_api_bridge_contract.py`).
 */
function providerStatsFromRawPayload(payload: RawPlayerStatsPayload) {
  const stats = payload.playerStats?.stats ?? {};
  const clearances = stats.clearances as Record<string, unknown> | undefined;
  return {
    kicks: numOrNull(stats.kicks), handballs: numOrNull(stats.handballs), marks: numOrNull(stats.marks),
    tackles: numOrNull(stats.tackles), goals: numOrNull(stats.goals), behinds: numOrNull(stats.behinds),
    hitouts: numOrNull(stats.hitouts), frees_for: numOrNull(stats.freesFor),
    frees_against: numOrNull(stats.freesAgainst), inside_50s: numOrNull(stats.inside50s),
    clearances: numOrNull(clearances?.totalClearances), rebounds: numOrNull(stats.rebound50s),
    goal_assists: numOrNull(stats.goalAssists), contested: numOrNull(stats.contestedPossessions),
    uncontested: numOrNull(stats.uncontestedPossessions), contested_marks: numOrNull(stats.contestedMarks),
    marks_inside_50: numOrNull(stats.marksInside50), one_percenters: numOrNull(stats.onePercenters),
    bounces: numOrNull(stats.bounces), clangers: numOrNull(stats.clangers),
  };
}

export type AflApiProviderEvidence = {
  providerId: string;
  state: AflApiIdentityState;
  existing: AflApiIdentityRow | null;
  observedGivenName: string | null;
  observedSurname: string | null;
  teamIds: readonly string[];
  seasons: readonly number[];
  jumperNumbers: readonly number[];
  matches: readonly { matchKey: string; season: number; canonicalMatchId: number | null }[];
  classification: AflApiProviderClassification | null;
  candidatePlayerIds: readonly number[];
  playerSummaries: ReadonlyMap<number, PlayerSummary>;
  playerStableIdentity: ReadonlyMap<number, string | null>;
  openContradictions: readonly { id: number; description: string; details: unknown }[];
  /**
   * The exact (id, sourceVersionSeq) pairs `adjudicationFingerprint()` needs -- carried as
   * a pair, not a bare id list, so the detail page can compute BYTE-IDENTICAL fingerprint
   * input to what `linkAflApiProvider`/`revokeAflApiLink` recompute under lock. A bare id
   * list here would force the page to fabricate a placeholder sourceVersionSeq that could
   * never agree with the server's real one, refusing every submission as stale.
   */
  pendingCandidates: readonly { id: number; sourceVersionSeq: number }[];
  latestAdjudicationId: number | null;
};

/**
 * §6 blocks 1-6, server-side and read-only: provider facts, per-match
 * evidence, the bridge's own rule recomputed against this database's
 * current data, candidate players, collisions/contradictions, and enough
 * to phrase "why it is unresolved" in words. Block 7 (the form) is the UI's
 * job; `null` when the provider has no pending evidence at all (D5: not
 * actionable).
 */
export async function readAflApiProviderEvidence(providerId: string): Promise<AflApiProviderEvidence | null> {
  const sourceId = await fetchAflApiSourceId(sql);
  const [existing, pendingCandidates] = await Promise.all([
    readExistingIdentity(sql, sourceId, providerId),
    readPendingCandidates(sql, sourceId, providerId),
  ]);
  const state = classifyAflApiIdentityState({ row: existing, hasPendingCandidate: pendingCandidates.length > 0 });
  if (pendingCandidates.length === 0 && existing === null) return null; // U0: not actionable, not listed

  // Block 1/2: the provider's own spine payloads, one per (match, candidate).
  const payloadRows = await sql<{
    externalRecordId: string; season: number; rawPayload: RawPlayerStatsPayload;
  }[]>`
    SELECT v.external_record_id AS "externalRecordId", c.season, p.raw_payload AS "rawPayload"
      FROM promotion_candidates c
      JOIN staging.source_record_versions v
        ON v.source_id = c.source_id AND v.family = c.family
       AND v.external_record_id = c.external_record_id AND v.version_seq = c.source_version_seq
      JOIN staging.source_payloads p
        ON p.source_id = v.source_id AND p.family = v.family AND p.payload_hash = v.payload_hash
     WHERE c.source_id = ${sourceId} AND c.verb = 'unresolved_identity' AND c.status = 'pending'
       AND split_part(c.external_record_id, '|', 3) = ${providerId}
     ORDER BY c.id
  `;

  const teamIds = new Set<string>();
  const seasons = new Set<number>();
  const jumperNumbers = new Set<number>();
  let observedGivenName: string | null = null;
  let observedSurname: string | null = null;
  const matchInputs: AflApiMatchEvidenceInput[] = [];
  const matchesByKey = new Map<string, { matchKey: string; season: number; canonicalMatchId: number | null }>();

  for (const row of payloadRows) {
    seasons.add(row.season);
    const [providerMatchId, providerTeamId] = row.externalRecordId.split('|');
    const player = row.rawPayload.playerStats?.player;
    if (player) {
      if (typeof player.playerJumperNumber === 'number') jumperNumbers.add(player.playerJumperNumber);
      const givenName = player.playerName?.givenName;
      const surname = player.playerName?.surname;
      if (observedGivenName === null && typeof givenName === 'string') observedGivenName = givenName;
      if (observedSurname === null && typeof surname === 'string') observedSurname = surname;
    }
    if (typeof row.rawPayload.teamId === 'string') teamIds.add(row.rawPayload.teamId);
    else if (providerTeamId) teamIds.add(providerTeamId);
  }

  // Block 3: recompute the bridge's own rule against this database's current data, one
  // AflApiMatchEvidenceInput per provider match, using exactly the canonical-side read
  // emit-afl-api-player-bridge.ts's readCanonicalPlayerMatchStats() uses.
  const matchKeys = [...new Set(payloadRows.map((r) => {
    const [providerMatchId] = r.externalRecordId.split('|');
    return providerMatchId;
  }))];
  // Provider match ids are CD_M...; the canonical match_key is a different rendered
  // string, renderMatchKey()'s own format (settle-core.ts:174-182):
  // season|round_code|match_date|home_club_name|away_club_name. staging.afl_api_match (if
  // the match itself resolved) carries every component except the club NAMES, joined here.
  const canonicalMatches = matchKeys.length === 0 ? [] : await sql<{
    externalRecordId: string; canonicalMatchId: number | null; matchKey: string | null;
  }[]>`
    SELECT m.external_record_id AS "externalRecordId", mm.id AS "canonicalMatchId", mm.match_key AS "matchKey"
      FROM staging.afl_api_match m
      JOIN clubs hc ON hc.id = m.home_club_id
      JOIN clubs ac ON ac.id = m.away_club_id
      LEFT JOIN matches mm
        ON mm.match_key = (m.season::text || '|' || m.round_code || '|' || m.match_date::text
                            || '|' || hc.name || '|' || ac.name)
     WHERE m.source_id = ${sourceId} AND m.external_record_id = ANY(${matchKeys})
  `;
  const canonicalByProviderMatch = new Map(canonicalMatches.map((m) => [m.externalRecordId, m]));

  for (const providerMatchId of matchKeys) {
    const rowsForMatch = payloadRows.filter((r) => r.externalRecordId.startsWith(`${providerMatchId}|`));
    const canonical = canonicalByProviderMatch.get(providerMatchId);
    const canonicalMatchId = canonical?.canonicalMatchId ?? null;
    matchesByKey.set(providerMatchId, {
      matchKey: canonical?.matchKey ?? providerMatchId,
      season: rowsForMatch[0]?.season ?? 0,
      canonicalMatchId,
    });

    const canonicalRows = canonicalMatchId === null ? [] : await sql<{
      playerId: number; clubId: number; jumperNumberRaw: string | null; surname: string | null;
      kicks: number | null; handballs: number | null; marks: number | null; tackles: number | null;
      goals: number | null; behinds: number | null; hitouts: number | null;
      frees_for: number | null; frees_against: number | null; inside_50s: number | null;
      clearances: number | null; rebounds: number | null; goal_assists: number | null;
      contested: number | null; uncontested: number | null; contested_marks: number | null;
      marks_inside_50: number | null; one_percenters: number | null; bounces: number | null;
      clangers: number | null;
    }[]>`
      SELECT pms.player_id AS "playerId", pms.club_id AS "clubId",
             pms.jumper_number AS "jumperNumberRaw", p.surname,
             pms.kicks, pms.handballs, pms.marks, pms.tackles, pms.goals, pms.behinds, pms.hitouts,
             pms.frees_for, pms.frees_against, pms.inside_50s, pms.clearances, pms.rebounds,
             pms.goal_assists, pms.contested, pms.uncontested, pms.contested_marks,
             pms.marks_inside_50, pms.one_percenters, pms.bounces, pms.clangers
        FROM player_match_stats pms
        JOIN players p ON p.id = pms.player_id
       WHERE pms.match_id = ${canonicalMatchId}
    `;

    matchInputs.push({
      providerMatchId,
      canonicalMatchId,
      unresolvedReason: canonicalMatchId === null ? 'match_not_resolved' : null,
      providerRows: rowsForMatch.map((r) => ({
        providerMatchId,
        providerPlayerId: providerId,
        clubId: null, // team-resolution (§6.2) is a display refinement, not required for the engine's own stat comparison
        jumperNumber: numOrNull(r.rawPayload.playerStats?.player?.playerJumperNumber),
        observedGivenName: typeof r.rawPayload.playerStats?.player?.playerName?.givenName === 'string'
          ? (r.rawPayload.playerStats!.player!.playerName!.givenName as string) : null,
        observedSurname: typeof r.rawPayload.playerStats?.player?.playerName?.surname === 'string'
          ? (r.rawPayload.playerStats!.player!.playerName!.surname as string) : null,
        stats: providerStatsFromRawPayload(r.rawPayload),
      })),
      canonicalRows: canonicalRows.map((r) => ({
        playerId: r.playerId, clubId: r.clubId, jumperNumberRaw: r.jumperNumberRaw, surname: r.surname,
        stats: {
          kicks: r.kicks, handballs: r.handballs, marks: r.marks, tackles: r.tackles, goals: r.goals,
          behinds: r.behinds, hitouts: r.hitouts, frees_for: r.frees_for, frees_against: r.frees_against,
          inside_50s: r.inside_50s, clearances: r.clearances, rebounds: r.rebounds,
          goal_assists: r.goal_assists, contested: r.contested, uncontested: r.uncontested,
          contested_marks: r.contested_marks, marks_inside_50: r.marks_inside_50,
          one_percenters: r.one_percenters, bounces: r.bounces, clangers: r.clangers,
        },
      })),
    });
  }

  const evidenceResult = buildAflApiPlayerEvidence(matchInputs);
  const classification = extractProviderClassification(evidenceResult, providerId);

  // Block 4: candidate players -- from the classification's own hits/competitors only,
  // per D12. A free-searched player is not added here; the UI labels that path itself.
  const candidatePlayerIds = [...new Set([
    ...(classification?.matches.map((m) => m.canonicalPlayerId) ?? []),
    ...(classification?.competingCandidates.flatMap((c) => [c.canonicalPlayerId]) ?? []),
    ...(existing?.playerId !== undefined && existing?.playerId !== null ? [existing.playerId] : []),
  ])];
  const [playerSummaries, stableIdentityEntries] = await Promise.all([
    readPlayerSummaries(sql, candidatePlayerIds),
    Promise.all(candidatePlayerIds.map(async (id) => [id, await readPlayerStableIdentity(sql, id)] as const)),
  ]);
  const playerStableIdentity = new Map(stableIdentityEntries);

  // Block 5: open contradiction findings naming this provider.
  const openContradictions = await sql<{ id: number; description: string; details: unknown }[]>`
    SELECT id, description, details
      FROM data_issues
     WHERE issue_type = 'afl_api_identity_contradiction' AND resolved_at IS NULL
       AND details->>'external_id' = ${providerId}
     ORDER BY id
  `;

  const latestAdjudicationId = await readLatestAdjudicationId(sql, providerId);

  return {
    providerId, state, existing,
    observedGivenName, observedSurname,
    teamIds: [...teamIds], seasons: [...seasons].sort((a, b) => a - b), jumperNumbers: [...jumperNumbers],
    matches: [...matchesByKey.values()],
    classification, candidatePlayerIds, playerSummaries, playerStableIdentity,
    openContradictions,
    pendingCandidates: pendingCandidates.map((c) => ({ id: c.id, sourceVersionSeq: c.sourceVersionSeq })),
    latestAdjudicationId,
  };
}

export type AflApiAdjudicationHistoryRow = {
  id: number;
  action: 'linked' | 'revoked';
  playerId: number;
  playerIdentity: string;
  adminUserId: number;
  note: string;
  createdAt: string;
  supersedesId: number | null;
};

export async function readAflApiAdjudicationHistory(
  providerId: string,
): Promise<readonly AflApiAdjudicationHistoryRow[]> {
  const rows = await sql<AflApiAdjudicationHistoryRow[]>`
    SELECT id, action, player_id AS "playerId", player_identity AS "playerIdentity",
           admin_user_id AS "adminUserId", note, created_at::text AS "createdAt",
           supersedes_id AS "supersedesId"
      FROM afl_api_identity_adjudications
     WHERE source_key = ${AFL_API_SOURCE_KEY} AND external_id = ${providerId}
     ORDER BY id
  `;
  return rows;
}

/* ------------------------------------------------------------------ *
 * Writes (§7.2, D6, D7, D10)
 * ------------------------------------------------------------------ */

const REVOKE_LOCK_TIMEOUT = '2s';

function providerLockKey(providerId: string): string {
  return `afl_api_identity:provider:${providerId}`;
}
function playerLockKey(playerId: number): string {
  return `afl_api_identity:player:${playerId}`;
}

async function takeIdentityLocks(tx: Tx, providerId: string, playerId: number): Promise<void> {
  // D7: provider lock first, then player lock -- every writer in this issue locks in this
  // fixed order, so there is no deadlock.
  await tx`SELECT pg_advisory_xact_lock(hashtextextended(${providerLockKey(providerId)}, 0))`;
  await tx`SELECT pg_advisory_xact_lock(hashtextextended(${playerLockKey(playerId)}, 0))`;
}

export type LinkAflApiProviderInput = {
  providerId: string;
  playerId: number;
  adminUserId: number;
  note: string;
  surnameAcknowledged: boolean;
  fingerprint: string;
};

export type LinkAflApiProviderResult =
  | { ok: true }
  | { ok: false; error: string; code?: AflApiRefusalCode };

/**
 * D6/D7/D12's whole link write: lock, re-read, recompute the fingerprint, run the checks,
 * then INSERT the `resolved` row and the `linked` audit row in one transaction (D8's
 * append-only pattern). `23505` (a concurrent bridge INSERT or a racing admin) maps to
 * stale (or T4 when the chosen player gained another provider), never a raw constraint
 * error; see classifyLinkUniqueViolation().
 */
export async function linkAflApiProvider(input: LinkAflApiProviderInput): Promise<LinkAflApiProviderResult> {
  const importUrl = process.env.AFLDB_IMPORT_DATABASE_URL;
  if (!importUrl) return { ok: false, error: 'AFLDB_IMPORT_DATABASE_URL is not configured.' };

  const importSql = postgres(importUrl, { max: 1, onnotice: () => {} });
  try {
    return await importSql.begin(async (tx) => {
      const sourceId = await fetchAflApiSourceId(tx);
      await takeIdentityLocks(tx, input.providerId, input.playerId);

      const [existing, pendingCandidates, chosenPlayerOther, latestAdjudicationId, stableIdentity] =
        await Promise.all([
          readExistingIdentity(tx, sourceId, input.providerId),
          readPendingCandidates(tx, sourceId, input.providerId),
          readPlayerOtherAflApiRow(tx, sourceId, input.playerId, input.providerId),
          readLatestAdjudicationId(tx, input.providerId),
          readPlayerStableIdentity(tx, input.playerId),
        ]);

      // The fingerprint is deliberately PROVIDER-SIDE ONLY on the link path: the detail
      // page renders it BEFORE an admin has picked a candidate, so it cannot include that
      // player's own facts (there is no "the chosen player" yet at render time) -- the
      // page and this recompute must agree byte-for-byte, so both fix chosenPlayerId/
      // chosenPlayerExistingRows to the same sentinel (0/[]). This does not weaken D6-2/
      // D6-3: the chosen player's collision and stable-identity facts are re-read FRESH
      // under lock and checked UNCONDITIONALLY by decideAflApiLink below, regardless of
      // whether the fingerprint matched -- a stale player-side fact is caught as T4/T7,
      // never silently trusted. Revoke's fingerprint (below) has no such gap: the "chosen
      // player" there is the ALREADY-linked player, known before the page renders.
      const recomputedFingerprint = adjudicationFingerprint({
        providerId: input.providerId,
        existing,
        pendingCandidates: pendingCandidates.map((c) => ({ id: c.id, sourceVersionSeq: c.sourceVersionSeq })),
        latestAdjudicationId,
        chosenPlayerId: 0,
        chosenPlayerExistingRows: [],
      });

      const state = classifyAflApiIdentityState({ row: existing, hasPendingCandidate: pendingCandidates.length > 0 });

      // Server-derived surname disagreement (D12): the observed surname from the
      // provider's own spine payload against the chosen player's canonical surname --
      // never trusting a client-computed flag.
      const [observedRow] = await tx<{ payload: { playerStats?: { player?: { playerName?: { surname?: unknown } } } } }[]>`
        SELECT p.raw_payload AS payload
          FROM promotion_candidates c
          JOIN staging.source_record_versions v
            ON v.source_id = c.source_id AND v.family = c.family
           AND v.external_record_id = c.external_record_id AND v.version_seq = c.source_version_seq
          JOIN staging.source_payloads p
            ON p.source_id = v.source_id AND p.family = v.family AND p.payload_hash = v.payload_hash
         WHERE c.source_id = ${sourceId} AND c.verb = 'unresolved_identity' AND c.status = 'pending'
           AND split_part(c.external_record_id, '|', 3) = ${input.providerId}
         ORDER BY c.id LIMIT 1
      `;
      const observedSurname = observedRow?.payload.playerStats?.player?.playerName?.surname;
      const [chosenPlayer] = await tx<{ surname: string | null }[]>`SELECT surname FROM players WHERE id = ${input.playerId}`;
      const surnameDisagrees = typeof observedSurname === 'string'
        && normaliseSurname(observedSurname) !== ''
        && normaliseSurname(chosenPlayer?.surname ?? null) !== ''
        && normaliseSurname(observedSurname) !== normaliseSurname(chosenPlayer?.surname ?? null);

      // Field-shape problems only. The surname acknowledgement is T9, which decideAflApiLink
      // below owns and orders AFTER T6/T8/T2/T3: refusing it here as well pre-empted those
      // coded refusals with a code-less error whenever the provider had pending evidence
      // naming a different surname -- the I7 live failure against an importer-linked row.
      const inputProblems = validateAdjudicationInput({
        providerId: input.providerId, playerId: input.playerId, note: input.note,
        surnameDisagrees, surnameAcknowledged: input.surnameAcknowledged,
      }).filter((problem) => problem !== 'missing_surname_acknowledgement');
      if (inputProblems.length > 0) {
        return { ok: false, error: `Invalid submission: ${inputProblems.join(', ')}.` };
      }

      const decision = decideAflApiLink({
        state,
        existingRow: existing,
        chosenPlayerId: input.playerId,
        chosenPlayerOtherAflApiProviderId: chosenPlayerOther?.externalId ?? null,
        chosenPlayerHasStableIdentity: stableIdentity !== null,
        hasPendingEvidence: pendingCandidates.length > 0,
        fingerprintMatches: recomputedFingerprint === input.fingerprint,
        surnameDisagrees,
        surnameAcknowledged: input.surnameAcknowledged,
      });
      if (!decision.allow) return { ok: false, error: decision.message, code: decision.code };

      const evidence = reduceAdjudicationEvidence({
        providerId: input.providerId,
        classification: null, // full block-3 recomputation is the detail-page read path; the
        // write path stores the input snapshot it actually decided against, not a re-run
        pendingCandidateIds: pendingCandidates.map((c) => c.id),
        latestAdjudicationId,
        chosenPlayerId: input.playerId,
        fingerprint: recomputedFingerprint,
      });

      // A 23505 here aborts the transaction, and postgres.js's begin() rethrows it even when
      // the callback handles it, so it is classified below, after the rollback.
      await tx`
        INSERT INTO external_identities
              (source_id, external_id, external_name, player_id, status,
               candidate_count, match_method, notes)
        VALUES (${sourceId}, ${input.providerId}, ${typeof observedSurname === 'string' ? observedSurname : null},
                ${input.playerId}, 'resolved', 0, ${AFL_API_ADMIN_MATCH_METHOD},
                'AFLDB-ISSUE-235 admin adjudication; see afl_api_identity_adjudications')
      `;

      await tx`
        INSERT INTO afl_api_identity_adjudications
              (source_key, external_id, action, player_id, player_identity, previous_state,
               evidence, evidence_sha256, surname_disagreement_acknowledged, admin_user_id, note)
        VALUES (${AFL_API_SOURCE_KEY}, ${input.providerId}, 'linked', ${input.playerId}, ${stableIdentity},
                ${existing === null ? null : jsonb(tx, existing)}, ${jsonb(tx, evidence)}, ${recomputedFingerprint},
                ${input.surnameAcknowledged}, ${input.adminUserId}, ${input.note})
      `;

      return { ok: true };
    });
  } catch (error) {
    // begin() has already rolled the whole transaction back before this catch runs, so
    // nothing here issues SQL inside it. A 23505 is a race lost to a writer that committed
    // after the locked re-read; the state is re-read fresh to classify it.
    if (isUniqueViolation(error)) return await classifyLinkUniqueViolation(importSql, input);
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `The link could not be applied: ${message}` };
  } finally {
    await importSql.end({ timeout: 5 });
  }
}

export type RevokeAflApiLinkInput = {
  providerId: string;
  adminUserId: number;
  note: string;
  fingerprint: string;
};

export type RevokeAflApiLinkResult =
  | { ok: true }
  | { ok: false; error: string; code?: AflApiRefusalCode };

/**
 * D10's whole revoke write. Locks in D7's fixed order, then `LOCK TABLE
 * external_identities IN ACCESS EXCLUSIVE MODE` under a 2s `lock_timeout`
 * (D10 point 1, R6) so every settle that might have read the link has
 * finished and committed before the non-use proof runs. `55P03` refuses as
 * "retry" with no write. The proof (D10 point 2) reads the live catalogue,
 * validates it against the manifest, runs every LINK_DEPENDENT predicate and
 * the two ledger checks -- ANY problem refuses. Only then: DELETE the row,
 * INSERT the `revoked` audit row.
 */
export async function revokeAflApiLink(input: RevokeAflApiLinkInput): Promise<RevokeAflApiLinkResult> {
  // OD-4: a revoke is a manual adjudication too. The migration CHECK (length(note) BETWEEN
  // 20 AND 2000) is the hard backstop; this just gives a friendlier refusal ahead of it.
  if (input.note.length < 20 || input.note.length > 2000) {
    return { ok: false, error: 'The note must be between 20 and 2000 characters.' };
  }

  const importUrl = process.env.AFLDB_IMPORT_DATABASE_URL;
  if (!importUrl) return { ok: false, error: 'AFLDB_IMPORT_DATABASE_URL is not configured.' };

  const importSql = postgres(importUrl, { max: 1, onnotice: () => {} });
  try {
    return await importSql.begin(async (tx) => {
      const sourceId = await fetchAflApiSourceId(tx);
      const existingBefore = await readExistingIdentity(tx, sourceId, input.providerId);
      if (existingBefore === null) {
        return { ok: false, error: 'No afl_api link exists for this provider.' };
      }
      await takeIdentityLocks(tx, input.providerId, existingBefore.playerId ?? -1);

      // An interpolated `SET LOCAL` is sent as `$1`, which SET rejects. set_config(…, true)
      // is the transaction-local, parameterisable equivalent. A 55P03 from LOCK TABLE
      // aborts the transaction and is classified after the rollback, below.
      await tx`SELECT set_config('lock_timeout', ${REVOKE_LOCK_TIMEOUT}, true)`;
      await tx`LOCK TABLE external_identities IN ACCESS EXCLUSIVE MODE`;

      // `existing` must be read to completion BEFORE `chosenPlayerRows` is queried: its
      // playerId is the filter chosenPlayerRows needs, and using the pre-lock
      // `existingBefore.playerId` instead would feed a stale player's rows into the
      // fingerprint if the row's player_id genuinely changed between the two reads.
      const [existing, pendingCandidates, latestAdjudicationId] = await Promise.all([
        readExistingIdentity(tx, sourceId, input.providerId),
        readPendingCandidates(tx, sourceId, input.providerId),
        readLatestAdjudicationId(tx, input.providerId),
      ]);
      if (existing === null) return { ok: false, error: 'No afl_api link exists for this provider.' };
      const chosenPlayerRows = await tx<{ id: number; status: string; matchMethod: string | null }[]>`
        SELECT id, status::text AS status, match_method AS "matchMethod"
          FROM external_identities
         WHERE source_id = ${sourceId} AND player_id = ${existing.playerId}
      `;

      const recomputedFingerprint = adjudicationFingerprint({
        providerId: input.providerId,
        existing,
        pendingCandidates: pendingCandidates.map((c) => ({ id: c.id, sourceVersionSeq: c.sourceVersionSeq })),
        latestAdjudicationId,
        chosenPlayerId: existing.playerId ?? -1,
        chosenPlayerExistingRows: chosenPlayerRows,
      });
      const state = classifyAflApiIdentityState({ row: existing, hasPendingCandidate: pendingCandidates.length > 0 });

      if (recomputedFingerprint !== input.fingerprint) {
        return { ok: false, error: 'The evidence changed after this page was loaded; reload and review again.', code: 'T6_stale_fingerprint' };
      }
      if (state === 'L-I') {
        return {
          ok: false,
          error: 'This provider was linked by the importer, not by a human decision, and cannot be revoked from this surface.',
          code: 'T20_revoke_importer_link',
        };
      }
      if (state !== 'L-H') {
        return { ok: false, error: 'This provider is in an anomalous state and cannot be actioned from this surface.', code: 'T8_anomalous_row' };
      }

      const nonUse = await proveNonUse(tx, sourceId, existing.playerId!, input.providerId);
      const decision = decideAflApiRevoke({
        state, fingerprintMatches: true, nonUseProven: nonUse.proven,
        nonUseRefusalReason: nonUse.proven ? undefined : nonUse.reason,
      });
      if (!decision.allow) return { ok: false, error: decision.message, code: decision.code };

      await tx`DELETE FROM external_identities WHERE source_id = ${sourceId} AND external_id = ${input.providerId}`;
      await tx`
        INSERT INTO afl_api_identity_adjudications
              (source_key, external_id, action, player_id, player_identity, previous_state,
               evidence, evidence_sha256, surname_disagreement_acknowledged, supersedes_id,
               admin_user_id, note)
        VALUES (${AFL_API_SOURCE_KEY}, ${input.providerId}, 'revoked', ${existing.playerId},
                ${await readPlayerStableIdentity(tx, existing.playerId!)}, ${jsonb(tx, existing)},
                ${jsonb(tx, { nonUseProof: nonUse })}, ${recomputedFingerprint}, false,
                ${latestAdjudicationId}, ${input.adminUserId}, ${input.note})
      `;

      return { ok: true };
    });
  } catch (error) {
    // begin() has already rolled back (no write), so a lock timeout is refused as "retry"
    // here, outside the aborted transaction.
    if (isLockTimeout(error)) {
      return {
        ok: false,
        error: 'An AFL API ingestion run or another identity transaction is in progress; retry.',
        code: 'T19_revoke_unprovable',
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `The revoke could not be applied: ${message}` };
  } finally {
    await importSql.end({ timeout: 5 });
  }
}

type NonUseProofOutcome = { proven: true } | { proven: false; reason: string };

/**
 * D10 point 2: read the live catalogue across every non-system schema, validate it
 * against the pinned manifest (fail closed on any drift), then run every
 * LINK_DEPENDENT table's use predicate and the two ledger checks. Runs under the
 * ACCESS EXCLUSIVE lock the caller already holds.
 */
async function proveNonUse(tx: Tx, sourceId: number, playerId: number, providerId: string): Promise<NonUseProofOutcome> {
  const catalogueRows = await tx<{ schema: string; table: string; column: string }[]>`
    SELECT n.nspname AS schema, c.relname AS table, a.attname AS column
      FROM pg_attribute a
      JOIN pg_constraint con ON con.conrelid = a.attrelid AND a.attnum = ANY(con.conkey)
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE con.contype = 'f' AND con.confrelid = 'public.players'::regclass
       AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
       AND n.nspname NOT LIKE 'pg_temp_%' AND n.nspname NOT LIKE 'pg_toast_temp_%'
       AND array_length(con.conkey, 1) = 1
  `;
  const manifestProblems = validateManifestAgainstCatalogue(catalogueRows, AFL_API_PLAYER_REFERENCE_MANIFEST);

  const useCounts: { schema: string; table: string; count: number }[] = [];
  for (const entry of AFL_API_PLAYER_REFERENCE_MANIFEST) {
    if (entry.class !== 'LINK_DEPENDENT') continue;
    for (const column of entry.playerColumns) {
      const [row] = await tx<{ n: string }[]>`
        SELECT count(*)::text AS n
          FROM ${tx(entry.schema)}.${tx(entry.table)}
         WHERE source_id = ${sourceId} AND ${tx(column)} = ${playerId}
      `;
      useCounts.push({ schema: entry.schema, table: entry.table, count: Number(row.n) });
    }
  }
  for (const check of AFL_API_LEDGER_CHECKS) {
    if (check.table === 'canonical_applications') {
      const [row] = await tx<{ n: string }[]>`
        SELECT count(*)::text AS n FROM canonical_applications
         WHERE source_id = ${sourceId}
           AND (target_key->>'player_id' = ${String(playerId)}
                OR external_record_id LIKE ${`%|${providerId}`})
      `;
      useCounts.push({ schema: check.schema, table: check.table, count: Number(row.n) });
    } else if (check.table === 'promotion_candidates') {
      const [row] = await tx<{ n: string }[]>`
        SELECT count(*)::text AS n FROM promotion_candidates
         WHERE source_id = ${sourceId}
           AND (proposed_fields->>'player_id' = ${String(playerId)}
                OR (verb <> 'unresolved_identity' AND external_record_id LIKE ${`%|${providerId}`}))
      `;
      useCounts.push({ schema: check.schema, table: check.table, count: Number(row.n) });
    }
  }

  return evaluateNonUseProof({ manifestProblems, useCounts, lockTimedOut: false });
}

/** D8: a jsonb OBJECT parameter. Pre-stringified text would be stored as a jsonb string. */
function jsonb(tx: Tx, value: object): postgres.Parameter {
  return tx.json(value as unknown as postgres.JSONValue);
}

/**
 * A link's INSERT lost a unique-index race (`23505`) to a writer that committed after the
 * locked re-read. begin() has already rolled back; these reads run outside it, on the same
 * connection. The chosen player now holding a different provider is T4; anything else
 * (typically the provider's own row, as in I10) is T6 stale.
 */
async function classifyLinkUniqueViolation(
  db: Sql, input: LinkAflApiProviderInput,
): Promise<LinkAflApiProviderResult> {
  const stale = (): LinkAflApiProviderResult => ({
    ok: false, error: aflApiRefusalMessage('T6_stale_fingerprint'), code: 'T6_stale_fingerprint',
  });
  try {
    const sourceId = await fetchAflApiSourceId(db);
    const existing = await readExistingIdentity(db, sourceId, input.providerId);
    if (existing !== null) return stale();
    const other = await readPlayerOtherAflApiRow(db, sourceId, input.playerId, input.providerId);
    if (other !== null) {
      return {
        ok: false,
        error: aflApiRefusalMessage('T4_player_holds_another_provider', other.externalId),
        code: 'T4_player_holds_another_provider',
      };
    }
    return stale();
  } catch {
    // The 23505 alone proves a conflicting committed row; nothing was written either way.
    return stale();
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}

function isLockTimeout(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '55P03';
}
