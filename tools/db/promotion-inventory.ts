/**
 * AFLDB-ISSUE-125 — the production promotion contract.
 *
 * When a clean rebuilt database (`afldb_test`, from `npm run db:test:rebuild`) is promoted
 * to production, every persistent table falls into exactly one treatment. This module is
 * the tracked, machine-readable form of that contract. `tools/db/promotion-check.ts` reads
 * it, `docs/production-promotion.md` explains it, and `tests/db-promotion-check.test.ts`
 * pins it.
 *
 * The 2026-09-02 cutover (AFLDB-ISSUE-122 §S8) restored the rebuilt dump over `afldb_prod`
 * and thereby replaced every production-only table with test-state content, including a
 * test fixture super admin. The contract below exists so that can never be an accident
 * again:
 *
 *   * the split between "rebuilt data" and "production-owned state" is NOT typed by hand
 *     at promotion time — it is `afldb_meta.import_writable_tables` (migration 045), the
 *     registry the database itself carries, versus the explicit list here;
 *   * the checker FAILS CLOSED: a public table that is in neither set is a refusal, and so
 *     is a table that is in both. A new operational table cannot be promoted by accident;
 *     someone has to decide its treatment and write it down here first.
 *
 * Nothing in this module touches a database. It is pure data and pure functions, so the
 * unit tests can pin every rule without a connection.
 */

// ---------------------------------------------------------------------------
// Treatments
// ---------------------------------------------------------------------------

/**
 * What happens to a table's ROWS when the rebuilt database becomes production.
 *
 *   reinstate   The rebuilt copy is truncated and the rows are restored from the
 *               mandatory pre-cutover production backup. Production human authority,
 *               auth identity, operator choices and audit history live here.
 *   reset       The rebuilt copy is truncated and left empty. Nothing from either side
 *               survives: either the rows are ephemeral (sessions, magic links) or they
 *               reference rebuilt rows that no longer exist (promotion decisions).
 *   regenerate  Truncated, then rebuilt by the application's own refresh action after
 *               promotion. Derived from rebuilt data plus reinstated human decisions.
 *   rebuilt     The rebuilt database's own content stands. Used for the one non-registry
 *               table the ETL writes (the canonical mutation ledger) and for the
 *               acquisition schemas.
 */
export type Treatment = 'reinstate' | 'reset' | 'regenerate' | 'rebuilt';

export type Category =
  | 'application'   // production-only application/auth/authorisation state
  | 'ephemeral'     // session/security state that must not cross a database identity
  | 'operations'    // audit, telemetry and review state
  | 'staging';      // acquisition state, decided by ownership

/** How `--compare` judges a table against the pre-cutover snapshot. */
export type CompareRule = 'equal' | 'zero' | 'atLeast' | 'any';

export type TableTreatment = {
  /** `public` unless stated. Schema-level entries use `schema` + `name: '*'`. */
  schema: 'public' | 'staging' | 'staging_aflw';
  name: string;
  subsystem: string;
  category: Category;
  /** True when the rows only ever existed on production (never produced by a rebuild). */
  productionOnly: boolean;
  treatment: Treatment;
  compare: CompareRule;
  /**
   * Reinstatement order. Lower first. Every table a row here references by foreign key
   * has a lower number, so a per-table restore in this order never trips a FK.
   */
  order: number;
  /**
   * Foreign keys INTO rebuilt tables. These are the columns that can dangle after a
   * rebuild changes an identity (AFLDB-ISSUE-136 merged players, batches are new), so
   * the checker probes them before reinstatement.
   */
  footballRefs?: { column: string; references: string; nullable: boolean }[];
  note: string;
};

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

/**
 * Every `public` table that is NOT in `afldb_meta.import_writable_tables`, plus the two
 * non-public acquisition schemas. Derived from the migrations (001–085) and
 * `tools/maintenance/privileges.sql`, not from the issue text.
 *
 * Tables in `import_writable_tables` are not listed: they are the canonical and derived
 * football data the rebuilt database exists to replace, and the registry — carried by
 * the dump itself — is their authority.
 */
export const PROMOTION_CONTRACT: readonly TableTreatment[] = [
  // --- Auth identity and authorisation (migrations 023, 029, 030, 033, 040) -----------
  {
    schema: 'public', name: 'auth_users', subsystem: 'auth', category: 'application',
    productionOnly: true, treatment: 'reinstate', compare: 'equal', order: 10,
    note: 'Administrator identities, password hashes, TOTP secrets and roles. The '
      + 'authentication boundary: a rebuilt copy holds integration-test fixtures and '
      + 'must never become production. Reinstated first — everything below references it.',
  },
  {
    schema: 'public', name: 'admin_invites', subsystem: 'auth', category: 'application',
    productionOnly: true, treatment: 'reinstate', compare: 'equal', order: 20,
    note: 'Outstanding invitations (token hashes, expiry). Preserved so an invite sent '
      + 'before promotion still works after it. References auth_users.',
  },
  // --- Beta access (migrations 023, 024, 035, 036) ------------------------------------
  {
    schema: 'public', name: 'beta_access_codes', subsystem: 'beta', category: 'application',
    productionOnly: true, treatment: 'reinstate', compare: 'equal', order: 20,
    note: 'Live access credentials cut by an operator. Explicitly preserved; the '
      + 'operator may revoke after promotion but must not lose them by accident.',
  },
  {
    schema: 'public', name: 'beta_allowed_emails', subsystem: 'beta', category: 'application',
    productionOnly: true, treatment: 'reinstate', compare: 'equal', order: 20,
    note: 'Allowlisted readers. Fixture-domain rows are refused by the identity gate.',
  },
  {
    schema: 'public', name: 'beta_join_requests', subsystem: 'beta', category: 'application',
    productionOnly: true, treatment: 'reinstate', compare: 'equal', order: 20,
    note: 'Early-access requests and their answers — reader-supplied, unrecoverable.',
  },
  {
    schema: 'public', name: 'beta_login_tokens', subsystem: 'beta', category: 'ephemeral',
    productionOnly: true, treatment: 'reset', compare: 'zero', order: 20,
    note: 'Single-use short-lived magic links. A reader requests a new one.',
  },
  // --- Sessions (migration 023, 028) ---------------------------------------------------
  {
    schema: 'public', name: 'auth_sessions', subsystem: 'auth', category: 'ephemeral',
    productionOnly: true, treatment: 'reset', compare: 'zero', order: 20,
    note: 'Never carried across a database identity change. Every admin logs in again, '
      + 'which is also how the real-admin-login acceptance gate is exercised.',
  },
  // --- Operator configuration and content (migrations 034, 037) -----------------------
  {
    schema: 'public', name: 'site_settings', subsystem: 'admin', category: 'application',
    productionOnly: true, treatment: 'reinstate', compare: 'equal', order: 20,
    note: 'Deliberate super-admin choices (home layout, grid audience, early-access copy, '
      + 'footer, theme). The app falls back to compiled defaults when rows are missing, '
      + 'which is exactly how a loss goes unnoticed. References auth_users.',
  },
  {
    schema: 'public', name: 'site_media', subsystem: 'admin', category: 'application',
    productionOnly: true, treatment: 'reinstate', compare: 'equal', order: 20,
    note: 'Uploaded images (bytes live in the row). Not in the issue\'s original list; '
      + 'found in the schema. References auth_users.',
  },
  // --- Human data authority (migrations 057, 058, 073, 078) ---------------------------
  {
    schema: 'public', name: 'data_edits', subsystem: 'admin data editor', category: 'operations',
    productionOnly: true, treatment: 'reinstate', compare: 'equal', order: 20,
    note: 'Append-only audit of every human canonical edit (before/after snapshots). '
      + 'Entities are referenced by key, not FK, so it reinstates cleanly. References auth_users.',
  },
  {
    schema: 'public', name: 'data_overrides', subsystem: 'admin data editor', category: 'application',
    productionOnly: true, treatment: 'reinstate', compare: 'equal', order: 20,
    note: 'Durable human overrides that destructive reloads REPLAY over source rows. The '
      + 'rebuild ran on afldb_test, which holds none of them, so after reinstatement they '
      + 'must be replayed onto the promoted canonical rows (docs/production-promotion.md §8).',
  },
  // --- Submissions (migration 023) ---------------------------------------------------
  {
    schema: 'public', name: 'data_submissions', subsystem: 'contributor uploads', category: 'application',
    productionOnly: true, treatment: 'reinstate', compare: 'equal', order: 20,
    footballRefs: [{ column: 'import_batch_id', references: 'import_batches', nullable: true }],
    note: 'Uploaded CSVs and their review state. import_batch_id points at a batch the '
      + 'rebuild no longer has; the checker probes it and the runbook nulls dangling refs.',
  },
  {
    schema: 'public', name: 'data_submission_rows', subsystem: 'contributor uploads', category: 'application',
    productionOnly: true, treatment: 'reinstate', compare: 'equal', order: 30,
    note: 'Per-row validation reports. References data_submissions.',
  },
  // --- Player-link review (migrations 056, 067) -------------------------------------
  {
    schema: 'public', name: 'player_link_suggestions', subsystem: 'player links', category: 'application',
    productionOnly: true, treatment: 'reinstate', compare: 'equal', order: 20,
    note: 'Reader suggestions. target_id is deliberately not a FK (a dead id is an '
      + 'unsurfaced row, not an error). References auth_users.',
  },
  {
    schema: 'public', name: 'player_link_resolutions', subsystem: 'player links', category: 'operations',
    productionOnly: true, treatment: 'reinstate', compare: 'equal', order: 20,
    footballRefs: [{ column: 'player_id', references: 'players', nullable: true }],
    note: 'Append-only human link decisions the honours reload is forbidden to overwrite. '
      + 'player_id can dangle after an identity merge; probed before reinstatement.',
  },
  {
    schema: 'public', name: 'player_link_match_candidates', subsystem: 'player links', category: 'operations',
    productionOnly: false, treatment: 'regenerate', compare: 'any', order: 20,
    footballRefs: [{ column: 'player_id', references: 'players', nullable: false }],
    note: 'Regenerated wholesale by the admin refresh action from rebuilt players plus '
      + 'reinstated resolutions. Never reinstated: player_id is NOT NULL against players.',
  },
  // --- NL search telemetry and review (migrations 046–051, 055, 079, 081) -------------
  {
    schema: 'public', name: 'nl_search_log', subsystem: 'NL search telemetry', category: 'operations',
    productionOnly: true, treatment: 'reinstate', compare: 'equal', order: 20,
    note: 'Query telemetry, self-referencing via parent_search_id. Preserved because it '
      + 'carries human review and reader feedback; the Super Admin can clear it later '
      + 'through nl_search_telemetry_clear(), whereas nothing can reconstruct it.',
  },
  {
    schema: 'public', name: 'nl_search_review', subsystem: 'NL search telemetry', category: 'operations',
    productionOnly: true, treatment: 'reinstate', compare: 'equal', order: 30,
    note: 'Human review verdicts. References nl_search_log and auth_users.',
  },
  {
    schema: 'public', name: 'nl_search_feedback', subsystem: 'NL search telemetry', category: 'operations',
    productionOnly: true, treatment: 'reinstate', compare: 'equal', order: 30,
    note: 'Reader thumbs up/down. References nl_search_log.',
  },
  {
    schema: 'public', name: 'app_health_events', subsystem: 'app health telemetry', category: 'operations',
    productionOnly: true, treatment: 'reinstate', compare: 'equal', order: 30,
    note: 'Runtime health events. related_search_id is ON DELETE SET NULL, so it '
      + 'tolerates a missing log row. Preserved as a conscious retention decision.',
  },
  // --- Audit (migration 023, 082) ----------------------------------------------------
  {
    schema: 'public', name: 'auth_audit_log', subsystem: 'auth', category: 'operations',
    productionOnly: true, treatment: 'reinstate', compare: 'atLeast', order: 20,
    note: 'Append-only administrative audit trail. Reinstated in full AND followed by an '
      + 'explicit database.promoted marker row, so the log itself records the cutover '
      + 'rather than presenting a seamless history. Count is therefore >= the snapshot.',
  },
  // --- Observation spine review (migration 074) --------------------------------------
  {
    schema: 'public', name: 'promotion_decisions', subsystem: 'source observation spine', category: 'operations',
    productionOnly: true, treatment: 'reset', compare: 'zero', order: 20,
    footballRefs: [{ column: 'candidate_id', references: 'promotion_candidates', nullable: false }],
    note: 'Reviewer decisions on promotion_candidates, which are import-writable and are '
      + 'therefore replaced by the rebuild. A decision cannot outlive its candidate, so '
      + 'these are an INTENTIONAL, RECORDED GAP: retained in the pre-cutover dump and the '
      + 'kept pre-rebuild database, named in the audit marker, never silently back-filled.',
  },
  // --- Machine mutation ledger (migration 083) ----------------------------------------
  {
    schema: 'public', name: 'canonical_applications', subsystem: 'in-season settle', category: 'operations',
    productionOnly: false, treatment: 'rebuilt', compare: 'any', order: 20,
    note: 'Written by afldb_import in the same savepoint as each automatic canonical '
      + 'mutation, and deliberately not registered import-writable. The rebuilt ledger '
      + 'describes the rebuilt rows; production\'s settle ledger describes rows that no '
      + 'longer exist and is retained only in the pre-cutover dump (a recorded gap).',
  },
  // --- Acquisition schemas (migrations 001, 014, 025, 074, 076, 077) -----------------
  {
    schema: 'staging', name: '*', subsystem: 'import pipeline / source observation spine', category: 'staging',
    productionOnly: false, treatment: 'rebuilt', compare: 'any', order: 20,
    note: 'The importer\'s own workspace and the source observation spine, keyed to the '
      + 'rebuilt import_batches. Production\'s in-season settle history here is replaced; '
      + 'the current season is re-acquired by the post-promotion settle run.',
  },
  {
    schema: 'staging_aflw', name: '*', subsystem: 'AFLW (tools/aflw)', category: 'staging',
    productionOnly: true, treatment: 'reinstate', compare: 'equal', order: 20,
    note: 'The aflwstats.com scrape the aflw.* views read. NOT produced by '
      + 'db:test:rebuild, so a rebuilt database has it empty; reinstated schema-wide '
      + 'from the pre-cutover dump (or reloaded with tools/aflw/load_staging.py --load).',
  },
];

/**
 * The derived football tables `tools/migration/rebuild_derived.py` recomputes. They are
 * import-writable (registry) and so arrive with the rebuild already computed; listed here
 * only so the inventory report can name them. Recompute after promotion only if a
 * post-promotion step (override replay, settle) changed canonical rows.
 */
export const DERIVED_FOOTBALL_TABLES: readonly string[] = [
  'player_clubs', 'player_club_season_stats', 'player_season_stats',
  'player_career_stats', 'club_seasons',
];

// ---------------------------------------------------------------------------
// Derived views of the contract
// ---------------------------------------------------------------------------

export function publicContractTables(): TableTreatment[] {
  return PROMOTION_CONTRACT.filter((t) => t.schema === 'public');
}

export function contractByName(name: string): TableTreatment | undefined {
  return PROMOTION_CONTRACT.find((t) => t.schema === 'public' && t.name === name);
}

/** Public tables truncated in the candidate before reinstatement: everything not `rebuilt`. */
export function truncatedPublicTables(): string[] {
  return publicContractTables()
    .filter((t) => t.treatment !== 'rebuilt')
    .map((t) => t.name);
}

/** Public tables restored from the pre-cutover dump, in FK-safe order. */
export function reinstatedPublicTables(): string[] {
  return publicContractTables()
    .filter((t) => t.treatment === 'reinstate')
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
    .map((t) => t.name);
}

export function tablesWithTreatment(treatment: Treatment): string[] {
  return PROMOTION_CONTRACT
    .filter((t) => t.treatment === treatment)
    .map((t) => (t.schema === 'public' ? t.name : `${t.schema}.*`));
}

/** Non-public schemas reinstated wholesale. */
export function reinstatedSchemas(): string[] {
  return PROMOTION_CONTRACT
    .filter((t) => t.schema !== 'public' && t.treatment === 'reinstate')
    .map((t) => t.schema);
}

// ---------------------------------------------------------------------------
// Fail-closed classification against a live catalogue
// ---------------------------------------------------------------------------

export type ClassificationProblem =
  | { kind: 'unclassified'; table: string }     // public table in neither set
  | { kind: 'both'; table: string }             // in the registry AND the contract
  | { kind: 'missing'; table: string };         // contract names a table the DB lacks

/**
 * The rule that makes the inventory complete: every public table is EITHER in
 * `afldb_meta.import_writable_tables` (rebuilt data) OR in the contract (a decided
 * treatment). Any other shape is a refusal.
 */
export function classifyPublicTables(
  publicTables: readonly string[],
  importWritable: readonly string[],
): ClassificationProblem[] {
  const registry = new Set(importWritable);
  const contract = new Set(publicContractTables().map((t) => t.name));
  const present = new Set(publicTables);
  const problems: ClassificationProblem[] = [];

  for (const table of [...present].sort()) {
    const inRegistry = registry.has(table);
    const inContract = contract.has(table);
    if (inRegistry && inContract) problems.push({ kind: 'both', table });
    else if (!inRegistry && !inContract) problems.push({ kind: 'unclassified', table });
  }
  for (const table of [...contract].sort()) {
    if (!present.has(table)) problems.push({ kind: 'missing', table });
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Test fixture identity — the refuse-if-present predicate
// ---------------------------------------------------------------------------

/**
 * Every table that stores an email address that grants or requests access. A fixture
 * address in ANY of them after promotion is a refusal, not just in auth_users: an
 * allowlisted fixture email is a login path too.
 */
export const EMAIL_BEARING_TABLES: readonly string[] = [
  'auth_users', 'admin_invites', 'beta_allowed_emails', 'beta_login_tokens', 'beta_join_requests',
];

/**
 * RFC 2606 / RFC 6761 reserved top-level domains. An address under any of them cannot
 * belong to a real person, which is why the repository's fixtures use them
 * (`@afldb.test`, `@example.test`) and why this is the narrowest reliable predicate
 * rather than a list of historic fixture addresses.
 */
export const RESERVED_TEST_TLDS: ReadonlySet<string> = new Set(['test', 'example', 'invalid', 'localhost']);

/** RFC 2606 second-level example domains, and every subdomain of them. */
export const RESERVED_EXAMPLE_DOMAINS: ReadonlySet<string> = new Set(['example.com', 'example.net', 'example.org']);

/**
 * True when an address is a test fixture — or is malformed, which fails closed: a value
 * with no `@` cannot be a deliverable production identity either.
 *
 * Must agree exactly with TEST_FIXTURE_EMAIL_SQL below; the unit test holds both to the
 * same table of examples.
 */
export function isTestFixtureEmail(email: string): boolean {
  const at = email.indexOf('@');
  if (at <= 0 || at === email.length - 1) return true;
  const domain = email.slice(at + 1).trim().toLowerCase().replace(/\.$/, '');
  if (!domain) return true;
  const labels = domain.split('.');
  if (RESERVED_TEST_TLDS.has(labels[labels.length - 1])) return true;
  if (labels.length >= 2 && RESERVED_EXAMPLE_DOMAINS.has(labels.slice(-2).join('.'))) return true;
  return false;
}

/**
 * The same predicate in SQL, over a column named `email`. Kept as one expression so every
 * table is checked by identical logic.
 */
export const TEST_FIXTURE_EMAIL_SQL = `(
     position('@' in email) <= 1
  OR position('@' in email) = length(email)
  OR rtrim(lower(split_part(email, '@', 2)), '.') = ''
  OR rtrim(lower(split_part(email, '@', 2)), '.') ~ '(^|\\.)(${[...RESERVED_TEST_TLDS].join('|')})$'
  OR rtrim(lower(split_part(email, '@', 2)), '.') ~ '(^|\\.)(${[...RESERVED_EXAMPLE_DOMAINS].map((d) => d.replace('.', '\\.')).join('|')})$'
)`;

// ---------------------------------------------------------------------------
// Database-name contract
// ---------------------------------------------------------------------------

export const PRODUCTION_DATABASE = 'afldb_prod';
export const SOURCE_DATABASE = 'afldb_test';
export const CANDIDATE_PREFIX = 'afldb_prod_candidate_';
/** Matches the read-only convention `tools/db/rebuild-test.ts` already enforces. */
export const PRE_REBUILD_PREFIX = 'afldb_prod_pre_rebuild_';

export type Phase = 'source' | 'pre-cutover' | 'restored' | 'candidate' | 'production';

export const PHASES: readonly Phase[] = ['source', 'pre-cutover', 'restored', 'candidate', 'production'];

export class PromotionRefused extends Error {}

/** The database each phase may be pointed at. Anything else is refused by name. */
export function assertDatabaseForPhase(phase: Phase, database: string): void {
  const nameOk = /^[a-z_][a-z0-9_-]*$/i.test(database);
  if (!nameOk) throw new PromotionRefused(`'${database}' is not a plausible database name.`);
  switch (phase) {
    case 'source':
      if (database !== SOURCE_DATABASE) {
        throw new PromotionRefused(
          `Phase 'source' inspects the rebuilt '${SOURCE_DATABASE}' only, not '${database}'.`);
      }
      return;
    case 'pre-cutover':
    case 'production':
      if (database !== PRODUCTION_DATABASE) {
        throw new PromotionRefused(
          `Phase '${phase}' inspects '${PRODUCTION_DATABASE}' only, not '${database}'.`);
      }
      return;
    case 'restored':
    case 'candidate':
      if (!database.startsWith(CANDIDATE_PREFIX) || database.length === CANDIDATE_PREFIX.length) {
        throw new PromotionRefused(
          `Phase '${phase}' inspects a candidate database named '${CANDIDATE_PREFIX}<stamp>', `
          + `not '${database}'. The name is the safety: the live '${PRODUCTION_DATABASE}' is `
          + 'never a candidate.');
      }
      return;
  }
}

/** The old production database the `restored` probe reads. */
export function assertOldDatabaseName(database: string): void {
  if (database === PRODUCTION_DATABASE) return;
  if (database.startsWith(PRE_REBUILD_PREFIX) && database.length > PRE_REBUILD_PREFIX.length) return;
  throw new PromotionRefused(
    `--old-database must be '${PRODUCTION_DATABASE}' (before the swap) or `
    + `'${PRE_REBUILD_PREFIX}<stamp>' (after it), not '${database}'.`);
}

/**
 * Replace the database NAME in a DSN, never a substring of the whole string — the
 * lesson `tools/maintenance/restore-test.sh` records. Query parameters are kept.
 */
export function withDatabase(dsn: string, database: string): string {
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    throw new PromotionRefused('The DSN is not a valid connection URL.');
  }
  if (!/^postgres(ql)?:$/.test(url.protocol)) {
    throw new PromotionRefused('The DSN is not a postgresql:// URL.');
  }
  url.pathname = `/${database}`;
  return url.toString();
}

export function databaseOf(dsn: string): string {
  try {
    return decodeURIComponent(new URL(dsn).pathname.replace(/^\//, ''));
  } catch {
    throw new PromotionRefused('The DSN is not a valid connection URL.');
  }
}

// ---------------------------------------------------------------------------
// Snapshot comparison
// ---------------------------------------------------------------------------

export type Snapshot = {
  issue: 'AFLDB-ISSUE-125';
  database: string;
  takenAt: string;
  /** `public.<table>` and `<schema>.<table>` row counts for every contract table. */
  counts: Record<string, number>;
  superAdmins: number;
  fixtureRows: number;
};

export type CompareFinding = {
  table: string;
  rule: CompareRule;
  before: number | undefined;
  after: number | undefined;
  ok: boolean;
  detail: string;
};

function compareOne(rule: CompareRule, before: number | undefined, after: number | undefined): [boolean, string] {
  if (after === undefined) return [false, 'table missing in the database being checked'];
  switch (rule) {
    case 'equal':
      if (before === undefined) return [false, 'not in the snapshot'];
      return [before === after, before === after ? 'reinstated in full' : `expected ${before}, found ${after}`];
    case 'zero':
      return [after === 0, after === 0 ? 'reset' : `expected 0 (reset), found ${after}`];
    case 'atLeast':
      if (before === undefined) return [false, 'not in the snapshot'];
      return [after >= before,
        after >= before ? `reinstated (${after - before} row(s) added after the snapshot)` : `expected >= ${before}, found ${after}`];
    case 'any':
      return [true, 'no count expectation'];
  }
}

/**
 * Judge a set of counts against the pre-cutover snapshot. Every finding is returned, not
 * just the failures, so the operator's transcript records what was checked.
 */
export function compareCounts(
  snapshot: Snapshot,
  rules: readonly { table: string; rule: CompareRule }[],
  counts: Record<string, number>,
): CompareFinding[] {
  return rules.map(({ table, rule }) => {
    const before = snapshot.counts[table];
    const after = counts[table];
    const [ok, detail] = compareOne(rule, before, after);
    return { table, rule, before, after, ok, detail };
  });
}

// ---------------------------------------------------------------------------
// Generated operator plan — text only, never executed here
// ---------------------------------------------------------------------------

export type PlanInput = {
  candidate: string;
  oldDatabase: string;
  preCutoverDump: string;
  rebuiltDump: string;
};

function sqlArray(names: readonly string[]): string {
  return `ARRAY[${names.map((n) => `'${n}'`).join(', ')}]`;
}

/** SQL that empties every non-rebuilt contract table in the candidate. */
export function truncateSql(): string {
  const tables = truncatedPublicTables().map((t) => `public.${t}`).join(',\n  ');
  const schemas = PROMOTION_CONTRACT
    .filter((t) => t.schema !== 'public' && t.treatment === 'reinstate')
    .map((t) => t.schema);
  const schemaBlocks = schemas.map((schema) => `DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = '${schema}' LOOP
    EXECUTE format('TRUNCATE TABLE %I.%I RESTART IDENTITY', '${schema}', r.tablename);
  END LOOP;
END $$;`).join('\n');
  return `-- AFLDB-ISSUE-125: remove every row of production-owned/operational state the
-- rebuilt dump carried (test fixtures included). One statement, no cascading: every table
-- that references one of these is itself in the list.
TRUNCATE TABLE
  ${tables}
RESTART IDENTITY;

${schemaBlocks}
`;
}

/** SQL that re-syncs identity sequences after a data-only restore of the listed tables. */
export function resyncIdentitySql(): string {
  return `-- AFLDB-ISSUE-125: pg_restore --data-only --table=<t> restores rows but not the
-- SEQUENCE SET entries of identity columns. Advance each identity sequence past the
-- reinstated maximum so the next INSERT cannot collide.
DO $$
DECLARE r record; seq text; mx bigint;
BEGIN
  FOR r IN
    SELECT c.relname, a.attname
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = ANY (${sqlArray(reinstatedPublicTables())})
       AND a.attidentity <> ''
       AND NOT a.attisdropped
  LOOP
    seq := pg_get_serial_sequence(format('public.%I', r.relname), r.attname);
    EXECUTE format('SELECT coalesce(max(%I), 0) FROM public.%I', r.attname, r.relname) INTO mx;
    PERFORM setval(seq, mx + 1, false);
    RAISE NOTICE '% restarted at %', seq, mx + 1;
  END LOOP;
END $$;
`;
}

/** The explicit cutover marker. Written AFTER reinstatement, BEFORE acceptance. */
export function auditMarkerSql(input: PlanInput): string {
  const j = (s: string) => `'${s.replace(/'/g, "''")}'`;
  return `-- AFLDB-ISSUE-125: the audit trail records the promotion itself. An operator, not a
-- user, so actor_user_id is NULL and actor_label names the procedure.
INSERT INTO auth_audit_log (actor_user_id, actor_label, action, detail)
VALUES (
  NULL,
  'operator: production promotion (AFLDB-ISSUE-125)',
  'database.promoted',
  jsonb_build_object(
    'issue', 'AFLDB-ISSUE-125',
    'candidate', ${j(input.candidate)},
    'replaced', ${j(input.oldDatabase)},
    'rebuilt_dump', ${j(input.rebuiltDump)},
    'pre_cutover_dump', ${j(input.preCutoverDump)},
    'reinstated', to_jsonb(${sqlArray(tablesWithTreatment('reinstate'))}),
    'reset', to_jsonb(${sqlArray(tablesWithTreatment('reset'))}),
    'regenerated', to_jsonb(${sqlArray(tablesWithTreatment('regenerate'))}),
    'taken_from_rebuild', to_jsonb(${sqlArray(tablesWithTreatment('rebuilt'))}),
    'recorded_gaps', to_jsonb(ARRAY[
      'promotion_decisions: reset, retained only in the pre-cutover dump',
      'canonical_applications and staging.*: production settle history replaced by the rebuild',
      'auth_sessions: reset, every administrator signs in again'
    ])
  )
);
`;
}

/**
 * The reinstatement command sequence. Each table is its own `pg_restore` under
 * `--single-transaction`, in FK order, so a failure names the table and leaves the
 * earlier ones committed and the failing one untouched.
 */
export function reinstatePlan(input: PlanInput): string {
  const lines: string[] = [];
  lines.push(`# AFLDB-ISSUE-125 reinstatement plan — candidate '${input.candidate}'`);
  lines.push('# Run on PROD (afldb-prod) as the owner role. CANDIDATE_DSN is the owner DSN with the');
  lines.push('# database name replaced; never paste a DSN into a tracked file or a transcript.');
  lines.push('');
  lines.push('# 1. Empty every production-owned/operational table the rebuilt dump carried.');
  lines.push(`psql "$CANDIDATE_DSN" -v ON_ERROR_STOP=1 -f promotion-truncate.sql`);
  lines.push('');
  lines.push('# 2. Reinstate production-owned rows from the pre-cutover dump, one table at a time,');
  lines.push('#    in foreign-key order. --data-only: the schema is the rebuilt one.');
  for (const table of reinstatedPublicTables()) {
    lines.push(`pg_restore --dbname="$CANDIDATE_DSN" --data-only --no-owner --no-privileges \\`);
    lines.push(`           --single-transaction --exit-on-error --table=${table} "${input.preCutoverDump}"`);
  }
  for (const schema of reinstatedSchemas()) {
    lines.push(`pg_restore --dbname="$CANDIDATE_DSN" --data-only --no-owner --no-privileges \\`);
    lines.push(`           --single-transaction --exit-on-error --schema=${schema} "${input.preCutoverDump}"`);
  }
  lines.push('');
  lines.push('# 3. Re-sync identity sequences (a data-only table restore does not carry SEQUENCE SET).');
  lines.push(`psql "$CANDIDATE_DSN" -v ON_ERROR_STOP=1 -f promotion-resync-identity.sql`);
  lines.push('');
  lines.push('# 4. Record the promotion in the audit trail it just reinstated.');
  lines.push(`psql "$CANDIDATE_DSN" -v ON_ERROR_STOP=1 -f promotion-audit-marker.sql`);
  lines.push('');
  lines.push('# 5. Reconcile grants — mandatory after ANY restore (docs/backup-restore.md §6).');
  lines.push(`psql "$CANDIDATE_DSN" -v ON_ERROR_STOP=1 -f tools/maintenance/privileges.sql`);
  lines.push('');
  lines.push('# 6. Acceptance, before the swap:');
  lines.push(`npm run db:promotion:check -- --phase candidate --database ${input.candidate} \\`);
  lines.push('    --compare <snapshot.json> --expect-super-admin <real production super admin email>');
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// Acceptance checklist
// ---------------------------------------------------------------------------

export const ACCEPTANCE_CHECKLIST: readonly string[] = [
  'Host identity confirmed on every terminal: PROD is afldb-prod; DEV is streamanator. `hostname` printed before any destructive command.',
  'Pre-cutover production backup taken with tools/maintenance/backup.sh, sha256 recorded, pg_restore --list read back, and an off-host copy made.',
  'Backup proven: restore-test.sh (or a restore into a throwaway database) passed its parity checks.',
  'Source validated: `--phase source` on afldb_test passed (name, migration parity with this checkout, optional catalog fingerprint) and the rebuilt dump\'s sha256 matched end to end.',
  'Production-owned state snapshot written by `--phase pre-cutover` and kept alongside the backup.',
  'Rebuilt dump restored into a NEW candidate database (afldb_prod_candidate_<stamp>) — never over afldb_prod.',
  '`--phase restored` passed: candidate name, migration parity, dangling-reference probe against the old database resolved.',
  'Every production-owned/operational table truncated in the candidate, then reinstated per the printed plan, in order, each under --single-transaction.',
  'Identity sequences re-synced; database.promoted audit marker written; privileges.sql run on the candidate.',
  '`--phase candidate` passed: no test-fixture identity anywhere, expected super admin present and enabled, counts match the snapshot per rule, grants reconciled, migrations at parity.',
  'Service stopped; afldb_prod renamed to afldb_prod_pre_rebuild_<stamp>; candidate renamed to afldb_prod; service started.',
  '`--phase production` passed on the live afldb_prod (same gates as candidate).',
  'Health: /api/health 200, a season page, a player page, an AFLW page, and /search all render.',
  'Real production super admin logged in with password + TOTP (a new session — the old ones were reset by design).',
  'data_overrides replayed onto the promoted canonical rows; player_link_match_candidates regenerated from /admin; derived tables recomputed if canonical rows changed.',
  'Current season re-acquired by a supervised settle (--dry-run first), then the timer left enabled.',
  'Rollback rehearsed on paper: stop service, rename afldb_prod back to the candidate name, rename afldb_prod_pre_rebuild_<stamp> to afldb_prod, start service.',
  'Cleanup deferred: the pre-rebuild database and the dumps are kept until the operator closes the promotion record; nothing is dropped the same day.',
];
