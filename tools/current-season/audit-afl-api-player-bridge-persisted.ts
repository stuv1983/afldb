#!/usr/bin/env node
/**
 * AFLDB-ISSUE-228 D-8 step 4 / D-9b — read-only DEV audit of the PERSISTED
 * `external_identities` state for the `afl_api` source (operator request,
 * 2026-09-23).
 *
 * Diagnostic only: SELECT-only against `external_identities`, `data_issues`
 * and `import_batches`. Never writes anything, never touches the importer
 * (`tools/migration/import_afl_api_player_bridge.py` — the ONLY tool that
 * writes `external_identities`) and never re-runs it.
 *
 * Why this is needed. `tools/current-season/emit-afl-api-player-bridge.ts`
 * proves that 669 `afl_api` providers CAN currently be resolved from live
 * `afldb_dev` canonical state (D-8 step 3). It does not read
 * `external_identities` at all, so it cannot prove that the table itself
 * holds one coherent 669-provider population, rather than the pre-existing
 * 577-provider lineage from the superseded `-011148` snapshot (D-9b,
 * `issues/open/AFLDB-ISSUE-228.md` §20.5.1) left partly in place with stale
 * `player_id` values the importer's own append-only, never-UPDATE contract
 * (see that tool's docstring) would silently leave behind.
 *
 * Because `external_identities_uq` (migration 002) constrains
 * `(source_id, external_id)` to at most one row, "old lineage mixed into
 * active state" cannot mean two rows for the same provider — it can only
 * mean a persisted row whose `player_id` disagrees with what the CURRENT
 * (`-031725`) bridge artefact says that provider should resolve to. That is
 * exactly what this tool detects, by comparing the artefact's declared
 * `providers[*].disposition === 'linked'` population against the live
 * `external_identities` rows for the `afl_api` source, one provider id at a
 * time.
 *
 * SAFETY.
 *   - It never writes to any database.
 *   - The connection is opened and proven exactly as
 *     `emit-afl-api-player-bridge.ts` does: `AFLDB_DEV_DATABASE_URL` only
 *     (the restricted `afldb_app` role), `default_transaction_read_only`
 *     as a STARTUP parameter, and the live session's own
 *     `current_database()` / `transaction_read_only` /
 *     `default_transaction_read_only` proven before any evidence query
 *     runs — reusing `assertAflApiEvidenceDsn`/`assertAflApiEvidenceSession`
 *     verbatim rather than reimplementing the proof.
 *   - `--artefact` is mandatory; there is no newest-file fallback (the same
 *     S9 discipline `import_afl_api_player_bridge.py` enforces).
 *
 * Usage:
 *   npx tsx tools/current-season/audit-afl-api-player-bridge-persisted.ts \
 *     --artefact data/reference/afl-api-player-bridge-2026-full-2026-09-22.json
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

import { resolveAflApiSourceId } from '../../src/lib/acquisition/afl-api-match-identity';
import {
  AFL_API_EVIDENCE_DSN_ENV,
  assertAflApiEvidenceDsn,
  assertAflApiEvidenceSession,
} from '../../src/lib/acquisition/afl-api-player-evidence';

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

function parseArgs(argv: readonly string[]): { artefact: string } {
  const i = argv.indexOf('--artefact');
  if (i < 0 || !argv[i + 1]) {
    throw new Error('--artefact <path> is mandatory — there is no newest-file fallback.');
  }
  return { artefact: argv[i + 1] };
}

type BridgeArtefact = {
  source_key?: unknown;
  match_method?: unknown;
  season?: unknown;
  snapshot_label?: unknown;
  built_from_database?: unknown;
  providers?: Record<string, { disposition?: unknown; candidate_player_id?: unknown }>;
};

function createReadOnlyDevClient(): postgres.Sql {
  const dsn = assertAflApiEvidenceDsn(process.env[AFL_API_EVIDENCE_DSN_ENV]);
  return postgres(dsn, {
    max: 1,
    idle_timeout: 0,
    connect_timeout: 15,
    onnotice: () => {},
    transform: { undefined: null },
    connection: {
      application_name: 'afldb-audit-afl-api-player-bridge-persisted',
      default_transaction_read_only: true,
      TimeZone: 'UTC',
    },
  });
}

async function proveReadOnlyDevSession(sql: postgres.Sql): Promise<{ database: string; role: string }> {
  const [row] = await sql<{
    currentDatabase: string; currentRole: string;
    transactionReadOnly: string; defaultTransactionReadOnly: string;
  }[]>`
    SELECT current_database() AS "currentDatabase",
           current_user AS "currentRole",
           current_setting('transaction_read_only') AS "transactionReadOnly",
           current_setting('default_transaction_read_only') AS "defaultTransactionReadOnly"
  `;
  assertAflApiEvidenceSession({
    currentDatabase: row?.currentDatabase,
    transactionReadOnly: row?.transactionReadOnly,
    defaultTransactionReadOnly: row?.defaultTransactionReadOnly,
  });
  return { database: row.currentDatabase, role: row.currentRole };
}

// The two D-8 §21 split-name corrections this audit must name explicitly.
const NAMED_CASES = [
  { label: 'Alex Van Wyk', providerId: 'CD_I1019944', expectedPlayerId: 13382 },
  { label: 'Hussien El Achkar', providerId: 'CD_I1030308', expectedPlayerId: 13422 },
] as const;

type PersistedRow = {
  id: number;
  externalId: string;
  playerId: number | null;
  status: string;
  candidateCount: number;
  matchMethod: string | null;
  notes: string | null;
};

async function main(): Promise<void> {
  loadEnv();
  const { artefact: artefactPath } = parseArgs(process.argv.slice(2));

  const artefact = readJson(artefactPath) as BridgeArtefact;
  if (artefact.source_key !== 'afl_api') {
    throw new Error(`${artefactPath}: source_key is ${JSON.stringify(artefact.source_key)}, expected "afl_api"`);
  }
  const providers = artefact.providers ?? {};
  const linked = new Map<string, number>();
  for (const [externalId, row] of Object.entries(providers)) {
    if (row.disposition === 'linked') {
      linked.set(externalId, row.candidate_player_id as number);
    }
  }

  console.log(`Artefact: ${artefactPath}`);
  console.log(`  source_key=${String(artefact.source_key)} match_method=${String(artefact.match_method)} `
    + `season=${String(artefact.season)} snapshot_label=${String(artefact.snapshot_label)} `
    + `built_from_database=${String(artefact.built_from_database)}`);
  console.log(`  declares ${linked.size} provider(s) with disposition="linked"`);
  console.log('');

  const sql = createReadOnlyDevClient();
  try {
    const { database, role } = await proveReadOnlyDevSession(sql);
    console.log(`Read-only session proven: current_database()='${database}', role='${role}'.`);
    console.log('');

    const sourceId = await resolveAflApiSourceId(sql);

    const persisted = await sql<PersistedRow[]>`
      SELECT id, external_id AS "externalId", player_id AS "playerId", status,
             candidate_count AS "candidateCount", match_method AS "matchMethod", notes
        FROM external_identities
       WHERE source_id = ${sourceId}
       ORDER BY external_id
    `;
    const persistedById = new Map(persisted.map((row) => [row.externalId, row]));

    const distinctProviderIds = new Set(persisted.map((r) => r.externalId)).size;
    const linkedToCanonicalPlayer = persisted.filter(
      (r) => r.playerId !== null && (r.status === 'unique' || r.status === 'resolved'),
    ).length;
    const noCanonicalPlayer = persisted.filter((r) => r.playerId === null).length;

    // Schema-enforced by external_identities_uq (migration 002); computed
    // defensively rather than assumed.
    const byExternalId = new Map<string, number>();
    for (const row of persisted) byExternalId.set(row.externalId, (byExternalId.get(row.externalId) ?? 0) + 1);
    const providerIdsWithMultipleRows = [...byExternalId.values()].filter((n) => n > 1).length;

    const unexpectedStale = persisted.filter((r) => !linked.has(r.externalId));
    const missingFromDb = [...linked.keys()].filter((id) => !persistedById.has(id));
    const staleMismatch = [...linked.entries()].filter(([id, candidatePlayerId]) => {
      const row = persistedById.get(id);
      return row && row.playerId !== null && row.playerId !== candidatePlayerId;
    });

    const openContradictions = await sql<{ id: number; entityId: number | null; details: unknown }[]>`
      SELECT id, entity_id AS "entityId", details
        FROM data_issues
       WHERE issue_type = 'afl_api_identity_contradiction'
         AND resolved_at IS NULL
       ORDER BY id
    `;

    const importBatches = await sql<{
      id: number; startedAt: string; completedAt: string | null; status: string;
      recordsRead: number; recordsInserted: number; recordsUpdated: number; recordsRejected: number;
      notes: string | null;
    }[]>`
      SELECT id, started_at AS "startedAt", completed_at AS "completedAt", status,
             records_read AS "recordsRead", records_inserted AS "recordsInserted",
             records_updated AS "recordsUpdated", records_rejected AS "recordsRejected", notes
        FROM import_batches
       WHERE source_id = ${sourceId} AND target_table = 'external_identities'
       ORDER BY started_at
    `;

    console.log('=== Persisted external_identities state (source_id = afl_api) ===');
    console.log(`Expected AFL API provider population:       ${linked.size}`);
    console.log(`Persisted AFL API provider identities:      ${persisted.length}`);
    console.log(`Distinct AFL API provider IDs:               ${distinctProviderIds}`);
    console.log(`Providers linked to a canonical player:      ${linkedToCanonicalPlayer}`);
    console.log(`Providers with no canonical player:          ${noCanonicalPlayer}`);
    console.log(`Provider IDs linked to >1 player:            ${providerIdsWithMultipleRows}`);
    console.log(`Unexpected/stale AFL API provider IDs:       ${unexpectedStale.length}`);
    console.log(`Old 577-lineage mixed into active state:     ${staleMismatch.length}`);
    console.log(`Artefact-linked providers missing from DB:   ${missingFromDb.length}`);
    console.log('');

    if (unexpectedStale.length > 0) {
      console.log('--- Persisted rows NOT in the artefact\'s linked set ---');
      for (const row of unexpectedStale) {
        console.log(`  ${row.externalId}: player_id=${row.playerId} status=${row.status} match_method=${row.matchMethod}`);
      }
      console.log('');
    }
    if (staleMismatch.length > 0) {
      console.log('--- STALE: persisted player_id disagrees with the -031725 artefact ---');
      for (const [id, candidatePlayerId] of staleMismatch) {
        const row = persistedById.get(id)!;
        console.log(`  ${id}: persisted player_id=${row.playerId}, artefact candidate_player_id=${candidatePlayerId}`);
      }
      console.log('');
    }
    if (missingFromDb.length > 0) {
      console.log('--- Artefact says "linked" but no external_identities row exists ---');
      for (const id of missingFromDb) console.log(`  ${id}: candidate_player_id=${linked.get(id)}`);
      console.log('');
    }

    console.log(`=== Open data_issues (afl_api_identity_contradiction): ${openContradictions.length} ===`);
    for (const issue of openContradictions) {
      console.log(`  id=${issue.id} entity_id=${issue.entityId} details=${JSON.stringify(issue.details)}`);
    }
    console.log('');

    console.log(`=== import_batches rows targeting external_identities for afl_api: ${importBatches.length} ===`);
    for (const b of importBatches) {
      console.log(
        `  id=${b.id} started_at=${b.startedAt} completed_at=${b.completedAt ?? 'NULL'} status=${b.status} `
        + `read=${b.recordsRead} inserted=${b.recordsInserted} updated=${b.recordsUpdated} rejected=${b.recordsRejected} `
        + `notes=${b.notes ?? ''}`,
      );
    }
    console.log('');

    console.log('=== Named split-name cases (D-8 §21) ===');
    for (const { label, providerId, expectedPlayerId } of NAMED_CASES) {
      const row = persistedById.get(providerId);
      if (!row) {
        console.log(`  ${label} (${providerId}): NO external_identities ROW — NOT PERSISTED`);
        continue;
      }
      const pass = row.playerId === expectedPlayerId && (row.status === 'unique' || row.status === 'resolved');
      console.log(
        `  ${label} (${providerId}): player_id=${row.playerId} status=${row.status} `
        + `match_method=${row.matchMethod} expected=${expectedPlayerId} -> ${pass ? 'PASS' : 'FAIL'}`,
      );
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
