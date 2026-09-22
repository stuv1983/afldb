/**
 * AFLDB-ISSUE-224 S9 — batch registration of the 92 approved REGISTER-disposition players.
 *
 * D-7 (registration authority) and the D-8 sequence are APPROVED (2026-09-22). This tool
 * consumes exactly two retained, byte-pinned artefacts:
 *
 *   docs/rebuild-manifests/draftguru/issue224-s9-target-set-20260922.json   (92 rows)
 *   docs/rebuild-manifests/draftguru/issue224-d7-registration-decision-20260922.json (92 rows)
 *
 * and registers each REGISTER row as a canonical player through the SAME primitives the
 * `/admin/draft` surface uses for a manually-created player who later gets an AFL Tables
 * profile: `createPlayerInTransaction` (src/db/queries/players.ts) mints the player, its
 * zero-game career-stats row, its `manual_admin_edit` durable token and its
 * `data_overrides('players', 'identity')` record; `attachAflTablesIdentityInTransaction`
 * (src/db/queries/admin-draft.ts, extracted from `attachAflTablesIdentity` for this tool so
 * both primitives are transaction-scoped and composable) then attaches the AFL Tables
 * profile identity onto that same durable record. Nothing here writes an `external_identities`
 * row for the AFL API provider id — that is explicitly deferred to D-8 step 2 and the bridge
 * rebuild, per the D-7 authorisation.
 *
 * The AFL Tables profile identity is the sole registration authority (never the AFL API
 * provider id), matching `afltables_external_id` on both artefacts.
 *
 * Safety
 * ------
 * DEFAULT is read-only classification (no `--apply`). `--apply` is required to write, and is
 * refused outright for `--target dev` — this pass registers to `afldb_test` only; DEV gets a
 * read-only preflight census. There is no PROD target: `resolveTarget()` recognises exactly
 * `test` -> afldb_test and `dev` -> afldb_dev, and refuses a DSN whose path is not exactly
 * that database name (and, belt-and-braces, anything that looks like a prod name).
 *
 * Classification (CREATE / ALREADY_SATISFIED / CONFLICT) is computed from `external_identities`
 * inside the SAME transaction as the writes in `--apply` mode, so the decision that is reported
 * is the decision that is acted on. A single CONFLICT refuses the WHOLE batch before any of the
 * 92 rows is written (Task 6: one outer transaction, all-or-nothing).
 *
 * Usage
 * -----
 *   npx tsx --conditions=react-server tools/rebuild/draftguru/register_issue224_s9_players.ts \
 *     --admin-user-id <n> [--target test|dev] [--dev-import-role] [--apply]
 *
 * `--conditions=react-server` is required (matches `match:backtest` / `records:first-kick-goal`
 * in package.json): every canonical primitive this tool imports carries `import 'server-only'`,
 * which throws under the plain Node resolution condition.
 *
 * `--target dev` connects as the ordinary read-oriented `afldb_app` role via
 * `AFLDB_DEV_DATABASE_URL` by default. `--dev-import-role` (only valid with `--target dev`)
 * instead connects via the separate, purpose-built `AFLDB_DEV_IMPORT_DATABASE_URL` as the
 * elevated `afldb_import` role, needed for the AFLDB-ISSUE-160 D-2 manual-shell collision guard
 * (`data_overrides` SELECT is `afldb_import`-only, migration 073). There is no fallback between
 * the two variables. Both DEV modes remain read-only preflight: `--apply` is refused for
 * `--target dev` regardless of `--dev-import-role` (ISSUE-224 S9 boundary: no DEV writes yet).
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

import { attachAflTablesIdentityInTransaction } from '@/db/queries/admin-draft';
import { createPlayerInTransaction, type CreatePlayerInput } from '@/db/queries/players';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');

const DEFAULT_TARGET_SET_PATH = join(
  REPO_ROOT, 'docs', 'rebuild-manifests', 'draftguru', 'issue224-s9-target-set-20260922.json',
);
const DEFAULT_DECISION_PATH = join(
  REPO_ROOT, 'docs', 'rebuild-manifests', 'draftguru', 'issue224-d7-registration-decision-20260922.json',
);

// Pinned by the operator brief (ISSUE-224 D-7/D-8, 2026-09-22). A byte change in either
// retained artefact refuses this tool before any database connection is opened.
const PINNED_TARGET_SET_SHA256 =
  'e087baf706effdda8034a37cc184311687dee3c49f3e3e23a1e746beb347dcb0';
const PINNED_DECISION_SHA256 =
  'a795c987ca62cf879cb2ecc3bb61d9e1533eae84882956c442ff252de307be3d';

const EXPECTED_ROW_COUNT = 92;

const NOTE = (providerId: string) =>
  `AFLDB-ISSUE-224 S9 batch registration (D-7 approved 2026-09-22); `
  + `AFL API provider ${providerId} identity is withheld pending D-8 step 2.`;

// ---------------------------------------------------------------------------
// Artefacts
// ---------------------------------------------------------------------------

type Target = {
  profilePath: string;
  displayName: string;
  aflApiProviderId: string;
  draftguruPlayerUrl: string;
};

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function loadAndValidateArtefacts(targetSetPath: string, decisionPath: string): Target[] {
  const targetSetBytes = readFileSync(targetSetPath);
  const targetSetSha256 = sha256(targetSetBytes);
  if (targetSetSha256 !== PINNED_TARGET_SET_SHA256) {
    throw new Error(
      `target-set sha256 mismatch (observed ${targetSetSha256}, expected ${PINNED_TARGET_SET_SHA256}); `
      + 'the artefact has changed since it was approved. Nothing has been read as authoritative.',
    );
  }
  const decisionBytes = readFileSync(decisionPath);
  const decisionSha256 = sha256(decisionBytes);
  if (decisionSha256 !== PINNED_DECISION_SHA256) {
    throw new Error(
      `D-7 decision sha256 mismatch (observed ${decisionSha256}, expected ${PINNED_DECISION_SHA256}); `
      + 'the artefact has changed since it was approved.',
    );
  }

  const targetSet = JSON.parse(targetSetBytes.toString('utf8')) as { rows?: unknown };
  const decision = JSON.parse(decisionBytes.toString('utf8')) as { rows?: unknown };
  const targetRows = targetSet.rows;
  const decisionRows = decision.rows;
  if (!Array.isArray(targetRows) || targetRows.length !== EXPECTED_ROW_COUNT) {
    throw new Error(
      `target-set carries ${Array.isArray(targetRows) ? targetRows.length : 'no'} row(s), `
      + `expected ${EXPECTED_ROW_COUNT}.`,
    );
  }
  if (!Array.isArray(decisionRows) || decisionRows.length !== EXPECTED_ROW_COUNT) {
    throw new Error(
      `D-7 decision carries ${Array.isArray(decisionRows) ? decisionRows.length : 'no'} row(s), `
      + `expected ${EXPECTED_ROW_COUNT}.`,
    );
  }

  const decisionByPath = new Map<string, Record<string, unknown>>();
  for (const raw of decisionRows) {
    const row = raw as Record<string, unknown>;
    const path = String(row.afltables_external_id);
    if (decisionByPath.has(path)) {
      throw new Error(`D-7 decision names AFL Tables path ${path} more than once.`);
    }
    if (row.decision !== 'REGISTER') {
      throw new Error(`D-7 decision for ${path} is ${String(row.decision)}, not REGISTER; refusing.`);
    }
    if (row.identity_withheld) {
      throw new Error(`D-7 decision for ${path} withholds identity; refusing.`);
    }
    decisionByPath.set(path, row);
  }

  const seenPaths = new Set<string>();
  const seenProviderIds = new Set<string>();
  const targets: Target[] = [];

  for (const raw of targetRows) {
    const row = raw as Record<string, unknown>;
    const path = String(row.afltables_external_id);
    const providerId = String(row.afl_api_provider_id);

    if (row.disposition !== 'REGISTER') {
      throw new Error(`target-set row ${path} has disposition ${String(row.disposition)}, not REGISTER; refusing.`);
    }
    if (seenPaths.has(path)) {
      throw new Error(`target-set names AFL Tables path ${path} more than once (duplicate AFL Tables path).`);
    }
    seenPaths.add(path);
    if (seenProviderIds.has(providerId)) {
      throw new Error(`target-set names AFL API provider ${providerId} more than once (duplicate provider).`);
    }
    seenProviderIds.add(providerId);

    const decisionRow = decisionByPath.get(path);
    if (!decisionRow) {
      throw new Error(`target-set row ${path} has no corresponding D-7 decision row; refusing.`);
    }
    if (String(decisionRow.afl_api_provider_id) !== providerId) {
      throw new Error(`target-set/D-7 AFL API provider id disagree for ${path}.`);
    }
    if (String(decisionRow.draftguru_player_url) !== String(row.draftguru_player_url)) {
      throw new Error(`target-set/D-7 draftguru_player_url disagree for ${path}.`);
    }

    const observedNames = Array.isArray(row.afltables_observed_names)
      ? (row.afltables_observed_names as unknown[]).map(String) : [];
    const distinctNames = Array.from(new Set(observedNames));
    if (distinctNames.length !== 1) {
      throw new Error(
        `target-set row ${path} carries ${distinctNames.length} distinct afltables_observed_names `
        + '(expected exactly 1); refusing to choose a display name.',
      );
    }

    targets.push({
      profilePath: path,
      displayName: distinctNames[0],
      aflApiProviderId: providerId,
      draftguruPlayerUrl: String(row.draftguru_player_url),
    });
  }

  if (decisionByPath.size !== targets.length) {
    throw new Error(
      `D-7 decision names ${decisionByPath.size} REGISTER row(s), the target-set resolved `
      + `${targets.length}; population mismatch.`,
    );
  }

  return targets;
}

// ---------------------------------------------------------------------------
// Classification (Task 3: CREATE / ALREADY_SATISFIED / CONFLICT)
// ---------------------------------------------------------------------------

type Classification =
  | { kind: 'CREATE'; target: Target }
  | { kind: 'ALREADY_SATISFIED'; target: Target; playerId: number }
  | { kind: 'CONFLICT'; target: Target; detail: string };

async function classify(
  sql: postgres.Sql | postgres.TransactionSql, targets: Target[], warnings: string[] = [],
): Promise<Classification[]> {
  const paths = targets.map((t) => t.profilePath);
  const existingIdentities = await sql<{ externalId: string; playerId: number | null; status: string }[]>`
    SELECT e.external_id AS "externalId", e.player_id AS "playerId", e.status::text AS "status"
      FROM external_identities e
      JOIN sources s ON s.id = e.source_id
     WHERE s.key = 'afltables' AND e.match_method = 'afltables_profile_url'
       AND e.external_id = ANY(${paths})
  `;
  const byPath = new Map(existingIdentities.map((r) => [r.externalId, r]));

  // AFLDB-ISSUE-160 D-2 collision guard, translated from
  // `import_fitzroy_core.load_manual_identity_candidates` /
  // `refuse_unsafe_manual_insert`: an administrator has already created a player shell with
  // this name and no AFL Tables identity yet. There is no per-row date-of-birth evidence in
  // these two artefacts to disambiguate a genuine namesake, so any name match fails closed.
  //
  // `data_overrides` carries no `grant_app_read` (migration 073: SELECT is granted to
  // `afldb_import` only). The DEFAULT DEV preflight connects as the low-privilege `afldb_app`
  // role and cannot run this guard; that is reported as a warning, not silently skipped. The
  // `--dev-import-role` preflight connects as `afldb_import` (see `resolveTarget`) and DOES run
  // it. Neither DEV mode is ever used for a DEV write (DEV writes are refused before any
  // connection is opened; see `parseArgs`).
  const pendingManualBySearchName = new Map<string, string[]>();
  try {
    const pendingManual = await sql<{ displayName: string; searchName: string }[]>`
      SELECT o.override_values->>'display_name' AS "displayName",
             afldb_normalise_name(o.override_values->>'display_name') AS "searchName"
        FROM data_overrides o
       WHERE o.entity_type = 'players' AND o.is_active = true
         AND split_part(o.entity_key, ':', 1) = 'manual_admin_edit'
         AND NOT (o.override_values ? 'afltables_profile_path')
    `;
    for (const p of pendingManual) {
      const list = pendingManualBySearchName.get(p.searchName) ?? [];
      list.push(p.displayName);
      pendingManualBySearchName.set(p.searchName, list);
    }
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== '42501') throw error; // anything but insufficient_privilege is a real failure
    warnings.push(
      'the AFLDB-ISSUE-160 D-2 manual-shell name-collision guard could not run: the connected '
      + 'role has no SELECT on data_overrides (expected for the read-only afldb_app DEV '
      + 'connection). CREATE counts below are NOT checked against pending manual player shells.',
    );
  }

  const names = targets.map((t) => t.displayName);
  const normalisedNames = await sql<{ name: string; searchName: string }[]>`
    SELECT n AS name, afldb_normalise_name(n) AS "searchName"
      FROM unnest(${sql.array(names)}::text[]) AS n
  `;
  const searchNameOf = new Map(normalisedNames.map((r) => [r.name, r.searchName]));

  const results: Classification[] = [];
  const claimants = new Map<number, string[]>();

  for (const target of targets) {
    const existing = byPath.get(target.profilePath);
    if (existing) {
      if (existing.playerId !== null && (existing.status === 'unique' || existing.status === 'resolved')) {
        results.push({ kind: 'ALREADY_SATISFIED', target, playerId: existing.playerId });
        const list = claimants.get(existing.playerId) ?? [];
        list.push(target.profilePath);
        claimants.set(existing.playerId, list);
        continue;
      }
      results.push({
        kind: 'CONFLICT',
        target,
        detail: `existing external_identities row for ${target.profilePath} is not cleanly resolved `
          + `(status=${existing.status}, player_id=${existing.playerId ?? 'null'})`,
      });
      continue;
    }

    const searchName = searchNameOf.get(target.displayName);
    const collision = searchName ? pendingManualBySearchName.get(searchName) : undefined;
    if (collision && collision.length > 0) {
      results.push({
        kind: 'CONFLICT',
        target,
        detail: 'an administrator-created player shell with no AFL Tables identity already carries '
          + `this name (${collision.join(', ')}); refusing to create a possible duplicate `
          + '(AFLDB-ISSUE-160 D-2 guard). Attach the identity in /admin/draft or reconcile first.',
      });
      continue;
    }

    results.push({ kind: 'CREATE', target });
  }

  for (const [playerId, claimingPaths] of claimants) {
    if (claimingPaths.length <= 1) continue;
    for (let i = 0; i < results.length; i += 1) {
      const r = results[i];
      if (r.kind === 'ALREADY_SATISFIED' && claimingPaths.includes(r.target.profilePath)) {
        results[i] = {
          kind: 'CONFLICT',
          target: r.target,
          detail: `canonical player #${playerId} is claimed by ${claimingPaths.length} target identities `
            + `(${claimingPaths.join(', ')}); refusing to treat any of them as satisfied`,
        };
      }
    }
  }

  return results;
}

function printReport(classification: Classification[], heading: string, warnings: string[] = []): void {
  const create = classification.filter((c) => c.kind === 'CREATE');
  const satisfied = classification.filter((c) => c.kind === 'ALREADY_SATISFIED');
  const conflict = classification.filter((c) => c.kind === 'CONFLICT');
  console.log('');
  console.log(heading);
  console.log(`  CREATE            = ${create.length}`);
  console.log(`  ALREADY_SATISFIED = ${satisfied.length}`);
  console.log(`  CONFLICT          = ${conflict.length}`);
  console.log(`  TOTAL             = ${classification.length}`);
  if (conflict.length > 0) {
    console.log('');
    console.log('  CONFLICT detail:');
    for (const c of conflict) {
      console.log(`    ${c.target.profilePath}: ${c.detail}`);
    }
  }
  for (const w of warnings) {
    console.log(`  WARN  ${w}`);
  }
}

// ---------------------------------------------------------------------------
// Database targets — closed list, no PROD entry (Task boundaries)
// ---------------------------------------------------------------------------

type TargetName = 'test' | 'dev';

type TargetConfig = {
  dsn: string;
  requiredDatabase: string;
  // null = not positively checked (unchanged pre-existing behaviour for --target test).
  requiredUser: string | null;
  readOnly: boolean;
  canApply: boolean;
};

function assertNotProdLike(databasePath: string): void {
  if (/prod/i.test(databasePath)) {
    throw new Error(`REFUSED: database path '${databasePath}' looks like a production database.`);
  }
}

function resolveTarget(target: TargetName, devImportRole: boolean): TargetConfig {
  if (target === 'test') {
    const dsn = process.env.AFLDB_TEST_IMPORT_DATABASE_URL;
    if (!dsn) throw new Error('AFLDB_TEST_IMPORT_DATABASE_URL is not set.');
    const path = new URL(dsn).pathname.replace(/^\//, '');
    assertNotProdLike(path);
    if (path !== 'afldb_test') throw new Error(`AFLDB_TEST_IMPORT_DATABASE_URL does not target /afldb_test (observed /${path}).`);
    return { dsn, requiredDatabase: 'afldb_test', requiredUser: null, readOnly: false, canApply: true };
  }
  if (target === 'dev') {
    if (devImportRole) {
      // Purpose-built, maintenance/import-only DSN (ISSUE-224 S9 unblock). Never the same
      // variable as the ordinary DEV connection below, and no fallback between the two.
      const dsn = process.env.AFLDB_DEV_IMPORT_DATABASE_URL;
      if (!dsn) throw new Error('AFLDB_DEV_IMPORT_DATABASE_URL is not set.');
      const path = new URL(dsn).pathname.replace(/^\//, '');
      assertNotProdLike(path);
      if (path !== 'afldb_dev') {
        throw new Error(`AFLDB_DEV_IMPORT_DATABASE_URL does not target /afldb_dev (observed /${path}).`);
      }
      return { dsn, requiredDatabase: 'afldb_dev', requiredUser: 'afldb_import', readOnly: true, canApply: false };
    }
    const dsn = process.env.AFLDB_DEV_DATABASE_URL;
    if (!dsn) throw new Error('AFLDB_DEV_DATABASE_URL is not set.');
    const path = new URL(dsn).pathname.replace(/^\//, '');
    assertNotProdLike(path);
    if (path !== 'afldb_dev') throw new Error(`AFLDB_DEV_DATABASE_URL does not target /afldb_dev (observed /${path}).`);
    return { dsn, requiredDatabase: 'afldb_dev', requiredUser: 'afldb_app', readOnly: true, canApply: false };
  }
  throw new Error(`unknown --target ${String(target)} — only 'test' and 'dev' exist (no PROD target).`);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

type Args = {
  target: TargetName;
  apply: boolean;
  devImportRole: boolean;
  adminUserId: number;
  targetSetPath: string;
  decisionPath: string;
};

function parseArgs(argv: string[]): Args {
  let target: TargetName = 'test';
  let apply = false;
  let devImportRole = false;
  let adminUserId: number | null = null;
  let targetSetPath = DEFAULT_TARGET_SET_PATH;
  let decisionPath = DEFAULT_DECISION_PATH;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--target') { target = argv[++i] as TargetName; continue; }
    if (arg === '--apply') { apply = true; continue; }
    if (arg === '--dev-import-role') { devImportRole = true; continue; }
    if (arg === '--admin-user-id') { adminUserId = Number(argv[++i]); continue; }
    if (arg === '--target-set') { targetSetPath = argv[++i]; continue; }
    if (arg === '--decision') { decisionPath = argv[++i]; continue; }
    throw new Error(`unrecognised argument: ${arg}`);
  }

  if (target !== 'test' && target !== 'dev') {
    throw new Error(`--target must be 'test' or 'dev' (no PROD target), got '${String(target)}'.`);
  }
  if (adminUserId === null || !Number.isInteger(adminUserId) || adminUserId <= 0) {
    throw new Error('--admin-user-id <n> is required (a positive integer admin_users.id).');
  }
  if (devImportRole && target !== 'dev') {
    throw new Error("REFUSED: --dev-import-role is only valid with --target dev.");
  }
  // Applies regardless of --dev-import-role: --target dev --dev-import-role --apply still
  // refuses (ISSUE-224 S9 boundary: no DEV writes in this pass, privileged or not).
  if (apply && target === 'dev') {
    throw new Error(
      'REFUSED: --apply is not permitted for --target dev in this pass (ISSUE-224 S9 boundary: '
      + 'no DEV writes). DEV runs read-only preflight only.',
    );
  }

  return { target, apply, devImportRole, adminUserId, targetSetPath, decisionPath };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const targets = loadAndValidateArtefacts(args.targetSetPath, args.decisionPath);
  console.log(
    `Loaded ${targets.length} REGISTER target(s) from pinned artefacts `
    + `(target-set sha256=${PINNED_TARGET_SET_SHA256.slice(0, 12)}…, `
    + `D-7 sha256=${PINNED_DECISION_SHA256.slice(0, 12)}…).`,
  );

  const cfg = resolveTarget(args.target, args.devImportRole);
  const sql = postgres(cfg.dsn, {
    max: 1,
    onnotice: () => {},
    connection: cfg.readOnly
      ? { application_name: 'afldb-issue224-s9-register', default_transaction_read_only: true, TimeZone: 'UTC' }
      : { application_name: 'afldb-issue224-s9-register', TimeZone: 'UTC' },
  });

  try {
    const [row] = await sql<{
      database: string; currentUser: string; txRo: string; defaultRo: string;
    }[]>`
      SELECT current_database() AS "database",
             current_user AS "currentUser",
             current_setting('transaction_read_only') AS "txRo",
             current_setting('default_transaction_read_only') AS "defaultRo"
    `;
    if (row.database !== cfg.requiredDatabase) {
      throw new Error(`REFUSED: connected database is '${row.database}', expected '${cfg.requiredDatabase}'.`);
    }
    if (cfg.requiredUser !== null && row.currentUser !== cfg.requiredUser) {
      throw new Error(`REFUSED: connected user is '${row.currentUser}', expected '${cfg.requiredUser}'.`);
    }
    if (cfg.readOnly && (row.txRo !== 'on' || row.defaultRo !== 'on')) {
      throw new Error('REFUSED: the DEV connection is not proven read-only.');
    }
    console.log(
      `Connected: current_database()='${row.database}', current_user='${row.currentUser}' `
      + `(--target ${args.target}${args.devImportRole ? ' --dev-import-role' : ''}), `
      + `mode=${args.apply ? 'APPLY' : cfg.readOnly ? 'READ-ONLY PREFLIGHT' : 'dry-run'}.`,
    );

    if (!args.apply) {
      const warnings: string[] = [];
      const classification = await classify(sql, targets, warnings);
      printReport(classification, `Classification against '${row.database}' (no write attempted):`, warnings);
      if (classification.some((c) => c.kind === 'CONFLICT')) {
        process.exitCode = 1;
      }
      return;
    }

    // --apply: afldb_test only (cfg.canApply enforced by parseArgs + resolveTarget already).
    const outcome = await sql.begin(async (tx) => {
      const warnings: string[] = [];
      const classification = await classify(tx, targets, warnings);
      printReport(
        classification, `Classification inside the write transaction against '${row.database}':`, warnings,
      );
      const conflicts = classification.filter((c) => c.kind === 'CONFLICT');
      if (conflicts.length > 0) {
        throw new Error(
          `${conflicts.length} CONFLICT row(s) — refusing to write ANY of the ${targets.length} rows. `
          + 'Nothing has been written.',
        );
      }

      const created: { profilePath: string; playerId: number }[] = [];
      for (const c of classification) {
        if (c.kind !== 'CREATE') continue;
        const input: CreatePlayerInput = {
          displayName: c.target.displayName,
          notes: NOTE(c.target.aflApiProviderId),
        };
        const player = await createPlayerInTransaction(tx, input, { adminUserId: args.adminUserId });
        const attach = await attachAflTablesIdentityInTransaction(tx, {
          playerId: player.id,
          profilePath: c.target.profilePath,
          adminUserId: args.adminUserId,
          note: NOTE(c.target.aflApiProviderId),
        });
        if (!attach.ok) {
          throw new Error(
            `attachAflTablesIdentityInTransaction refused for ${c.target.profilePath} `
            + `(player #${player.id}): ${attach.error}`,
          );
        }
        created.push({ profilePath: c.target.profilePath, playerId: player.id });
      }
      return { created, satisfied: classification.filter((c) => c.kind === 'ALREADY_SATISFIED').length };
    });

    console.log('');
    console.log(
      `APPLY complete against '${row.database}': ${outcome.created.length} player(s) created and `
      + `attached, ${outcome.satisfied} already satisfied, 0 conflicts.`,
    );
    for (const c of outcome.created) {
      console.log(`  player_id=${c.playerId}  ${c.profilePath}`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error('');
  console.error(`REFUSED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
