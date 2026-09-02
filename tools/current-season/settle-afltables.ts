/**
 * AFLDB-ISSUE-099 — the in-season AFL Tables settle CLI.
 *
 * Stage S-C then S-D of §21. Everything before the database is offline and
 * fail-closed: the bundle is read, the manifest it names is re-hashed from
 * disk, and the whole contract is validated. Only if all of that passes is a
 * connection opened at all, so an unverified snapshot cannot reach PostgreSQL.
 *
 * REVIEW-FIRST IS THE DEFAULT. `--dry-run` needs no other flag; `--apply`
 * must be explicit. Nothing here is scheduled — no cron entry, no timer.
 * Scheduling is a separate authorisation.
 *
 * v1 WRITES NO CANONICAL ROW. This tool produces observations, typed staging
 * projections and promotion candidates for a human to review. It accepts
 * nothing, and `canonicalRowsInserted` / `canonicalRowsUpdated` are reported
 * because they are always 0.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

import { loadManualAuthority } from '../../src/lib/acquisition/manual-authority';
import { UNAVAILABLE_MANUAL_AUTHORITY } from '../../src/lib/acquisition/observations';
import {
  resolveManifestPath,
  runSettleAfltables,
  validateSettleBundle,
  SETTLE_ISSUE_OWNER,
  SETTLE_ISSUE_TYPE,
  type SettleBundle,
  type SettleCounters,
} from '../../src/lib/acquisition/settle-afltables';
import { parseSourceFamilyRegistry } from '../../src/lib/acquisition/source-families';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');

const BUNDLE_ROOT = join(PROJECT_ROOT, 'data', 'sources', 'afltables', 'fitzroy_core');

type Args = { label: string; apply: boolean; report: boolean };

function loadEnv(): void {
  let contents: string;
  try {
    contents = readFileSync(join(PROJECT_ROOT, '.env'), 'utf8');
  } catch {
    return;
  }
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...rest] = trimmed.split('=');
    const name = key.trim();
    if (!process.env[name]) process.env[name] = rest.join('=').trim();
  }
}

function valueFor(argv: string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

function parseArgs(argv: string[]): Args {
  const label = valueFor(argv, '--label');
  if (!label) throw new Error('--label <snapshot> is required.');
  if (argv.includes('--apply') && argv.includes('--dry-run')) {
    throw new Error('--apply and --dry-run are mutually exclusive; choose one.');
  }
  return { label, apply: argv.includes('--apply'), report: argv.includes('--report') };
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * The bundle, validated against the manifest actually on disk.
 *
 * The digest is recomputed here rather than trusted from the bundle, which is
 * the whole point of the check: a snapshot that changed after emission is no
 * longer evidence of what the bundle describes.
 */
function loadBundle(label: string): SettleBundle {
  const raw = readJson(join(BUNDLE_ROOT, label, 'observations.json')) as {
    manifest_path?: unknown;
  };
  if (typeof raw.manifest_path !== 'string') {
    throw new Error('The bundle names no manifest_path, so it cannot be verified.');
  }
  // The emitter writes an ABSOLUTE path; joining it onto the root again is the
  // T8 double-prefix defect. The rule lives in the contract module.
  const manifestPath = resolveManifestPath(PROJECT_ROOT, raw.manifest_path);
  const actualManifestSha256 = createHash('sha256')
    .update(readFileSync(manifestPath))
    .digest('hex');

  const seasons = readJson(join(PROJECT_ROOT, 'data', 'reference', 'seasons.json')) as {
    in_progress_seasons?: unknown;
  };
  const inProgressSeasons = Array.isArray(seasons.in_progress_seasons)
    ? seasons.in_progress_seasons.filter((year): year is number => typeof year === 'number')
    : [];

  const registry = parseSourceFamilyRegistry(
    readJson(join(PROJECT_ROOT, 'data', 'reference', 'source-families.json')),
  );

  return validateSettleBundle({
    raw,
    expectedSnapshotLabel: label,
    actualManifestSha256,
    inProgressSeasons,
    registry,
  });
}

function createImportClient(): postgres.Sql {
  const dsn = process.env.AFLDB_IMPORT_DATABASE_URL;
  if (!dsn) throw new Error('AFLDB_IMPORT_DATABASE_URL is not set.');
  return postgres(dsn, { max: 1, onnotice: () => {}, transform: { undefined: null } });
}

function printCounters(counters: SettleCounters): void {
  const group = (title: string, keys: readonly (keyof SettleCounters)[]) => {
    console.log(`\n${title}`);
    for (const key of keys) console.log(`  ${key}: ${counters[key]}`);
  };
  group('Snapshot', [
    'snapshotMatches', 'snapshotPlayerMatchRows', 'snapshotRejections',
    'snapshotUnkeyedRejections',
  ]);
  group('Observation', [
    'observationsSeen', 'payloadsCreated', 'payloadsReused', 'versionsAppended',
    'observationsUnchanged', 'observationsCorrected', 'observationsHistoryOnly',
    'observationsMarkedAbsent', 'observationsReappeared', 'absenceSweepSkipped',
  ]);
  group('Projection / resolution', [
    'projectionRowsWritten', 'venueUnmapped', 'nullInCoveredStat',
    'unresolvedIdentityPlayer', 'unresolvedIdentityClub', 'unresolvedIdentityVenue',
    'unresolvedIdentityMatch', 'foreignOwnedCollision', 'sourceDisagreement',
    'manualAuthorityRefusals',
  ]);
  group('Review', ['candidatesCreated', 'candidatesRefreshed', 'candidatesMootLeftPending']);
  group('Data issues', ['dataIssuesOpened', 'dataIssuesRefreshed', 'dataIssuesResolved']);
  // Never summed with the observation counters, and never anything but 0.
  group('Canonical', ['canonicalRowsInserted', 'canonicalRowsUpdated']);
}

/** How many open disagreements the report lists before summarising the rest. */
const OPEN_ISSUE_LIMIT = 20;

/**
 * The review queue (§23.1 step 6), in two halves: the pending promotion
 * candidates and the open disagreements behind the ones that are blocked.
 *
 * Strictly read-only. It offers the operator no path to accept, resolve or
 * retire anything — every mutation in this issue happens inside the settle
 * transaction, on evidence, and a report is not evidence.
 */
async function report(sql: postgres.Sql, season: number): Promise<void> {
  const rows = await sql<{ targetTable: string; verb: string; pending: number }[]>`
    SELECT c.target_table AS "targetTable", c.verb, count(*)::int AS pending
      FROM promotion_candidates c
      JOIN sources s ON s.id = c.source_id
     WHERE s.key = 'afltables' AND c.season = ${season} AND c.status = 'pending'
     GROUP BY c.target_table, c.verb
     ORDER BY c.target_table, c.verb
  `;
  console.log(`\nPending AFL Tables promotion candidates for ${season}:`);
  if (rows.length === 0) console.log('  (none)');
  for (const row of rows) {
    console.log(`  ${row.targetTable} / ${row.verb}: ${row.pending}`);
  }

  // Not season-scoped: `data_issues` carries no season, and inferring one
  // from a record id would be a guess. The whole open queue is the honest
  // answer, and ownership keeps it to findings this issue actually wrote.
  const issues = await sql<{
    severity: string; issueKey: string; detectedAt: string; description: string;
  }[]>`
    SELECT d.severity::text AS severity, d.issue_key AS "issueKey",
           to_char(d.detected_at, 'YYYY-MM-DD') AS "detectedAt", d.description
      FROM data_issues d
     WHERE d.issue_type = ${SETTLE_ISSUE_TYPE}
       AND d.resolved_at IS NULL
       AND d.details->>'owner' = ${SETTLE_ISSUE_OWNER}
     ORDER BY d.severity DESC, d.issue_key
     LIMIT ${OPEN_ISSUE_LIMIT + 1}
  `;
  console.log('\nOpen AFL Tables source disagreements:');
  if (issues.length === 0) console.log('  (none)');
  for (const issue of issues.slice(0, OPEN_ISSUE_LIMIT)) {
    console.log(`  [${issue.severity}] ${issue.issueKey} — first detected ${issue.detectedAt}`);
    console.log(`      ${issue.description}`);
  }
  if (issues.length > OPEN_ISSUE_LIMIT) {
    console.log(
      `  … more than ${OPEN_ISSUE_LIMIT} open; query data_issues directly for the full list.`,
    );
  }
}

async function main(): Promise<void> {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));

  // Offline and fail-closed. No database has been opened yet.
  const bundle = loadBundle(args.label);
  console.log(
    `Bundle v${bundle.bundleContractVersion} '${bundle.snapshotLabel}' `
    + `(${bundle.acquisitionKind}, season ${bundle.season}, fitzRoy `
    + `${bundle.fitzroyVersion ?? 'unpinned'}) validated against its manifest.`,
  );

  const sql = createImportClient();
  try {
    if (args.report) {
      await report(sql, bundle.season);
      return;
    }

    const result = await runSettleAfltables(sql, {
      bundle,
      registry: parseSourceFamilyRegistry(
        readJson(join(PROJECT_ROOT, 'data', 'reference', 'source-families.json')),
      ),
      apply: args.apply,
      // Only ever reached if the loader below is somehow absent. There is no
      // bypass: an un-implemented authority mechanism refuses rather than
      // permitting.
      manualAuthority: UNAVAILABLE_MANUAL_AUTHORITY,
      // AFLDB-ISSUE-122 §8. The real provider, resolved from `data_overrides`
      // inside the run transaction. A query error or a broken pinned contract
      // yields refusal, not permission.
      manualAuthorityLoader: (tx) => loadManualAuthority(tx, bundle.season),
    });

    printCounters(result.counters);
    for (const skipped of result.absenceSweepSkipped) {
      console.log(
        `\nAbsence sweep SKIPPED for ${skipped.family} '${skipped.scopeKey}': ${skipped.reason}. `
        + 'Nothing in that scope was marked absent.',
      );
    }

    if (result.applied) {
      console.log(`\nApplied as import batch ${result.batchId}. No canonical row was written.`);
      await report(sql, bundle.season);
    } else {
      console.log(
        '\nDry run. The full write path executed against real constraints and privileges, '
        + 'then the whole transaction was rolled back. Nothing was retained — not even the '
        + 'import_batches row. Re-run with --apply to keep it.',
      );
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
