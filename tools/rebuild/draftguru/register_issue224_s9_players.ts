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
 * before. `resolveTarget()` recognises exactly `test` -> afldb_test and `dev` -> afldb_dev, and
 * refuses a DSN whose path is not exactly that database name (and, belt-and-braces, anything
 * that looks like a prod name); it is never called with `prod` from `main()`.
 *
 * PROD (AFLDB-ISSUE-251)
 * -----------------------
 * PROD is a SEPARATE, more strongly guarded mode, not a third value bolted onto the DEV gate:
 * `resolveProdTarget()`/`resolveProdAuthTarget()` are distinct functions from `resolveTarget()`,
 * never call `assertNotProdLike()` (this connection is deliberately PROD), and open two
 * PROD-only DSNs that exist for no other target: `AFLDB_PROD_IMPORT_DATABASE_URL` (`afldb_import`,
 * the write transaction) and `AFLDB_PROD_AUTH_DATABASE_URL` (`afldb_auth`, a brief read-only
 * connection used ONLY for an early, informational preflight of the selected attribution actor —
 * `afldb_import` holds no general `SELECT` on `auth_users`, so this preflight cannot itself be the
 * authoritative check; see the next paragraph for how the actor is actually re-verified inside the
 * write transaction).
 *
 * `--target prod` always requires `--prod-import-role` (there is no reduced-privilege PROD
 * connection in this tool). `--target prod --apply` additionally requires ALL of
 * `--allow-prod-write`, `--backup-sha256 <64-hex>`, `--expected-host <hostname>` and
 * `--expected-revision <40-hex git sha>` — checked, together with the running host and checkout
 * revision, BEFORE any PROD database connection is opened (`assertProdBoundary`: the running host
 * must be the pinned `PROD_HOSTNAME` literal AND `--expected-host` must independently name that
 * same literal — an operator cannot satisfy this by pointing both at some other machine's own
 * hostname). Immediately after `assertProdBoundary`, still before any PROD connection opens,
 * `assertProdCheckoutIntegrity` closes a review finding against `--expected-revision` alone: it
 * proves zero tracked drift against HEAD (`git diff HEAD --quiet --exit-code --`, covering
 * unstaged/staged modifications and deletions/renames of tracked paths) and that every untracked
 * file matches exactly `docs/rebuild-manifests/afltables_fitzroy_core/settle-*.json` — the
 * operational settle manifests a real PROD checkout legitimately carries untracked — refusing on
 * anything else untracked, on any git invocation failure, and when the checkout is not proven to
 * be the repository containing the running tool itself. `--name-parts` is refused outright for
 * `--target prod`: PROD always loads and
 * hash-pins the SAME tracked `docs/rebuild-manifests/draftguru/issue224-s9-name-parts-20260922.json`
 * artefact DEV/test may optionally override; no alternate file is ever accepted. The selected
 * `--admin-user-id` must name a real, enabled, fully-enrolled `super_admin`
 * (`isViableSuperAdmin`, `src/lib/auth/admin-lifecycle.ts`) checked twice: once as an
 * informational preflight (`assertViableProdActor`, against a brief pre-transaction
 * `AFLDB_PROD_AUTH_DATABASE_URL` read) and, authoritatively, again inside the write transaction
 * itself as its first act (`assertViableActorInTransaction`, calling migration 105's
 * `SECURITY DEFINER public.assert_viable_super_admin_actor()`, which also refuses a reserved
 * fixture/example email domain and holds a `FOR SHARE` row lock on the actor until that same
 * transaction commits) — this alone excludes every fixture/recovery actor this codebase creates,
 * which is always disabled with no password/TOTP (`insertAttributionOnlyActor`,
 * `tools/migration/rebuild_manual_registrations.ts`). PROD's first-adoption apply requires the
 * exact classification shape CREATE=92/ALREADY_SATISFIED=0/CONFLICT=0
 * (`assertExactFirstApplyShape`, shared with DEV) and, before COMMIT, both the shared
 * `runDevPostWriteChecks` battery (now target-independent — DEV and PROD both run it) AND a
 * PROD-only proof that adoption created no `afl_api` identity (`assertNoAflApiIdentityWritten`).
 * The write itself is `runProdAdoptionWrite`, exported so an isolated rehearsal against a
 * disposable database (never the retained PROD candidate, never `afldb_prod`) can exercise the
 * exact same mutation code without going through `resolveProdTarget()`'s hard `afldb_prod` name
 * check — see `tools/rebuild/draftguru/issue251_prod_rehearsal.ts`.
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
 *     --admin-user-id <n> [--target test|dev|prod] [--dev-import-role] [--apply] \
 *     [--allow-dev-write] [--backup-sha256 <64-hex>] [--name-parts <path>] \
 *     [--prod-import-role] [--allow-prod-write] [--expected-host <hostname>] \
 *     [--expected-revision <40-hex-git-sha>]
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

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

import { attachAflTablesIdentityInTransaction } from '@/db/queries/admin-draft';
import { createPlayerInTransaction, type CreatePlayerInput } from '@/db/queries/players';
import {
  isActive, isLifecycleRole, isViableSuperAdmin, type LifecycleAccountState,
} from '@/lib/auth/admin-lifecycle';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');

const DEFAULT_TARGET_SET_PATH = join(
  REPO_ROOT, 'docs', 'rebuild-manifests', 'draftguru', 'issue224-s9-target-set-20260922.json',
);
const DEFAULT_DECISION_PATH = join(
  REPO_ROOT, 'docs', 'rebuild-manifests', 'draftguru', 'issue224-d7-registration-decision-20260922.json',
);
/**
 * PROD's ONLY accepted `--name-parts` source (AFLDB-ISSUE-251 D-251-5). PROD never takes a
 * `--name-parts` CLI argument (`parseArgs` refuses it outright for `--target prod`); this tracked
 * path and its pinned hash are the sole input `loadPinnedProdNameParts` will ever read.
 */
const PROD_NAME_PARTS_PATH = join(
  REPO_ROOT, 'docs', 'rebuild-manifests', 'draftguru', 'issue224-s9-name-parts-20260922.json',
);

// Pinned by the operator brief (ISSUE-224 D-7/D-8, 2026-09-22). A byte change in either
// retained artefact refuses this tool before any database connection is opened.
const PINNED_TARGET_SET_SHA256 =
  'e087baf706effdda8034a37cc184311687dee3c49f3e3e23a1e746beb347dcb0';
const PINNED_DECISION_SHA256 =
  'a795c987ca62cf879cb2ecc3bb61d9e1533eae84882956c442ff252de307be3d';
/**
 * Pinned by AFLDB-ISSUE-251 (D-251-5), calculated from the currently tracked
 * `issue224-s9-name-parts-20260922.json` (`sha256sum` of the file as tracked at implementation
 * time). A byte change refuses PROD mode before any database connection is opened; it never
 * affects test/DEV, which may still pass an arbitrary `--name-parts` file.
 */
const PINNED_PROD_NAME_PARTS_SHA256 =
  'f93d19b1e8cd7cb63917178f9576b5fc4a382b8acaed316d53305ff555db9f41';

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

/**
 * AFLDB-ISSUE-251 D-251-5. PROD's only accepted name-parts source: the SAME tracked artefact
 * DEV/test may optionally pass by path, but here read from a fixed path and hash-pinned. There is
 * no `path` parameter — an alternate file is not a shape this function can express, by design.
 */
export function loadPinnedProdNameParts(): Map<string, NameParts & { displayName: string }> {
  const bytes = readFileSync(PROD_NAME_PARTS_PATH);
  const observed = sha256(bytes);
  if (observed !== PINNED_PROD_NAME_PARTS_SHA256) {
    throw new Error(
      `PROD name-parts sha256 mismatch (observed ${observed}, expected `
      + `${PINNED_PROD_NAME_PARTS_SHA256}); the tracked artefact has changed since it was approved `
      + 'for PROD adoption. Nothing has been read as authoritative.',
    );
  }
  return loadNameParts(PROD_NAME_PARTS_PATH);
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

export type Classification =
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

/**
 * The deliberate first-apply gate (Task 3 for DEV; AFLDB-ISSUE-251 §7 for PROD): re-classification
 * inside the write transaction must come back exactly CREATE=92/ALREADY_SATISFIED=0/CONFLICT=0 or
 * the whole batch refuses and rolls back. A plain "no CONFLICT" check is not sufficient for a
 * first-adoption apply — any ALREADY_SATISFIED means live state has moved since the read-only
 * preflight (or this is a retry that is not automatically accepted; ISSUE-251 §10 prefers refusal
 * over heuristic recovery) and this exact batch is no longer safe to apply blind. Shared so DEV and
 * PROD cannot drift onto two different first-apply shapes.
 */
export function assertExactFirstApplyShape(classification: Classification[], label: string): void {
  const createCount = classification.filter((c) => c.kind === 'CREATE').length;
  const satisfiedCount = classification.filter((c) => c.kind === 'ALREADY_SATISFIED').length;
  const conflictCount = classification.filter((c) => c.kind === 'CONFLICT').length;
  if (createCount !== EXPECTED_ROW_COUNT || satisfiedCount !== 0 || classification.length !== EXPECTED_ROW_COUNT) {
    throw new Error(
      `REFUSED: ${label} apply requires exactly CREATE=${EXPECTED_ROW_COUNT}, ALREADY_SATISFIED=0, `
      + `CONFLICT=0 (observed CREATE=${createCount}, ALREADY_SATISFIED=${satisfiedCount}, `
      + `CONFLICT=${conflictCount}, TOTAL=${classification.length}); state has drifted since the `
      + 'read-only preflight, or this is a retry that is not automatically accepted. Nothing has '
      + 'been written.',
    );
  }
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

export type TargetName = 'test' | 'dev' | 'prod';

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
// PROD target resolution (AFLDB-ISSUE-251) — deliberately separate from
// resolveTarget()/assertNotProdLike() above, not a third branch bolted onto it.
// Two distinct PROD-only DSNs exist for no other target: the write role
// (AFLDB_PROD_IMPORT_DATABASE_URL, afldb_import) and a brief read-only
// attribution-actor check (AFLDB_PROD_AUTH_DATABASE_URL, afldb_auth — the only
// role in this codebase granted SELECT on auth_users; see migration 023).
// ---------------------------------------------------------------------------

/** The write connection. Never routes through resolveTarget/assertNotProdLike: this IS prod. */
export function resolveProdTarget(writeAuthorized: boolean): TargetConfig {
  const dsn = process.env.AFLDB_PROD_IMPORT_DATABASE_URL;
  if (!dsn) throw new Error('AFLDB_PROD_IMPORT_DATABASE_URL is not set.');
  const path = new URL(dsn).pathname.replace(/^\//, '');
  if (path !== 'afldb_prod') {
    throw new Error(`AFLDB_PROD_IMPORT_DATABASE_URL does not target /afldb_prod (observed /${path}).`);
  }
  return writeAuthorized
    ? { dsn, requiredDatabase: 'afldb_prod', requiredUser: 'afldb_import', readOnly: false, canApply: true }
    : { dsn, requiredDatabase: 'afldb_prod', requiredUser: 'afldb_import', readOnly: true, canApply: false };
}

export type ProdAuthTargetConfig = { dsn: string; requiredDatabase: string; requiredUser: string };

/**
 * The brief, INFORMATIONAL pre-write attribution-actor read (AFLDB-ISSUE-251 finding).
 * `afldb_import` (the write role above) holds no general SELECT on `auth_users` (migration 023
 * grants that table only to `afldb_auth`), so this connection exists only to give an operator a
 * fast, friendly refusal for an obviously-wrong actor before any write connection is even opened.
 * It is NOT how the actor is authoritatively verified: the write transaction itself re-reads and
 * re-asserts the SAME actor id as its first act, via `assertViableActorInTransaction`, which calls
 * migration 105's `SECURITY DEFINER public.assert_viable_super_admin_actor()` — a function
 * `afldb_import` IS granted `EXECUTE` on, without ever being granted `SELECT` on `auth_users`
 * itself. That in-transaction call is what row-locks the actor (`FOR SHARE`) for the remaining
 * lifetime of the write transaction, so this preflight's result is discarded rather than passed
 * to the write (`runProdAdoptionWrite` takes only `adminUserId`, never a pre-fetched row).
 */
export function resolveProdAuthTarget(): ProdAuthTargetConfig {
  const dsn = process.env.AFLDB_PROD_AUTH_DATABASE_URL;
  if (!dsn) throw new Error('AFLDB_PROD_AUTH_DATABASE_URL is not set.');
  const path = new URL(dsn).pathname.replace(/^\//, '');
  if (path !== 'afldb_prod') {
    throw new Error(`AFLDB_PROD_AUTH_DATABASE_URL does not target /afldb_prod (observed /${path}).`);
  }
  return { dsn, requiredDatabase: 'afldb_prod', requiredUser: 'afldb_auth' };
}

/** Exactly 40 lowercase hex characters: a git commit SHA-1 as `git rev-parse HEAD` prints it. */
export const PROD_REVISION_RE = /^[0-9a-f]{40}$/;

/**
 * The repository/operator-defined PROD hostname (AFLDB-ISSUE-251 finding). Hard-pinned rather
 * than merely compared against whatever `--expected-host` says: `actual.host === args.expectedHost`
 * alone would let an operator running this tool on ANY other machine supply that same machine's
 * own hostname as `--expected-host` and pass, since the two sides of that comparison can be set by
 * the same person in the same command. Pinning one side to a literal closes that: a non-PROD
 * machine is refused regardless of what `--expected-host` claims, and `--expected-host` itself must
 * separately equal the same literal, so the two facts an operator could otherwise conflate are
 * checked against a shared, unmovable reference rather than against each other.
 */
export const PROD_HOSTNAME = 'afldb-prod';

/**
 * Runs `git <args>` with `cwd` fixed to `repoRoot` (never the inherited process CWD) via a direct
 * process invocation — an argv array, no shell, nothing interpolated into a command string
 * (AFLDB-ISSUE-251 checkout-integrity finding). Fails closed: any non-zero exit or spawn failure
 * (git missing, not a git repository, etc.) throws rather than returning a partial/empty result.
 */
function runGit(args: readonly string[], repoRoot: string): Buffer {
  const result = spawnSync('git', args, { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] });
  if (result.error || result.status !== 0 || result.stdout === null) {
    throw new Error(
      `REFUSED: 'git ${args.join(' ')}' failed (status=${String(result.status)}). Nothing has `
      + 'been written.',
    );
  }
  return result.stdout;
}

function gitRevision(repoRoot: string): string {
  return runGit(['rev-parse', 'HEAD'], repoRoot).toString('utf8').trim();
}

/**
 * The PROD boundary checks that need no database connection (AFLDB-ISSUE-251 §6): the running
 * host must be the exact PROD host, the operator's `--expected-host` must independently name that
 * same exact PROD host, and the checked-out revision must equal exactly what the operator
 * supplied. Deliberately DB-free and run BEFORE any PROD connection opens. `actual` is injectable
 * so DB-free tests never depend on the real machine's hostname or this exact checkout's revision.
 */
export function assertProdBoundary(
  args: Pick<Args, 'expectedHost' | 'expectedRevision'>,
  actual: { host: string; revision: string } = { host: hostname(), revision: gitRevision(REPO_ROOT) },
): void {
  if (actual.host !== PROD_HOSTNAME) {
    throw new Error(
      `REFUSED: running host '${actual.host}' is not the production host '${PROD_HOSTNAME}'. A `
      + 'user-supplied --expected-host can never make a non-production host sufficient. Nothing '
      + 'has been written.',
    );
  }
  if (args.expectedHost !== PROD_HOSTNAME) {
    throw new Error(
      `REFUSED: --expected-host '${String(args.expectedHost)}' does not equal the production host `
      + `'${PROD_HOSTNAME}'. Nothing has been written.`,
    );
  }
  if (actual.revision !== args.expectedRevision) {
    throw new Error(
      `REFUSED: checkout revision '${actual.revision}' does not match --expected-revision `
      + `'${String(args.expectedRevision)}'. Nothing has been written.`,
    );
  }
}

/**
 * The exact untracked-path family a PROD apply tolerates without treating the checkout as dirty
 * (AFLDB-ISSUE-251 checkout-integrity finding): the operational settle manifests a real PROD
 * checkout legitimately, deliberately leaves untracked. Narrow by construction — exactly this
 * directory, a `settle-` prefix, a `.json` suffix, no further path segments — so nothing else
 * under `docs/` (another JSON file, a script, a source file, an alternate manifest directory, a
 * temporary or generated file, arbitrary evidence) can slip through as "an established exception".
 */
export const PROD_ALLOWED_UNTRACKED_RE =
  /^docs\/rebuild-manifests\/afltables_fitzroy_core\/settle-[^/]+\.json$/;

/**
 * The raw git facts the checkout-integrity boundary judges. Injectable so DB-free tests never
 * depend on this session's own (currently dirty) ISSUE-251 development worktree — see
 * `judgeCheckoutIntegrity` (the pure judgment) vs `gatherCheckoutIntegrityFacts` (the real git
 * invocations that produce this shape).
 */
export type CheckoutIntegrityFacts = {
  /**
   * True iff `git rev-parse --show-toplevel`, invoked with `cwd` fixed to the running tool's own
   * `REPO_ROOT` (never the inherited process CWD), succeeded AND its answer resolves (via
   * `realpathSync`, so symlinks/case/short-path differences never cause a false mismatch) to that
   * same `REPO_ROOT` — i.e. this check is proven to run against the repository containing the tool
   * that is running it, not whatever repository a stray inherited CWD happened to point at.
   */
  isOwnRepoToplevel: boolean;
  /**
   * True iff `git diff HEAD --quiet --exit-code --` reports zero differences. A diff against a
   * commit (rather than against the index) covers unstaged modifications, staged modifications,
   * deletions, and additions/renames of tracked paths in one single comparison against HEAD.
   */
  hasNoTrackedDrift: boolean;
  /**
   * Repo-root-relative, forward-slash untracked paths from
   * `git ls-files --others --exclude-standard -z`, parsed as NUL-delimited data — never
   * whitespace-split, so a path containing a space or other unusual character is never misparsed.
   */
  untrackedPaths: string[];
};

/**
 * The pure checkout-integrity judgment (AFLDB-ISSUE-251 finding): `--expected-revision` alone
 * pins HEAD but proves nothing about tracked drift or unexpected untracked files, so a PROD
 * `--apply` could previously execute against a checkout that merely happened to share HEAD's
 * commit hash while carrying uncommitted local changes. Takes no git action itself — every branch
 * here is exercised by DB-free tests against hand-built facts, never this (or any) real worktree's
 * actual state. Does not repeat `assertProdBoundary`'s host/revision checks; it runs immediately
 * after that check and assumes it already passed.
 */
export function judgeCheckoutIntegrity(facts: CheckoutIntegrityFacts): void {
  if (!facts.isOwnRepoToplevel) {
    throw new Error(
      "REFUSED: this checkout's git toplevel does not resolve to the directory containing the "
      + 'running tool itself (or this is not a git repository at all). Nothing has been written.',
    );
  }
  if (!facts.hasNoTrackedDrift) {
    throw new Error(
      'REFUSED: tracked working-tree drift detected relative to HEAD (an unstaged modification, a '
      + 'staged modification, a deletion, or an addition/rename of a tracked path). A PROD apply '
      + 'requires an exact, unmodified checkout of --expected-revision. Nothing has been written.',
    );
  }
  const unexpected = facts.untrackedPaths.filter((p) => !PROD_ALLOWED_UNTRACKED_RE.test(p));
  if (unexpected.length > 0) {
    throw new Error(
      'REFUSED: unexpected untracked file(s) present in the checkout: '
      + `${unexpected.join(', ')}. The only untracked paths a PROD apply permits are the `
      + 'operational settle manifests matching exactly '
      + 'docs/rebuild-manifests/afltables_fitzroy_core/settle-*.json. Nothing has been written.',
    );
  }
}

function normalizeRealpathForComparison(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? trimmed.toLowerCase() : trimmed;
}

/**
 * Gathers the real git facts `judgeCheckoutIntegrity` judges, entirely via direct `git` process
 * invocation (`runGit`: argv arrays, no shell, nothing interpolated into a command string) with
 * `cwd` always fixed to `repoRoot`. Any git invocation failure (not a git repository, git missing,
 * an unexpected exit status) throws, which is fail-closed: the caller never receives a
 * "successful" but meaningless facts object.
 */
export function gatherCheckoutIntegrityFacts(repoRoot: string): CheckoutIntegrityFacts {
  const toplevel = runGit(['rev-parse', '--show-toplevel'], repoRoot).toString('utf8').trim();
  const isOwnRepoToplevel = normalizeRealpathForComparison(realpathSync.native(toplevel))
    === normalizeRealpathForComparison(realpathSync.native(repoRoot));

  const diffResult = spawnSync('git', ['diff', 'HEAD', '--quiet', '--exit-code', '--'], {
    cwd: repoRoot, stdio: ['ignore', 'ignore', 'ignore'],
  });
  if (diffResult.error || (diffResult.status !== 0 && diffResult.status !== 1)) {
    throw new Error(
      "REFUSED: 'git diff HEAD --quiet --exit-code --' failed "
      + `(status=${String(diffResult.status)}). Nothing has been written.`,
    );
  }
  const hasNoTrackedDrift = diffResult.status === 0;

  const lsFilesOut = runGit(['ls-files', '--others', '--exclude-standard', '-z'], repoRoot);
  const untrackedPaths = lsFilesOut.toString('utf8').split('\0').filter((p) => p.length > 0);

  return { isOwnRepoToplevel, hasNoTrackedDrift, untrackedPaths };
}

/**
 * The full checkout-integrity boundary (AFLDB-ISSUE-251 finding). DB-free, and run in `runProdMain`
 * immediately after `assertProdBoundary`, BEFORE any PROD database connection opens. `repoRoot`
 * defaults to this file's own `REPO_ROOT` so the real PROD CLI path never has to supply it;
 * `facts` defaults to the real `gatherCheckoutIntegrityFacts(repoRoot)` — both are overridable so
 * tests can inject hand-built facts instead of depending on this (or any) real worktree.
 */
export function assertProdCheckoutIntegrity(
  repoRoot: string = REPO_ROOT,
  facts: CheckoutIntegrityFacts = gatherCheckoutIntegrityFacts(repoRoot),
): void {
  judgeCheckoutIntegrity(facts);
}

/** The attribution-actor row read from `AFLDB_PROD_AUTH_DATABASE_URL`. Never carries a secret. */
export type ProdActorRow = {
  id: number; role: string; isActive: boolean; hasPassword: boolean; hasTotp: boolean;
};

/**
 * The read-only, pre-transaction eligibility check against `isViableSuperAdmin`
 * (`src/lib/auth/admin-lifecycle.ts`) — enabled, `super_admin`, both credentials enrolled. This
 * alone excludes every fixture/recovery actor this codebase creates (`insertAttributionOnlyActor`,
 * `tools/migration/rebuild_manual_registrations.ts`, always disabled with NULL password/TOTP), so
 * there is no separate "is this a recovery actor" check to maintain in parallel.
 *
 * INFORMATIONAL ONLY (AFLDB-ISSUE-251 §6 finding). This runs once against the brief
 * `AFLDB_PROD_AUTH_DATABASE_URL` read, before the write transaction opens, purely so an operator
 * gets a fast, friendly refusal without a write connection ever being made. It is NOT the
 * write-boundary authority and does not by itself satisfy AFLDB-ISSUE-251's requirement that the
 * actor be re-read authoritatively inside the same transaction as the writes: that authority is
 * `assertViableActorInTransaction` below, which calls the `SECURITY DEFINER`
 * `public.assert_viable_super_admin_actor()` (migration 105) as the write transaction's first act.
 * It also does not apply the fixture-domain refusal the database function does, since this JS
 * predicate has no email to inspect — the auth DSN read never selects `email` — the exact
 * asymmetry that made the old approximation insufficient.
 */
export function assertViableProdActor(actor: ProdActorRow | undefined): asserts actor is ProdActorRow {
  if (!actor) {
    throw new Error('REFUSED: --admin-user-id names no auth_users row. Nothing has been written.');
  }
  if (!isLifecycleRole(actor.role)) {
    throw new Error(
      `REFUSED: admin-user-id ${actor.id} carries role '${actor.role}', which is not a recognised `
      + 'lifecycle role. Nothing has been written.',
    );
  }
  const state: LifecycleAccountState = {
    id: actor.id,
    role: actor.role,
    disabledAt: actor.isActive ? null : new Date(0),
    hasPassword: actor.hasPassword,
    hasTotp: actor.hasTotp,
    canManageAdmins: false,
  };
  if (!isViableSuperAdmin(state)) {
    throw new Error(
      `REFUSED: admin-user-id ${actor.id} is not a viable PROD super_admin (role=${actor.role}, `
      + `active=${isActive(state)}, hasPassword=${actor.hasPassword}, hasTotp=${actor.hasTotp}). PROD `
      + 'adoption requires an enabled, fully-enrolled super_admin — never a disabled, unenrolled, '
      + 'lower-privileged, fixture or recovery actor. Nothing has been written.',
    );
  }
}

/**
 * THE write-boundary authority (AFLDB-ISSUE-251 finding). Calls `public.assert_viable_super_admin_actor`
 * (migration 105) — a `SECURITY DEFINER` function owned by `afldb_owner`, granted `EXECUTE` to
 * `afldb_import` alone — inside the caller's OWN transaction, on the same connection that will
 * perform the 92 registration writes. That function re-reads `auth_users` for the given id
 * (`afldb_import` itself has no `SELECT` there; migration 023), applies exactly
 * `isViableSuperAdmin`'s four conditions plus the production fixture-domain refusal, and takes a
 * `FOR SHARE` row lock held until the SAME transaction commits or rolls back — so nothing can
 * disable, demote or un-enrol this actor between this call and the caller's COMMIT. It raises
 * (rejecting this promise) and writes nothing on refusal; the exception message never leaves this
 * function undisturbed, so a caller that does not catch it aborts the whole transaction before any
 * of the 92 rows is written.
 *
 * This must be the very first statement `runProdAdoptionWrite` executes against `tx`, before
 * `classify()` and before any `createPlayerInTransaction`/`attachAflTablesIdentityInTransaction`
 * call — see that function below.
 */
export async function assertViableActorInTransaction(
  tx: postgres.TransactionSql, actorId: number,
): Promise<void> {
  await tx`SELECT public.assert_viable_super_admin_actor(${actorId})`;
}

/**
 * AFLDB-ISSUE-251 §5/§8: adoption must write no `afl_api` external identity. Structurally this
 * code never touches the `afl_api` source at all, but this proves it for the exact 92 newly
 * created players rather than resting on that alone.
 */
export async function assertNoAflApiIdentityWritten(
  tx: postgres.TransactionSql, createdPlayerIds: number[],
): Promise<void> {
  const [{ count }] = await tx<{ count: string }[]>`
    SELECT count(*)::text AS count
      FROM external_identities e
      JOIN sources s ON s.id = e.source_id
     WHERE s.key = 'afl_api' AND e.player_id = ANY(${createdPlayerIds})
  `;
  if (Number(count) !== 0) {
    throw new Error(
      `postcondition failed: ${count} afl_api external_identities row(s) exist for the newly-created `
      + 'PROD players; AFLDB-ISSUE-251 adoption must write no AFL API identity.',
    );
  }
}

/**
 * The PROD write, inside the caller's transaction: the same canonical primitives and the same
 * shared postcondition battery (`runDevPostWriteChecks`) DEV uses, plus PROD's own extra
 * boundary proof. Exported so `issue251_prod_rehearsal.ts` can exercise the EXACT same mutation
 * code against a disposable database, never through `resolveProdTarget()` (which hard-refuses any
 * database name other than `afldb_prod`).
 *
 * The FIRST statement this function runs against `tx` is `assertViableActorInTransaction` —
 * before `classify()`, before any row is written (AFLDB-ISSUE-251 finding). This is what makes the
 * actor assertion authoritative rather than the old approximation (a separate `afldb_auth` read
 * moments before the transaction opened): the `SECURITY DEFINER` function it calls row-locks
 * `auth_users` `FOR SHARE` for the remaining lifetime of THIS transaction, so nothing can disable,
 * demote or un-enrol `params.adminUserId` between this call and this transaction's own COMMIT. No
 * pre-fetched `ProdActorRow` is accepted or trusted here — the only input is the id.
 */
export async function runProdAdoptionWrite(
  tx: postgres.TransactionSql,
  params: { targets: Target[]; adminUserId: number },
): Promise<{ created: { profilePath: string; playerId: number }[]; integrityResults: string[] }> {
  await assertViableActorInTransaction(tx, params.adminUserId);

  const warnings: string[] = [];
  const classification = await classify(tx, params.targets, warnings);
  printReport(classification, 'PROD classification inside the write transaction:', warnings);
  const conflicts = classification.filter((c) => c.kind === 'CONFLICT');
  if (conflicts.length > 0) {
    throw new Error(
      `${conflicts.length} CONFLICT row(s) — refusing to write ANY of the ${params.targets.length} `
      + 'rows. Nothing has been written.',
    );
  }
  assertExactFirstApplyShape(classification, 'PROD');

  const [{ count: beforeCountRaw }] = await tx<{ count: string }[]>`SELECT count(*)::text AS count FROM players`;
  const beforePlayerCount = Number(beforeCountRaw);

  const created: { profilePath: string; playerId: number }[] = [];
  let confirmedAuditWrites = 0;
  for (const c of classification) {
    if (c.kind !== 'CREATE') continue;
    const input: CreatePlayerInput = {
      displayName: c.target.displayName,
      givenName: c.target.givenName,
      surname: c.target.surname,
      notes: NOTE(c.target.aflApiProviderId),
    };
    const player = await createPlayerInTransaction(tx, input, { adminUserId: params.adminUserId });
    const attach = await attachAflTablesIdentityInTransaction(tx, {
      playerId: player.id,
      profilePath: c.target.profilePath,
      adminUserId: params.adminUserId,
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

  const integrityResults = await runDevPostWriteChecks(
    tx, params.targets, created, beforePlayerCount, confirmedAuditWrites,
  );
  await assertNoAflApiIdentityWritten(tx, created.map((c) => c.playerId));
  integrityResults.push(
    `0/${EXPECTED_ROW_COUNT} afl_api external_identities rows created for the newly-created PROD `
    + 'players: OK',
  );
  return { created, integrityResults };
}

// ---------------------------------------------------------------------------
// Shared post-write integrity checks (Task 5) — run inside the write transaction,
// after all 92 writes and BEFORE commit. Any failure throws, which rolls the
// whole transaction (all 92 rows) back. Not run for --target test: the exact
// numeric shape here (EXPECTED_ROW_COUNT, not "however many CREATEd") is the
// deliberate first-apply gate for this batch (DEV and, per AFLDB-ISSUE-251, PROD),
// not a general-purpose check.
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
  /** Optional operator-authored authoritative name divisions; see `loadNameParts`. Always null
   *  for --target prod (refused by parseArgs; see loadPinnedProdNameParts). */
  namePartsPath: string | null;
  /** AFLDB-ISSUE-251 PROD-only flags. All null/false for --target test|dev. */
  prodImportRole: boolean;
  allowProdWrite: boolean;
  expectedHost: string | null;
  expectedRevision: string | null;
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
  let prodImportRole = false;
  let allowProdWrite = false;
  let expectedHost: string | null = null;
  let expectedRevision: string | null = null;

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
    if (arg === '--prod-import-role') { prodImportRole = true; continue; }
    if (arg === '--allow-prod-write') { allowProdWrite = true; continue; }
    if (arg === '--expected-host') { expectedHost = argv[++i] ?? null; continue; }
    if (arg === '--expected-revision') { expectedRevision = argv[++i] ?? null; continue; }
    throw new Error(`unrecognised argument: ${arg}`);
  }

  if (target !== 'test' && target !== 'dev' && target !== 'prod') {
    throw new Error(`--target must be 'test', 'dev' or 'prod', got '${String(target)}'.`);
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
  // --allow-dev-write is a DEV-apply-only concept: invalid/irrelevant for --target test, which
  // keeps its existing unconditional-apply behaviour untouched.
  if (allowDevWrite && target !== 'dev') {
    throw new Error("REFUSED: --allow-dev-write is only valid with --target dev.");
  }
  // --backup-sha256 is a DEV/PROD-apply-only concept: invalid/irrelevant for --target test.
  if (backupSha256 !== null && target !== 'dev' && target !== 'prod') {
    throw new Error("REFUSED: --backup-sha256 is only valid with --target dev or --target prod.");
  }
  if (prodImportRole && target !== 'prod') {
    throw new Error("REFUSED: --prod-import-role is only valid with --target prod.");
  }
  if (allowProdWrite && target !== 'prod') {
    throw new Error("REFUSED: --allow-prod-write is only valid with --target prod.");
  }
  if (expectedHost !== null && target !== 'prod') {
    throw new Error("REFUSED: --expected-host is only valid with --target prod.");
  }
  if (expectedRevision !== null && target !== 'prod') {
    throw new Error("REFUSED: --expected-revision is only valid with --target prod.");
  }
  // AFLDB-ISSUE-251 D-251-5: PROD never accepts an operator-authored name-parts override. It
  // always loads and hash-pins the one tracked artefact via loadPinnedProdNameParts.
  if (namePartsPath !== null && target === 'prod') {
    throw new Error(
      'REFUSED: --name-parts is not accepted for --target prod. PROD always uses the pinned '
      + 'tracked issue224-s9-name-parts-20260922.json artefact; no alternate file is ever accepted.',
    );
  }

  // The explicit DEV write authorisation gate (ISSUE-224 S9 unblock). ALL FOUR of
  // --target dev, --dev-import-role, --apply and --allow-dev-write, plus a well-formed
  // --backup-sha256, are required before a DEV --apply is permitted past this point. Every
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

  // AFLDB-ISSUE-251: --target prod always requires --prod-import-role. There is no
  // reduced-privilege PROD connection in this tool (unlike DEV's ordinary afldb_app path), so a
  // PROD read-only preflight and a PROD --apply both require it.
  if (target === 'prod' && !prodImportRole) {
    throw new Error(
      'REFUSED: --target prod requires --prod-import-role (no ordinary, reduced-privilege PROD '
      + 'connection exists in this tool).',
    );
  }

  // The explicit PROD write authorisation gate (AFLDB-ISSUE-251 §6). ALL of --allow-prod-write,
  // --backup-sha256, --expected-host and --expected-revision are required before a PROD --apply
  // is permitted past this point, checked here before any database connection is opened.
  if (apply && target === 'prod') {
    if (!allowProdWrite) {
      throw new Error(
        'REFUSED: --target prod --apply requires --allow-prod-write (the explicit, issue-specific '
        + 'PROD write authorisation). PROD runs read-only preflight only without it.',
      );
    }
    if (backupSha256 === null) {
      throw new Error(
        'REFUSED: --target prod --apply requires --backup-sha256 <64-hex> — the operator\'s '
        + 'acknowledgement that a fresh, verified pre-write PROD backup exists. This runner cannot '
        + 'itself prove the backup exists; the hash is an acknowledgement, not proof.',
      );
    }
    if (!BACKUP_SHA256_RE.test(backupSha256)) {
      throw new Error(
        'REFUSED: --backup-sha256 must be exactly 64 hexadecimal characters (observed a '
        + 'malformed value); refusing before any database connection is opened.',
      );
    }
    if (expectedHost === null || expectedHost.trim() === '') {
      throw new Error(
        'REFUSED: --target prod --apply requires --expected-host <hostname> — the exact PROD host '
        + 'the operator expects this to run on. Nothing has been written.',
      );
    }
    if (expectedRevision === null) {
      throw new Error(
        'REFUSED: --target prod --apply requires --expected-revision <40-hex-git-sha> — the exact '
        + 'checkout revision the operator approved. Nothing has been written.',
      );
    }
    if (!PROD_REVISION_RE.test(expectedRevision)) {
      throw new Error(
        'REFUSED: --expected-revision must be exactly 40 hexadecimal characters (a git commit '
        + 'SHA-1, lower-case as git prints it); refusing before any database connection is opened.',
      );
    }
  }

  return {
    target, apply, devImportRole, allowDevWrite, backupSha256, adminUserId, targetSetPath,
    decisionPath, namePartsPath, prodImportRole, allowProdWrite, expectedHost, expectedRevision,
  };
}

// ---------------------------------------------------------------------------
// PROD main (AFLDB-ISSUE-251) — a separate function, not a branch threaded
// through the test/dev body below: PROD's boundary checks, its two DSNs and
// its write path (runProdAdoptionWrite) are all distinct from test/dev.
// ---------------------------------------------------------------------------

async function runProdMain(args: Args, targets: Target[]): Promise<void> {
  const prodWriteAuthorized = args.apply;
  if (prodWriteAuthorized) {
    // DB-free, before any PROD connection opens (AFLDB-ISSUE-251 §6).
    assertProdBoundary(args);
    // DB-free, before any PROD connection opens (AFLDB-ISSUE-251 checkout-integrity finding):
    // --expected-revision alone pins HEAD but proves nothing about local tracked drift or
    // unexpected untracked files. Runs immediately after assertProdBoundary, still before
    // resolveProdTarget() below opens the writable PROD connection.
    assertProdCheckoutIntegrity();
  }
  const cfg = resolveProdTarget(prodWriteAuthorized);
  const sql = postgres(cfg.dsn, {
    max: 1,
    onnotice: () => {},
    connection: cfg.readOnly
      ? { application_name: 'afldb-issue251-prod-register', default_transaction_read_only: true, TimeZone: 'UTC' }
      : { application_name: 'afldb-issue251-prod-register', TimeZone: 'UTC' },
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
      throw new Error('REFUSED: the PROD connection is not proven read-only.');
    }
    console.log(
      `Connected: current_database()='${row.database}', current_user='${row.currentUser}' `
      + `(--target prod --prod-import-role), mode=${args.apply ? 'APPLY' : 'READ-ONLY PREFLIGHT'}.`,
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

    console.log(
      `Expected host/revision confirmed. PROD backup acknowledgement: `
      + `sha256=${args.backupSha256!.slice(0, 12)}… (operator-verified, not proven by this runner).`,
    );

    // INFORMATIONAL preflight only (AFLDB-ISSUE-251 finding): a brief, separate afldb_auth
    // connection, opened and closed BEFORE the write transaction, purely so an operator gets a
    // fast, friendly refusal for an obviously-wrong actor without a write connection ever being
    // made. It is NOT the write-boundary authority and its result is not passed to the write: the
    // authoritative, in-transaction re-assertion happens inside `runProdAdoptionWrite` itself, as
    // that transaction's first act, via `assertViableActorInTransaction` (migration 105's
    // `SECURITY DEFINER` function). See `resolveProdAuthTarget`'s and `assertViableProdActor`'s doc
    // comments for why this preflight cannot by itself satisfy that requirement.
    const authCfg = resolveProdAuthTarget();
    const authSql = postgres(authCfg.dsn, {
      max: 1,
      onnotice: () => {},
      connection: { application_name: 'afldb-issue251-prod-actor-check', default_transaction_read_only: true, TimeZone: 'UTC' },
    });
    try {
      const [authRow] = await authSql<{ database: string; currentUser: string }[]>`
        SELECT current_database() AS "database", current_user AS "currentUser"
      `;
      if (authRow.database !== authCfg.requiredDatabase) {
        throw new Error(`REFUSED: PROD actor-check connection database is '${authRow.database}', expected '${authCfg.requiredDatabase}'.`);
      }
      if (authRow.currentUser !== authCfg.requiredUser) {
        throw new Error(`REFUSED: PROD actor-check connection user is '${authRow.currentUser}', expected '${authCfg.requiredUser}'.`);
      }
      const [fetched] = await authSql<ProdActorRow[]>`
        SELECT id, role,
               (disabled_at IS NULL) AS "isActive",
               (password_hash IS NOT NULL) AS "hasPassword",
               (totp_secret IS NOT NULL) AS "hasTotp"
          FROM auth_users WHERE id = ${args.adminUserId}
      `;
      assertViableProdActor(fetched);
      console.log(`PROD attribution actor preflight OK: admin_user_id=${fetched.id}, role=${fetched.role}.`);
    } finally {
      await authSql.end({ timeout: 5 });
    }

    const outcome = await sql.begin(async (tx) => runProdAdoptionWrite(tx, {
      targets, adminUserId: args.adminUserId,
    }));

    console.log('');
    console.log(
      `APPLY complete against '${row.database}': ${outcome.created.length} player(s) created and `
      + 'attached, 0 already satisfied, 0 conflicts.',
    );
    for (const c of outcome.created) {
      console.log(`  player_id=${c.playerId}  ${c.profilePath}`);
    }
    console.log('');
    console.log('Post-write integrity checks (before commit):');
    for (const r of outcome.integrityResults) {
      console.log(`  ${r}`);
    }
    console.log('Transaction committed = yes');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const nameParts: Map<string, NameParts & { displayName: string }> = args.target === 'prod'
    ? loadPinnedProdNameParts()
    : (args.namePartsPath === null ? new Map() : loadNameParts(args.namePartsPath));
  const targets = loadAndValidateArtefacts(args.targetSetPath, args.decisionPath, nameParts);
  console.log(
    `Loaded ${targets.length} REGISTER target(s) from pinned artefacts `
    + `(target-set sha256=${PINNED_TARGET_SET_SHA256.slice(0, 12)}…, `
    + `D-7 sha256=${PINNED_DECISION_SHA256.slice(0, 12)}…).`,
  );
  if (args.target === 'prod') {
    console.log(
      `Applied ${nameParts.size} pinned PROD name division(s) from the tracked `
      + `issue224-s9-name-parts-20260922.json artefact (sha256=${PINNED_PROD_NAME_PARTS_SHA256.slice(0, 12)}…).`,
    );
  } else if (args.namePartsPath !== null) {
    console.log(
      `Applied ${nameParts.size} operator-authored name division(s) from ${args.namePartsPath} `
      + '(each verified to recompose to the pinned display name).',
    );
  }

  if (args.target === 'prod') {
    return runProdMain(args, targets);
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
        assertExactFirstApplyShape(classification, 'DEV');
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
