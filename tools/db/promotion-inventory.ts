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
 *   source_key             sources.key — the stable acquisition-source key used across
 *                          rebuilt id lineages (for example `gridley`).
 *   afltables_coach_path   coaches.afltables_coach_path — NOT NULL UNIQUE since migration
 *                          087, the AFL Tables coach page path, and `manual:<token>` for
 *                          an admin-created coach (AFLDB-ISSUE-159 §1). Minted once and
 *                          never edited, so it survives a rebuild on both databases.
 *                          Deliberately NOT `coaches.name_key`: that is a name.
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
export type LineageIdentityRule =
  'afltables_profile_url' | 'match_key' | 'source_key' | 'afltables_coach_path'
  | 'draft_pick_key' | 'none';

/**
 * AFLDB-ISSUE-151. The schema a STAGED table is restored into before its rows meet a
 * NOT NULL foreign key whose target ids belong to the candidate's lineage (see
 * `isStagedReinstatement`). Created by the generated plan, dropped by the same plan; never
 * part of the application schema.
 */
export const STAGING_SCHEMA = 'promotion_staging';

export type RestoreDependency = {
  /** The table whose rows are restored after every table in `dependsOn`. */
  table: string;
  /** Direct FK parents within the same reinstated schema. */
  dependsOn: readonly string[];
};

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
  /**
   * Schema-level `reinstate` entries only: every table of the schema, in foreign-key
   * order. `pg_restore --data-only --schema=<s>` restores tables in the dump's TOC order
   * (alphabetical), and `--single-transaction --exit-on-error` then fails on the first
   * FK it meets (`staging_aflw.fixtures` before `staging_aflw.seasons`, met on the first
   * live DEV promotion, `AFLDB-ISSUE-139` Phase 4E-2), so the plan restores one table per
   * line in this order instead.
   */
  tables?: readonly string[];
  /** Direct FK parents among reinstated public tables. */
  restoreAfter?: readonly string[];
  /** Direct FK dependencies for `tables`, explicit so TOC/alphabetical order is never used. */
  tableDependencies?: readonly RestoreDependency[];
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
   * AFLDB-ISSUE-155. The column that uniquely identifies one row of THIS table, used to
   * anchor a per-row lineage-remap UPDATE (`WHERE <rowIdColumn> = <row> AND <column> =
   * <oldValue>`) and to order a staged promotion. Defaults to `id`, true for every table
   * declared before this field existed. Declared only where the default is wrong: a table
   * whose own primary key IS the lineage-bound column being remapped (no separate surrogate
   * `id` exists), for example `brownlow_vote_entry_state.match_id`.
   */
  rowIdColumn?: string;
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
    restoreAfter: ['auth_users'],
    note: 'Outstanding invitations (token hashes, expiry). Preserved so an invite sent '
      + 'before promotion still works after it. References auth_users.',
  },
  // --- Beta access (migrations 023, 024, 035, 036) ------------------------------------
  {
    schema: 'public', name: 'beta_access_codes', subsystem: 'beta', category: 'application',
    productionOnly: true, treatment: 'reinstate', compare: 'equal', order: 20,
    restoreAfter: ['auth_users'],
    note: 'Live access credentials cut by an operator. Explicitly preserved; the '
      + 'operator may revoke after promotion but must not lose them by accident.',
  },
  {
    schema: 'public', name: 'beta_allowed_emails', subsystem: 'beta', category: 'application',
    productionOnly: true, treatment: 'reinstate', compare: 'equal', order: 20,
    restoreAfter: ['auth_users'],
    note: 'Allowlisted readers. Fixture-domain rows are refused by the identity gate.',
  },
  {
    schema: 'public', name: 'beta_join_requests', subsystem: 'beta', category: 'application',
    productionOnly: true, treatment: 'reinstate', compare: 'equal', order: 20,
    restoreAfter: ['auth_users'],
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
    restoreAfter: ['auth_users'],
    note: 'Deliberate super-admin choices (home layout, grid audience, early-access copy, '
      + 'footer, theme). The app falls back to compiled defaults when rows are missing, '
      + 'which is exactly how a loss goes unnoticed. References auth_users.',
  },
  {
    schema: 'public', name: 'site_media', subsystem: 'admin', category: 'application',
    productionOnly: true, treatment: 'reinstate', compare: 'equal', order: 20,
    restoreAfter: ['auth_users'],
    note: 'Uploaded images (bytes live in the row). Not in the issue\'s original list; '
      + 'found in the schema. References auth_users.',
  },
  // --- Human data authority (migrations 057, 058, 073, 078) ---------------------------
  {
    schema: 'public', name: 'data_edits', subsystem: 'admin data editor', category: 'operations',
    productionOnly: true, treatment: 'reinstate', compare: 'equal', order: 20,
    restoreAfter: ['auth_users'],
    lineageRefs: [{
      column: 'row_id', kindColumn: 'table_name',
      targets: [
        { kind: 'players', entity: 'players', identity: 'afltables_profile_url' },
        { kind: 'matches', entity: 'matches', identity: 'match_key' },
        // AFLDB-ISSUE-159 §5.6. Admitting 'coaches' into data_edits.table_name
        // (migration 095) obliges a lineage target for it, because coaches is
        // rebuilt on promotion and its ids are renumbered by the swap.
        { kind: 'coaches', entity: 'coaches', identity: 'afltables_coach_path' },
        // AFLDB-ISSUE-160 D-3. 'draft_picks' has been admitted by
        // data_edits_table_name_check since migration 057, but it had no lineage
        // target -- so a draft audit row was reinstated with its row_id integer
        // unchanged and was never counted, listed or remapped, because the gate
        // enumerates only the declared targets. On a lineage-changing promotion
        // that integer then names a DIFFERENT selection: silent misattribution,
        // exactly what AFLDB-ISSUE-142 (B) exists to prevent. With the target the
        // row is remapped through the selection's stable key, or the gate reports
        // FAIL and the promotion stops before the swap. On a shared lineage the
        // gate passes unchanged, as today.
        { kind: 'draft_picks', entity: 'draft_picks', identity: 'draft_pick_key' },
      ],
      remediation: 'Every entity here has a stable identity, so every row is remappable in '
        + 'principle: resolve row_id through the AFL Tables profile url (players), '
        + 'matches.match_key, coaches.afltables_coach_path, or the draft selection key '
        + "'<source key>|<player_url>|<draft_year>|<draft_kind>' (draft_picks), and apply the "
        + 'generated per-row UPDATEs after the reinstate. A draft audit row whose selection '
        + 'carries no source_id at all (a pre-AFLDB-ISSUE-160 admin row) has NO stable key and '
        + 'is reported unresolved: adopt that selection in /admin/draft first, which mints its '
        + 'identity, or decide it explicitly. A coach edit resolves the same way whether '
        + 'the coach is source-owned or admin-created: the path is the identity either way, '
        + "'coaches/<Given>_<Surname><n>.html' or 'manual:<token>', and an admin-created "
        + 'coach is re-created in the candidate by the data_overrides replay step (§8) '
        + 'before that remap can resolve, so the replay runs first. '
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
      + 'table_name + row_id is a row id in players, matches or coaches, NOT a foreign key: it '
      + 'reinstates without tripping a constraint, and therefore without noticing a lineage '
      + 'change. AFLDB-ISSUE-142 (B): remapped through a stable identity, never by id. '
      + 'References auth_users.',
  },
  {
    schema: 'public', name: 'data_overrides', subsystem: 'admin data editor', category: 'application',
    productionOnly: true, treatment: 'reinstate', compare: 'equal', order: 20,
    restoreAfter: ['auth_users'],
    note: 'Durable human overrides that destructive reloads REPLAY over source rows. The '
      + 'rebuild ran on afldb_test, which holds none of them, so after reinstatement they '
      + 'must be replayed onto the promoted canonical rows (docs/production-promotion.md §8).',
  },
  // --- Submissions (migration 023) ---------------------------------------------------
  {
    schema: 'public', name: 'data_submissions', subsystem: 'contributor uploads', category: 'application',
    productionOnly: true, treatment: 'reinstate', compare: 'equal', order: 20,
    restoreAfter: ['auth_users'],
    footballRefs: [{ column: 'import_batch_id', references: 'import_batches', nullable: true }],
    note: 'Uploaded CSVs and their review state. import_batch_id points at a batch the '
      + 'rebuild no longer has; the checker probes it and the runbook nulls dangling refs.',
  },
  {
    schema: 'public', name: 'data_submission_rows', subsystem: 'contributor uploads', category: 'application',
    productionOnly: true, treatment: 'reinstate', compare: 'equal', order: 30,
    restoreAfter: ['data_submissions'],
    note: 'Per-row validation reports. References data_submissions.',
  },
  // --- Player-link review (migrations 056, 067) -------------------------------------
  {
    schema: 'public', name: 'player_link_suggestions', subsystem: 'player links', category: 'application',
    productionOnly: true, treatment: 'reinstate', compare: 'equal', order: 20,
    restoreAfter: ['auth_users'],
    note: 'Reader suggestions. target_id is deliberately not a FK (a dead id is an '
      + 'unsurfaced row, not an error). References auth_users.',
  },
  {
    schema: 'public', name: 'player_link_resolutions', subsystem: 'player links', category: 'operations',
    productionOnly: true, treatment: 'reinstate', compare: 'equal', order: 20,
    restoreAfter: ['auth_users'],
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
    restoreAfter: ['auth_users', 'nl_search_log'],
    note: 'Human review verdicts. References nl_search_log and auth_users.',
  },
  {
    schema: 'public', name: 'nl_search_feedback', subsystem: 'NL search telemetry', category: 'operations',
    productionOnly: true, treatment: 'reinstate', compare: 'equal', order: 30,
    restoreAfter: ['nl_search_log'],
    note: 'Reader thumbs up/down. References nl_search_log.',
  },
  {
    schema: 'public', name: 'app_health_events', subsystem: 'app health telemetry', category: 'operations',
    productionOnly: true, treatment: 'reinstate', compare: 'equal', order: 30,
    restoreAfter: ['nl_search_log'],
    note: 'Runtime health events. related_search_id is ON DELETE SET NULL, so it '
      + 'tolerates a missing log row. Preserved as a conscious retention decision.',
  },
  // --- Audit (migration 023, 082) ----------------------------------------------------
  {
    schema: 'public', name: 'auth_audit_log', subsystem: 'auth', category: 'operations',
    productionOnly: true, treatment: 'reinstate', compare: 'atLeast', order: 20,
    restoreAfter: ['auth_users'],
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
        + "'gridley' need not equal the dumped one, and the column is NOT NULL against an "
        + 'immediate FK, so a plain pg_restore of the old integer refuses (AFLDB-ISSUE-151). '
        + 'The generated plan therefore STAGES this table: its rows are restored into '
        + `${STAGING_SCHEMA}.external_grid_sources (no FK), the evidenced --lineage-remap-out `
        + 'UPDATE (old id -> sources.key -> candidate id) is applied THERE, and only then are '
        + 'the rows promoted into public.external_grid_sources under the FK, ids preserved. '
        + 'Never insert a sources row for this: migration 080 seeds it, so the candidate '
        + 'already has one.',
    }],
    lineageRefs: [{
      column: 'ingest_source_id',
      targets: [{ entity: 'sources', identity: 'source_key' }],
      remediation: "Resolve ingest_source_id through sources.key (the stable 'gridley' key). "
        + 'The generated guarded UPDATE targets the STAGED copy of this table and runs at the '
        + "plan's remap step, BEFORE the rows are promoted under the FK (AFLDB-ISSUE-151). The "
        + 'numeric source id is deliberately not stable across rebuilt lineages and must never '
        + 'be assumed.',
    }],
    note: 'The grid platforms boards are captured from — one row, gridley, seeded by '
      + 'migration 080 itself. Reinstated FIRST of the three: the truncate removes the '
      + "candidate's seed so the dump's row keeps its id and external_grids.source_id "
      + 'lands on the same id. Immutable captured evidence with no rebuild stage. '
      + 'STAGED (AFLDB-ISSUE-151): ingest_source_id is NOT NULL into rebuilt sources, so the '
      + 'plan restores it via the staging schema and remaps it before the FK sees it.',
  },
  {
    schema: 'public', name: 'external_grids', subsystem: 'Grid Solver corpus', category: 'operations',
    productionOnly: true, treatment: 'reinstate', compare: 'equal', order: 30,
    restoreAfter: ['external_grid_sources'],
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
    restoreAfter: ['external_grids'],
    note: 'The six captured criteria of one board revision. ON DELETE CASCADE from '
      + 'external_grids, so it is reinstated LAST of the three; its own rows carry the '
      + "source's stable criterion keys and raw text, which no later parse can recover.",
  },
  // --- Brownlow administration workflow (migration 094, AFLDB-ISSUE-155 Phase C) -------
  // AFLDB-ISSUE-155 §27.22/§27.28. Two workflow tables, deliberately NOT registered
  // import-writable (094 §7): they are a record of administrative decisions, and
  // grant_import_write() would hand afldb_import the same TRUNCATE + unrestricted DELETE
  // that migrations 066, 073, 078, 080 and 083 all decline to give a reload path. They
  // are narrow-grant in privileges.sql instead, exactly like those tables.
  //
  // brownlow_vote_entry_state.match_id is its PRIMARY KEY, REFERENCES matches(id) ON DELETE
  // RESTRICT, and is NOT NULL — a plain pg_restore would present the pre-cutover dump's old
  // integer to that FK before any remap could run, and `matches` is rebuilt/import-writable
  // (fresh ids on every rebuild), so the old integer is not guaranteed to exist, let alone
  // still mean the same match. This is exactly the AFLDB-ISSUE-151 staged-reinstatement
  // shape `external_grid_sources.ingest_source_id` established: the whole table restores
  // into `promotion_staging` (no FK there), match_id is remapped old id -> match_key ->
  // candidate id, and only then is it promoted into `public` under the FK, id preserved.
  //
  // Because the table's OWN primary key IS the staged column, there is no separate
  // surrogate `id` to anchor a per-row remap UPDATE or a staged promotion order — the
  // generic machinery assumed one (every table it had served until now used `id`).
  // `rowIdColumn: 'match_id'` below generalises that anchor; see `rowIdColumnOf`.
  //
  // three_player_id / two_player_id / one_player_id are NULLABLE references into `players`
  // (also rebuilt/import-writable), remapped through the same AFLDB-ISSUE-142 (B) stable
  // identity as `player_link_resolutions.player_id`. They are not what makes the table
  // staged (a nullable reference never blocks the FK), but because the WHOLE row sits in
  // `promotion_staging` until match_id is settled, their remap must ALSO run there, not
  // against `public` — `isStagedLineageColumn` is table-level for exactly this reason.
  // Declared BEFORE match_id in the lineageRefs array below (remap plans run in declaration
  // order), so the player-slot UPDATEs are applied while match_id — their only row anchor —
  // still holds its pre-cutover value; match_id's own remap runs last and, being
  // self-anchored, does not depend on any other column having settled first.
  //
  // season (on both tables) is NOT declared as a lineage-bound or football reference.
  // `seasons.year` is itself the primary key — a permanent natural identity, not a
  // surrogate integer a rebuild reassigns — so a season referenced by an existing decision
  // is definitionally still present under the same value after any rebuild. It is also
  // exactly the shape the generic dangling-reference probe cannot express (it queries the
  // referenced table by a column literally named `id`, which `seasons` does not have), so
  // declaring it would trade a probe with no real failure mode for a probe that always
  // errors. Nothing is remapped and nothing needs to be.
  {
    schema: 'public', name: 'brownlow_vote_entry_state', subsystem: 'Brownlow administration',
    category: 'operations', productionOnly: true, treatment: 'reinstate', compare: 'equal', order: 20,
    restoreAfter: ['auth_users'],
    rowIdColumn: 'match_id',
    footballRefs: [
      { column: 'three_player_id', references: 'players', nullable: true },
      { column: 'two_player_id', references: 'players', nullable: true },
      { column: 'one_player_id', references: 'players', nullable: true },
      {
        column: 'match_id', references: 'matches', nullable: false,
        remediation: 'match_id is this row\'s PRIMARY KEY (ON DELETE RESTRICT), so a plain '
          + 'restore refuses the moment the dumped integer is not a candidate match id. '
          + "matches is import-writable, and its stable identity is match_key "
          + '(NOT NULL UNIQUE since migration 003), so the plan STAGES this table '
          + '(AFLDB-ISSUE-151): rows restore into promotion_staging.brownlow_vote_entry_state '
          + '(no FK there), match_id is remapped old id -> match_key -> candidate id at the '
          + "plan's remap step, and only then is the row promoted into public under the FK, "
          + 'id preserved. Never insert a matches row to make an old id fit.',
      },
    ],
    lineageRefs: [
      {
        column: 'three_player_id',
        targets: [{ entity: 'players', identity: 'afltables_profile_url' }],
        remediation: 'Resolve three_player_id through the AFL Tables profile url and apply '
          + 'the generated per-row UPDATE after the reinstate, exactly as for '
          + 'player_link_resolutions.player_id. A slot that does not resolve is never nulled '
          + 'or dropped: the promotion stops and the operator records the decision, because a '
          + 'silently-nulled vote slot is indistinguishable from one that was never awarded.',
      },
      {
        column: 'two_player_id',
        targets: [{ entity: 'players', identity: 'afltables_profile_url' }],
        remediation: 'Resolve two_player_id through the AFL Tables profile url; same rule as '
          + 'three_player_id.',
      },
      {
        column: 'one_player_id',
        targets: [{ entity: 'players', identity: 'afltables_profile_url' }],
        remediation: 'Resolve one_player_id through the AFL Tables profile url; same rule as '
          + 'three_player_id.',
      },
      {
        // Declared LAST: the row anchor for every plan above is match_id itself (this
        // table's own primary key — rowIdColumn), so the player-slot remaps must be applied
        // while match_id still holds its pre-cutover value. match_id's own remap is
        // self-anchored (WHERE match_id = <old value> AND match_id = <old value>) and does
        // not depend on any other column, so it is safe to settle last.
        column: 'match_id',
        targets: [{ entity: 'matches', identity: 'match_key' }],
        remediation: 'STAGED (AFLDB-ISSUE-151): resolved old id -> match_key -> candidate id '
          + 'and applied to promotion_staging.brownlow_vote_entry_state at the plan\'s remap '
          + "step, before the row is promoted into public under match_id's own foreign key. "
          + 'An unresolved match_id is never dropped or guessed by date/round/club: the '
          + 'promotion stops and the operator records the decision.',
      },
    ],
    note: 'Per-match Brownlow entry workflow (draft/final/void), keyed by match_id itself — '
      + 'no separate surrogate id (rowIdColumn: match_id). A workflow/decision record, never '
      + 'a public statistical authority: the canonical facts stay in brownlow_round_votes. '
      + 'STAGED (AFLDB-ISSUE-151) because match_id is a NOT NULL PRIMARY KEY reference into '
      + 'rebuilt matches; the nullable player-slot columns ride the same staged reinstatement '
      + '(AFLDB-ISSUE-142 (B), AFLDB-ISSUE-155). season is a natural key into seasons(year) '
      + 'and needs no remap. References auth_users (created_by, updated_by, finalised_by).',
  },
  {
    schema: 'public', name: 'brownlow_season_authority', subsystem: 'Brownlow administration',
    category: 'operations', productionOnly: true, treatment: 'reinstate', compare: 'equal', order: 20,
    restoreAfter: ['auth_users'],
    note: 'Publication state of a season\'s Brownlow totals (season is its primary key). '
      + 'Not staged and not lineage-bound: its only foreign keys are season -> seasons(year), '
      + "a permanent natural identity that needs no remap (seasons' primary key is the year "
      + 'itself, not a surrogate a rebuild reassigns), and published_by/updated_by -> '
      + 'auth_users, which is itself reinstated. No column of this table carries a row id '
      + "from the replaced database's rebuilt-data lineage.",
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
    // Migration 025's FK order: seasons first; fixtures, ladders, player_seasons -> seasons;
    // matches -> seasons + fixtures; scoring_events, player_match_stats -> matches (+ seasons);
    // issues stands alone.
    tables: ['seasons', 'fixtures', 'ladders', 'player_seasons', 'matches', 'scoring_events',
      'player_match_stats', 'issues'],
    tableDependencies: [
      { table: 'fixtures', dependsOn: ['seasons'] },
      { table: 'ladders', dependsOn: ['seasons'] },
      { table: 'player_seasons', dependsOn: ['seasons'] },
      { table: 'matches', dependsOn: ['seasons', 'fixtures'] },
      { table: 'scoring_events', dependsOn: ['seasons', 'matches'] },
      { table: 'player_match_stats', dependsOn: ['seasons', 'matches'] },
    ],
    note: 'The aflwstats.com scrape the aflw.* views read. NOT produced by '
      + 'db:test:rebuild, so a rebuilt database has it empty; reinstated table by table '
      + 'in FK order from the pre-cutover dump (or reloaded with tools/aflw/load_staging.py --load).',
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
function restoreOrderFor(
  contract: readonly TableTreatment[], environment: Environment,
): TableTreatment[] {
  return contract
    .filter((t) => t.schema === 'public' && effectiveTreatment(t, environment) === 'reinstate')
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

function dependencyProblems(
  label: string, order: readonly string[], dependencies: readonly RestoreDependency[],
): string[] {
  const problems: string[] = [];
  const positions = new Map(order.map((table, index) => [table, index] as const));
  if (positions.size !== order.length) problems.push(`${label} restore order contains a duplicate table`);
  const seen = new Set<string>();
  for (const dependency of dependencies) {
    if (!positions.has(dependency.table)) {
      problems.push(`${label} dependency names missing child '${dependency.table}'`);
      continue;
    }
    for (const parent of dependency.dependsOn) {
      const edge = `${dependency.table}->${parent}`;
      if (seen.has(edge)) problems.push(`${label} dependency ${edge} is declared more than once`);
      seen.add(edge);
      if (parent === dependency.table) problems.push(`${label} table '${dependency.table}' depends on itself`);
      if (!positions.has(parent)) {
        problems.push(`${label} dependency ${edge} names a parent absent from the restore`);
      } else if (positions.get(parent)! >= positions.get(dependency.table)!) {
        problems.push(`${label} restore order puts '${dependency.table}' before required parent '${parent}'`);
      }
    }
  }
  return problems;
}

/** Pure structural validation for the promotion contract, including synthetic test contracts. */
export function promotionContractProblems(
  contract: readonly TableTreatment[] = PROMOTION_CONTRACT,
  rebuiltReferrerFks: readonly RebuiltReferrerFk[] = REBUILT_REFERRER_FKS,
): string[] {
  const problems: string[] = [];
  const keys = contract.map((t) => `${t.schema}.${t.name}`);
  for (const key of new Set(keys.filter((value, index) => keys.indexOf(value) !== index))) {
    problems.push(`${key} has contradictory duplicate dispositions`);
  }

  for (const table of contract) {
    const where = `${table.schema}.${table.name}`;
    for (const problem of historicalOnlyProblems(table)) problems.push(`${where} ${problem}`);
    for (const problem of stagedReinstatementProblems(table)) problems.push(`${where} ${problem}`);
    if (table.schema === 'public') {
      if (table.tables || table.tableDependencies) {
        problems.push(`${where} is public but declares schema-table restore metadata`);
      }
      if (table.restoreAfter && table.treatment !== 'reinstate') {
        problems.push(`${where} declares restore dependencies but is not reinstated`);
      }
    } else {
      if (table.restoreAfter) problems.push(`${where} must use tableDependencies, not restoreAfter`);
      if (table.treatment === 'reinstate' && (!table.tables || table.tables.length === 0)) {
        problems.push(`${where} is reinstated but declares no FK-ordered table list`);
      }
      if (table.tables) {
        problems.push(...dependencyProblems(where, table.tables, table.tableDependencies ?? []));
      }
    }
    if (table.lineageRefs && (table.schema !== 'public' || table.treatment !== 'reinstate')) {
      problems.push(`${where} declares lineage-bound columns but is not a reinstated public table`);
    }
    const lineageColumns = (table.lineageRefs ?? []).map((ref) => ref.column);
    if (new Set(lineageColumns).size !== lineageColumns.length) {
      problems.push(`${where} declares a lineage-bound column more than once`);
    }
  }

  for (const environment of ENVIRONMENTS) {
    const ordered = restoreOrderFor(contract, environment);
    const dependencies = ordered.flatMap((table) => (table.restoreAfter ?? [])
      .map((parent) => ({ table: table.name, dependsOn: [parent] })));
    problems.push(...dependencyProblems(
      `public (${environment})`, ordered.map((table) => table.name), dependencies,
    ));
    // AFLDB-ISSUE-151: the order the plan restores in (direct -> staged -> dependants) must
    // satisfy the same FK dependencies as the contract order it was derived from.
    problems.push(...dependencyProblems(
      `public plan (${environment})`, plannedReinstateOrder(environment, contract), dependencies,
    ));
    for (const table of contract) {
      if (table.schema !== 'public' || !historicalOnlyFor(table, environment)) continue;
      if (ordered.some((restored) => restored.name === table.name)) {
        problems.push(`${table.schema}.${table.name} is historical-only for '${environment}' yet still restored`);
      }
    }
  }

  const publicByName = new Map(contract
    .filter((t) => t.schema === 'public')
    .map((t) => [t.name, t] as const));
  for (const table of publicByName.values()) {
    for (const ref of table.footballRefs ?? []) {
      const stableTargets = lineageTargetsOf(table)
        .filter(({ ref: lineageRef, target }) => lineageRef.column === ref.column
          && target.entity === ref.references
          && target.identity !== 'none');
      if (stableTargets.length > 1) {
        problems.push(`${table.name}.${ref.column} has more than one stable remap target for ${ref.references}`);
      }
      if (table.treatment === 'reinstate' && !ref.nullable
          && stableTargets.length === 0 && !ref.remediation?.trim()) {
        problems.push(`${table.name}.${ref.column} is a preserved NOT NULL reference with no remap disposition`);
      }
      const restoredParent = publicByName.get(ref.references);
      if (table.treatment === 'reinstate' && restoredParent?.treatment === 'reinstate'
          && !(table.restoreAfter ?? []).includes(ref.references)) {
        problems.push(`${table.name}.${ref.column} references restored table ${ref.references} without restoreAfter`);
      }
    }
  }
  const constraints = rebuiltReferrerFks.map((fk) => fk.constraint);
  if (new Set(constraints).size !== constraints.length) {
    problems.push('rebuilt-referrer FK lifecycle declares a constraint more than once');
  }
  for (const fk of rebuiltReferrerFks) {
    const target = publicByName.get(fk.references);
    const referrer = publicByName.get(fk.referrer);
    const label = `${fk.referrer}.${fk.column} -> ${fk.references}`;
    if (!fk.constraint.trim() || !fk.column.trim() || !fk.referrer.trim() || !fk.references.trim()) {
      problems.push(`rebuilt-referrer FK ${label} has an empty lifecycle field`);
      continue;
    }
    if (!target || target.treatment === 'rebuilt') {
      problems.push(`rebuilt-referrer FK ${label} does not target a truncated contract table`);
    }
    if (target?.treatment === 'reinstate') {
      problems.push(`rebuilt-referrer FK ${label} targets restored data, but this lifecycle recreates before restore`);
    }
    if (referrer && referrer.treatment !== 'rebuilt') {
      problems.push(`rebuilt-referrer FK ${label} names a referrer that is not rebuilt`);
    }
  }
  return problems;
}

/** The contract's invariants, checked before plan output or any database query. */
export function assertContractCoherent(
  contract: readonly TableTreatment[] = PROMOTION_CONTRACT,
  rebuiltReferrerFks: readonly RebuiltReferrerFk[] = REBUILT_REFERRER_FKS,
): void {
  const problems = promotionContractProblems(contract, rebuiltReferrerFks);
  if (problems.length > 0) {
    throw new PromotionRefused(`Incoherent promotion contract: ${problems.join('; ')}.`);
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

/**
 * The tables of every reinstated non-public schema, in the FK order the contract declares
 * (`TableTreatment.tables`). Refuses a schema entry that declares none: a schema restored
 * in TOC order is the failure this exists to prevent, so it is not a silent fallback.
 */
export function reinstatedSchemaTables(): { schema: string; table: string }[] {
  const out: { schema: string; table: string }[] = [];
  for (const t of PROMOTION_CONTRACT) {
    if (t.schema === 'public' || t.treatment !== 'reinstate') continue;
    if (!t.tables || t.tables.length === 0) {
      throw new PromotionRefused(`Contract entry ${t.schema}.* is reinstated but declares no FK-ordered table list.`);
    }
    for (const table of t.tables) out.push({ schema: t.schema, table });
  }
  return out;
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

/** Stable-identity remap declared for a real FK into rebuilt data, when one exists. */
export function stableLineageTargetForFootballRef(
  table: TableTreatment, column: string, references: string,
): LineageTarget | undefined {
  const targets = lineageTargetsOf(table)
    .filter(({ ref, target }) => ref.column === column
      && target.entity === references
      && target.identity !== 'none')
    .map(({ target }) => target);
  return targets.length === 1 ? targets[0] : undefined;
}

// ---------------------------------------------------------------------------
// Staged reinstatement — AFLDB-ISSUE-151
// ---------------------------------------------------------------------------

/**
 * A NOT NULL foreign key from a reinstated table into rebuilt data whose old integer is
 * carried across the lineage change through a stable identity. The remap exists (§7.4c),
 * but a plain `pg_restore --data-only` of the table would present the OLD integer to an
 * immediate FK before any UPDATE could run — met on the first production promotion, where
 * `external_grid_sources.ingest_source_id` = 57 (old `sources` 57 = gridley) had to land in a
 * candidate whose gridley row is `sources` 7 and whose id 57 does not exist.
 */
export type StagedLineageColumn = {
  column: string;
  references: string;
  identity: LineageIdentityRule;
};

/**
 * Every NOT NULL reference of this table that is BOTH probed as a football reference AND
 * remappable through a stable identity. Empty for every table that is not staged.
 */
export function stagedLineageColumns(table: TableTreatment): StagedLineageColumn[] {
  if (table.schema !== 'public' || table.treatment !== 'reinstate') return [];
  return (table.footballRefs ?? [])
    .filter((ref) => !ref.nullable)
    .flatMap((ref) => {
      const target = stableLineageTargetForFootballRef(table, ref.column, ref.references);
      return target ? [{ column: ref.column, references: ref.references, identity: target.identity }] : [];
    });
}

/**
 * Is this table reinstated THROUGH the staging schema rather than straight into `public`?
 *
 * Decided from the contract alone, never from a table name: any reinstated public table
 * carrying a NOT NULL football reference that has a stable lineage identity is staged. Its
 * rows are restored into `promotion_staging.<table>` (the same columns, no constraints, no
 * identity), the evidenced `--lineage-remap-out` UPDATE is applied there, and the rows are
 * then promoted into `public.<table>` — where the FK checks them — with their ids preserved.
 * Nothing is bypassed: the FK never sees the old integer, and a row the remap did not settle
 * refuses the promotion.
 *
 * Invariant the mechanism relies on: a staged table HOLDS ROWS in the database being
 * replaced. A data-only restore of an empty table leaves no trace, so the promotion cannot
 * tell "restored zero rows" from "the staged restore never ran", and it refuses an empty
 * staging copy rather than guess. That ambiguity is settled before any plan exists:
 * `--phase pre-cutover` refuses (`judgeStagedSourceRows`) when a staged table is empty in the
 * live database, so an operator decides the table's disposition then, not mid-transcript.
 * Today the one staged table is seeded by its own migration (080) and cannot be empty on a
 * migrated database; the gate is what keeps that true for any table this predicate selects.
 */
export function isStagedReinstatement(table: TableTreatment): boolean {
  return stagedLineageColumns(table).length > 0;
}

/** The column that identifies one row of this table for a remap anchor or a staged promote. */
export function rowIdColumnOf(table: TableTreatment): string {
  return table.rowIdColumn ?? 'id';
}

export type StagedSourceRowsJudgement = {
  /** Staged tables with rows in the replaced database, with their counts. */
  populated: { table: string; rows: number }[];
  /** Staged tables the replaced database has but which hold no rows. */
  empty: string[];
  /** Staged tables the inventory did not count (absent from the replaced database). */
  missing: string[];
  verdict: 'PASS' | 'FAIL';
};

/**
 * AFLDB-ISSUE-151: the narrower invariant behind staged reinstatement, judged from the
 * `--phase pre-cutover` inventory counts (`public.<table>` keys). Every staged table must
 * hold at least one row in the database being replaced; an empty or absent one refuses,
 * because the generated promotion would refuse it later anyway, when the transcript is
 * half-run. Nothing here reads a database.
 */
export function judgeStagedSourceRows(
  counts: Readonly<Record<string, number>>, environment: Environment = DEFAULT_ENVIRONMENT,
): StagedSourceRowsJudgement {
  const out: StagedSourceRowsJudgement = { populated: [], empty: [], missing: [], verdict: 'PASS' };
  for (const t of stagedReinstateTables(environment)) {
    const n = counts[`public.${t.name}`];
    if (n === undefined) out.missing.push(t.name);
    else if (n <= 0) out.empty.push(t.name);
    else out.populated.push({ table: t.name, rows: n });
  }
  out.verdict = out.empty.length + out.missing.length === 0 ? 'PASS' : 'FAIL';
  return out;
}

export type StagingLeftoverJudgement = { verdict: 'PASS' | 'FAIL'; lines: string[] };

/**
 * AFLDB-ISSUE-151: a `promotion_staging` schema exists only between plan steps 2b and 2d.
 * Found at ANY checker phase it is the residue of an interrupted staged reinstatement, and
 * the verdict is a refusal that tells the operator what to do: inspect it, never reuse it,
 * and remove it only by hand after the inspection is recorded. `null` means the schema is
 * absent; an empty list means the schema exists with no tables — still a leftover.
 */
export function judgeStagingLeftover(
  found: readonly { table: string; rows: number }[] | null,
): StagingLeftoverJudgement {
  if (found === null) return { verdict: 'PASS', lines: [`schema ${STAGING_SCHEMA} is absent`] };
  const lines = [
    `schema ${STAGING_SCHEMA} EXISTS: an earlier staged reinstatement (plan steps 2b-2d) did not finish.`,
    ...(found.length === 0
      ? ['       it holds no tables']
      : found.map((f) => `       ${STAGING_SCHEMA}.${f.table.padEnd(30)} ${String(f.rows).padStart(8)} row(s)`)),
    'Inspect it before anything else (docs/production-promotion.md §7.2): which step stopped, what',
    'the staged rows hold, whether the remap was applied, and whether public already has the rows.',
    'Never reuse it and never run a plan over it: promotion-stage.sql refuses CREATE SCHEMA while it',
    'exists, and nothing generated drops it. Drop it by hand, deliberately, only after the inspection',
    'is recorded in the promotion record; then regenerate the plan and start its step 1 again.',
  ];
  return { verdict: 'FAIL', lines };
}

/** Staged tables reinstated in this environment, in contract order. */
export function stagedReinstateTables(environment: Environment = DEFAULT_ENVIRONMENT): TableTreatment[] {
  return publicContractTables()
    .filter((t) => effectiveTreatment(t, environment) === 'reinstate' && isStagedReinstatement(t))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

/**
 * Is the named table's named column settled in the staging schema before its FK applies?
 *
 * Table-level, not column-level: when ANY not-null football reference of a table is staged
 * (`isStagedReinstatement`), the WHOLE table's rows are restored into `promotion_staging` and
 * promoted into `public` as one unit (`reinstateGroupsOf`) — so EVERY lineage-bound column of
 * that table, staged trigger or not, physically sits in the staging schema at remap time.
 * AFLDB-ISSUE-155: `brownlow_vote_entry_state` is the first table where a NOT NULL staged
 * reference (`match_id`) and nullable lineage references on the same row (`three_player_id`
 * etc.) coexist — remapping the nullable columns against `public` would silently do nothing,
 * because the rows have not been promoted there yet.
 */
export function isStagedLineageColumn(
  tableName: string, column: string, environment: Environment = DEFAULT_ENVIRONMENT,
): boolean {
  const table = contractByName(tableName);
  if (!table || effectiveTreatment(table, environment) !== 'reinstate') return false;
  if (!isStagedReinstatement(table)) return false;
  return (table.lineageRefs ?? []).some((r) => r.column === column);
}

/**
 * The public reinstatement, split into the three groups the plan restores in turn.
 *
 *   direct      restored straight into `public`, in contract order — every reinstated table
 *               that is neither staged nor a (transitive) FK descendant of a staged table;
 *   staged      restored into `promotion_staging`, remapped there, then promoted;
 *   dependants  tables whose `restoreAfter` chain reaches a staged table, restored only
 *               after the staged rows exist in `public` (external_grids, external_grid_axes).
 *
 * The lineage remap runs between `staged` and the promotion, so at that one moment every
 * non-staged lineage-bound table is already in `public` and every staged table is in the
 * staging schema — one file, applied once.
 */
export type ReinstateGroups = { direct: string[]; staged: string[]; dependants: string[] };

function reinstateGroupsOf(
  contract: readonly TableTreatment[], environment: Environment,
): ReinstateGroups {
  const ordered = contract
    .filter((t) => t.schema === 'public' && effectiveTreatment(t, environment) === 'reinstate')
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  const byName = new Map(ordered.map((t) => [t.name, t] as const));
  const staged = new Set(ordered.filter(isStagedReinstatement).map((t) => t.name));
  const descendsFromStaged = new Map<string, boolean>();
  const descends = (name: string, seen: Set<string> = new Set()): boolean => {
    if (descendsFromStaged.has(name)) return descendsFromStaged.get(name)!;
    if (seen.has(name)) return false;
    seen.add(name);
    const parents = byName.get(name)?.restoreAfter ?? [];
    const result = parents.some((parent) => staged.has(parent) || descends(parent, seen));
    descendsFromStaged.set(name, result);
    return result;
  };
  const groups: ReinstateGroups = { direct: [], staged: [], dependants: [] };
  for (const t of ordered) {
    if (staged.has(t.name)) groups.staged.push(t.name);
    else if (descends(t.name)) groups.dependants.push(t.name);
    else groups.direct.push(t.name);
  }
  return groups;
}

export function reinstateGroups(environment: Environment = DEFAULT_ENVIRONMENT): ReinstateGroups {
  return reinstateGroupsOf(PROMOTION_CONTRACT, environment);
}

/**
 * The order the plan actually restores public tables in: direct, then staged, then their
 * dependants. Same membership as `reinstatedPublicTables`, which stays in contract order
 * for everything that is not the restore transcript (sequence re-sync, comparisons).
 */
export function plannedReinstateOrder(
  environment: Environment = DEFAULT_ENVIRONMENT, contract: readonly TableTreatment[] = PROMOTION_CONTRACT,
): string[] {
  const groups = reinstateGroupsOf(contract, environment);
  return [...groups.direct, ...groups.staged, ...groups.dependants];
}

/** Everything wrong with the staging of one table, as plain sentences. */
export function stagedReinstatementProblems(table: TableTreatment): string[] {
  const columns = stagedLineageColumns(table);
  if (columns.length === 0) return [];
  const problems: string[] = [];
  for (const c of columns) {
    const ref = (table.lineageRefs ?? []).find((r) => r.column === c.column);
    if (!ref) {
      problems.push(`stages ${c.column} without a lineage-bound declaration`);
    } else if (ref.kindColumn) {
      problems.push(`stages polymorphic column ${c.column}, which the staged promotion does not support`);
    }
    if (c.identity === 'none') problems.push(`stages ${c.column} with no stable identity`);
  }
  return problems;
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
    description: "external_identities: source 'afltables' + match_method "
      + "'afltables_profile_url' (the AFL Tables profile path), or, for a player an "
      + "administrator created, source 'manual_admin_edit' + match_method "
      + "'manual_admin_edit' (the token minted once at creation). Status unique/resolved. "
      + 'ONE identity per player: the AFL Tables path is ordered first, so a player known '
      + 'by token on the replaced side and by path in the candidate still resolves — '
      + 'the players override replay binds the token onto the path-player BEFORE the '
      + 'remap runs (AFLDB-ISSUE-160 §8.1, the same ordering rule as coaches)',
    // AFLDB-ISSUE-160. Before this, an administrator-created player carried no identity
    // at all, so its data_edits rows were 'no_identity_in_replaced' and STOPPED a PROD
    // promotion (DEF-4a). DISTINCT ON (player_id) with the path ordered first is what
    // keeps one player to one identity while admitting the second namespace.
    byId: `
      SELECT DISTINCT ON (ei.player_id) ei.player_id::bigint AS id, ei.external_id AS identity
        FROM external_identities ei
        JOIN sources s ON s.id = ei.source_id
       WHERE ((s.key = 'afltables' AND ei.match_method = 'afltables_profile_url')
              OR (s.key = 'manual_admin_edit' AND ei.match_method = 'manual_admin_edit'))
         AND ei.status IN ('unique', 'resolved')
         AND ei.player_id IS NOT NULL
         AND ei.player_id = ANY ($1::bigint[])
       ORDER BY ei.player_id, (s.key <> 'afltables'), ei.external_id`,
    byIdentity: `
      SELECT DISTINCT ON (ei.player_id) ei.player_id::bigint AS id, ei.external_id AS identity
        FROM external_identities ei
        JOIN sources s ON s.id = ei.source_id
       WHERE ((s.key = 'afltables' AND ei.match_method = 'afltables_profile_url')
              OR (s.key = 'manual_admin_edit' AND ei.match_method = 'manual_admin_edit'))
         AND ei.status IN ('unique', 'resolved')
         AND ei.player_id IS NOT NULL
         AND ei.player_id IN (
               SELECT inner_ei.player_id
                 FROM external_identities inner_ei
                 JOIN sources inner_s ON inner_s.id = inner_ei.source_id
                WHERE ((inner_s.key = 'afltables' AND inner_ei.match_method = 'afltables_profile_url')
                       OR (inner_s.key = 'manual_admin_edit' AND inner_ei.match_method = 'manual_admin_edit'))
                  AND inner_ei.status IN ('unique', 'resolved')
                  AND inner_ei.external_id = ANY ($1::text[]))
       ORDER BY ei.player_id, (s.key <> 'afltables'), ei.external_id`,
  },
  afltables_coach_path: {
    entity: 'coaches',
    description: 'coaches.afltables_coach_path — NOT NULL UNIQUE (migration 087), the AFL '
      + "Tables coach page path; 'manual:<token>' for an admin-created coach "
      + '(AFLDB-ISSUE-159). Minted once and never edited, so it denotes the same person on '
      + 'both databases; migration 095 makes the two namespaces non-overlapping by CHECK',
    byId: `
      SELECT id::bigint AS id, afltables_coach_path AS identity
        FROM public.coaches
       WHERE id = ANY ($1::bigint[])
       ORDER BY 1, 2`,
    byIdentity: `
      SELECT id::bigint AS id, afltables_coach_path AS identity
        FROM public.coaches
       WHERE afltables_coach_path = ANY ($1::text[])
       ORDER BY 1, 2`,
  },
  draft_pick_key: {
    entity: 'draft_picks',
    description: "the selection's stable acquisition key, "
      + "'<sources.key>|<player_url>|<draft_year>|<draft_kind>' — migration 069's reload "
      + 'key, written with the source KEY rather than the per-database sources.id so it '
      + "denotes the same selection on both databases. A manual selection's player_url is "
      + "'manual:<token>', minted once and never edited. A selection with source_id NULL "
      + '(a pre-AFLDB-ISSUE-160 admin row) has NO key and is deliberately absent here, so '
      + 'it reports as unresolved rather than being carried by an integer that now names '
      + 'someone else (AFLDB-ISSUE-160 D-3)',
    byId: `
      SELECT dp.id::bigint AS id,
             s.key || '|' || dp.player_url || '|' || dp.draft_year::text || '|' || dp.draft_kind
               AS identity
        FROM public.draft_picks dp
        JOIN public.sources s ON s.id = dp.source_id
       WHERE dp.player_url IS NOT NULL
         AND dp.draft_kind IS NOT NULL
         AND dp.id = ANY ($1::bigint[])
       ORDER BY 1, 2`,
    byIdentity: `
      SELECT dp.id::bigint AS id,
             s.key || '|' || dp.player_url || '|' || dp.draft_year::text || '|' || dp.draft_kind
               AS identity
        FROM public.draft_picks dp
        JOIN public.sources s ON s.id = dp.source_id
       WHERE dp.player_url IS NOT NULL
         AND dp.draft_kind IS NOT NULL
         AND s.key || '|' || dp.player_url || '|' || dp.draft_year::text || '|' || dp.draft_kind
             = ANY ($1::text[])
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
  source_key: {
    entity: 'sources',
    description: 'sources.key — NOT NULL UNIQUE, the stable acquisition-source identity',
    byId: `
      SELECT id::bigint AS id, key AS identity
        FROM public.sources
       WHERE id = ANY ($1::bigint[])
       ORDER BY 1, 2`,
    byIdentity: `
      SELECT id::bigint AS id, key AS identity
        FROM public.sources
       WHERE key = ANY ($1::text[])
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
  // AFLDB-ISSUE-151: a staged column is remapped in the staging schema, where its rows sit
  // BEFORE they are promoted under the FK. Every other column is remapped in `public`, where
  // its rows have already been restored by the time the plan reaches this file.
  const staged = (plan: LineageColumnPlan): boolean =>
    isStagedLineageColumn(plan.table, plan.column, names.environment);
  const relationOf = (plan: LineageColumnPlan): string =>
    `${quoteIdent(staged(plan) ? STAGING_SCHEMA : 'public')}.${quoteIdent(plan.table)}`;
  // AFLDB-ISSUE-155: the row anchor is the table's OWN identifying column, not always `id`
  // (brownlow_vote_entry_state's primary key is match_id, the very column some plans remap).
  const rowIdCol = (plan: LineageColumnPlan): string => rowIdColumnOf(contractByName(plan.table)!);
  const lines: string[] = [];
  lines.push('-- AFLDB-ISSUE-142 (B) — lineage remap for reinstated human/admin rows.');
  lines.push(`-- Candidate '${input.candidate}' (${names.environment}) does NOT share the id lineage of`);
  lines.push(`-- '${input.oldDatabase}'. Each UPDATE below is evidenced by ONE stable identity string`);
  lines.push('-- read from both databases in the same read-only pass: old id -> identity -> new id.');
  lines.push('-- No row is matched by name. Run at the REMAP step of promotion-reinstate.sh: after');
  lines.push('-- every directly-restored table, BEFORE the staged tables are promoted under their');
  lines.push(`-- foreign keys (AFLDB-ISSUE-151) — a staged column is updated in ${STAGING_SCHEMA}.`);
  lines.push('');
  lines.push('BEGIN;');

  let unresolvedTotal = 0;
  for (const plan of input.plans) {
    const scope = plan.kindColumn
      ? ` WHERE ${quoteIdent(plan.kindColumn)} = ${quoteSqlLiteral(plan.kind ?? '')}`
      : '';
    lines.push('');
    lines.push(`-- ${plan.table}.${plan.column}${scope} -> ${plan.entity} (identity: ${plan.rule})`);
    if (staged(plan)) {
      lines.push(`-- STAGED (AFLDB-ISSUE-151): updated in ${STAGING_SCHEMA}.${plan.table}, where the rows`);
      lines.push('--   wait without a foreign key; the plan promotes them into public afterwards.');
    }
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
      const guard = plan.kindColumn
        ? ` AND ${quoteIdent(plan.kindColumn)} = ${quoteSqlLiteral(plan.kind ?? '')}`
        : '';
      lines.push(`--   ${m.oldId} -> ${m.identity} -> ${m.newId}`);
      lines.push(`UPDATE ${relationOf(plan)} SET ${quoteIdent(plan.column)} = ${m.newId}`
        + ` WHERE ${quoteIdent(rowIdCol(plan))} = ${row.rowId} AND ${quoteIdent(plan.column)} = ${m.oldId}${guard};`);
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
    const pairs = plan.remap.mapped.map((m) => `(${m.newId}, ${quoteSqlLiteral(m.identity)})`).join(', ');
    const guard = plan.kindColumn
      ? ` AND t.${quoteIdent(plan.kindColumn)} = ${quoteSqlLiteral(plan.kind ?? '')}`
      : '';
    lines.push(`-- ${plan.table}.${plan.column}: expect 0 rows`);
    lines.push(`SELECT t.${quoteIdent(rowIdCol(plan))}, t.${quoteIdent(plan.column)} FROM ${relationOf(plan)} t`
      + ` WHERE t.${quoteIdent(plan.column)} IS NOT NULL${guard}`
      + ` AND t.${quoteIdent(plan.column)} NOT IN (SELECT id FROM (VALUES ${pairs}) v(id, identity));`);
  }
  const sql = `${lines.join('\n')}\n`;
  const problems = lineageRemapProblems(sql, input.plans, names.environment);
  if (problems.length > 0) {
    throw new PromotionRefused(`Incoherent lineage remap: ${problems.join('; ')}.`);
  }
  return sql;
}

function regexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Structural no-write guard for tables omitted as historical-only. */
export function lineageRemapProblems(
  sql: string, plans: readonly LineageColumnPlan[], environment: Environment,
): string[] {
  const problems: string[] = [];
  const executable = sql.split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('--'));
  const withheld = new Set(plans
    .filter((plan) => isHistoricalOnlyColumn(plan.table, plan.column, environment))
    .map((plan) => plan.table));
  for (const table of withheld) {
    const relation = `(?:${regexLiteral(quoteIdent('public'))}\\.)?${regexLiteral(quoteIdent(table))}`;
    const write = new RegExp(
      `^(?:UPDATE|INSERT\\s+INTO|DELETE\\s+FROM|TRUNCATE(?:\\s+TABLE)?)\\s+${relation}(?:\\s|$)`, 'i',
    );
    if (executable.some((line) => write.test(line))) {
      problems.push(`historical-only table ${table} receives a generated remap write`);
    }
  }
  // AFLDB-ISSUE-151: a staged column is settled in the staging schema. A write to its public
  // relation here would run against rows that are not there yet, and the promotion would
  // then present the old integer to the FK — the exact failure staging exists to prevent.
  const stagedTables = new Set(plans
    .filter((plan) => isStagedLineageColumn(plan.table, plan.column, environment))
    .map((plan) => plan.table));
  for (const table of stagedTables) {
    const relation = `${regexLiteral(quoteIdent('public'))}\\.${regexLiteral(quoteIdent(table))}`;
    const write = new RegExp(
      `^(?:UPDATE|INSERT\\s+INTO|DELETE\\s+FROM|TRUNCATE(?:\\s+TABLE)?)\\s+${relation}(?:\\s|$)`, 'i',
    );
    if (executable.some((line) => write.test(line))) {
      problems.push(`staged table ${table} receives a generated remap write in public instead of ${STAGING_SCHEMA}`);
    }
  }
  return problems;
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

/** PostgreSQL identifier quoting equivalent to format('%I', value). */
export function quoteIdent(value: string): string {
  if (!value || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new PromotionRefused('SQL identifiers must be non-empty and contain no control characters.');
  }
  return `"${value.replace(/"/g, '""')}"`;
}

/** PostgreSQL text literal quoting for generated, operator-reviewed SQL. */
export function quoteSqlLiteral(value: string): string {
  if (/[\u0000]/.test(value)) throw new PromotionRefused('SQL text values cannot contain NUL.');
  return `'${value.replace(/'/g, "''")}'`;
}

/** POSIX shell argument quoting. Plans are transcripts for Linux hosts. */
export function shellQuote(value: string): string {
  if (/[\u0000]/.test(value)) throw new PromotionRefused('Shell arguments cannot contain NUL.');
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

/**
 * Git Bash rewrites /home/... before Node receives argv. Refuse the rewritten value and
 * every non-POSIX path rather than generating a plan that names a nonexistent host file.
 */
export function assertLinuxHostPath(value: string, flag: string): void {
  const rewritten = /^[a-z]:[\\/]/i.test(value)
    || /(?:^|[\\/])Program Files(?:[\\/]|$)/i.test(value);
  if (rewritten || !value.startsWith('/') || /\\/.test(value) || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new PromotionRefused(
      `${flag} must be an absolute Linux host path. Received a Windows/MSYS-shaped path. `
      + "From Git Bash set MSYS_NO_PATHCONV=1 and MSYS2_ARG_CONV_EXCL='*', then rerun --plan.",
    );
  }
}

function sqlArray(names: readonly string[]): string {
  return `ARRAY[${names.map(quoteSqlLiteral).join(', ')}]`;
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

/**
 * Foreign keys from a REBUILT table into a truncated contract table. PostgreSQL refuses
 * `TRUNCATE` on a referenced table unless every referrer is in the same statement — a
 * structural check, made even when both tables are empty — and the rebuilt referrer can
 * neither join the statement nor be cascaded. The truncate therefore drops exactly these
 * constraints first and re-adds them, by their original names, after the one `TRUNCATE`,
 * inside the same transaction: the `ADD CONSTRAINT` re-validates every rebuilt row, so a
 * rebuilt row that still pointed at an emptied table refuses the whole file — the same
 * fail-closed shape as the §7.4 exception path. Met on the first live DEV promotion
 * (`AFLDB-ISSUE-139` Phase 4E-2): migration 074's
 * `promotion_candidates.resolved_decision_id -> promotion_decisions(id)`. Any other
 * arrangement was wrong: emptying `promotion_decisions` with `DELETE` instead only moves the
 * refusal to `auth_users`, which `promotion_decisions` itself references.
 */
export interface RebuiltReferrerFk {
  /** Rebuilt table holding the constraint. */
  referrer: string;
  /** Its constraint name, exactly as the migration created it. */
  constraint: string;
  /** Referencing column on the rebuilt table. */
  column: string;
  /** Truncated contract table the constraint points at. */
  references: string;
  /** Migration that created it. */
  migration: string;
}
export const REBUILT_REFERRER_FKS: readonly RebuiltReferrerFk[] = [
  {
    referrer: 'promotion_candidates', constraint: 'promotion_candidates_decision_fk',
    column: 'resolved_decision_id', references: 'promotion_decisions', migration: '074',
  },
];

/** SQL that empties every non-rebuilt contract table in the candidate. */
export function truncateSql(): string {
  const tables = truncatedPublicTables().map((t) => `${quoteIdent('public')}.${quoteIdent(t)}`).join(',\n  ');
  const dropFks = REBUILT_REFERRER_FKS.map((fk) => `-- ${fk.referrer} is REBUILT and holds ${fk.column} -> ${fk.references} (migration ${fk.migration}),
-- so ${fk.references} cannot be truncated while the constraint exists (AFLDB-ISSUE-139).
ALTER TABLE ${quoteIdent('public')}.${quoteIdent(fk.referrer)} DROP CONSTRAINT ${quoteIdent(fk.constraint)};`).join('\n');
  const addFks = REBUILT_REFERRER_FKS.map((fk) => `-- Re-added by its original name; this re-validates every rebuilt row, so a row that still
-- pointed into the emptied table refuses the whole transaction rather than dangling.
ALTER TABLE ${quoteIdent('public')}.${quoteIdent(fk.referrer)} ADD CONSTRAINT ${quoteIdent(fk.constraint)}
  FOREIGN KEY (${quoteIdent(fk.column)}) REFERENCES ${quoteIdent('public')}.${quoteIdent(fk.references)}(${quoteIdent('id')});`).join('\n');
  const schemas = PROMOTION_CONTRACT
    .filter((t) => t.schema !== 'public' && t.treatment === 'reinstate')
    .map((t) => t.schema);
  // One TRUNCATE over every table of the schema, not one per table: the schema's own
  // foreign keys (staging_aflw.matches -> staging_aflw.fixtures) refuse a table-at-a-time
  // truncate exactly as the public list would (AFLDB-ISSUE-139 Phase 4E-2).
  const schemaBlocks = schemas.map((schema) => `DO $$
DECLARE tabs text;
BEGIN
  SELECT string_agg(format('%I.%I', schemaname, tablename), ', ' ORDER BY tablename)
    INTO tabs FROM pg_tables WHERE schemaname = ${quoteSqlLiteral(schema)};
  IF tabs IS NOT NULL THEN
    EXECUTE 'TRUNCATE TABLE ' || tabs || ' RESTART IDENTITY';
  END IF;
END $$;`).join('\n');
  return `-- AFLDB-ISSUE-125: remove every row of production-owned/operational state the
-- rebuilt dump carried (test fixtures included). One statement, no cascading: every table
-- that references one of these is itself in the list — bar the rebuilt referrers whose
-- constraints are dropped and re-added around it below (AFLDB-ISSUE-139). One transaction:
-- a refusal anywhere leaves the candidate exactly as it was.
BEGIN;

${dropFks}

TRUNCATE TABLE
  ${tables}
RESTART IDENTITY;

${addFks}

${schemaBlocks}

COMMIT;
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

// ---------------------------------------------------------------------------
// Staged reinstatement SQL — AFLDB-ISSUE-151
// ---------------------------------------------------------------------------

/** The generated restore script one staged table is loaded from (plan directory, relative). */
export function stagedRestoreScript(table: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(table)) throw new PromotionRefused(`Unexpected staged table name '${table}'.`);
  return `promotion-stage-${table}.sql`;
}

/**
 * The one-line `sed` expression that points the dump's COPY at the staging copy. Anchored to
 * the COPY header `pg_restore -f` writes (`COPY public.<table> (col, …) FROM stdin;`), so no
 * data line can match; if the header is ever shaped differently the redirect does not
 * apply, the COPY still targets `public`, and the FK refuses the load — fail closed, and the
 * plan's `grep` line names it first.
 */
export function stagedCopyRedirect(table: string): string {
  stagedRestoreScript(table);
  return `s/^COPY public\\.${table} (/COPY ${STAGING_SCHEMA}.${table} (/`;
}

/**
 * SQL that creates the staging schema and one constraint-free copy of each staged table.
 * `LIKE` without options copies the columns (names, types, order, NOT NULL) and nothing
 * else: no identity, no primary key, no unique, no foreign key — so the dump's rows land
 * with their ids intact and their old reference integers, ready to be remapped.
 */
export function stageSql(environment: Environment = DEFAULT_ENVIRONMENT): string {
  const tables = stagedReinstateTables(environment);
  const schema = quoteIdent(STAGING_SCHEMA);
  const creates = tables.map((t) => {
    const columns = stagedLineageColumns(t)
      .map((c) => `${c.column} -> ${c.references} (identity: ${c.identity})`).join('; ');
    return `-- ${t.name}: ${columns}
CREATE TABLE ${schema}.${quoteIdent(t.name)} (LIKE ${quoteIdent('public')}.${quoteIdent(t.name)});`;
  }).join('\n');
  return `-- AFLDB-ISSUE-151: staging copies for the tables whose NOT NULL reference into rebuilt
-- data is lineage-bound. Each is the public table's columns and nothing else — no identity,
-- no key, no foreign key — so the pre-cutover rows can be restored here with their old
-- integers, remapped by the evidenced --lineage-remap-out file, and only then promoted into
-- public under the foreign key (promotion-promote-staged.sql), ids preserved.
-- CREATE SCHEMA refuses if ${STAGING_SCHEMA} already exists: a leftover means an earlier
-- attempt did not finish. Inspect it; never reuse it.
BEGIN;
CREATE SCHEMA ${schema};
${creates}
COMMIT;
`;
}

/**
 * SQL that moves the remapped rows from the staging schema into `public`, then removes the
 * staging schema. Refuses, before any INSERT, a staged table that is empty (the staged
 * restore did not run) or a staged row whose reference still points at an id the candidate
 * does not have (the remap was not applied or did not settle it). The foreign key is the
 * final judge either way: `OVERRIDING SYSTEM VALUE` keeps the dumped ids, and nothing here
 * defers, disables or drops a constraint.
 */
export function promoteStagedSql(environment: Environment = DEFAULT_ENVIRONMENT): string {
  const tables = stagedReinstateTables(environment);
  const schema = quoteIdent(STAGING_SCHEMA);
  const blocks = tables.map((t) => {
    const staged = `${schema}.${quoteIdent(t.name)}`;
    const target = `${quoteIdent('public')}.${quoteIdent(t.name)}`;
    // AFLDB-ISSUE-155: the row anchor for the unsettled-row report and the promotion order is
    // the table's OWN identifying column, not always `id` (see `rowIdColumnOf`).
    const rowId = rowIdColumnOf(t);
    const checks = stagedLineageColumns(t).map((c) => {
      const referenced = `${quoteIdent('public')}.${quoteIdent(c.references)}`;
      return `  SELECT string_agg(format('${rowId} %s -> ${c.column} %s', t.${quoteIdent(rowId)}, t.${quoteIdent(c.column)}), ', ' ORDER BY t.${quoteIdent(rowId)})
    INTO unsettled
    FROM ${staged} t
   WHERE NOT EXISTS (SELECT 1 FROM ${referenced} r WHERE r.id = t.${quoteIdent(c.column)});
  IF unsettled IS NOT NULL THEN
    RAISE EXCEPTION '${t.name}.${c.column} still carries the replaced database''s id(s) [%]: apply the --lineage-remap-out file (plan step 2c) first; never insert a ${c.references} row to make it fit', unsettled;
  END IF;`;
    }).join('\n');
    return `-- ${t.name}
DO $$
DECLARE staged_rows bigint; unsettled text;
BEGIN
  SELECT count(*) INTO staged_rows FROM ${staged};
  IF staged_rows = 0 THEN
    RAISE EXCEPTION '${STAGING_SCHEMA}.${t.name} is empty: the staged restore (plan step 2b) did not run or restored nothing (--phase pre-cutover proved the replaced database holds rows here, so an empty copy is never a legitimate state)';
  END IF;
${checks}
  RAISE NOTICE '${t.name}: % staged row(s) settled', staged_rows;
END $$;
INSERT INTO ${target} OVERRIDING SYSTEM VALUE SELECT * FROM ${staged} ORDER BY ${quoteIdent(rowId)};
DROP TABLE ${staged};`;
  }).join('\n\n');
  return `-- AFLDB-ISSUE-151: promote the staged, remapped rows into public under the foreign key.
-- Column order is the public table's (the staging copy was created with LIKE), the ids are
-- the dumped ids (OVERRIDING SYSTEM VALUE), and a row the remap did not settle refuses the
-- whole file before any INSERT. No constraint is deferred, disabled or dropped: the FK
-- checks every promoted row as it is inserted. One transaction.
BEGIN;

${blocks}

DROP SCHEMA ${schema};

COMMIT;
`;
}

/** The explicit cutover marker. Written AFTER reinstatement, BEFORE acceptance. */
export function auditMarkerSql(input: PlanInput): string {
  const names = environmentNames(input.environment ?? DEFAULT_ENVIRONMENT);
  const label = names.environment === 'prod' ? 'production promotion' : 'dev promotion';
  // AFLDB-ISSUE-143: an intentional omission is only a decision if the promoted database
  // carries the record of it. Each withheld table is named twice — once in a list the marker
  // can be queried by, once in prose among the recorded gaps, with the deciding issue.
  const withheld = historicalOnlyTables(names.environment);
  const historicalList = withheld.length === 0
    ? "ARRAY[]::text[]"
    : `ARRAY[${withheld.map((e) => quoteSqlLiteral(`${e.table.name} (${e.disposition.decidedBy})`)).join(', ')}]`;
  const historicalGaps = withheld
    .map((e) => `,\n      ${quoteSqlLiteral(`${e.disposition.summary} [${e.disposition.decidedBy}]`)}`)
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
    'candidate', ${quoteSqlLiteral(input.candidate)},
    'replaced', ${quoteSqlLiteral(input.oldDatabase)},
    'rebuilt_dump', ${quoteSqlLiteral(input.rebuiltDump)},
    'pre_cutover_dump', ${quoteSqlLiteral(input.preCutoverDump)},
    'environment', ${quoteSqlLiteral(input.environment ?? DEFAULT_ENVIRONMENT)},
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

function cutoverNames(input: PlanInput): {
  candidate: string; live: string; preRebuild: string; environment: Environment;
} {
  const environment = input.environment ?? DEFAULT_ENVIRONMENT;
  const names = environmentNames(environment);
  assertDatabaseForPhase('candidate', input.candidate, environment);
  if (input.oldDatabase !== names.live) {
    throw new PromotionRefused(
      `A swap plan replaces '${names.live}', not '${input.oldDatabase}'. Generate it before cutover.`,
    );
  }
  const stamp = input.candidate.slice(names.candidatePrefix.length);
  if (!stamp) throw new PromotionRefused('The candidate database name has no stamp.');
  return {
    candidate: input.candidate,
    live: names.live,
    preRebuild: `${names.preRebuildPrefix}${stamp}`,
    environment,
  };
}

/** Operator-reviewed SQL for the cutover. Every dynamic database name is an identifier. */
export function swapSql(input: PlanInput): string {
  const names = cutoverNames(input);
  return `\\set ON_ERROR_STOP on
-- Run as postgres only after the application/settle services are stopped.
-- Connect to postgres (never to either database being renamed).
SELECT pg_terminate_backend(pid)
  FROM pg_stat_activity
 WHERE datname IN (${quoteSqlLiteral(names.live)}, ${quoteSqlLiteral(names.candidate)})
   AND pid <> pg_backend_pid();
ALTER DATABASE ${quoteIdent(names.live)} RENAME TO ${quoteIdent(names.preRebuild)};
ALTER DATABASE ${quoteIdent(names.candidate)} RENAME TO ${quoteIdent(names.live)};
`;
}

/** Exact reverse of swapSql; writes made after cutover stay in the candidate database. */
export function rollbackSql(input: PlanInput): string {
  const names = cutoverNames(input);
  return `\\set ON_ERROR_STOP on
-- Run as postgres only after the application/settle services are stopped.
-- The promoted live database is renamed back to the original candidate name.
SELECT pg_terminate_backend(pid)
  FROM pg_stat_activity
 WHERE datname IN (${quoteSqlLiteral(names.live)}, ${quoteSqlLiteral(names.preRebuild)})
   AND pid <> pg_backend_pid();
ALTER DATABASE ${quoteIdent(names.live)} RENAME TO ${quoteIdent(names.candidate)};
ALTER DATABASE ${quoteIdent(names.preRebuild)} RENAME TO ${quoteIdent(names.live)};
`;
}

/**
 * The reinstatement command sequence. Each table is its own `pg_restore` under
 * `--single-transaction`, in FK order, so a failure names the table and leaves the
 * earlier ones committed and the failing one untouched.
 */
export function reinstatePlan(input: PlanInput): string {
  assertLinuxHostPath(input.preCutoverDump, '--pre-cutover-dump');
  assertLinuxHostPath(input.rebuiltDump, '--rebuilt-dump');
  const names = environmentNames(input.environment ?? DEFAULT_ENVIRONMENT);
  const envFlag = names.environment === 'prod' ? '' : ` --environment ${names.environment}`;
  const lines: string[] = [];
  lines.push(`# AFLDB-ISSUE-125 reinstatement plan — candidate '${input.candidate}' (${names.environment})`);
  lines.push(`# Run on ${names.host} as the owner role. CANDIDATE_DSN is the owner DSN with the`);
  lines.push('# database name replaced; never paste a DSN into a tracked file or a transcript.');
  if (stagedReinstateTables(names.environment).length > 0) {
    lines.push('# LINEAGE_REMAP_SQL is the file --phase restored wrote through --lineage-remap-out.');
  }
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
  const groups = reinstateGroups(names.environment);
  const restoreLine = (table: string): void => {
    lines.push(`pg_restore --dbname="$CANDIDATE_DSN" --data-only --no-owner --no-privileges \\`);
    lines.push(`           --single-transaction --exit-on-error --table=${table} ${shellQuote(input.preCutoverDump)}`);
  };
  lines.push('# 2. Reinstate production-owned rows from the pre-cutover dump, one table at a time,');
  lines.push('#    in foreign-key order. --data-only: the schema is the rebuilt one.');
  if (groups.staged.length > 0) {
    lines.push(`#    NOT here: ${groups.staged.join(', ')} (staged in 2b) and ${groups.dependants.join(', ')}`);
    lines.push('#    (restored in 2e, after the staged rows exist in public).');
  }
  for (const table of groups.direct) restoreLine(table);
  if (groups.staged.length > 0) {
    // AFLDB-ISSUE-151. A staged table carries a NOT NULL reference into rebuilt data whose
    // old integer may denote nothing (or something else) in the candidate. Restoring it
    // straight into public would present that integer to an immediate FK before any remap
    // could run, so its rows go through the staging schema instead: no FK there, the
    // evidenced remap is applied there, and the promotion is what the FK checks.
    lines.push('');
    lines.push('# 2b. STAGE the tables whose NOT NULL reference into rebuilt data is lineage-bound');
    lines.push('#     (AFLDB-ISSUE-151). Their rows are restored into the constraint-free');
    lines.push(`#     ${STAGING_SCHEMA} copies created by promotion-stage.sql, NOT into public: the`);
    lines.push('#     dumped integer may not exist in the candidate, and an immediate FK would refuse');
    lines.push('#     the plain restore before any UPDATE could run. The COPY target is redirected');
    lines.push('#     in the generated restore script; read the small file before loading it.');
    for (const table of groups.staged) {
      const columns = stagedLineageColumns(contractByName(table)!)
        .map((c) => `${c.column} -> ${c.references} (identity: ${c.identity})`).join('; ');
      lines.push(`#     ${table}: ${columns}`);
    }
    lines.push(`psql "$CANDIDATE_DSN" -v ON_ERROR_STOP=1 -f promotion-stage.sql`);
    for (const table of groups.staged) {
      const script = stagedRestoreScript(table);
      lines.push(`pg_restore --data-only --no-owner --no-privileges --table=${table} -f - ${shellQuote(input.preCutoverDump)} \\`);
      lines.push(`  | sed -e ${shellQuote(stagedCopyRedirect(table))} > ${script}`);
      lines.push(`grep -q ${shellQuote(`^COPY ${STAGING_SCHEMA}.${table} (`)} ${script}   # must succeed: the COPY now targets ${STAGING_SCHEMA}`);
      lines.push(`psql "$CANDIDATE_DSN" -v ON_ERROR_STOP=1 --single-transaction -f ${script}`);
    }
    lines.push('');
    lines.push('# 2c. Apply the evidenced lineage remap written by --phase restored --lineage-remap-out');
    lines.push('#     (AFLDB-ISSUE-142, docs/production-promotion.md §7.4c). Every directly restored');
    lines.push(`#     lineage-bound table is in public by now; every staged table is in ${STAGING_SCHEMA},`);
    lines.push('#     and that is where its UPDATE lands. On a shared lineage the file holds no UPDATE');
    lines.push('#     and this is a no-op; it is still run, so the step is never silently skipped.');
    lines.push(`psql "$CANDIDATE_DSN" -v ON_ERROR_STOP=1 -f "$LINEAGE_REMAP_SQL"`);
    lines.push('');
    lines.push('# 2d. PROMOTE the staged rows into public, ids preserved, under the foreign key. The');
    lines.push('#     file refuses — before any INSERT — if a staged row still points at an id absent');
    lines.push(`#     from the candidate, then drops ${STAGING_SCHEMA}. One transaction.`);
    lines.push(`psql "$CANDIDATE_DSN" -v ON_ERROR_STOP=1 -f promotion-promote-staged.sql`);
    lines.push('');
    lines.push('# 2e. Tables that reference a staged table, now that its rows exist in public.');
    for (const table of groups.dependants) restoreLine(table);
  }
  // One line per table of the schema, in the contract's FK order — never `--schema=` alone,
  // which restores in TOC (alphabetical) order and fails on the schema's own foreign keys.
  for (const { schema, table } of reinstatedSchemaTables()) {
    lines.push(`pg_restore --dbname="$CANDIDATE_DSN" --data-only --no-owner --no-privileges \\`);
    lines.push(`           --single-transaction --exit-on-error --schema=${schema} --table=${table} ${shellQuote(input.preCutoverDump)}`);
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
  lines.push(`npm run db:promotion:check -- --phase candidate --database ${shellQuote(input.candidate)}${envFlag} \\`);
  lines.push(names.environment === 'prod'
    ? '    --compare <snapshot.json> --expect-super-admin <real production super admin email>'
    : '    --compare <snapshot.json> [--expect-super-admin <email>]   # optional on DEV, enforced when given');
  return `${lines.join('\n')}\n`;
}

export type PromotionPlanArtifacts = {
  truncate: string;
  reinstate: string;
  resyncIdentity: string;
  auditMarker: string;
  /** AFLDB-ISSUE-151: `promotion-stage.sql`. */
  stage: string;
  /** AFLDB-ISSUE-151: `promotion-promote-staged.sql`. */
  promoteStaged: string;
};

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

/** Pure validation of the generated plan before any file is written or database is contacted. */
export function promotionPlanProblems(
  artifacts: PromotionPlanArtifacts,
  environment: Environment = DEFAULT_ENVIRONMENT,
): string[] {
  const problems = promotionContractProblems();
  const sql = artifacts.truncate;
  const begin = sql.indexOf('BEGIN;');
  const truncate = sql.indexOf('TRUNCATE TABLE');
  const commit = sql.lastIndexOf('COMMIT;');
  if (begin < 0 || truncate < begin || commit < truncate) {
    problems.push('truncate lifecycle is not one ordered BEGIN -> TRUNCATE -> COMMIT sequence');
  }
  if (/\bDELETE\s+FROM\b/i.test(sql)) problems.push('truncate lifecycle substitutes DELETE for controlled TRUNCATE');
  if (/\bCASCADE\b/i.test(sql)) problems.push('truncate lifecycle uses CASCADE');

  const publicTruncate = truncate >= 0
    ? sql.slice(truncate, sql.indexOf('RESTART IDENTITY;', truncate) + 'RESTART IDENTITY;'.length)
    : '';
  for (const table of truncatedPublicTables()) {
    const target = `${quoteIdent('public')}.${quoteIdent(table)}`;
    if (occurrences(publicTruncate, target) !== 1) {
      problems.push(`truncate lifecycle must name ${target} exactly once in the public TRUNCATE`);
    }
  }
  for (const fk of REBUILT_REFERRER_FKS) {
    const relation = `${quoteIdent('public')}.${quoteIdent(fk.referrer)}`;
    const constraint = quoteIdent(fk.constraint);
    const dropText = `ALTER TABLE ${relation} DROP CONSTRAINT ${constraint};`;
    const addText = `ALTER TABLE ${relation} ADD CONSTRAINT ${constraint}`;
    const drop = sql.indexOf(dropText);
    const add = sql.indexOf(addText);
    if (occurrences(sql, dropText) !== 1 || occurrences(sql, addText) !== 1) {
      problems.push(`FK lifecycle for ${fk.constraint} must contain exactly one DROP and one ADD`);
    } else if (!(begin < drop && drop < truncate && truncate < add && add < commit)) {
      problems.push(`FK lifecycle for ${fk.constraint} is not ordered BEGIN -> DROP -> TRUNCATE -> ADD -> COMMIT`);
    }
    const definition = `FOREIGN KEY (${quoteIdent(fk.column)}) REFERENCES `
      + `${quoteIdent('public')}.${quoteIdent(fk.references)}(${quoteIdent('id')});`;
    if (!sql.includes(definition)) problems.push(`FK lifecycle for ${fk.constraint} restores the wrong definition`);
  }

  for (const entry of PROMOTION_CONTRACT.filter((t) => t.schema !== 'public' && t.treatment === 'reinstate')) {
    const schemaLiteral = quoteSqlLiteral(entry.schema);
    if (!sql.includes(`schemaname = ${schemaLiteral}`)
        || !sql.includes("string_agg(format('%I.%I', schemaname, tablename)")
        || !sql.includes("EXECUTE 'TRUNCATE TABLE ' || tabs || ' RESTART IDENTITY'")) {
      problems.push(`${entry.schema} truncate is not one FK-safe schema/table-group statement`);
    }
  }

  const publicRestores = [...artifacts.reinstate.matchAll(/--exit-on-error --table=([a-z_]+)/g)]
    .map((match) => match[1]);
  const groups = reinstateGroups(environment);
  const expectedPublic = [...groups.direct, ...groups.dependants];
  if (JSON.stringify(publicRestores) !== JSON.stringify(expectedPublic)) {
    problems.push(`public restore order differs from the ${environment} contract`);
  }
  problems.push(...stagedPlanProblems(artifacts, environment));
  for (const schema of reinstatedSchemas()) {
    const schemaRestores = [...artifacts.reinstate.matchAll(
      new RegExp(`--schema=${schema} --table=([a-z_]+)`, 'g'),
    )].map((match) => match[1]);
    const expected = reinstatedSchemaTables()
      .filter((entry) => entry.schema === schema)
      .map((entry) => entry.table);
    if (JSON.stringify(schemaRestores) !== JSON.stringify(expected)) {
      problems.push(`${schema} restore order differs from its explicit FK dependency order`);
    }
    if (artifacts.reinstate.includes(`--schema=${schema} "`)) {
      problems.push(`${schema} restore falls back to unsafe whole-schema/TOC order`);
    }
  }

  for (const { table } of historicalOnlyTables(environment)) {
    if (publicRestores.includes(table.name)) {
      problems.push(`historical-only table ${table.name} receives a pg_restore command`);
    }
    if (!artifacts.auditMarker.includes(table.name)) {
      problems.push(`historical-only table ${table.name} is absent from the audit marker`);
    }
    if (artifacts.resyncIdentity.includes(`'${table.name}'`)) {
      problems.push(`historical-only table ${table.name} receives post-restore sequence writes`);
    }
  }
  return problems;
}

/**
 * AFLDB-ISSUE-151. Everything the staged path must hold to, checked on the generated text:
 * no plain `pg_restore --table=<staged>` into public anywhere; the staging schema created,
 * each staged table loaded through its redirected script, the remap applied, the promotion
 * run, and every dependant restored — in that order, all of it after the last direct restore
 * and before the schema restores; the staging SQL creating exactly the staged copies; the
 * promotion inserting under the FK with ids preserved and dropping the schema without
 * CASCADE; and no constraint bypass of any kind in any of the three files.
 */
export function stagedPlanProblems(
  artifacts: Pick<PromotionPlanArtifacts, 'reinstate' | 'stage' | 'promoteStaged'>,
  environment: Environment = DEFAULT_ENVIRONMENT,
): string[] {
  const problems: string[] = [];
  const groups = reinstateGroups(environment);
  const plan = artifacts.reinstate;
  const schemaIdent = quoteIdent(STAGING_SCHEMA);
  const bypass = /session_replication_role|DISABLE\s+TRIGGER|DROP\s+CONSTRAINT|SET\s+CONSTRAINTS|DEFERRABLE|NOT\s+VALID|--disable-triggers|--superuser/i;
  for (const [name, text] of [['reinstate', plan], ['stage', artifacts.stage], ['promoteStaged', artifacts.promoteStaged]] as const) {
    if (bypass.test(text)) problems.push(`${name} bypasses or weakens a constraint`);
  }
  if (/\bCASCADE\b/i.test(artifacts.stage) || /\bCASCADE\b/i.test(artifacts.promoteStaged)) {
    problems.push('staged lifecycle uses CASCADE');
  }
  // AFLDB-ISSUE-151: a leftover staging schema is evidence of an interrupted attempt. The
  // plan must refuse it (CREATE SCHEMA without IF NOT EXISTS), never adopt it and never
  // remove it: no generated file drops the schema except the promotion, once, at the end.
  const silentReuse = /CREATE\s+SCHEMA\s+IF\s+NOT\s+EXISTS|DROP\s+SCHEMA\s+IF\s+EXISTS|DROP\s+TABLE\s+IF\s+EXISTS/i;
  for (const [name, text] of [['reinstate', plan], ['stage', artifacts.stage], ['promoteStaged', artifacts.promoteStaged]] as const) {
    if (silentReuse.test(text)) problems.push(`${name} silently reuses or removes a leftover staging schema`);
  }
  if (/DROP\s+SCHEMA/i.test(artifacts.stage) || /DROP\s+SCHEMA/i.test(plan)) {
    problems.push('a leftover staging schema is dropped outside promotion-promote-staged.sql');
  }
  if (groups.staged.length === 0) {
    if (plan.includes('promotion-stage.sql') || plan.includes(STAGING_SCHEMA)) {
      problems.push('plan stages a table the contract does not stage');
    }
    return problems;
  }
  const indexOfLine = (needle: string): number => plan.indexOf(needle);
  const lastDirect = groups.direct.length > 0
    ? plan.lastIndexOf(`--exit-on-error --table=${groups.direct[groups.direct.length - 1]} `)
    : -1;
  const stageCreate = indexOfLine('-f promotion-stage.sql');
  const remap = indexOfLine('-f "$LINEAGE_REMAP_SQL"');
  const promote = indexOfLine('-f promotion-promote-staged.sql');
  const firstDependant = groups.dependants.length > 0
    ? indexOfLine(`--exit-on-error --table=${groups.dependants[0]} `)
    : plan.length;
  const firstSchema = plan.search(/--schema=[a-z_]+ --table=/);
  if (occurrences(plan, '-f promotion-stage.sql') !== 1) problems.push('plan must run promotion-stage.sql exactly once');
  if (occurrences(plan, '-f "$LINEAGE_REMAP_SQL"') !== 1) problems.push('plan must apply the lineage remap exactly once');
  if (occurrences(plan, '-f promotion-promote-staged.sql') !== 1) problems.push('plan must run promotion-promote-staged.sql exactly once');
  if (!(lastDirect < stageCreate && stageCreate < remap && remap < promote && promote < firstDependant
      && (firstSchema < 0 || promote < firstSchema))) {
    problems.push('staged lifecycle is not ordered direct restores -> stage -> remap -> promote -> dependants');
  }
  for (const table of groups.staged) {
    if (new RegExp(`--exit-on-error --table=${table}(?:\\s|$)`).test(plan)) {
      problems.push(`staged table ${table} receives a plain pg_restore into public`);
    }
    const script = stagedRestoreScript(table);
    const restore = indexOfLine(`--table=${table} -f - `);
    const load = indexOfLine(`--single-transaction -f ${script}`);
    if (restore < 0 || occurrences(plan, `--table=${table} -f - `) !== 1) {
      problems.push(`staged table ${table} has no single redirected restore`);
    }
    if (!plan.includes(shellQuote(stagedCopyRedirect(table)))) {
      problems.push(`staged table ${table} restore does not redirect its COPY to ${STAGING_SCHEMA}`);
    }
    if (load < 0 || occurrences(plan, `--single-transaction -f ${script}`) !== 1) {
      problems.push(`staged table ${table} is not loaded from ${script} in one transaction`);
    }
    if (!(stageCreate < restore && restore < load && load < remap)) {
      problems.push(`staged table ${table} is not restored between promotion-stage.sql and the remap`);
    }
    const stagedRelation = `${schemaIdent}.${quoteIdent(table)}`;
    const publicRelation = `${quoteIdent('public')}.${quoteIdent(table)}`;
    if (!artifacts.stage.includes(`CREATE TABLE ${stagedRelation} (LIKE ${publicRelation});`)) {
      problems.push(`promotion-stage.sql does not create ${stagedRelation} as a bare copy`);
    }
    // AFLDB-ISSUE-155: the promotion order anchor is the table's own row-id column.
    const rowId = quoteIdent(rowIdColumnOf(contractByName(table)!));
    if (!artifacts.promoteStaged.includes(
      `INSERT INTO ${publicRelation} OVERRIDING SYSTEM VALUE SELECT * FROM ${stagedRelation} ORDER BY ${rowId};`,
    )) {
      problems.push(`promotion-promote-staged.sql does not promote ${table} with its ids preserved`);
    }
    if (!artifacts.promoteStaged.includes(`DROP TABLE ${stagedRelation};`)) {
      problems.push(`promotion-promote-staged.sql does not drop ${stagedRelation}`);
    }
    for (const c of stagedLineageColumns(contractByName(table)!)) {
      if (!artifacts.promoteStaged.includes(`${table}.${c.column} still carries the replaced database''s id(s)`)) {
        problems.push(`promotion-promote-staged.sql does not refuse an unsettled ${table}.${c.column}`);
      }
    }
  }
  const stagedCreates = [...artifacts.stage.matchAll(/CREATE TABLE "promotion_staging"\."([a-z_]+)"/g)].map((m) => m[1]);
  if (JSON.stringify(stagedCreates) !== JSON.stringify(groups.staged)) {
    problems.push('promotion-stage.sql does not create exactly the staged tables, in order');
  }
  if (!artifacts.stage.includes(`CREATE SCHEMA ${schemaIdent};`)) problems.push('promotion-stage.sql does not create the staging schema');
  if (!artifacts.promoteStaged.includes(`DROP SCHEMA ${schemaIdent};`)) problems.push('promotion-promote-staged.sql does not drop the staging schema');
  if (/\b(?:DELETE\s+FROM|TRUNCATE|UPDATE)\b/i.test(artifacts.promoteStaged)) {
    problems.push('promotion-promote-staged.sql writes something other than the promotion INSERT');
  }
  return problems;
}

export function assertPromotionPlanCoherent(
  artifacts: PromotionPlanArtifacts,
  environment: Environment = DEFAULT_ENVIRONMENT,
): void {
  const problems = promotionPlanProblems(artifacts, environment);
  if (problems.length > 0) {
    throw new PromotionRefused(`Incoherent promotion plan: ${problems.join('; ')}.`);
  }
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
  'Captured grid corpus (migration 080) reinstated, and its two NOT NULL references settled BEFORE the rows met their foreign keys: external_grid_sources STAGED per the plan (AFLDB-ISSUE-151 — restored into promotion_staging, ingest_source_id remapped there onto the candidate\'s gridley sources row through sources.key by the --lineage-remap-out file, then promoted into public with its id preserved and the staging schema dropped), and external_grids.import_batch_id per docs/production-promotion.md §7.4b, with the choice recorded. No sources row inserted, no constraint dropped or deferred, and rows are never dropped to make the FK pass. The promotion_staging schema is gone (the checker refuses it at every phase); a leftover one was inspected and recorded before it was dropped by hand, never reused.',
  'Lineage proved at `--phase restored`: the candidate either shares the replaced database\'s id lineage, or every reinstated id-keyed column (player_link_resolutions.player_id and .target_id, data_edits.row_id, external_grid_sources.ingest_source_id) was resolved through a stable external identity and the generated remap applied at the plan\'s remap step (after the direct restores, before the staged promotion) — with every unresolved id decided deliberately and recorded. Never remapped by name, never left on the old integer.',
  'Historical-only tables (AFLDB-ISSUE-143) confirmed: for each table the contract withholds in this environment, the generated plan had no pg_restore line, the candidate reads 0 rows, the rows are present in the pre-cutover dump and the retained pre-rebuild database, and the database.promoted marker names the table and the deciding issue. Nothing was deleted to achieve this and no column was remapped by name.',
  'Identity sequences re-synced; database.promoted audit marker written; privileges.sql run on the candidate.',
  '`--phase candidate` passed: no test-fixture identity anywhere, expected super admin present and enabled, counts match the snapshot per rule, grants reconciled, migrations at parity.',
  'Service stopped; afldb_prod renamed to afldb_prod_pre_rebuild_<stamp>; candidate renamed to afldb_prod; service started.',
  '`--phase production` passed on the live afldb_prod (same gates as candidate).',
  'Health: /api/health 200, a season page, a player page, an AFLW page, and /search all render.',
  'Real production super admin logged in with password + TOTP (a new session — the old ones were reset by design).',
  'data_overrides replayed onto the promoted canonical rows for EVERY entity type the CHECK admits — players, matches, draft_picks, coaches, match_coaches — not just players and matches. The coaches replay is what re-creates every admin-created coach in the candidate (AFLDB-ISSUE-159 §7): until it runs, a manual coach does not exist there and its /coaches/<slug>-<id> URL 404s. It must run BEFORE the data_edits row_id remap, which resolves coach edits through afltables_coach_path.',
  'player_link_match_candidates regenerated from /admin; derived tables recomputed if canonical rows changed.',
  'Current season re-acquired by a supervised settle (--dry-run first), then the timer left enabled.',
  'Rollback rehearsed on paper: stop service, rename afldb_prod back to the candidate name, rename afldb_prod_pre_rebuild_<stamp> to afldb_prod, start service.',
  'Cleanup deferred: the pre-rebuild database and the dumps are kept until the operator closes the promotion record; nothing is dropped the same day.',
];
