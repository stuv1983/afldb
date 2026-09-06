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
  | 'football'      // canonical football data that is NOT in the import-writable registry
  | 'staging';      // acquisition state, decided by ownership

/** How `--compare` judges a table against the pre-cutover snapshot. */
export type CompareRule = 'equal' | 'zero' | 'atLeast' | 'any';

// ---------------------------------------------------------------------------
// Lineage — AFLDB-ISSUE-142 (B)
// ---------------------------------------------------------------------------

/**
 * The stable, external identity a row id can be resolved through when the candidate does
 * NOT share the replaced database's id lineage.
 *
 *   afltables_profile_url  external_identities(source 'afltables', match_method
 *                          'afltables_profile_url', status unique/resolved) -> the AFL
 *                          Tables profile path. The identity every AFLDB-ISSUE-118 loader
 *                          and the AFLDB-ISSUE-113 artefact already resolve people through.
 *   match_key              matches.match_key — NOT NULL UNIQUE since migration 003 and the
 *                          natural key migration 076's settle projections link on.
 *   none                   NO stable identity exists in this repository for the entity this
 *                          column points at. The column therefore CANNOT be remapped, and
 *                          across a lineage change the checker refuses rather than
 *                          reinstating an id that now denotes something else.
 *
 * A display name is deliberately not on this list and must never be added: every loader in
 * the tree refuses name matching, and two footballers share a name often enough that a name
 * match would silently retarget a human decision — the exact failure this type exists to
 * prevent.
 */
export type LineageIdentityRule = 'afltables_profile_url' | 'match_key' | 'none';

export type LineageTarget = {
  /** The `kindColumn` value this applies to; omitted when the column points at one table. */
  kind?: string;
  /** The table the id lives in, on BOTH databases. */
  entity: string;
  identity: LineageIdentityRule;
};

/**
 * A column carrying row ids from the REPLACED database's lineage. Distinct from
 * `footballRefs`, which asks only whether an id still exists: existence is not identity, and
 * on a lineage change almost every id exists and denotes a different row.
 */
export type LineageRef = {
  column: string;
  /** The column naming which table `column` points into, for a polymorphic reference. */
  kindColumn?: string;
  /** One target per `kindColumn` value, or exactly one when the column is monomorphic. */
  targets: readonly LineageTarget[];
  /** Printed beside a refusal: what an operator does when a value cannot be remapped. */
  remediation: string;
};

/**
 * AFLDB-ISSUE-143 — an intentional HISTORICAL-ONLY / recorded-gap disposition.
 *
 * §7.4c of docs/production-promotion.md names two supportable answers for a lineage-bound
 * row that cannot be evidenced. Until this issue the checker could execute neither, so a
 * DEV promotion could never pass `--phase restored`. This declaration is the executable
 * form of answer (2): the table is truncated in the candidate like any other, its rows are
 * NOT reinstated as live state, and it survives as evidence in the mandatory pre-cutover
 * dump and in the retained `<live>_pre_rebuild_<stamp>` database. It is the
 * `promotion_decisions` treatment, decided per table instead of once for all time.
 *
 * It is NOT a switch that lets unresolved lineage pass. Three things must hold together,
 * and all three come from this one declaration, so the plan and the gate cannot disagree:
 *
 *   1. this exact table AND this exact column are declared here, for the environment being
 *      promoted (`environments` is explicit — a `dev` declaration never applies to `prod`);
 *   2. the generated plan omits the table's `pg_restore` line (`reinstatedPublicTables`)
 *      and the candidate comparison therefore expects zero rows (`effectiveCompare`);
 *   3. the report, the plan and the `database.promoted` marker all name the table, the
 *      count and the reason.
 *
 * Everything else still refuses. Another table's unresolved rows refuse; a column of THIS
 * table that is not listed refuses; and `assertContractCoherent()` rejects a declaration
 * that does not name every lineage-bound column of its table, so adding a new lineage
 * column re-opens the decision rather than inheriting the old one.
 */
export type HistoricalOnly = {
  /**
   * The environments this disposition applies to. Never inferred, never defaulted: a
   * promotion of an environment not named here gets today's refusal. Production is listed
   * only if the same evidence genuinely applies to a production promotion.
   */
  environments: readonly Environment[];
  /**
   * Every lineage-bound column of the table, exhaustively. A table that is not reinstated
   * cannot have one of its columns remapped, so a partial list is a contradiction and
   * `assertContractCoherent()` refuses it.
   */
  columns: readonly string[];
  /** The issue and operator decision that chose this. Printed beside every acceptance. */
  decidedBy: string;
  /** One line for the audit marker's recorded gaps and the plan's omission block. */
  summary: string;
  /** Why no live reinstatement is supportable. Printed in full by the `restored` gate. */
  reason: string;
};

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
  footballRefs?: {
    column: string;
    references: string;
    nullable: boolean;
    /**
     * What an operator does when the probe finds this reference dangling. Printed by the
     * dangling-reference gate beside the finding. Omitted where the generic path applies:
     * a nullable reference gets the drop-FK / restore / NULL / re-add sequence the gate
     * already generates, and a NOT NULL reference with nothing written here is a refusal
     * with no path — which is what "the contract must decide this table" meant.
     */
    remediation?: string;
  }[];
  /**
   * AFLDB-ISSUE-142 (B). Columns holding row ids from the REPLACED database's lineage.
   * Declared only on tables whose rows are reinstated: a reinstated id-keyed row is the one
   * that can silently change meaning when the candidate's ids denote different rows.
   */
  lineageRefs?: readonly LineageRef[];
  /**
   * AFLDB-ISSUE-143. Declared only where an operator has decided, in writing, that this
   * table's lineage-bound rows are historical evidence rather than live state in the named
   * environments. Absent everywhere else, which is the default and the refusal.
   */
  historicalOnly?: HistoricalOnly;
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
    lineageRefs: [{
      column: 'row_id', kindColumn: 'table_name',
      targets: [
        { kind: 'players', entity: 'players', identity: 'afltables_profile_url' },
        { kind: 'matches', entity: 'matches', identity: 'match_key' },
      ],
      remediation: 'Both entities have a stable identity, so every row is remappable in '
        + 'principle: resolve row_id through the AFL Tables profile url (players) or '
        + 'matches.match_key, and apply the generated per-row UPDATEs after the reinstate. '
        + 'A row that does not resolve is NOT dropped and NOT left pointing at the old id: '
        + 'the promotion stops and the operator records the decision. The common case is a '
        + 'CURRENT-SEASON match edit — the rebuild carries seasons to the accepted baseline '
        + 'only, so those matches do not exist in the candidate until the post-promotion '
        + 'settle re-acquires the season; the supportable answer is to apply that part of '
        + 'the remap after the settle, stated in the promotion record.',
    }],
    // AFLDB-ISSUE-143 / AFLDB-ISSUE-139 D2 (operator decision, 2026-09-06).
    historicalOnly: {
      environments: ['dev'],
      columns: ['row_id'],
      decidedBy: 'AFLDB-ISSUE-139 D2 (2026-09-06), docs/production-promotion.md §7.4c option 2',
      summary: 'data_edits: NOT reinstated on a DEV promotion — the human edit audit is kept as '
        + 'historical evidence in the pre-cutover dump and the retained pre-rebuild database',
      reason: 'Every lineage-bound data_edits row on afldb_dev is in the bootstrap id space. Its '
        + "'players' rows name ids that carry no external identity at all (measured 0 of 7 "
        + "evidenced), and two of its 'matches' rows were created and then DELETED on afldb_dev "
        + 'itself, so nothing can ever resolve them. Forcing those ids into the rebuilt lineage '
        + 'would re-attribute a human edit to a different footballer or a different match — the '
        + 'exact misattribution AFLDB-ISSUE-142 (B) exists to prevent — and the reference cannot '
        + 'be nulled instead, because table_name + row_id is what the audit row is ABOUT. The '
        + 'rows are therefore historical evidence, not live state: retained in full in the '
        + 'mandatory pre-cutover dump and in the kept <live>_pre_rebuild_<stamp>, named in the '
        + 'database.promoted marker, and never reinstated into the candidate. The one '
        + 'current-season match edit that would resolve by match_key after the post-swap settle '
        + 'is part of this same gap: it is NOT carried as a pending remap, so it can neither '
        + 'weaken the pre-swap gate nor be forgotten silently.',
    },
    note: 'Append-only audit of every human canonical edit (before/after snapshots). '
      + 'table_name + row_id is a row id in players or matches, NOT a foreign key: it '
      + 'reinstates without tripping a constraint, and therefore without noticing a lineage '
      + 'change. AFLDB-ISSUE-142 (B): remapped through a stable identity, never by id. '
      + 'References auth_users.',
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
    lineageRefs: [
      {
        column: 'player_id',
        targets: [{ entity: 'players', identity: 'afltables_profile_url' }],
        remediation: 'Resolve player_id through the AFL Tables profile url and apply the '
          + 'generated per-row UPDATEs after the reinstate. It cannot be nulled instead: '
          + "plr_action_player_ck requires a player whenever action is 'linked', so a "
          + 'reinstated decision always asserts a person — it is either the right one or a '
          + 'wrong one. Where no identity resolves, the promotion stops; the row is never '
          + 'dropped (it survives in the pre-cutover dump and the kept pre-rebuild database) '
          + 'and never silently retargeted.',
      },
      {
        column: 'target_id', kindColumn: 'target_table',
        targets: [
          'award_winners', 'award_nominations', 'hall_of_fame', 'honour_team_members',
          'captaincies', 'player_achievements', 'draft_picks',
        ].map((t) => ({ kind: t, entity: t, identity: 'none' as const })),
        remediation: 'NO stable identity exists for an honours row: the seven target tables '
          + 'are import-writable, the rebuild assigns their ids, and nothing in the tree '
          + 'carries an external key for one of their rows. target_id is deliberately not a '
          + 'foreign key (migration 056), so a stale value reinstates silently and either '
          + 'hides the decision from the admin queue or attaches it to a different honours '
          + 'row. Across a lineage change there are exactly two supportable answers, and the '
          + 'choice must be recorded in the promotion record and the database.promoted '
          + 'marker: (1) reinstate as a HISTORICAL audit ledger of the replaced database, '
          + 'stating that its links are not live; or (2) do not reinstate it into the '
          + 'candidate at all and keep it as a recorded gap, the promotion_decisions '
          + 'treatment — a decision cannot outlive the row it is about. Remapping player_id '
          + 'alone is NOT an answer: it produces a row that looks resolved, names the right '
          + 'person and points at the wrong honours row.',
      },
    ],
    // AFLDB-ISSUE-143 / AFLDB-ISSUE-139 D1 (operator decision, 2026-09-06): answer (2) above.
    historicalOnly: {
      environments: ['dev'],
      columns: ['player_id', 'target_id'],
      decidedBy: 'AFLDB-ISSUE-139 D1 (2026-09-06), docs/production-promotion.md §7.4c option 2',
      summary: 'player_link_resolutions: NOT reinstated on a DEV promotion — the human link '
        + 'decisions are kept as historical evidence in the pre-cutover dump and the retained '
        + 'pre-rebuild database',
      reason: "target_id's seven honours tables carry no external key of any kind, so its "
        + 'identity is `none` and NOT ONE target_id row can be evidenced across a lineage '
        + 'change. Remapping player_id alone is explicitly not an answer (§7.4c): it produces a '
        + 'row that looks resolved, names the right person and points at the wrong honours row. '
        + 'The whole table is therefore historical evidence rather than live state — the '
        + 'promotion_decisions treatment, on the same reasoning that a decision cannot outlive '
        + 'the row it is about. Every row is retained in the mandatory pre-cutover dump and in '
        + 'the kept <live>_pre_rebuild_<stamp>, named in the database.promoted marker, and '
        + 'never reinstated into the candidate. Consequence to state in the promotion record: '
        + 'player_link_match_candidates is regenerated from rebuilt players plus reinstated '
        + 'resolutions, so with none reinstated the admin link queue re-surfaces the '
        + 'previously-decided suggestions for a fresh decision against the new lineage.',
    },
    note: 'Append-only human link decisions the honours reload is forbidden to overwrite. '
      + 'player_id can dangle after an identity merge; probed before reinstatement. Both '
      + 'player_id and target_id are ids of the replaced database — AFLDB-ISSUE-142 (B).',
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
  // --- Canonical football schema with no writer (migration 062) -----------------------
  // AFLDB-ISSUE-142 (A). player_match_period_stats is football data by shape — player_id,
  // match_id, club_id NOT NULL into canonical tables, per-period statistic columns, a
  // source_id/import_batch_id provenance pair and UNIQUE (player_id, match_id, period).
  // Migration 062 nevertheless registered it NOWHERE: it calls neither
  // afldb_meta.grant_import_write() (as 053, 074, 086, 087 and 089 all do) nor
  // grant_app_read(). It is the ONLY public table any migration creates that is in neither
  // classification set, so the fail-closed gate refused EVERY phase on EVERY real database
  // — the same "a deliberate absence read as a decision" shape as AFLDB-ISSUE-141, except
  // here the absence was an omission rather than a decision.
  //
  // Decided as a CONTRACT entry, not a registry row. grant_import_write() registers and
  // GRANTS in one statement (045), so registering it would hand afldb_import UPDATE, DELETE
  // and TRUNCATE — and privileges.sql would restore that at every reconcile — to serve a
  // writer that does not exist. Nothing in the tree writes this table: the only references
  // are reads (tools/current-season/repair-match-rekeys.ts counts rows;
  // src/db/queries/nl/player-{career,game}.ts read it for period-split questions), no
  // db:test:rebuild stage produces it, and it held 0 rows on afldb_dev and on the rebuilt
  // afldb_test when this was measured (AFLDB-ISSUE-139 Phase 4C, read-only).
  //
  // 'rebuilt' is the honest treatment: there is nothing to reinstate and nothing to reset,
  // and if the table ever does carry canonical rows they are the rebuild's, exactly like
  // every table in the registry. compare 'zero' is the tripwire — the day a writer exists,
  // the candidate/production comparison FAILS and this entry must be revisited, at which
  // point registering it import-writable, with the grant it then genuinely needs, is the
  // right answer. See docs/production-promotion.md §1.
  {
    schema: 'public', name: 'player_match_period_stats', subsystem: 'quarter-by-quarter player stats',
    category: 'football', productionOnly: false, treatment: 'rebuilt', compare: 'zero', order: 20,
    note: 'Canonical football schema created by migration 062 with no writer, no rebuild '
      + 'stage and no registry row. Classified here rather than registered import-writable: '
      + 'the registry grants UPDATE/DELETE/TRUNCATE, and no importer needs them. Never '
      + 'truncated and never reinstated — the candidate\'s copy stands, as for any rebuilt '
      + 'football table. compare \'zero\' fails the moment that stops being true.',
  },
  // --- Captured external grid corpus (migration 080) ----------------------------------
  // AFLDB-ISSUE-141. Deliberately NOT in afldb_meta.import_writable_tables — see the foot
  // of 080_external_grids.sql: grant_import_write() hands out UPDATE, DELETE and TRUNCATE
  // and privileges.sql would restore them at every reconcile, which would end the corpus's
  // immutability. Deliberately not import-writable is NOT the same as decided, and until
  // this issue the three tables were in neither set: the classification gate refused every
  // database carrying 080, and — the substantive defect — a generated plan named them in
  // neither the truncate list nor the reinstate list, so a swap would have replaced an
  // explicitly immutable captured corpus with the candidate's empty tables, unnoticed.
  //
  // There is no Gridley rebuild stage (tools/db/rebuild-test.ts planStages()), so a rebuilt
  // candidate carries these tables EMPTY apart from 080's own external_grid_sources seed.
  // The corpus therefore behaves exactly like staging_aflw: not produced by the rebuild,
  // reinstated from the pre-cutover dump, and lost if it is not.
  {
    schema: 'public', name: 'external_grid_sources', subsystem: 'Grid Solver corpus', category: 'operations',
    productionOnly: true, treatment: 'reinstate', compare: 'equal', order: 20,
    footballRefs: [{
      column: 'ingest_source_id', references: 'sources', nullable: false,
      remediation: "sources is import-writable, so the candidate's sources.id for key "
        + "'gridley' need not equal the dumped one. Resolve BEFORE the reinstate: read the "
        + "candidate id (SELECT id FROM sources WHERE key = 'gridley') and restore this "
        + 'table with ingest_source_id set to it, or reinstate and then UPDATE the column. '
        + 'Never insert a sources row for this: migration 080 seeds it, so the candidate '
        + 'already has one.',
    }],
    note: 'The grid platforms boards are captured from — one row, gridley, seeded by '
      + 'migration 080 itself. Reinstated FIRST of the three: the truncate removes the '
      + "candidate's seed so the dump's row keeps its id and external_grids.source_id "
      + 'lands on the same id. Immutable captured evidence with no rebuild stage.',
  },
  {
    schema: 'public', name: 'external_grids', subsystem: 'Grid Solver corpus', category: 'operations',
    productionOnly: true, treatment: 'reinstate', compare: 'equal', order: 30,
    footballRefs: [{
      column: 'import_batch_id', references: 'import_batches', nullable: false,
      remediation: 'import_batches is import-writable, so the rebuilt candidate holds the '
        + "rebuild's batches and NOT the batch that captured the corpus. This reference "
        + 'will dangle on any real promotion and the column is NOT NULL, so the nullable '
        + 'exception path of docs/production-promotion.md §7.4 does not apply. Decide it '
        + 'explicitly and record the choice: either reinstate the referenced import_batches '
        + 'row(s) from the pre-cutover dump BEFORE this table (their ids must not collide '
        + "with the candidate's own, and the identity sequence must be re-synced), or open "
        + 'ONE batch in the candidate for the reinstatement and set import_batch_id to it, '
        + "which rewrites the corpus's ingest provenance and must be stated in the "
        + 'promotion record. Never drop the rows: the captured payload is the evidence. '
        + 'See docs/production-promotion.md §7.4b.',
    }],
    note: 'One row per captured REVISION of one external grid board, with the raw payload '
      + 'that is the evidence a parse was made from. Immutable by design (ISSUE-118 §10.4) '
      + 'and irreplaceable: the rescued legacy archive cannot be re-fetched. After '
      + 'external_grid_sources, before external_grid_axes.',
  },
  {
    schema: 'public', name: 'external_grid_axes', subsystem: 'Grid Solver corpus', category: 'operations',
    productionOnly: true, treatment: 'reinstate', compare: 'equal', order: 40,
    note: 'The six captured criteria of one board revision. ON DELETE CASCADE from '
      + 'external_grids, so it is reinstated LAST of the three; its own rows carry the '
      + "source's stable criterion keys and raw text, which no later parse can recover.",
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

/**
 * Public tables restored from the pre-cutover dump, in FK-safe order.
 *
 * AFLDB-ISSUE-143: a table declared historical-only for this environment is NOT here, which
 * is what makes the omission real rather than a comment — `reinstatePlan` generates its
 * `pg_restore` lines from this list and `resyncIdentitySql` its sequences.
 */
export function reinstatedPublicTables(environment: Environment = DEFAULT_ENVIRONMENT): string[] {
  return publicContractTables()
    .filter((t) => effectiveTreatment(t, environment) === 'reinstate')
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
    .map((t) => t.name);
}

/**
 * The tables under each treatment, as the audit marker lists them. A historical-only table
 * appears under none of them — it has its own list (`historicalOnlyTables`), because
 * "truncated and left empty" is what happens to it but not why.
 */
export function tablesWithTreatment(
  treatment: Treatment, environment: Environment = DEFAULT_ENVIRONMENT,
): string[] {
  return PROMOTION_CONTRACT
    .filter((t) => historicalOnlyFor(t, environment) === undefined && t.treatment === treatment)
    .map((t) => (t.schema === 'public' ? t.name : `${t.schema}.*`));
}

// ---------------------------------------------------------------------------
// Historical-only / recorded-gap disposition — AFLDB-ISSUE-143
// ---------------------------------------------------------------------------

/** The disposition in force for one table in one environment, or `undefined`. */
export function historicalOnlyFor(
  table: TableTreatment, environment: Environment = DEFAULT_ENVIRONMENT,
): HistoricalOnly | undefined {
  const declared = table.historicalOnly;
  if (!declared) return undefined;
  return declared.environments.includes(environment) ? declared : undefined;
}

export type HistoricalOnlyEntry = { table: TableTreatment; disposition: HistoricalOnly };

/** Every table intentionally not reinstated in this environment, in reinstatement order. */
export function historicalOnlyTables(
  environment: Environment = DEFAULT_ENVIRONMENT,
): HistoricalOnlyEntry[] {
  return publicContractTables()
    .map((table) => ({ table, disposition: historicalOnlyFor(table, environment) }))
    .filter((e): e is HistoricalOnlyEntry => e.disposition !== undefined)
    .sort((a, b) => a.table.order - b.table.order || a.table.name.localeCompare(b.table.name));
}

/**
 * Is this EXACT table and column declared historical-only here? The whole acceptance rule
 * of AFLDB-ISSUE-143 in one predicate: anything it says no to still refuses.
 */
export function isHistoricalOnlyColumn(
  tableName: string, column: string, environment: Environment = DEFAULT_ENVIRONMENT,
): boolean {
  const table = contractByName(tableName);
  if (!table) return false;
  const disposition = historicalOnlyFor(table, environment);
  return disposition !== undefined && disposition.columns.includes(column);
}

/** What actually happens to the rows here: `reset` (truncated, left empty) when declared. */
export function effectiveTreatment(
  table: TableTreatment, environment: Environment = DEFAULT_ENVIRONMENT,
): Treatment {
  return historicalOnlyFor(table, environment) ? 'reset' : table.treatment;
}

/** `--compare` expects zero rows for a table the plan deliberately did not reinstate. */
export function effectiveCompare(
  table: TableTreatment, environment: Environment = DEFAULT_ENVIRONMENT,
): CompareRule {
  return historicalOnlyFor(table, environment) ? 'zero' : table.compare;
}

/**
 * Everything wrong with one table's historical-only declaration, as plain sentences. Pure,
 * so the unit tests exercise every rule on synthetic tables instead of on the real contract.
 * An undeclared table has no problems by definition.
 */
export function historicalOnlyProblems(table: TableTreatment): string[] {
  const d = table.historicalOnly;
  if (!d) return [];
  const problems: string[] = [];
  if (table.schema !== 'public') problems.push('is not a public table, so it has no lineage-bound columns');
  if (table.treatment !== 'reinstate') {
    problems.push(`has treatment '${table.treatment}': only a reinstated table can be withheld as historical-only`);
  }
  if (d.environments.length === 0) problems.push('declares a historical-only disposition for no environment');
  for (const environment of d.environments) {
    if (!ENVIRONMENTS.includes(environment)) problems.push(`names an unknown environment '${environment}'`);
  }
  const declared = (table.lineageRefs ?? []).map((r) => r.column);
  if (declared.length === 0) {
    problems.push('declares no lineage-bound column, so there is nothing for a lineage disposition to decide');
  }
  const missing = declared.filter((c) => !d.columns.includes(c));
  const extra = d.columns.filter((c) => !declared.includes(c));
  if (missing.length > 0) {
    problems.push(`withholds the table but does not name its lineage-bound column(s) ${missing.join(', ')} — `
      + 'a table that is not reinstated cannot have one of its columns remapped, so the '
      + 'disposition must name every one of them or be re-decided');
  }
  if (extra.length > 0) problems.push(`names column(s) ${extra.join(', ')}, which are not lineage-bound`);
  for (const [field, value] of [['decidedBy', d.decidedBy], ['summary', d.summary], ['reason', d.reason]] as const) {
    if (value.trim().length === 0) problems.push(`has an empty ${field}`);
  }
  return problems;
}

/**
 * The contract's own invariants, checked before anything reads it — `tools/db/promotion-check.ts`
 * calls this before its first query, and the unit tests call it directly. Every rule here
 * exists so a historical-only declaration cannot quietly become a general relaxation.
 */
export function assertContractCoherent(): void {
  for (const table of PROMOTION_CONTRACT) {
    const where = `${table.schema}.${table.name}`;
    const problems = historicalOnlyProblems(table);
    // Condition (2) of AFLDB-ISSUE-143, proved rather than promised: acceptance and omission
    // come from one declaration, so the gate and the generated plan cannot disagree.
    for (const environment of table.historicalOnly?.environments ?? []) {
      if (ENVIRONMENTS.includes(environment) && reinstatedPublicTables(environment).includes(table.name)) {
        problems.push(`is declared historical-only for '${environment}' yet the generated plan still reinstates it`);
      }
    }
    if (problems.length > 0) {
      throw new PromotionRefused(`Incoherent promotion contract: ${where} ${problems.join('; ')}.`);
    }
  }
}

/**
 * Why one lineage-bound column's unresolved rows are refused or accepted. The gate reports
 * this; it does not decide it.
 */
export type LineageJudgement = {
  refused: { table: string; column: string; unresolved: number }[];
  accepted: { table: string; column: string; unresolved: number; decidedBy: string }[];
  refusedTotal: number;
  acceptedTotal: number;
  /** `FAIL` if anything is refused; otherwise `WARN` — a lineage change is never silent. */
  verdict: 'WARN' | 'FAIL';
};

/**
 * The acceptance rule, as a pure function of the contract and the measured counts.
 *
 * A column's unresolved rows are accepted ONLY when this exact table and this exact column
 * are declared historical-only for the environment being promoted. Every other unresolved
 * row refuses, exactly as before AFLDB-ISSUE-143 — including another column of a table that
 * has a disposition, and including every column of every other table.
 */
export function judgeLineage(input: {
  environment: Environment;
  columns: readonly { table: string; column: string; unresolved: number }[];
}): LineageJudgement {
  const out: LineageJudgement = {
    refused: [], accepted: [], refusedTotal: 0, acceptedTotal: 0, verdict: 'WARN',
  };
  for (const c of input.columns) {
    if (c.unresolved === 0) continue;
    if (isHistoricalOnlyColumn(c.table, c.column, input.environment)) {
      const decidedBy = contractByName(c.table)!.historicalOnly!.decidedBy;
      out.accepted.push({ ...c, decidedBy });
      out.acceptedTotal += c.unresolved;
    } else {
      out.refused.push({ ...c });
      out.refusedTotal += c.unresolved;
    }
  }
  out.verdict = out.refusedTotal === 0 ? 'WARN' : 'FAIL';
  return out;
}

/** Non-public schemas reinstated wholesale. */
export function reinstatedSchemas(): string[] {
  return PROMOTION_CONTRACT
    .filter((t) => t.schema !== 'public' && t.treatment === 'reinstate')
    .map((t) => t.schema);
}

// ---------------------------------------------------------------------------
// Lineage-safe reinstatement — AFLDB-ISSUE-142 (B)
// ---------------------------------------------------------------------------

/**
 * Every reinstated table that carries ids of the replaced database, with its columns.
 * Empty of consequence when the candidate shares the old id lineage (a production
 * promotion restored from the same rebuild), which is why the gate proves that first.
 */
export function lineageBoundTables(): TableTreatment[] {
  return publicContractTables().filter((t) => (t.lineageRefs?.length ?? 0) > 0);
}

/** Every entity a lineage-bound column can point at, with the rule that identifies it. */
export function lineageTargetsOf(table: TableTreatment): { ref: LineageRef; target: LineageTarget }[] {
  return (table.lineageRefs ?? []).flatMap((ref) => ref.targets.map((target) => ({ ref, target })));
}

/**
 * The identity of a row, in SQL, asked of BOTH databases by identical logic. `byId` takes a
 * bigint[] of row ids; `byIdentity` takes a text[] of identities. Both return `(id,
 * identity)` pairs and nothing else — no name, no date, no club — so a name match is not
 * merely forbidden here, it is unavailable.
 */
export const LINEAGE_IDENTITY_SQL: Readonly<Record<
  Exclude<LineageIdentityRule, 'none'>,
  { entity: string; description: string; byId: string; byIdentity: string }
>> = {
  afltables_profile_url: {
    entity: 'players',
    description: "external_identities: source 'afltables', match_method "
      + "'afltables_profile_url', status unique/resolved — the AFL Tables profile path",
    byId: `
      SELECT ei.player_id::bigint AS id, ei.external_id AS identity
        FROM external_identities ei
        JOIN sources s ON s.id = ei.source_id
       WHERE s.key = 'afltables'
         AND ei.match_method = 'afltables_profile_url'
         AND ei.status IN ('unique', 'resolved')
         AND ei.player_id IS NOT NULL
         AND ei.player_id = ANY ($1::bigint[])
       ORDER BY 1, 2`,
    byIdentity: `
      SELECT ei.player_id::bigint AS id, ei.external_id AS identity
        FROM external_identities ei
        JOIN sources s ON s.id = ei.source_id
       WHERE s.key = 'afltables'
         AND ei.match_method = 'afltables_profile_url'
         AND ei.status IN ('unique', 'resolved')
         AND ei.player_id IS NOT NULL
         AND ei.external_id = ANY ($1::text[])
       ORDER BY 1, 2`,
  },
  match_key: {
    entity: 'matches',
    description: 'matches.match_key — NOT NULL UNIQUE (migration 003), the natural key the '
      + 'settle projections link on (migration 076)',
    byId: `
      SELECT id::bigint AS id, match_key AS identity
        FROM public.matches
       WHERE id = ANY ($1::bigint[])
       ORDER BY 1, 2`,
    byIdentity: `
      SELECT id::bigint AS id, match_key AS identity
        FROM public.matches
       WHERE match_key = ANY ($1::text[])
       ORDER BY 1, 2`,
  },
};

/** Why one id could not be carried across the lineage change. Every case refuses. */
export type LineageRemapReason =
  | 'no_stable_identity_rule'      // the contract has no identity for this entity at all
  | 'no_identity_in_replaced'      // the replaced database's row carries no stable identity
  | 'ambiguous_in_replaced'        // one old id, more than one stable identity
  | 'identity_absent_in_candidate' // the identity does not exist in the new lineage
  | 'ambiguous_in_candidate';      // one identity, more than one candidate row

export type IdentityPair = { id: number; identity: string };

export type LineageRemap = {
  entity: string;
  rule: LineageIdentityRule;
  /** Evidenced old -> new, each proved by one identity string read from both databases. */
  mapped: { oldId: number; identity: string; newId: number }[];
  unresolved: { oldId: number; reason: LineageRemapReason; identity?: string }[];
  /** Old rows that fold onto one candidate row (an AFLDB-ISSUE-136 identity merge). */
  merges: { newId: number; oldIds: number[] }[];
  /** Mapped ids whose value does not change. On a shared lineage this is all of them. */
  unchanged: number;
};

/**
 * The whole remap rule, as a pure function of two id<->identity readings.
 *
 * It never sees a name, so it cannot match on one. It maps an old id ONLY when exactly one
 * stable identity is read for it in the replaced database and exactly one candidate row
 * carries that same identity string. Every other shape is unresolved, and unresolved always
 * refuses: dropping the row, nulling the reference or keeping the old integer would each
 * silently change who a human decision is about.
 */
export function resolveLineageRemap(input: {
  entity: string;
  rule: LineageIdentityRule;
  referencedIds: readonly number[];
  replacedIdentities: readonly IdentityPair[];
  candidateIdentities: readonly IdentityPair[];
}): LineageRemap {
  const ids = [...new Set(input.referencedIds)].sort((a, b) => a - b);
  const out: LineageRemap = {
    entity: input.entity, rule: input.rule, mapped: [], unresolved: [], merges: [], unchanged: 0,
  };
  if (input.rule === 'none') {
    for (const oldId of ids) out.unresolved.push({ oldId, reason: 'no_stable_identity_rule' });
    return out;
  }

  const oldIdentities = new Map<number, Set<string>>();
  for (const row of input.replacedIdentities) {
    if (!oldIdentities.has(row.id)) oldIdentities.set(row.id, new Set());
    oldIdentities.get(row.id)!.add(row.identity);
  }
  const newIds = new Map<string, Set<number>>();
  for (const row of input.candidateIdentities) {
    if (!newIds.has(row.identity)) newIds.set(row.identity, new Set());
    newIds.get(row.identity)!.add(row.id);
  }

  for (const oldId of ids) {
    const identities = [...(oldIdentities.get(oldId) ?? [])].sort();
    if (identities.length === 0) { out.unresolved.push({ oldId, reason: 'no_identity_in_replaced' }); continue; }
    if (identities.length > 1) { out.unresolved.push({ oldId, reason: 'ambiguous_in_replaced' }); continue; }
    const identity = identities[0];
    const candidates = [...(newIds.get(identity) ?? [])].sort((a, b) => a - b);
    if (candidates.length === 0) { out.unresolved.push({ oldId, reason: 'identity_absent_in_candidate', identity }); continue; }
    if (candidates.length > 1) { out.unresolved.push({ oldId, reason: 'ambiguous_in_candidate', identity }); continue; }
    out.mapped.push({ oldId, identity, newId: candidates[0] });
    if (candidates[0] === oldId) out.unchanged += 1;
  }

  const byNew = new Map<number, number[]>();
  for (const m of out.mapped) {
    if (!byNew.has(m.newId)) byNew.set(m.newId, []);
    byNew.get(m.newId)!.push(m.oldId);
  }
  for (const [newId, oldIds] of [...byNew].sort((a, b) => a[0] - b[0])) {
    if (oldIds.length > 1) out.merges.push({ newId, oldIds: [...oldIds].sort((a, b) => a - b) });
  }
  return out;
}

export type LineageSample = { id: number; replaced?: string; candidate?: string };

export type LineageVerdict = {
  /** True unless every comparable sample agreed. No comparable sample = changed. */
  changed: boolean;
  agreed: number;
  differed: { id: number; replaced: string; candidate: string }[];
  /** Ids with no identity on one side or the other: they prove nothing either way. */
  incomparable: number;
};

/**
 * Does the candidate share the replaced database's id lineage? Answered from evidence — the
 * same id read on both sides must denote the same identity — and fails closed: if nothing
 * could be compared, the answer is "changed", so a missing identity layer can never be read
 * as "safe to reinstate by id".
 */
export function detectLineageChange(samples: readonly LineageSample[]): LineageVerdict {
  const differed: LineageVerdict['differed'] = [];
  let agreed = 0;
  let incomparable = 0;
  for (const s of samples) {
    if (s.replaced === undefined || s.candidate === undefined) { incomparable += 1; continue; }
    if (s.replaced === s.candidate) agreed += 1;
    else differed.push({ id: s.id, replaced: s.replaced, candidate: s.candidate });
  }
  return { changed: differed.length > 0 || agreed === 0, agreed, differed, incomparable };
}

/** One column of one table, resolved against the candidate. Rows carry their own row id. */
export type LineageColumnPlan = {
  table: string;
  column: string;
  kindColumn?: string;
  kind?: string;
  entity: string;
  rule: LineageIdentityRule;
  remediation: string;
  /** The rows read from the replaced database, one per (row id, current value). */
  rows: { rowId: number; oldValue: number }[];
  remap: LineageRemap;
};

export type LineageRemapInput = {
  candidate: string;
  oldDatabase: string;
  environment?: Environment;
  plans: readonly LineageColumnPlan[];
};

/**
 * The remap as SQL an operator reads, then runs on the candidate AFTER the reinstate.
 *
 * One UPDATE per ROW, each guarded by the value it was proved against, so the file is its
 * own audit trail and re-running it is a no-op. Nothing is emitted for an id that was not
 * evidenced: those become `-- UNRESOLVED` lines naming the reason, and the trailing
 * verification query fails until every one of them has been dealt with deliberately.
 */
export function lineageRemapSql(input: LineageRemapInput): string {
  const names = environmentNames(input.environment ?? DEFAULT_ENVIRONMENT);
  const withheld = (plan: LineageColumnPlan): boolean =>
    isHistoricalOnlyColumn(plan.table, plan.column, names.environment);
  const lines: string[] = [];
  lines.push('-- AFLDB-ISSUE-142 (B) — lineage remap for reinstated human/admin rows.');
  lines.push(`-- Candidate '${input.candidate}' (${names.environment}) does NOT share the id lineage of`);
  lines.push(`-- '${input.oldDatabase}'. Each UPDATE below is evidenced by ONE stable identity string`);
  lines.push('-- read from both databases in the same read-only pass: old id -> identity -> new id.');
  lines.push('-- No row is matched by name. Run AFTER the reinstate, BEFORE --phase candidate.');
  lines.push('');
  lines.push('BEGIN;');

  let unresolvedTotal = 0;
  for (const plan of input.plans) {
    const scope = plan.kindColumn ? ` WHERE ${plan.kindColumn} = '${plan.kind}'` : '';
    lines.push('');
    lines.push(`-- ${plan.table}.${plan.column}${scope} -> ${plan.entity} (identity: ${plan.rule})`);
    // AFLDB-ISSUE-143. Nothing is emitted for a table the plan did not reinstate: there are
    // no rows in the candidate to update, and an UPDATE here would be the very
    // reinstatement the disposition declined. The evidence is written down instead.
    if (withheld(plan)) {
      const disposition = contractByName(plan.table)!.historicalOnly!;
      lines.push(`-- HISTORICAL-ONLY (AFLDB-ISSUE-143) under --environment ${names.environment}:`);
      lines.push(`--   ${disposition.decidedBy}`);
      lines.push(`--   ${plan.rows.length} row(s) read from ${input.oldDatabase}, `
        + `${plan.remap.mapped.length} evidenced, ${plan.remap.unresolved.length} unresolved — `
        + 'NONE of them reinstated, so NONE of them remapped.');
      for (const line of wrapComment(disposition.reason, 92)) lines.push(`--   ${line}`);
      lines.push(`--   The rows survive in the pre-cutover dump and in `
        + `${names.preRebuildPrefix}<stamp>. No statement is generated for this column.`);
      continue;
    }
    const byOld = new Map(plan.remap.mapped.map((m) => [m.oldId, m] as const));
    for (const row of plan.rows) {
      const m = byOld.get(row.oldValue);
      if (!m) continue;
      if (m.newId === m.oldId) continue;
      const guard = plan.kindColumn ? ` AND ${plan.kindColumn} = '${plan.kind}'` : '';
      lines.push(`--   ${m.oldId} -> ${m.identity} -> ${m.newId}`);
      lines.push(`UPDATE public.${plan.table} SET ${plan.column} = ${m.newId}`
        + ` WHERE id = ${row.rowId} AND ${plan.column} = ${m.oldId}${guard};`);
    }
    for (const u of plan.remap.unresolved) {
      unresolvedTotal += 1;
      const rows = plan.rows.filter((r) => r.oldValue === u.oldId).map((r) => r.rowId);
      lines.push(`-- UNRESOLVED ${plan.table}.${plan.column} = ${u.oldId} (${u.reason}`
        + `${u.identity ? `, identity ${u.identity}` : ''}) — ${plan.table} row(s) ${rows.join(', ')}`);
    }
    for (const merge of plan.remap.merges) {
      lines.push(`-- MERGE ${plan.entity} ${merge.oldIds.join(', ')} -> ${merge.newId}`
        + ' (one candidate row; both decisions now attach to it)');
    }
    if (plan.remap.unresolved.length > 0) {
      for (const line of plan.remediation.split('\n')) lines.push(`--   ${line}`);
    }
  }

  lines.push('');
  const withheldColumns = input.plans.filter(withheld);
  if (withheldColumns.length > 0) {
    lines.push(`-- ${withheldColumns.length} column(s) are HISTORICAL-ONLY by contract and generate`);
    lines.push('-- nothing here; the tables they belong to have no reinstate line in the plan and');
    lines.push('-- must read 0 rows at --phase candidate. This file remaps the REST.');
  }
  lines.push(unresolvedTotal === 0
    ? '-- Every referenced id was evidenced. COMMIT is safe once the counts above are read.'
    : `-- ${unresolvedTotal} id(s) could NOT be evidenced. NOTHING above resolves them: decide each`);
  if (unresolvedTotal > 0) {
    lines.push('-- one deliberately, record the decision in the promotion record and the');
    lines.push('-- database.promoted marker, and do not COMMIT until you have.');
  }
  lines.push('COMMIT;');
  lines.push('');
  lines.push('-- Verification: every remapped value must now resolve to the identity it was');
  lines.push('-- proved against. This is the proof that no row changed semantic owner.');
  for (const plan of input.plans) {
    if (plan.remap.mapped.length === 0 || withheld(plan)) continue;
    const pairs = plan.remap.mapped.map((m) => `(${m.newId}, ${quote(m.identity)})`).join(', ');
    const guard = plan.kindColumn ? ` AND t.${plan.kindColumn} = '${plan.kind}'` : '';
    lines.push(`-- ${plan.table}.${plan.column}: expect 0 rows`);
    lines.push(`SELECT t.id, t.${plan.column} FROM public.${plan.table} t`
      + ` WHERE t.${plan.column} IS NOT NULL${guard}`
      + ` AND t.${plan.column} NOT IN (SELECT id FROM (VALUES ${pairs}) v(id, identity));`);
  }
  return `${lines.join('\n')}\n`;
}

function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
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

/**
 * AFLDB-ISSUE-141. Which live database this promotion is for. It is ALWAYS explicit: the
 * checker takes `--environment prod|dev`, defaults to `prod`, and never infers it from a
 * database name — inferring it would mean a typo could select the relaxations below.
 *
 * `dev` exists because `AFLDB-ISSUE-139` must converge `afldb_dev` through the same
 * supported path, not through hand-written per-table dump/restore, which is the
 * improvisation this procedure exists to prevent. It is one MORE accepted name shape per
 * phase, not a name-free phase: the fail-closed matrix is identical, and a `prod` name
 * under `dev` (or the reverse) is still refused.
 *
 * DEV IS NOT PRODUCTION AUTHORITY. A dev promotion has no real administrator identity to
 * protect, so two gates differ — and only when asked for, in writing, on the command line.
 * See `docs/production-promotion.md` §13.
 */
export type Environment = 'prod' | 'dev';

export const ENVIRONMENTS: readonly Environment[] = ['prod', 'dev'];

/** The default is `prod`: an operator who states nothing gets the production contract. */
export const DEFAULT_ENVIRONMENT: Environment = 'prod';

export type EnvironmentNames = {
  environment: Environment;
  /** The live database the candidate is eventually renamed to. */
  live: string;
  /** `<prefix><stamp>` — the restored candidate, never the live name. */
  candidatePrefix: string;
  /** `<prefix><stamp>` — the live database renamed aside by the swap, and kept. */
  preRebuildPrefix: string;
  /** The rebuilt source. `afldb_test` for both: `db:test:rebuild` accepts no other name. */
  source: string;
  /** The host label the generated plan prints. */
  host: string;
};

const ENVIRONMENT_NAMES: Readonly<Record<Environment, EnvironmentNames>> = {
  prod: {
    environment: 'prod',
    live: 'afldb_prod',
    candidatePrefix: 'afldb_prod_candidate_',
    // Matches the read-only convention `tools/db/rebuild-test.ts` already enforces.
    preRebuildPrefix: 'afldb_prod_pre_rebuild_',
    source: 'afldb_test',
    host: 'PROD (afldb-prod)',
  },
  dev: {
    environment: 'dev',
    live: 'afldb_dev',
    candidatePrefix: 'afldb_dev_candidate_',
    preRebuildPrefix: 'afldb_dev_pre_rebuild_',
    source: 'afldb_test',
    host: 'DEV (streamanator)',
  },
};

export function environmentNames(environment: Environment = DEFAULT_ENVIRONMENT): EnvironmentNames {
  const names = ENVIRONMENT_NAMES[environment];
  if (!names) throw new PromotionRefused(`Unknown environment '${environment}'.`);
  return names;
}

/** The production names, kept as named constants because the procedure and its docs cite them. */
export const PRODUCTION_DATABASE = ENVIRONMENT_NAMES.prod.live;
export const SOURCE_DATABASE = ENVIRONMENT_NAMES.prod.source;
export const CANDIDATE_PREFIX = ENVIRONMENT_NAMES.prod.candidatePrefix;
export const PRE_REBUILD_PREFIX = ENVIRONMENT_NAMES.prod.preRebuildPrefix;

export type Phase = 'source' | 'pre-cutover' | 'restored' | 'candidate' | 'production';

export const PHASES: readonly Phase[] = ['source', 'pre-cutover', 'restored', 'candidate', 'production'];

export class PromotionRefused extends Error {}

/**
 * The database each phase may be pointed at, within one explicitly named environment.
 * Anything else is refused by name. The environment is a parameter, never a deduction from
 * the name offered: `--environment dev` with `afldb_prod` is refused, and so is
 * `--environment prod` (the default) with `afldb_dev_candidate_<stamp>`.
 */
export function assertDatabaseForPhase(
  phase: Phase, database: string, environment: Environment = DEFAULT_ENVIRONMENT,
): void {
  const names = environmentNames(environment);
  const nameOk = /^[a-z_][a-z0-9_-]*$/i.test(database);
  if (!nameOk) throw new PromotionRefused(`'${database}' is not a plausible database name.`);
  switch (phase) {
    case 'source':
      if (database !== names.source) {
        throw new PromotionRefused(
          `Phase 'source' inspects the rebuilt '${names.source}' only, not '${database}'.`);
      }
      return;
    case 'pre-cutover':
    case 'production':
      if (database !== names.live) {
        throw new PromotionRefused(
          `Phase '${phase}' inspects '${names.live}' only (--environment ${environment}), not '${database}'.`);
      }
      return;
    case 'restored':
    case 'candidate':
      if (!database.startsWith(names.candidatePrefix) || database.length === names.candidatePrefix.length) {
        throw new PromotionRefused(
          `Phase '${phase}' inspects a candidate database named '${names.candidatePrefix}<stamp>' `
          + `(--environment ${environment}), not '${database}'. The name is the safety: the live `
          + `'${names.live}' is never a candidate.`);
      }
      return;
  }
}

/** The old live database the `restored` probe reads, within the named environment. */
export function assertOldDatabaseName(
  database: string, environment: Environment = DEFAULT_ENVIRONMENT,
): void {
  const names = environmentNames(environment);
  if (database === names.live) return;
  if (database.startsWith(names.preRebuildPrefix) && database.length > names.preRebuildPrefix.length) return;
  throw new PromotionRefused(
    `--old-database must be '${names.live}' (before the swap) or `
    + `'${names.preRebuildPrefix}<stamp>' (after it), not '${database}' `
    + `(--environment ${environment}).`);
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
  /** Defaults to `prod`, so every existing caller and every existing plan is unchanged. */
  environment?: Environment;
};

function sqlArray(names: readonly string[]): string {
  return `ARRAY[${names.map((n) => `'${n}'`).join(', ')}]`;
}

/** Soft-wrap a reason for a comment block, so a plan stays readable in a terminal. */
function wrapComment(text: string, width: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line.length === 0) line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else { out.push(line); line = word; }
  }
  if (line.length > 0) out.push(line);
  return out;
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
export function resyncIdentitySql(environment: Environment = DEFAULT_ENVIRONMENT): string {
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
       AND c.relname = ANY (${sqlArray(reinstatedPublicTables(environment))})
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
  const names = environmentNames(input.environment ?? DEFAULT_ENVIRONMENT);
  const label = names.environment === 'prod' ? 'production promotion' : 'dev promotion';
  // AFLDB-ISSUE-143: an intentional omission is only a decision if the promoted database
  // carries the record of it. Each withheld table is named twice — once in a list the marker
  // can be queried by, once in prose among the recorded gaps, with the deciding issue.
  const withheld = historicalOnlyTables(names.environment);
  const historicalList = withheld.length === 0
    ? "ARRAY[]::text[]"
    : `ARRAY[${withheld.map((e) => j(`${e.table.name} (${e.disposition.decidedBy})`)).join(', ')}]`;
  const historicalGaps = withheld
    .map((e) => `,\n      ${j(`${e.disposition.summary} [${e.disposition.decidedBy}]`)}`)
    .join('');
  return `-- AFLDB-ISSUE-125: the audit trail records the promotion itself. An operator, not a
-- user, so actor_user_id is NULL and actor_label names the procedure.
INSERT INTO auth_audit_log (actor_user_id, actor_label, action, detail)
VALUES (
  NULL,
  'operator: ${label} (AFLDB-ISSUE-125)',
  'database.promoted',
  jsonb_build_object(
    'issue', 'AFLDB-ISSUE-125',
    'candidate', ${j(input.candidate)},
    'replaced', ${j(input.oldDatabase)},
    'rebuilt_dump', ${j(input.rebuiltDump)},
    'pre_cutover_dump', ${j(input.preCutoverDump)},
    'environment', ${j(input.environment ?? DEFAULT_ENVIRONMENT)},
    'reinstated', to_jsonb(${sqlArray(tablesWithTreatment('reinstate', names.environment))}),
    'reset', to_jsonb(${sqlArray(tablesWithTreatment('reset', names.environment))}),
    'regenerated', to_jsonb(${sqlArray(tablesWithTreatment('regenerate', names.environment))}),
    'taken_from_rebuild', to_jsonb(${sqlArray(tablesWithTreatment('rebuilt', names.environment))}),
    'historical_only', to_jsonb(${historicalList}),
    'recorded_gaps', to_jsonb(ARRAY[
      'promotion_decisions: reset, retained only in the pre-cutover dump',
      'canonical_applications and staging.*: settle history replaced by the rebuild',
      'auth_sessions: reset, every administrator signs in again',
      'external_grids.import_batch_id: the capturing batch is not in the rebuilt candidate; see the promotion record',
      'id-keyed ledgers (player_link_resolutions, data_edits): if the candidate did not share the replaced database''s id lineage, the promotion record states how each lineage-bound column was resolved'${historicalGaps}
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
  const names = environmentNames(input.environment ?? DEFAULT_ENVIRONMENT);
  const envFlag = names.environment === 'prod' ? '' : ` --environment ${names.environment}`;
  const lines: string[] = [];
  lines.push(`# AFLDB-ISSUE-125 reinstatement plan — candidate '${input.candidate}' (${names.environment})`);
  lines.push(`# Run on ${names.host} as the owner role. CANDIDATE_DSN is the owner DSN with the`);
  lines.push('# database name replaced; never paste a DSN into a tracked file or a transcript.');
  lines.push('');
  lines.push('# 1. Empty every production-owned/operational table the rebuilt dump carried.');
  lines.push(`psql "$CANDIDATE_DSN" -v ON_ERROR_STOP=1 -f promotion-truncate.sql`);
  lines.push('');
  // AFLDB-ISSUE-143. The omission is stated in the plan an operator actually follows, with
  // the reason and the deciding issue, before the restore lines it is missing from.
  const withheld = historicalOnlyTables(names.environment);
  if (withheld.length > 0) {
    lines.push('# INTENTIONALLY NOT REINSTATED (AFLDB-ISSUE-143 historical-only / recorded gap).');
    lines.push(`# ${withheld.length} table(s) below have NO pg_restore line in step 2 by contract, not by`);
    lines.push('# oversight. Each is still TRUNCATED in step 1, so the candidate holds none of the');
    lines.push(`# rebuilt copy either; --phase candidate expects 0 rows in each. Nothing is deleted:`);
    lines.push(`# every row survives in ${input.preCutoverDump} and in the retained`);
    lines.push(`# ${names.preRebuildPrefix}<stamp> database. Record this in the promotion record.`);
    for (const { table, disposition } of withheld) {
      lines.push('#');
      lines.push(`#   public.${table.name} — ${disposition.decidedBy}`);
      lines.push(`#     columns withheld: ${disposition.columns.join(', ')}`);
      for (const line of wrapComment(disposition.reason, 84)) lines.push(`#     ${line}`);
    }
    lines.push('');
  }
  lines.push('# 2. Reinstate production-owned rows from the pre-cutover dump, one table at a time,');
  lines.push('#    in foreign-key order. --data-only: the schema is the rebuilt one.');
  for (const table of reinstatedPublicTables(names.environment)) {
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
  lines.push(`npm run db:promotion:check -- --phase candidate --database ${input.candidate}${envFlag} \\`);
  lines.push(names.environment === 'prod'
    ? '    --compare <snapshot.json> --expect-super-admin <real production super admin email>'
    : '    --compare <snapshot.json> [--expect-super-admin <email>]   # optional on DEV, enforced when given');
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
  'Captured grid corpus (migration 080) reinstated, and its two NOT NULL references settled BEFORE its restore lines: external_grid_sources.ingest_source_id onto the candidate\'s gridley sources row, and external_grids.import_batch_id per docs/production-promotion.md §7.4b, with the choice recorded. Rows are never dropped to make the FK pass.',
  'Lineage proved at `--phase restored`: the candidate either shares the replaced database\'s id lineage, or every reinstated id-keyed column (player_link_resolutions.player_id and .target_id, data_edits.row_id) was resolved through a stable external identity and the generated remap applied — with every unresolved id decided deliberately and recorded. Never remapped by name, never left on the old integer.',
  'Historical-only tables (AFLDB-ISSUE-143) confirmed: for each table the contract withholds in this environment, the generated plan had no pg_restore line, the candidate reads 0 rows, the rows are present in the pre-cutover dump and the retained pre-rebuild database, and the database.promoted marker names the table and the deciding issue. Nothing was deleted to achieve this and no column was remapped by name.',
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
