/**
 * AFLDB-ISSUE-235 S6 — shared `afldb_test` fixtures for the `afl_api` human-adjudication
 * integration cases (runbook §10.2 I2–I10, I6b–I6d, I15, I16, and the OD-5 recovery path).
 *
 * NOT a test file (vitest includes only `*.test.ts`). It exists because two suites —
 * `settle-afl-api.test.ts` (functional, replay, recovery) and
 * `player-link-concurrency.test.ts` (I8–I10 races) — must seed and remove the SAME fixture
 * namespace, and one leftover gate (`issue235FixtureResidue`) must be able to prove both
 * clean. A second copy of the seeding and teardown in each file would drift.
 *
 * OWNERSHIP. Everything this module creates is findable after an interrupted process, by ONE
 * exact definition (`S6_OWNERSHIP`, and `ISSUE235_OWNERSHIP` = S6 + I1 + I14) that teardown,
 * the leftover gate and the ledger-isolation precondition all read:
 *   - provider ids      `CD_I999235nnnn`   exactly (anchored: `S6_PROVIDER_ID_PATTERN`)
 *   - provider matches  `CD_M999235nnnn`   exactly, alone or as a record id's first segment
 *   - players           legacy_player_id -235209999 … -235200001
 *   - AFL Tables ids    `players/Z/Issue235-S6-<n>.html` exactly
 *   - the one actor     `issue235-s6-fixture@example.test` (created, never reused)
 *   - import batches    tool = `issue235-s6-fixture`
 *   - payloads          hash_recipe = `issue235-s6-fixture:sha256`
 * plus I1's and I14's literal ids (`I1_FIXTURE`, `I14_FIXTURE`), and I18's (`I18_FIXTURE`, owned by
 * `tools/migration/afl_api_adjudication_i18_fixture.ts`, which has its own seed/teardown: the gate
 * counts it, S6 teardown never touches it, and the S6 isolation check refuses while it is seeded).
 *
 * NEVER a bare prefix such as `CD_I999%`: real Champion Data provider ids are `CD_I` + 6–7
 * digits, and 2026 afldb_test holds real `CD_I999xxx` players (`CD_I999321`, `CD_I999724`, …).
 * A prefix selector once counted their importer links, staging rows and pending candidates as
 * fixture residue (S6 live run, 2026-09-24). Fixture provider ids are `CD_I` + 10 digits and are
 * matched whole.
 *
 * Teardown deletes ONLY those rows, and runs as the owner role: the ledger is append-only for
 * `afldb_import`/`afldb_auth` (migration 104), so fixture adjudications can only be removed
 * by the owner (runbook D15, "Consequence for tests").
 *
 * Direct INSERTs here are FIXTURE SETUP only — the pending evidence a settle would have
 * written, a stable identity, a pre-existing importer row. Every adjudication under test goes
 * through the real `linkAflApiProvider()` / `revokeAflApiLink()` / replay code.
 */
import { createHash } from 'node:crypto';

import type postgres from 'postgres';

import { readAflApiProviderEvidence, type AflApiProviderEvidence } from '@/db/queries/afl-api-player-links';
import { adjudicationFingerprint } from '@/lib/acquisition/afl-api-adjudication';

import {
  isS6MatchRecordId,
  s6MatchId,
  S6_ACTOR_EMAIL,
  S6_AFLTABLES_PREFIX,
  S6_FIXTURE_TOOL,
  S6_HASH_RECIPE,
  S6_LEGACY_ID_RANGE,
  S6_MATCH_PREFIX,
  S6_SEASON,
  type S6Refs,
} from './afl-api-fixture-ownership';
import { createImportRoleParityHarness } from './import-role-parity';

// The namespace, ownership registry, teardown and leftover gate live in the server-neutral
// `./afl-api-fixture-ownership` (the I18 CLI teardown loads it without `react-server`). This
// module adds the seeding and rendering that need the real `server-only` query module.
export * from './afl-api-fixture-ownership';

type Db = postgres.Sql | postgres.TransactionSql;

/* ------------------------------------------------------------------ *
 * Import-role routing (the repository's integration convention)
 * ------------------------------------------------------------------ */

function databaseNameOf(dsn: string): string {
  return decodeURIComponent(new URL(dsn).pathname.replace(/^\//, ''));
}

/**
 * `linkAflApiProvider()`/`revokeAflApiLink()` open their own connection on
 * `AFLDB_IMPORT_DATABASE_URL`. Route it exactly as the other admin-mutation suites do:
 * `AFLDB_TEST_IMPORT_DATABASE_URL` (the real `afldb_import` role, proved by the shared
 * role-parity harness first) when configured, otherwise the owner test DSN. Either way the
 * routed database must be the owner's own `_test` database, or this refuses before any write.
 * Returns the restore function; no DSN is ever printed.
 */
export async function routeS6ImportDsn(): Promise<{ restore: () => void; restrictedRole: boolean }> {
  const owner = process.env.AFLDB_TEST_DATABASE_URL;
  if (!owner) throw new Error('AFLDB_TEST_DATABASE_URL must be set for the ISSUE-235 S6 suites.');
  const restricted = process.env.AFLDB_TEST_IMPORT_DATABASE_URL;
  if (restricted) await createImportRoleParityHarness(owner, restricted).validate();
  const routed = restricted ?? owner;
  const routedDatabase = databaseNameOf(routed);
  if (!/_test$/.test(routedDatabase) || routedDatabase !== databaseNameOf(owner)) {
    throw new Error(
      `ISSUE-235 S6: the import DSN names '${routedDatabase}', not the owner's _test database. Refusing to run.`);
  }
  const previous = process.env.AFLDB_IMPORT_DATABASE_URL;
  process.env.AFLDB_IMPORT_DATABASE_URL = routed;
  return {
    restrictedRole: Boolean(restricted),
    restore: () => {
      if (previous === undefined) delete process.env.AFLDB_IMPORT_DATABASE_URL;
      else process.env.AFLDB_IMPORT_DATABASE_URL = previous;
    },
  };
}

/* ------------------------------------------------------------------ *
 * Seeding
 * ------------------------------------------------------------------ */

/** The one S6 actor: super_admin, disabled, no credentials. Always suite-created. */
export async function seedS6Actor(db: Db): Promise<number> {
  const [row] = await db<{ id: number }[]>`
    INSERT INTO auth_users (email, role, password_hash, totp_secret, disabled_at)
    VALUES (${S6_ACTOR_EMAIL}, 'super_admin', NULL, NULL, now())
    ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
    RETURNING id
  `;
  return row.id;
}

export type S6Player = { id: number; identity: string | null };

/**
 * One fixture player, keyed 1…9999. `stable` gives it a trusted AFL Tables profile identity
 * (D6-3); without it the player has no stable identity (T7).
 */
export async function seedS6Player(
  db: Db, refs: S6Refs,
  input: { key: number; givenName?: string; surname?: string; stable?: boolean },
): Promise<S6Player> {
  if (!Number.isInteger(input.key) || input.key < 1 || input.key > 9999) throw new Error('S6 player key must be 1…9999.');
  const legacyId = S6_LEGACY_ID_RANGE.max - (input.key - 1);
  const givenName = input.givenName ?? 'Test';
  const surname = input.surname ?? 'Forward';
  const [player] = await db<{ id: number }[]>`
    INSERT INTO players (legacy_player_id, display_name, sort_name, search_name, slug, given_name, surname)
    VALUES (${legacyId}, ${`${givenName} ${surname} (ISSUE-235 S6 fixture ${input.key})`},
            ${`${surname}, ${givenName} (ISSUE-235 S6 fixture ${input.key})`},
            ${`${givenName} ${surname} issue235 s6 fixture ${input.key}`.toLowerCase()},
            ${`issue-235-s6-fixture-player-${input.key}`}, ${givenName}, ${surname})
    ON CONFLICT (legacy_player_id) DO UPDATE SET display_name = EXCLUDED.display_name
    RETURNING id
  `;
  if (input.stable === false) return { id: player.id, identity: null };
  const identity = `${S6_AFLTABLES_PREFIX}${input.key}.html`;
  await db`
    INSERT INTO external_identities (source_id, external_id, player_id, status, candidate_count, match_method)
    VALUES (${refs.afltablesSourceId}, ${identity}, ${player.id}, 'unique', 1, 'afltables_profile_url')
    ON CONFLICT (source_id, external_id) DO NOTHING
  `;
  return { id: player.id, identity };
}

/** A completed fixture import batch; every seeded spine row cites one. */
async function seedS6Batch(db: Db, refs: S6Refs): Promise<number> {
  const [batch] = await db<{ id: number }[]>`
    INSERT INTO import_batches (source_id, tool, status, completed_at, notes)
    VALUES (${refs.aflApiSourceId}, ${S6_FIXTURE_TOOL}, 'completed', now(), ${S6_FIXTURE_TOOL})
    RETURNING id
  `;
  return batch.id;
}

/**
 * One spine observation (migration 074): payload + version 1 of a fresh `CD_M999235…`
 * external record, exactly the rows `promotion_candidates` and `canonical_applications`
 * reference. Refuses to reuse an external record id.
 */
export async function seedS6SpineVersion(
  db: Db, refs: S6Refs,
  input: { family: string; externalRecordId: string; payload: Record<string, unknown> },
): Promise<{ batchId: number; versionSeq: 1 }> {
  if (!isS6MatchRecordId(input.externalRecordId)) {
    throw new Error(`S6 spine rows must live under ${S6_MATCH_PREFIX}…; got ${input.externalRecordId}.`);
  }
  const batchId = await seedS6Batch(db, refs);
  const payloadHash = createHash('sha256')
    .update(`${input.family}|${input.externalRecordId}|${JSON.stringify(input.payload)}`)
    .digest('hex');
  await db`
    INSERT INTO staging.source_payloads (source_id, family, payload_hash, hash_recipe, raw_payload)
    VALUES (${refs.aflApiSourceId}, ${input.family}, ${payloadHash}, ${S6_HASH_RECIPE},
            ${db.json(input.payload as never)})
  `;
  await db`
    INSERT INTO staging.source_record_versions
          (source_id, family, external_record_id, version_seq, payload_hash, observed_from, opened_by_batch_id)
    VALUES (${refs.aflApiSourceId}, ${input.family}, ${input.externalRecordId}, 1, ${payloadHash}, now(), ${batchId})
  `;
  return { batchId, versionSeq: 1 };
}

export type S6PendingEvidence = { candidateId: number; versionSeq: number; externalRecordId: string };

/**
 * U1 evidence for one provider: the pending `unresolved_identity` candidate a settle writes
 * for an unbridged player (`settle-afl-api.ts` `writePromotionCandidate`, verb
 * `unresolved_identity`, family/target `player_match_stats`, `proposed_fields = {}`), on its
 * own spine version. The payload carries the observed surname in the shape
 * `readAflApiProviderEvidence()` and the link's server-side surname check read.
 */
export async function seedS6PendingEvidence(
  db: Db, refs: S6Refs, input: { providerId: string; match: number; surname?: string },
): Promise<S6PendingEvidence> {
  const externalRecordId = `${s6MatchId(input.match)}|CD_T20|${input.providerId}`;
  const { batchId, versionSeq } = await seedS6SpineVersion(db, refs, {
    family: 'player_match_stats',
    externalRecordId,
    payload: {
      teamId: 'CD_T20',
      playerStats: {
        player: {
          playerId: input.providerId, playerJumperNumber: 25,
          playerName: { givenName: 'Test', surname: input.surname ?? 'Forward' },
        },
        stats: { kicks: 7, handballs: 5, marks: 3 },
      },
    },
  });
  const [candidate] = await db<{ id: number }[]>`
    INSERT INTO promotion_candidates
          (source_id, family, external_record_id, source_version_seq, verb, season,
           target_table, target_id, proposed_fields, status, created_by_batch_id)
    VALUES (${refs.aflApiSourceId}, 'player_match_stats', ${externalRecordId}, ${versionSeq},
            'unresolved_identity', ${S6_SEASON}, 'player_match_stats', NULL, '{}'::jsonb, 'pending', ${batchId})
    RETURNING id
  `;
  return { candidateId: candidate.id, versionSeq, externalRecordId };
}

/** A pre-existing importer (`unique`) `afl_api` row — the loader's shape (L-I). */
export async function seedS6ImporterLink(db: Db, refs: S6Refs, providerId: string, playerId: number): Promise<void> {
  await db`
    INSERT INTO external_identities (source_id, external_id, player_id, status, candidate_count, match_method)
    VALUES (${refs.aflApiSourceId}, ${providerId}, ${playerId}, 'unique', 1, 'afl_api_stat_vector_season')
  `;
}

/**
 * A Brownlow round-vote row as the AFL API Brownlow settle leaves it (source `afl_api`,
 * F002-demoted `votes = 0`, no resolved match): a D10 LINK_DEPENDENT use of `playerId`.
 */
export async function insertS6BrownlowVote(
  db: Db, refs: S6Refs, input: { playerId: number; roundNumber: number; sourceRecordId: string },
): Promise<void> {
  await db`
    INSERT INTO brownlow_round_votes (season, player_id, round_number, played, votes, source_id, source_record_id)
    VALUES (${S6_SEASON}, ${input.playerId}, ${input.roundNumber}, true, 0, ${refs.aflApiSourceId}, ${input.sourceRecordId})
  `;
}

/* ------------------------------------------------------------------ *
 * The admin page's own fingerprints
 * ------------------------------------------------------------------ */

export type S6RenderedForm = {
  evidence: AflApiProviderEvidence | null;
  linkFingerprint: string | null;
  revokeFingerprint: string | null;
};

/**
 * What `/admin/player-links/afl-api/[providerId]` renders: the real evidence read, then the
 * two fingerprints computed EXACTLY as `page.tsx:52-69` computes them. A test submits these,
 * so a stale-fingerprint refusal is only ever caused by a real change in the database.
 */
export async function renderS6Form(providerId: string): Promise<S6RenderedForm> {
  const evidence = await readAflApiProviderEvidence(providerId);
  if (evidence === null) return { evidence, linkFingerprint: null, revokeFingerprint: null };
  const linkFingerprint = adjudicationFingerprint({
    providerId,
    existing: evidence.existing,
    pendingCandidates: evidence.pendingCandidates,
    latestAdjudicationId: evidence.latestAdjudicationId,
    chosenPlayerId: 0,
    chosenPlayerExistingRows: [],
  });
  const revokeFingerprint = evidence.existing === null ? null : adjudicationFingerprint({
    providerId,
    existing: evidence.existing,
    pendingCandidates: evidence.pendingCandidates,
    latestAdjudicationId: evidence.latestAdjudicationId,
    chosenPlayerId: evidence.existing.playerId ?? 0,
    chosenPlayerExistingRows: [{
      id: evidence.existing.id, status: evidence.existing.status, matchMethod: evidence.existing.matchMethod,
    }],
  });
  return { evidence, linkFingerprint, revokeFingerprint };
}

/* ------------------------------------------------------------------ *
 * Snapshots and reads
 * ------------------------------------------------------------------ */

/**
 * Everything a refused adjudication must leave untouched, captured whole (`to_jsonb`): the
 * `afl_api` rows of the providers AND of the players involved, the ledger rows of the
 * providers, and the providers' candidates. Two equal snapshots prove no write at all.
 */
export async function s6StateSnapshot(
  db: Db, refs: S6Refs, input: { providerIds: readonly string[]; playerIds?: readonly number[] },
): Promise<{ identities: unknown[]; ledger: unknown[]; candidates: unknown[] }> {
  const playerIds = input.playerIds ?? [];
  const identities = await db<{ row: unknown }[]>`
    SELECT to_jsonb(ei) AS row FROM external_identities ei
     WHERE ei.source_id = ${refs.aflApiSourceId}
       AND (ei.external_id = ANY(${input.providerIds as string[]}::text[])
            OR ei.player_id = ANY(${playerIds as number[]}::int[]))
     ORDER BY ei.id
  `;
  const ledger = await db<{ row: unknown }[]>`
    SELECT to_jsonb(a) AS row FROM afl_api_identity_adjudications a
     WHERE a.external_id = ANY(${input.providerIds as string[]}::text[])
     ORDER BY a.id
  `;
  const candidates = await db<{ row: unknown }[]>`
    SELECT to_jsonb(c) AS row FROM promotion_candidates c
     WHERE c.source_id = ${refs.aflApiSourceId}
       AND split_part(c.external_record_id, '|', 3) = ANY(${input.providerIds as string[]}::text[])
     ORDER BY c.id
  `;
  return {
    identities: identities.map((r) => r.row),
    ledger: ledger.map((r) => r.row),
    candidates: candidates.map((r) => r.row),
  };
}

export type S6LedgerRow = {
  id: number; externalId: string; action: 'linked' | 'revoked'; playerId: number; playerIdentity: string;
  previousState: unknown; previousStateType: string | null; evidence: unknown; evidenceType: string;
  evidenceSha256: string; surnameAck: boolean; supersedesId: number | null; adminUserId: number; note: string;
};

export async function s6LedgerRows(db: Db, providerIds: readonly string[]): Promise<S6LedgerRow[]> {
  const rows = await db<(Omit<S6LedgerRow, 'id' | 'supersedesId'> & { id: string; supersedesId: string | null })[]>`
    SELECT id::text AS id, external_id AS "externalId", action, player_id AS "playerId",
           player_identity AS "playerIdentity",
           previous_state AS "previousState", jsonb_typeof(previous_state) AS "previousStateType",
           evidence, jsonb_typeof(evidence) AS "evidenceType", evidence_sha256 AS "evidenceSha256",
           surname_disagreement_acknowledged AS "surnameAck", supersedes_id::text AS "supersedesId",
           admin_user_id AS "adminUserId", note
      FROM afl_api_identity_adjudications
     WHERE external_id = ANY(${providerIds as string[]}::text[])
     ORDER BY id
  `;
  return rows.map((r) => ({
    ...r, id: Number(r.id), supersedesId: r.supersedesId === null ? null : Number(r.supersedesId),
  }));
}

/**
 * The decoded content of a jsonb ledger column, independent of its storage shape. The
 * SHAPE itself (object vs double-encoded string) is asserted separately and strictly
 * (`evidenceType`/`previousStateType`); this only lets the content assertions report on
 * the content.
 */
export function decodeS6Jsonb(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value;
}
