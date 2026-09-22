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
 * Name parts (AFLDB-ISSUE-224 S9, recurrence fix)
 * -----------------------------------------------
 * `createPlayerInTransaction` falls back to a LAST-TOKEN split when a caller supplies neither
 * `givenName` nor `surname`: "Alex Van Wyk" becomes given "Alex Van" / surname "Wyk". For a
 * multipart surname that is silently wrong, and it is durable — the wrong parts land in
 * `players`, in `sort_name`, and in the `data_overrides` identity payload that
 * `replay_admin_overrides(players)` re-creates the row from. It also breaks the AFL API player
 * bridge, whose rule (d) is a fail-closed normalised SURNAME equality check
 * (`src/lib/acquisition/afl-api-player-evidence.ts`): "VANWYK" != "WYK", so an otherwise
 * accepted pair is withheld.
 *
 * This runner therefore NEVER lets that fallback fire. It resolves `given_name`/`surname` itself
 * and passes them explicitly, by `resolveNameParts()`:
 *
 *   - one token            -> surname only (no given name) — unambiguous;
 *   - exactly two tokens    -> given + surname — unambiguous;
 *   - three or more tokens  -> REFUSED. The split is a human decision, not a guess.
 *
 * A refused row is unblocked by `--name-parts <path>`: an operator-authored JSON artefact naming
 * the authoritative `given_name`/`surname` for that AFL Tables path, from the source that owns the
 * name. It is not hash-pinned (it is authored per run, unlike the two D-7 artefacts) but it is
 * checked against the pinned target set: every row must name a target path, must repeat that
 * target's `display_name` byte-for-byte, and must recompose to it (`given + ' ' + surname`), so an
 * override can restate how a name divides but can never change what the name is.
 *
 * No player id and no player name is special-cased anywhere in this file.
 *
 * Safety
 * ------
 * DEFAULT is read-only classification (no `--apply`). `--apply` is required to write. For
 * `--target test` this is unchanged: `--apply` writes to `afldb_test` under the ordinary
 * idempotent CREATE/ALREADY_SATISFIED/CONFLICT rule. For `--target dev`, `--apply` is refused
 * unless ALL of `--dev-import-role`, `--allow-dev-write` and `--backup-sha256 <64-hex>` are
 * also present (the explicit DEV write authorisation gate, ISSUE-224 S9 unblock) — see
 * `parseArgs`. Absent that full combination, DEV stays a read-only preflight census exactly as
 * before. There is no PROD target: `resolveTarget()` recognises exactly `test` -> afldb_test and
 * `dev` -> afldb_dev, and refuses a DSN whose path is not exactly that database name (and,
 * belt-and-braces, anything that looks like a prod name).
 *
 * A DEV apply additionally requires, inside the same write transaction and before any row is
 * written, that re-classification against live `afldb_dev` state come back exactly
 * CREATE=92 / ALREADY_SATISFIED=0 / CONFLICT=0 — the deliberate first-apply gate for this batch
 * (Task 3). Any drift from that exact shape refuses and rolls back. After the 92 writes and
 * before commit, a battery of postconditions (identity resolution, distinct player ids, slug
 * uniqueness, row counts, durability/audit rows) must all hold or the whole transaction is
 * rolled back (Task 5).
 *
 * Classification (CREATE / ALREADY_SATISFIED / CONFLICT) is computed from `external_identities`
 * inside the SAME transaction as the writes in `--apply` mode, so the decision that is reported
 * is the decision that is acted on. A single CONFLICT refuses the WHOLE batch before any of the
 * 92 rows is written (Task 6: one outer transaction, all-or-nothing).
 *
 * Usage
 * -----
 *   npx tsx --conditions=react-server tools/rebuild/draftguru/register_issue224_s9_players.ts \
 *     --admin-user-id <n> [--target test|dev] [--dev-import-role] [--apply] \
 *     [--allow-dev-write] [--backup-sha256 <64-hex>] [--name-parts <path>]
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
 * the two variables.
 *
 * `--target dev --apply` is refused UNLESS `--dev-import-role`, `--allow-dev-write` and
 * `--backup-sha256 <64-hex>` are ALL also present (`parseArgs`). `--allow-dev-write` is the
 * explicit, issue-specific DEV write authorisation; it is invalid (refused) with `--target test`.
 * `--backup-sha256` is an operator acknowledgement that a pre-write DEV backup has been taken and
 * independently verified — this runner cannot itself prove the remote dump exists, so it only
 * validates the value's shape (64 hex characters) and echoes a shortened form back, never the
 * full value or any credential. Any DEV apply invocation missing one of these, or supplying a
 * malformed `--backup-sha256`, is refused before any database connection is opened. Without the
 * full combination, `--target dev` remains a read-only preflight census exactly as before.
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

export const EXPECTED_ROW_COUNT = 92;

const NOTE = (providerId: string) =>
  `AFLDB-ISSUE-224 S9 batch registration (D-7 approved 2026-09-22); `
  + `AFL API provider ${providerId} identity is withheld pending D-8 step 2.`;

// ---------------------------------------------------------------------------
// Artefacts
// ---------------------------------------------------------------------------

export type Target = {
  profilePath: string;
  displayName: string;
  /** null only for a single-token display name; never guessed from a multipart one. */
  givenName: string | null;
  surname: string;
  aflApiProviderId: string;
  draftguruPlayerUrl: string;
};

/** One operator-authored authoritative name division, keyed by AFL Tables profile path. */
export type NameParts = { givenName: string | null; surname: string };

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Collapse runs of whitespace so a comparison is about the name, not about its spacing. */
function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/**
 * Resolve `given_name`/`surname` for one target WITHOUT ever falling through to
 * `createPlayerInTransaction`'s last-token split (see the header). Throws — refusing the whole
 * batch — rather than guessing where a multipart name divides.
 *
 * `override`, when present, is the authoritative division for this path and is verified to
 * recompose to exactly `displayName`: an override restates how the name divides, never what it is.
 */
export function resolveNameParts(
  profilePath: string, displayName: string, override?: NameParts,
): NameParts {
  const name = collapseWhitespace(displayName);
  if (!name) {
    throw new Error(`target-set row ${profilePath} carries an empty display name; refusing.`);
  }

  if (override) {
    const givenName = override.givenName === null ? null : collapseWhitespace(override.givenName);
    const surname = collapseWhitespace(override.surname);
    if (!surname) {
      throw new Error(
        `--name-parts row ${profilePath} carries an empty surname; refusing (a surname is the one `
        + 'part every canonical player row must have).',
      );
    }
    const recomposed = collapseWhitespace([givenName ?? '', surname].join(' '));
    if (recomposed !== name) {
      throw new Error(
        `--name-parts row ${profilePath} does not recompose to the pinned display name: `
        + `'${recomposed}' != '${name}'. An override may restate how a name divides, never what `
        + 'the name is.',
      );
    }
    return { givenName: givenName || null, surname };
  }

  const tokens = name.split(' ');
  if (tokens.length === 1) {
    // Mononym: surname-only is what every other canonical writer produces, and there is nothing
    // to divide, so there is nothing to guess.
    return { givenName: null, surname: tokens[0] };
  }
  if (tokens.length === 2) {
    return { givenName: tokens[0], surname: tokens[1] };
  }
  throw new Error(
    `REFUSED: target-set row ${profilePath} carries the multipart display name '${name}' `
    + `(${tokens.length} tokens). Where it divides into given name and surname is a human `
    + 'decision this tool will not guess — a last-token split would durably record the wrong '
    + 'surname in players, sort_name, the data_overrides identity payload and the AFL API bridge\'s '
    + 'fail-closed surname check. Supply the authoritative division via '
    + '--name-parts <path> and re-run. Nothing has been written.',
  );
}

/**
 * Load the optional operator-authored `--name-parts` artefact. Deliberately NOT hash-pinned: it is
 * authored per run, unlike the two immutable D-7 artefacts. Its safety comes from being validated
 * against the pinned target set by `loadAndValidateArtefacts` instead.
 */
export function loadNameParts(path: string): Map<string, NameParts & { displayName: string }> {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as { rows?: unknown };
  const rows = parsed.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`--name-parts artefact ${path} carries no rows.`);
  }
  const out = new Map<string, NameParts & { displayName: string }>();
  for (const raw of rows) {
    const row = raw as Record<string, unknown>;
    const profilePath = String(row.afltables_external_id ?? '');
    if (!profilePath) {
      throw new Error(`--name-parts artefact ${path} carries a row with no afltables_external_id.`);
    }
    if (out.has(profilePath)) {
      throw new Error(`--name-parts artefact names AFL Tables path ${profilePath} more than once.`);
    }
    if (typeof row.display_name !== 'string' || typeof row.surname !== 'string') {
      throw new Error(
        `--name-parts row ${profilePath} must carry a string display_name and a string surname.`,
      );
    }
    if (row.given_name !== null && typeof row.given_name !== 'string') {
      throw new Error(`--name-parts row ${profilePath} given_name must be a string or null.`);
    }
    out.set(profilePath, {
      displayName: row.display_name,
      givenName: row.given_name === null ? null : row.given_name,
      surname: row.surname,
    });
  }
  return out;
}

export function loadAndValidateArtefacts(
  targetSetPath: string,
  decisionPath: string,
  nameParts: Map<string, NameParts & { displayName: string }> = new Map(),
): Target[] {
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

    const displayName = distinctNames[0];

    // An override may only ever restate a name the pinned target set already carries, for a path
    // the pinned target set already names.
    const override = nameParts.get(path);
    if (override && override.displayName !== displayName) {
      throw new Error(
        `--name-parts row ${path} carries display_name '${override.displayName}', the pinned `
        + `target set carries '${displayName}'; refusing.`,
      );
    }
    const parts = resolveNameParts(path, displayName, override);

    targets.push({
      profilePath: path,
      displayName,
      givenName: parts.givenName,
      surname: parts.surname,
      aflApiProviderId: providerId,
      draftguruPlayerUrl: String(row.draftguru_player_url),
    });
  }

  // An override for a path this batch does not register is an operator error about WHICH rows are
  // being corrected; it fails closed rather than being ignored.
  for (const path of nameParts.keys()) {
    if (!seenPaths.has(path)) {
      throw new Error(
        `--name-parts names AFL Tables path ${path}, which is not in the pinned target set; refusing.`,
      );
    }
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

export type TargetName = 'test' | 'dev';

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

/**
 * `writeAuthorized` is true only when `--target dev --apply` passed the full explicit gate in
 * `parseArgs` (`--dev-import-role` + `--allow-dev-write` + valid `--backup-sha256`). It is
 * ignored for `--target test` (unchanged: always writable via the import role) and for the
 * ordinary, non-import-role DEV connection (always read-only regardless — `--apply` on that path
 * is unreachable because `parseArgs` requires `--dev-import-role` for any DEV apply).
 */
export function resolveTarget(target: TargetName, devImportRole: boolean, writeAuthorized: boolean): TargetConfig {
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
      return writeAuthorized
        ? { dsn, requiredDatabase: 'afldb_dev', requiredUser: 'afldb_import', readOnly: false, canApply: true }
        : { dsn, requiredDatabase: 'afldb_dev', requiredUser: 'afldb_import', readOnly: true, canApply: false };
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
// DEV post-write integrity checks (Task 5) — run inside the write transaction,
// after all 92 writes and BEFORE commit. Any failure throws, which rolls the
// whole transaction (all 92 rows) back. Not run for --target test: the exact
// numeric shape here (EXPECTED_ROW_COUNT, not "however many CREATEd") is the
// deliberate DEV first-apply gate for this batch, not a general-purpose check.
// ---------------------------------------------------------------------------

export async function runDevPostWriteChecks(
  tx: postgres.TransactionSql,
  targets: Target[],
  created: { profilePath: string; playerId: number }[],
  beforePlayerCount: number,
  confirmedAuditWrites: number,
): Promise<string[]> {
  const results: string[] = [];
  const paths = targets.map((t) => t.profilePath);
  const createdIds = created.map((c) => c.playerId);

  if (createdIds.length !== EXPECTED_ROW_COUNT) {
    throw new Error(
      `postcondition failed: ${createdIds.length} player(s) were created, expected exactly `
      + `${EXPECTED_ROW_COUNT}.`,
    );
  }

  // 92 target AFL Tables identities resolve, each to a distinct player, and no target identity
  // is claimed by more than one player.
  const identities = await tx<{ externalId: string; playerId: number | null }[]>`
    SELECT e.external_id AS "externalId", e.player_id AS "playerId"
      FROM external_identities e
      JOIN sources s ON s.id = e.source_id
     WHERE s.key = 'afltables' AND e.match_method = 'afltables_profile_url'
       AND e.status IN ('unique', 'resolved')
       AND e.external_id = ANY(${paths})
  `;
  if (identities.length !== EXPECTED_ROW_COUNT || identities.some((i) => i.playerId === null)) {
    throw new Error(
      `postcondition failed: ${identities.filter((i) => i.playerId !== null).length}/`
      + `${EXPECTED_ROW_COUNT} target AFL Tables identities resolve to a player.`,
    );
  }
  results.push(`${EXPECTED_ROW_COUNT}/${EXPECTED_ROW_COUNT} target AFL Tables identities resolve: OK`);

  const distinctPlayerIds = new Set(identities.map((i) => i.playerId));
  if (distinctPlayerIds.size !== EXPECTED_ROW_COUNT) {
    throw new Error(
      `postcondition failed: ${distinctPlayerIds.size} distinct canonical player_id(s) across the `
      + `${EXPECTED_ROW_COUNT} target identities (expected ${EXPECTED_ROW_COUNT} — an identity is `
      + `claimed by more than one player).`,
    );
  }
  results.push(`${EXPECTED_ROW_COUNT} distinct canonical player_ids, no identity claimed twice: OK`);

  // No duplicate slug among the 92 newly-created players, and — same query — the persisted name
  // parts are the ones this runner resolved, not a last-token split of the display name.
  const slugRows = await tx<{
    id: number; slug: string; givenName: string | null; surname: string | null; sortName: string | null;
  }[]>`
    SELECT id, slug, given_name AS "givenName", surname, sort_name AS "sortName"
      FROM players WHERE id = ANY(${createdIds})
  `;
  const distinctSlugs = new Set(slugRows.map((r) => r.slug));
  if (slugRows.length !== EXPECTED_ROW_COUNT || distinctSlugs.size !== EXPECTED_ROW_COUNT) {
    throw new Error(
      `postcondition failed: ${slugRows.length} newly-created player row(s) carry `
      + `${distinctSlugs.size} distinct slug(s) (expected ${EXPECTED_ROW_COUNT} of each).`,
    );
  }
  results.push('no duplicate slug among the newly-created players: OK');

  // Name-parts postcondition (ISSUE-224 S9 recurrence fix). A row whose surname is a suffix of a
  // multipart name is exactly the defect this batch previously wrote to DEV, and it is invisible
  // in every other check here.
  const targetByPath = new Map(targets.map((t) => [t.profilePath, t]));
  const playerRowById = new Map(slugRows.map((r) => [r.id, r]));
  const nameMismatches: string[] = [];
  for (const c of created) {
    const target = targetByPath.get(c.profilePath);
    const row = playerRowById.get(c.playerId);
    if (!target || !row) {
      nameMismatches.push(`${c.profilePath}: no row to verify name parts against`);
      continue;
    }
    const expectedSortName = target.givenName === null
      ? target.surname
      : `${target.surname}, ${target.givenName}`;
    if (row.givenName !== target.givenName || row.surname !== target.surname
        || row.sortName !== expectedSortName) {
      nameMismatches.push(
        `${c.profilePath}: given_name=${JSON.stringify(row.givenName)}/`
        + `surname=${JSON.stringify(row.surname)}/sort_name=${JSON.stringify(row.sortName)}, `
        + `expected ${JSON.stringify(target.givenName)}/${JSON.stringify(target.surname)}/`
        + JSON.stringify(expectedSortName),
      );
    }
  }
  if (nameMismatches.length > 0) {
    throw new Error(
      `postcondition failed: ${nameMismatches.length} newly-created player row(s) do not carry the `
      + `resolved name parts: ${nameMismatches.slice(0, 5).join('; ')}`,
    );
  }
  results.push(
    `${EXPECTED_ROW_COUNT}/${EXPECTED_ROW_COUNT} newly-created players carry the resolved `
    + 'given_name/surname/sort_name (no last-token split): OK',
  );

  // Player count increased by exactly 92 — combined with createdIds.length === 92 above, this
  // also proves no non-target player was created by this batch: every row this batch inserted
  // into `players` is accounted for in `created`, and nothing else changed the table's size.
  const [{ count: afterCountRaw }] = await tx<{ count: string }[]>`SELECT count(*)::text AS count FROM players`;
  const afterCount = Number(afterCountRaw);
  if (afterCount - beforePlayerCount !== EXPECTED_ROW_COUNT) {
    throw new Error(
      `postcondition failed: player count moved from ${beforePlayerCount} to ${afterCount} `
      + `(delta ${afterCount - beforePlayerCount}, expected exactly +${EXPECTED_ROW_COUNT}).`,
    );
  }
  results.push(`player count increased by exactly ${EXPECTED_ROW_COUNT} (no non-target player created): OK`);

  // 92 required player_career_stats rows exist for the newly-created players.
  const [{ count: statsCountRaw }] = await tx<{ count: string }[]>`
    SELECT count(*)::text AS count FROM player_career_stats WHERE player_id = ANY(${createdIds})
  `;
  if (Number(statsCountRaw) !== EXPECTED_ROW_COUNT) {
    throw new Error(
      `postcondition failed: ${statsCountRaw}/${EXPECTED_ROW_COUNT} player_career_stats row(s) `
      + 'exist for the newly-created players.',
    );
  }
  results.push(`${EXPECTED_ROW_COUNT}/${EXPECTED_ROW_COUNT} player_career_stats rows exist: OK`);

  // Expected data_overrides durability rows exist for all 92, and each carries the attached
  // AFL Tables path (i.e. attachAflTablesIdentityInTransaction's UPDATE actually landed) AND
  // the resolved name division. The payload is what `replay_admin_overrides(players)` re-creates
  // a destroyed row FROM, so a last-token split surviving there would outlive the correct
  // `players` row the check above proves -- the same defect, one layer down, and invisible to
  // every other postcondition here.
  const overrideRows = await tx<{
    playerId: number; hasPath: boolean; givenName: string | null; surname: string | null;
  }[]>`
    SELECT e.player_id AS "playerId",
           (o.override_values ? 'afltables_profile_path') AS "hasPath",
           o.override_values->>'given_name' AS "givenName",
           o.override_values->>'surname' AS "surname"
      FROM external_identities e
      JOIN sources s ON s.id = e.source_id
      JOIN data_overrides o
        ON o.entity_type = 'players'
       AND o.entity_key = 'manual_admin_edit:' || e.external_id
       AND o.field_group = 'identity'
       AND o.is_active = true
     WHERE s.key = 'manual_admin_edit'
       AND e.player_id = ANY(${createdIds})
  `;
  const withPath = overrideRows.filter((r) => r.hasPath);
  if (overrideRows.length !== EXPECTED_ROW_COUNT || withPath.length !== EXPECTED_ROW_COUNT) {
    throw new Error(
      `postcondition failed: ${overrideRows.length}/${EXPECTED_ROW_COUNT} data_overrides `
      + `durability row(s) found, ${withPath.length} carrying afltables_profile_path.`,
    );
  }
  results.push(`${EXPECTED_ROW_COUNT}/${EXPECTED_ROW_COUNT} data_overrides durability rows carry the attached path: OK`);

  const createdPathById = new Map(created.map((c) => [c.playerId, c.profilePath]));
  const payloadMismatches: string[] = [];
  for (const record of overrideRows) {
    const target = targetByPath.get(createdPathById.get(record.playerId) ?? '');
    if (!target) {
      payloadMismatches.push(`player #${record.playerId}: durability row names no target`);
      continue;
    }
    if (record.givenName !== target.givenName || record.surname !== target.surname) {
      payloadMismatches.push(
        `${target.profilePath}: payload given_name=${JSON.stringify(record.givenName)}/`
        + `surname=${JSON.stringify(record.surname)}, expected `
        + `${JSON.stringify(target.givenName)}/${JSON.stringify(target.surname)}`,
      );
    }
  }
  if (payloadMismatches.length > 0) {
    throw new Error(
      `postcondition failed: ${payloadMismatches.length} durable identity payload(s) do not carry `
      + `the resolved name parts: ${payloadMismatches.slice(0, 5).join('; ')}`,
    );
  }
  results.push(
    `${EXPECTED_ROW_COUNT}/${EXPECTED_ROW_COUNT} durable identity payloads carry the resolved `
    + 'given_name/surname (a rebuild replays the correct split): OK',
  );

  // Expected data_edits/audit rows for all 92 (recordDataEdit inside
  // attachAflTablesIdentityInTransaction, field_group 'source_identity') — proven
  // transaction-locally, not queried: afldb_import holds INSERT-only on data_edits (migration
  // 066 / privileges.sql), by design (append-only audit, least privilege), so there is no SELECT
  // grant to read it back with, and none should be added for this check (AFLDB-ISSUE-224 S9).
  //
  // recordDataEdit() (src/db/queries/audit-log.ts) is an unconditional INSERT with no ON
  // CONFLICT and no try/catch, and it is the LAST statement attachAflTablesIdentityInTransaction
  // runs before returning { ok: true }. A failed INSERT there throws, which aborts this whole
  // sql.begin() block before the caller's write loop can advance past that row — so
  // confirmedAuditWrites, incremented once per successful attach in that loop, IS the count of
  // audit rows this transaction has inserted for field_group 'source_identity' on these rowIds.
  if (confirmedAuditWrites !== EXPECTED_ROW_COUNT) {
    throw new Error(
      `postcondition failed: ${confirmedAuditWrites}/${EXPECTED_ROW_COUNT} data_edits audit `
      + 'writes were confirmed during registration (transaction-local count; afldb_import has no '
      + 'SELECT on data_edits by design, so this cannot be queried back).',
    );
  }
  results.push(
    `${EXPECTED_ROW_COUNT}/${EXPECTED_ROW_COUNT} data_edits audit writes confirmed `
    + '(transaction-local, no SELECT required): OK',
  );

  return results;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/** Exactly 64 hex characters (case-insensitive), no other shape accepted. */
export const BACKUP_SHA256_RE = /^[0-9a-fA-F]{64}$/;

export type Args = {
  target: TargetName;
  apply: boolean;
  devImportRole: boolean;
  allowDevWrite: boolean;
  backupSha256: string | null;
  adminUserId: number;
  targetSetPath: string;
  decisionPath: string;
  /** Optional operator-authored authoritative name divisions; see `loadNameParts`. */
  namePartsPath: string | null;
};

export function parseArgs(argv: string[]): Args {
  let target: TargetName = 'test';
  let apply = false;
  let devImportRole = false;
  let allowDevWrite = false;
  let backupSha256: string | null = null;
  let adminUserId: number | null = null;
  let targetSetPath = DEFAULT_TARGET_SET_PATH;
  let decisionPath = DEFAULT_DECISION_PATH;
  let namePartsPath: string | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--target') { target = argv[++i] as TargetName; continue; }
    if (arg === '--apply') { apply = true; continue; }
    if (arg === '--dev-import-role') { devImportRole = true; continue; }
    if (arg === '--allow-dev-write') { allowDevWrite = true; continue; }
    if (arg === '--backup-sha256') { backupSha256 = argv[++i] ?? null; continue; }
    if (arg === '--admin-user-id') { adminUserId = Number(argv[++i]); continue; }
    if (arg === '--target-set') { targetSetPath = argv[++i]; continue; }
    if (arg === '--decision') { decisionPath = argv[++i]; continue; }
    if (arg === '--name-parts') { namePartsPath = argv[++i] ?? null; continue; }
    throw new Error(`unrecognised argument: ${arg}`);
  }

  if (target !== 'test' && target !== 'dev') {
    throw new Error(`--target must be 'test' or 'dev' (no PROD target), got '${String(target)}'.`);
  }
  if (adminUserId === null || !Number.isInteger(adminUserId) || adminUserId <= 0) {
    throw new Error('--admin-user-id <n> is required (a positive integer admin_users.id).');
  }
  if (namePartsPath !== null && namePartsPath.trim() === '') {
    throw new Error('--name-parts <path> requires a path.');
  }
  if (devImportRole && target !== 'dev') {
    throw new Error("REFUSED: --dev-import-role is only valid with --target dev.");
  }
  // --allow-dev-write and --backup-sha256 are DEV-apply-only concepts: invalid/irrelevant for
  // --target test, which keeps its existing unconditional-apply behaviour untouched.
  if (allowDevWrite && target !== 'dev') {
    throw new Error("REFUSED: --allow-dev-write is only valid with --target dev.");
  }
  if (backupSha256 !== null && target !== 'dev') {
    throw new Error("REFUSED: --backup-sha256 is only valid with --target dev.");
  }

  // The explicit DEV write authorisation gate (ISSUE-224 S9 unblock). ALL FOUR of
  // --target dev, --dev-import-role, --apply and --allow-dev-write, plus a well-formed
  // --backup-sha256, are required before a DEV --apply is permitted past this point. No PROD
  // target exists at all (enforced above and in resolveTarget/assertNotProdLike), and every
  // other combination — including --target dev --apply alone, or with only some of the three
  // additional flags — is refused here, before any database connection is opened.
  if (apply && target === 'dev') {
    if (!devImportRole) {
      throw new Error(
        'REFUSED: --target dev --apply requires --dev-import-role (the elevated afldb_import '
        + 'connection this gate is built on). DEV runs read-only preflight only without it.',
      );
    }
    if (!allowDevWrite) {
      throw new Error(
        'REFUSED: --target dev --apply requires --allow-dev-write (the explicit, issue-specific '
        + 'DEV write authorisation). DEV runs read-only preflight only without it.',
      );
    }
    if (backupSha256 === null) {
      throw new Error(
        'REFUSED: --target dev --apply requires --backup-sha256 <64-hex> — the operator\'s '
        + 'acknowledgement that a pre-write DEV backup has been taken and verified. This runner '
        + 'cannot itself prove the remote dump exists; the hash is an acknowledgement, not proof.',
      );
    }
    if (!BACKUP_SHA256_RE.test(backupSha256)) {
      throw new Error(
        'REFUSED: --backup-sha256 must be exactly 64 hexadecimal characters (observed a '
        + 'malformed value); refusing before any database connection is opened.',
      );
    }
  }

  return {
    target, apply, devImportRole, allowDevWrite, backupSha256, adminUserId, targetSetPath,
    decisionPath, namePartsPath,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const nameParts: Map<string, NameParts & { displayName: string }> = args.namePartsPath === null
    ? new Map()
    : loadNameParts(args.namePartsPath);
  const targets = loadAndValidateArtefacts(args.targetSetPath, args.decisionPath, nameParts);
  console.log(
    `Loaded ${targets.length} REGISTER target(s) from pinned artefacts `
    + `(target-set sha256=${PINNED_TARGET_SET_SHA256.slice(0, 12)}…, `
    + `D-7 sha256=${PINNED_DECISION_SHA256.slice(0, 12)}…).`,
  );
  if (args.namePartsPath !== null) {
    console.log(
      `Applied ${nameParts.size} operator-authored name division(s) from ${args.namePartsPath} `
      + '(each verified to recompose to the pinned display name).',
    );
  }

  const devWriteAuthorized = args.apply && args.target === 'dev';
  const cfg = resolveTarget(args.target, args.devImportRole, devWriteAuthorized);
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

    // --apply: afldb_test (unchanged idempotent behaviour) or, when devWriteAuthorized, the
    // gated afldb_dev first-apply (cfg.canApply enforced by parseArgs + resolveTarget already).
    if (devWriteAuthorized) {
      // Backup SHA is an operator acknowledgement only — never proof — and only its shortened
      // form is ever printed (Task 2/Task 6: no credential or full-length secret-shaped value
      // in normal console output).
      console.log(`DEV backup acknowledgement: sha256=${args.backupSha256!.slice(0, 12)}… (operator-verified, not proven by this runner).`);
    }

    const [{ count: beforeCountRaw }] = await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM players`;
    const beforePlayerCount = Number(beforeCountRaw);
    if (devWriteAuthorized) {
      console.log(`Before player count: ${beforePlayerCount}`);
    }

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

      if (devWriteAuthorized) {
        // Task 3: the deliberate DEV first-apply gate for this batch. Re-classification inside
        // THIS transaction must come back exactly this shape or the whole batch refuses and
        // rolls back — a general "no conflicts" check (as above, shared with --target test) is
        // not sufficient for DEV: any drift in CREATE/ALREADY_SATISFIED counts since the
        // read-only preflight means live state has moved and this exact batch is no longer safe
        // to apply blind.
        const createCount = classification.filter((c) => c.kind === 'CREATE').length;
        const satisfiedCount = classification.filter((c) => c.kind === 'ALREADY_SATISFIED').length;
        if (
          createCount !== EXPECTED_ROW_COUNT
          || satisfiedCount !== 0
          || classification.length !== EXPECTED_ROW_COUNT
        ) {
          throw new Error(
            `REFUSED: DEV apply requires exactly CREATE=${EXPECTED_ROW_COUNT}, ALREADY_SATISFIED=0, `
            + `CONFLICT=0 (observed CREATE=${createCount}, ALREADY_SATISFIED=${satisfiedCount}, `
            + `CONFLICT=${conflicts.length}, TOTAL=${classification.length}); state has drifted `
            + 'since the read-only DEV preflight. Nothing has been written.',
          );
        }
      }

      const created: { profilePath: string; playerId: number }[] = [];
      // See runDevPostWriteChecks: incremented only after attach.ok, which is only reachable
      // once attachAflTablesIdentityInTransaction's recordDataEdit() INSERT has itself
      // succeeded (a failed INSERT throws before ok:true is returned) — this is
      // transaction-local proof of the data_edits write, standing in for a SELECT afldb_import
      // is not granted (AFLDB-ISSUE-224 S9).
      let confirmedAuditWrites = 0;
      for (const c of classification) {
        if (c.kind !== 'CREATE') continue;
        const input: CreatePlayerInput = {
          displayName: c.target.displayName,
          // Explicit, always — never left undefined, which is what arms
          // createPlayerInTransaction's last-token split (see the header).
          givenName: c.target.givenName,
          surname: c.target.surname,
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
        confirmedAuditWrites += 1;
        created.push({ profilePath: c.target.profilePath, playerId: player.id });
      }

      const satisfied = classification.filter((c) => c.kind === 'ALREADY_SATISFIED').length;
      if (!devWriteAuthorized) {
        return { created, satisfied, integrityResults: [] as string[] };
      }

      // Task 5: postconditions, still inside the transaction, before commit. Any failure throws
      // and rolls back all 92 writes.
      const integrityResults = await runDevPostWriteChecks(
        tx, targets, created, beforePlayerCount, confirmedAuditWrites,
      );
      return { created, satisfied, integrityResults };
    });

    console.log('');
    console.log(
      `APPLY complete against '${row.database}': ${outcome.created.length} player(s) created and `
      + `attached, ${outcome.satisfied} already satisfied, 0 conflicts.`,
    );
    for (const c of outcome.created) {
      console.log(`  player_id=${c.playerId}  ${c.profilePath}`);
    }
    if (devWriteAuthorized) {
      console.log('');
      console.log('Post-write integrity checks (before commit):');
      for (const r of outcome.integrityResults) {
        console.log(`  ${r}`);
      }
      console.log('Transaction committed = yes');
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

// Guarded so `parseArgs`/`resolveTarget` can be imported and exercised by DB-free tests without
// `main()` running against the real CLI argv/environment/filesystem (it would otherwise execute
// unconditionally on import, since this module doubles as a runnable script).
const isMainModule = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  main().catch((error: unknown) => {
    console.error('');
    console.error(`REFUSED: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
