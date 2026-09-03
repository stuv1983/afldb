import 'server-only';

import { authSql } from '@/db/authClient';
import { sql } from '@/db/client';

/**
 * Read-only diagnostics for the super-admin "Database Health" page.
 *
 * Modelled on sports_data_lab's health.py, adapted to what AFLDB actually
 * has: PostgreSQL with real foreign keys and a UNIQUE(player_id, match_id)
 * constraint on player_match_stats means whole classes of integrity check
 * that page needs (orphan rows, duplicate player-game keys) are already
 * structurally impossible here, so they are not reproduced. What remains
 * genuinely useful is ported: core counts, a table inventory, and
 * reconciliation between the derived player_career_stats table and the
 * fact tables it is aggregated from.
 *
 * Table/column identifiers here are either fixed SQL text (no user input
 * reaches any query in this file) or drawn from the fixed LINK_LAYERS
 * array below -- never introspected from a request. That is the same
 * allowlist discipline query-builder.ts uses for user-selected identifiers;
 * it applies more loosely here only because there is no user selection to
 * guard against in the first place.
 */

// --- Core summary ---

export type CoreSummary = {
  seasonMin: number | null;
  seasonMax: number | null;
  seasons: number;
  players: number;
  playersWithCareerStats: number;
  matches: number;
  playerGameRows: number;
};

export async function getCoreSummary(): Promise<CoreSummary> {
  const [row] = await sql<{
    seasonMin: number | null; seasonMax: number | null; seasons: string;
    players: string; playersWithCareerStats: string; matches: string; playerGameRows: string;
  }[]>`
    SELECT
      (SELECT min(year) FROM seasons)              AS "seasonMin",
      (SELECT max(year) FROM seasons)               AS "seasonMax",
      (SELECT count(*) FROM seasons)                 AS seasons,
      (SELECT count(*) FROM players)                 AS players,
      (SELECT count(*) FROM player_career_stats)     AS "playersWithCareerStats",
      (SELECT count(*) FROM matches)                 AS matches,
      (SELECT count(*) FROM player_match_stats)      AS "playerGameRows"
  `;
  return {
    seasonMin: row.seasonMin,
    seasonMax: row.seasonMax,
    seasons: Number(row.seasons),
    players: Number(row.players),
    playersWithCareerStats: Number(row.playersWithCareerStats),
    matches: Number(row.matches),
    playerGameRows: Number(row.playerGameRows),
  };
}

// --- Table inventory ---

/**
 * What each table is for, so the inventory reads as an explanation of the
 * database rather than a bare list of names. A table missing from this map
 * still appears, with no purpose shown -- an unexplained table is a prompt
 * to document it later, not a reason to hide it.
 */
const TABLE_PURPOSE: Record<string, string> = {
  players: 'Player identity only; career totals live in player_career_stats',
  player_name_aliases: 'Maiden/alternate name spellings',
  player_birth_evidence: 'Evidence trail behind disputed or derived dates of birth',
  player_match_stats: 'One row per player per match -- the core fact table',
  player_season_stats: 'DERIVED per-player-per-season totals (player grain)',
  player_club_season_stats: 'DERIVED per-player-per-season-per-club totals (club grain)',
  player_career_stats: 'DERIVED career totals, rebuilt by tools/migration/rebuild_derived.py',
  player_clubs: 'DERIVED: historical club identities represented by each player',
  player_relationships: 'Football family relationships',
  external_identities: 'Third-party person IDs (e.g. draft source) linked to players',
  matches: 'One row per match',
  match_period_scores: 'Quarter-by-quarter cumulative scores per match per club',
  clubs: '24 historical club identities (18 current AFL clubs)',
  club_aliases: 'Alternative spellings and abbreviations per club',
  club_organizations: 'Modern lineage groupings across renames and mergers',
  club_organization_relations: 'How historical club identities relate to an organization',
  club_seasons: 'Season ladder record per club',
  venues: 'Venue entities derived from free-text names',
  venue_aliases: 'Alternative venue spellings',
  seasons: 'One row per competition season',
  stat_definitions: 'Statistic catalogue: label, unit, display order',
  stat_availability: 'Per-season presence of each statistic',
  brownlow_season_votes: 'AUTHORITATIVE season Brownlow totals',
  brownlow_round_votes: 'Round-level Brownlow detail, 1984 onward only',
  awards: 'Award definitions',
  award_winners: 'Award winners, linked to players where confident',
  award_nominations: 'Award nominations (e.g. Rising Star)',
  hall_of_fame: 'Australian Football Hall of Fame inductees',
  honour_team_members: 'Team-of-the-Century-style honour team selections',
  captaincies: 'Club captains by season',
  draft_picks: 'Draft and recruitment history from 1981',
  draft_persons: 'One row per person in the draft source, identity resolved once',
  father_son_selections: 'Father-son and academy draft selections',
  derived_rebuilds: 'Audit trail of derived-data rebuilds',
  sources: 'Registry of every dataset AFLDB ingests',
  import_batches: 'One row per import run',
  import_rejections: 'Rows an import could not use, with the reason',
  data_issues: 'Open data-quality findings',
};

export type TableRowCount = {
  schema: string;
  table: string;
  estimatedRows: number;
  purpose: string | null;
};

/**
 * The public tables afldb_app must not read -- migration 031's REVOKE
 * list plus every operational table added since (038's site_media).
 * Duplicated here rather than imported: this file has no server-only-free
 * path to a migration's SQL. It is the single TypeScript copy, though --
 * tests/integration/privileges.test.ts and db-health.test.ts both import
 * it, so there is one list to keep current rather than three.
 *
 * The database's own copy is afldb_meta.app_readable_tables (migration
 * 039), stated the other way round: what afldb_app MAY read. That is the
 * authority for grants, and tools/maintenance/privileges.sql reconciles
 * against it. This list is the display-side complement, and a test
 * asserts the two agree.
 *
 * pg_stat_user_tables carries no privilege filtering: it reports every
 * table in a schema to any role that can read the catalogue, which is
 * exactly what afldb_owner (this file's connection, via the read-only
 * `sql` client's underlying grants -- see client.ts) can do. Without this
 * exclusion, a table this super-admin-only page has no business surfacing
 * row counts for -- auth_users, sessions, the audit log -- would appear
 * in "what is in the database" right alongside the statistical tables.
 */
export const OPERATIONAL_TABLES = [
  'auth_users',
  'auth_sessions',
  'auth_audit_log',
  'beta_access_codes',
  'beta_allowed_emails',
  'beta_login_tokens',
  'beta_join_requests',
  'data_submissions',
  'data_submission_rows',
  'admin_invites',
  'site_media',
];

/**
 * Every table's row count, largest first -- an ESTIMATE from PostgreSQL's
 * own statistics view, not a per-table `COUNT(*)`. A literal count-every-
 * table loop across ~50 tables, including the 694k-row match-stats table,
 * risks AFLDB_STATEMENT_TIMEOUT_MS on every page load for a number that
 * only needs to be roughly right. `staging`/`staging_aflw` are import
 * pipeline internals (migration 001: staging is "never queried by the
 * application"), so this inventory covers `public` only, and excludes the
 * operational tables covered by the submission-backlog panel instead.
 */
export async function listTableRowCounts(): Promise<TableRowCount[]> {
  const rows = await sql<{ schema: string; table: string; estimatedRows: string }[]>`
    SELECT schemaname AS schema, relname AS table, n_live_tup AS "estimatedRows"
      FROM pg_stat_user_tables
     WHERE schemaname = 'public'
       AND relname <> ALL(${OPERATIONAL_TABLES})
     ORDER BY n_live_tup DESC
  `;
  return rows.map((r) => ({
    schema: r.schema,
    table: r.table,
    estimatedRows: Number(r.estimatedRows),
    purpose: TABLE_PURPOSE[r.table] ?? null,
  }));
}

// --- Derived-data rebuild log ---

export type RebuildRow = {
  id: number;
  target: string;
  startedAt: Date;
  completedAt: Date | null;
  rowCount: number | null;
  status: string;
  scope: string | null;
  error: string | null;
};

/** Most recent rebuild_derived.py runs, so staleness is visible in the app rather than only in a server shell. */
export async function getLatestRebuilds(limit: number): Promise<RebuildRow[]> {
  return sql<RebuildRow[]>`
    SELECT id, target, started_at AS "startedAt", completed_at AS "completedAt",
           row_count AS "rowCount", status::text, scope, error
      FROM derived_rebuilds
     ORDER BY started_at DESC
     LIMIT ${limit}
  `;
}

// --- Career-total reconciliation ---

export type ReconciliationCheck = {
  check: string;
  mismatches: number;
};

/**
 * player_career_stats must agree with the fact tables it was aggregated
 * from. Every check is set-based (one query per check, not one query per
 * player) and LEFT JOINs from player_career_stats so a player with a
 * career-stats row but zero matching fact rows is caught too, not just a
 * player whose totals disagree with existing fact rows.
 *
 * brownlow_votes is checked against brownlow_season_votes, never against
 * player_match_stats.brownlow_votes -- migration 007's own comment: summing
 * the match-stats column instead yields 46,979 against an authoritative
 * 79,113, and is wrong.
 */
export async function reconcileCareerTotals(): Promise<ReconciliationCheck[]> {
  const [games, goals, finals, brownlow, missing] = await Promise.all([
    sql<{ count: string }[]>`
      SELECT count(*) FROM player_career_stats c
      LEFT JOIN (SELECT player_id, count(*) AS actual
                   FROM player_match_stats GROUP BY player_id) g
        ON g.player_id = c.player_id
      WHERE c.games <> COALESCE(g.actual, 0)
    `,
    sql<{ count: string }[]>`
      SELECT count(*) FROM player_career_stats c
      LEFT JOIN (SELECT player_id, sum(goals) AS actual
                   FROM player_match_stats GROUP BY player_id) g
        ON g.player_id = c.player_id
      WHERE c.goals <> COALESCE(g.actual, 0)
    `,
    sql<{ count: string }[]>`
      SELECT count(*) FROM player_career_stats c
      LEFT JOIN (
        SELECT pms.player_id, count(*) AS actual
          FROM player_match_stats pms
          JOIN matches m ON m.id = pms.match_id
         -- Must mirror rebuild_derived.py / player-derived.ts exactly, which
         -- build player_career_stats.finals from is_finals_series. Using
         -- is_final here would report false drift for every Wildcard Final.
         WHERE m.is_finals_series
         GROUP BY pms.player_id
      ) f ON f.player_id = c.player_id
      WHERE c.finals <> COALESCE(f.actual, 0)
    `,
    sql<{ count: string }[]>`
      SELECT count(*) FROM player_career_stats c
      LEFT JOIN (SELECT player_id, sum(votes) AS actual
                   FROM brownlow_season_votes GROUP BY player_id) b
        ON b.player_id = c.player_id
      WHERE c.brownlow_votes <> COALESCE(b.actual, 0)
    `,
    // A canonical player_career_stats row is derived from player_match_stats, so it
    // is required only for players who have match history. DraftGuru seeds a small
    // number of canonical player shells for drafted people with no senior game
    // (AFLDB-ISSUE-108); those legitimately have no career-stats row and are not drift.
    sql<{ count: string }[]>`
      SELECT count(*) FROM players p
      LEFT JOIN player_career_stats c ON c.player_id = p.id
      WHERE c.player_id IS NULL
        AND EXISTS (SELECT 1 FROM player_match_stats s WHERE s.player_id = p.id)
    `,
  ]);
  return [
    { check: 'games: player_career_stats vs. player_match_stats', mismatches: Number(games[0].count) },
    { check: 'goals: player_career_stats vs. player_match_stats', mismatches: Number(goals[0].count) },
    { check: 'finals: player_career_stats vs. player_match_stats + matches.is_finals_series', mismatches: Number(finals[0].count) },
    { check: 'brownlow votes: player_career_stats vs. brownlow_season_votes', mismatches: Number(brownlow[0].count) },
    { check: 'players with match history but no player_career_stats row', mismatches: Number(missing[0].count) },
  ];
}

// --- Statistic era coverage ---

export type StatEraRow = {
  key: string;
  label: string;
  firstRecordedSeason: number | null;
  seasonsRecorded: number;
};

/** Read directly from stat_availability -- AFLDB already stores this; no live per-column MIN(season) scan needed. */
export async function getStatEraStarts(): Promise<StatEraRow[]> {
  const rows = await sql<{
    key: string; label: string; firstRecordedSeason: number | null; seasonsRecorded: string;
  }[]>`
    SELECT d.key, d.label,
           min(a.season) FILTER (WHERE a.is_recorded)   AS "firstRecordedSeason",
           count(*)      FILTER (WHERE a.is_recorded)   AS "seasonsRecorded"
      FROM stat_definitions d
      LEFT JOIN stat_availability a ON a.stat_key = d.key
     GROUP BY d.key, d.label, d.display_order
     ORDER BY d.display_order
  `;
  return rows.map((r) => ({ ...r, seasonsRecorded: Number(r.seasonsRecorded) }));
}

// --- Submission pipeline backlog (operational tables -- authSql, not sql) ---

export type SubmissionBacklogRow = {
  status: string;
  count: number;
  oldestUploadedAt: Date | null;
};

/**
 * data_submissions is in migration 031's REVOKE list, so it is unreadable
 * through the public `sql` client by design -- this is the one query in
 * this file that must go through `authSql` instead.
 */
export async function getSubmissionBacklog(): Promise<SubmissionBacklogRow[]> {
  const rows = await authSql<{ status: string; count: string; oldestUploadedAt: Date | null }[]>`
    SELECT status::text, count(*) AS count, min(uploaded_at) AS "oldestUploadedAt"
      FROM data_submissions
     GROUP BY status
     ORDER BY count(*) DESC
  `;
  return rows.map((r) => ({ ...r, count: Number(r.count) }));
}

// --- Link quality ---

type LinkLayer = {
  table: string;
  label: string;
  /** The link_status-typed column on this table. Fixed, never user input. */
  statusColumn: string;
};

/**
 * Column names here are genuinely inconsistent across tables
 * (link_status_value / link_status / status / drafted_link_status /
 * father_link_status), verified against each table's own migration rather
 * than assumed uniform -- father_son_selections carries two independent
 * link-status columns for two different people, so it appears twice.
 */
const LINK_LAYERS: LinkLayer[] = [
  { table: 'award_winners', label: 'Award winners', statusColumn: 'link_status_value' },
  { table: 'award_nominations', label: 'Award nominations', statusColumn: 'link_status_value' },
  { table: 'hall_of_fame', label: 'Hall of Fame', statusColumn: 'link_status_value' },
  { table: 'honour_team_members', label: 'Honour team members', statusColumn: 'link_status_value' },
  { table: 'captaincies', label: 'Captaincies', statusColumn: 'link_status_value' },
  { table: 'brownlow_season_votes', label: 'Brownlow season votes', statusColumn: 'link_status_value' },
  { table: 'draft_picks', label: 'Draft picks', statusColumn: 'link_status_value' },
  { table: 'draft_persons', label: 'Draft persons', statusColumn: 'link_status' },
  { table: 'father_son_selections', label: 'Father-son selections (drafted player)', statusColumn: 'drafted_link_status' },
  { table: 'father_son_selections', label: 'Father-son selections (father)', statusColumn: 'father_link_status' },
  { table: 'external_identities', label: 'External identities', statusColumn: 'status' },
];

export type LinkQualityRow = {
  label: string;
  total: number;
  trusted: number;
};

/**
 * Trusted ('unique'/'resolved') vs. not, per optional link-status layer --
 * the same 'unique'/'resolved' pair `isLinked()` in lib/format.ts checks,
 * kept as a literal here because every other query in this codebase that
 * filters link_status does the same rather than round-tripping through a
 * JS predicate.
 */
export async function getLinkQuality(): Promise<LinkQualityRow[]> {
  const results = await Promise.all(
    LINK_LAYERS.map(async (layer) => {
      const [row] = await sql<{ total: string; trusted: string }[]>`
        SELECT count(*) AS total,
               count(*) FILTER (WHERE ${sql.unsafe(layer.statusColumn)} IN ('unique', 'resolved')) AS trusted
          FROM ${sql.unsafe(layer.table)}
      `;
      return { label: layer.label, total: Number(row.total), trusted: Number(row.trusted) };
    }),
  );
  return results;
}

// --- Database size ---

export type DatabaseSize = { bytes: number; pretty: string };

export async function getDatabaseSize(): Promise<DatabaseSize> {
  const [row] = await sql<{ bytes: string; pretty: string }[]>`
    SELECT pg_database_size(current_database()) AS bytes,
           pg_size_pretty(pg_database_size(current_database())) AS pretty
  `;
  return { bytes: Number(row.bytes), pretty: row.pretty };
}

// --- Everything together ---

export type HealthReport = {
  core: CoreSummary;
  tables: TableRowCount[];
  rebuilds: RebuildRow[];
  reconciliation: ReconciliationCheck[];
  statEras: StatEraRow[];
  linkQuality: LinkQualityRow[];
  size: DatabaseSize;
  submissionBacklog: SubmissionBacklogRow[];
};

export async function collectHealthReport(): Promise<HealthReport> {
  const [core, tables, rebuilds, reconciliation, statEras, linkQuality, size, submissionBacklog] =
    await Promise.all([
      getCoreSummary(),
      listTableRowCounts(),
      getLatestRebuilds(10),
      reconcileCareerTotals(),
      getStatEraStarts(),
      getLinkQuality(),
      getDatabaseSize(),
      getSubmissionBacklog(),
    ]);
  return { core, tables, rebuilds, reconciliation, statEras, linkQuality, size, submissionBacklog };
}
