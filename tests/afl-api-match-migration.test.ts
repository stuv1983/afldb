/**
 * AFLDB-ISSUE-228 S4 — migration 103 typed-projection shape gate (UNAPPLIED).
 *
 * Proves migration 103's intent BEFORE it is applied, following the exact
 * precedent of `tests/afl-api-lineup-migration.test.ts` (migration 077):
 * every assertion runs over comment-stripped, executable SQL, because 103
 * explains each invariant in prose immediately above the SQL that upholds
 * it, and a regex over the raw file would match the explanation instead of
 * the rule.
 *
 * DB-free: nothing here connects to PostgreSQL, and the migration is not
 * applied by this suite.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const MIGRATION = 'src/db/migrations/103_afl_api_match_projections.sql';
const raw = readFileSync(MIGRATION, 'utf8');

/** Comment-stripped SQL. Everything below reads this, not `raw`. */
const executable = raw.replace(/--[^\n]*/g, '');
/** Whitespace-collapsed statements, split on `;`. */
const statements = executable
  .split(';')
  .map((s) => s.replace(/\s+/g, ' ').trim())
  .filter(Boolean);
/** One whitespace-collapsed string, for cross-statement phrase checks. */
const flat = executable.replace(/\s+/g, ' ');

/** The STRUCTURAL statements: everything except `COMMENT ON` (see 077's precedent). */
const schemaStatements = statements.filter((s) => !s.startsWith('COMMENT ON'));
const schemaFlat = schemaStatements.join(' ; ');

/** The executable CREATE TABLE body for one table, line by line. */
function tableBody(tableName: string): string[] {
  const start = executable.indexOf(`CREATE TABLE staging.${tableName}`);
  if (start === -1) throw new Error(`migration 103 creates no staging.${tableName}`);
  // Bounded by THIS table's own terminating `);` line. `executable` is
  // already comment-stripped, so the `-- =====` section banners this file
  // used to bound on no longer exist anywhere in it — that bound was
  // always `-1` and silently fell through to end-of-file, leaking every
  // later table's (and this table's own COMMENT ON / CREATE INDEX
  // statements') columns into the slice. Every CREATE TABLE in this
  // migration closes on a line containing only `);` (verified: no other
  // `\n);` occurs between a table's opening and its own close), so that
  // token is the sound terminator.
  const terminator = executable.indexOf('\n);', start);
  if (terminator === -1) {
    throw new Error(`migration 103's staging.${tableName} definition never terminates`);
  }
  return executable.slice(start, terminator).split('\n');
}

/** The column's own definition line within one table — not a comment. */
function columnLine(tableName: string, name: string): string {
  const body = tableBody(tableName);
  const line = body.find((l) => new RegExp(`^\\s{2}${name}\\s`).test(l));
  if (line === undefined) throw new Error(`no column definition line for '${tableName}.${name}'`);
  return line;
}

const TABLES = ['afl_api_match', 'afl_api_player_match', 'afl_api_brownlow_vote'] as const;

describe('migration 103 — creates exactly the three declared typed projections', () => {
  it('creates staging.afl_api_match, staging.afl_api_player_match, staging.afl_api_brownlow_vote', () => {
    for (const table of TABLES) {
      expect(flat).toContain(`CREATE TABLE staging.${table}`);
    }
  });

  it('creates no typed projection for brownlow_leaderboard (promotion_policy never)', () => {
    expect(schemaFlat).not.toMatch(/CREATE TABLE staging\.afl_api_brownlow_leaderboard/);
    expect(schemaFlat).not.toMatch(/CREATE TABLE staging\.afl_api_leaderboard/);
  });

  it('does not edit a checksum-frozen migration or canonical table', () => {
    expect(schemaFlat).not.toMatch(/(ALTER|DROP) TABLE staging\.(source_|afltables_|afl_api_lineup)/);
    expect(schemaFlat).not.toMatch(
      /(ALTER|DROP) TABLE (matches|players|clubs|player_match_stats|match_period_scores|brownlow_round_votes|external_identities|data_overrides)\b/,
    );
    expect(schemaFlat).not.toMatch(/canonical_applications_target_table_ck/);
  });

  it('writes no canonical DML and installs no trigger or rule', () => {
    for (const statement of statements) {
      // The sources description UPDATE is the only UPDATE permitted, and no
      // INSERT/DELETE/TRUNCATE appears anywhere.
      expect(statement).not.toMatch(/^(INSERT INTO|DELETE FROM|TRUNCATE)\b/);
      expect(statement).not.toMatch(/CREATE (TRIGGER|RULE)/);
    }
    const updates = statements.filter((s) => /^UPDATE\b/.test(s));
    expect(updates).toHaveLength(1);
    expect(updates[0]).toContain('UPDATE sources');
  });
});

describe('migration 103 — staging.afl_api_match shape', () => {
  it('makes provider and observation identity NOT NULL', () => {
    for (const required of [
      'source_id', 'family', 'external_record_id', 'version_seq',
      'provider_match_id', 'provider_season_id', 'provider_status',
      'provider_home_team_id', 'provider_away_team_id', 'provider_venue_id',
      'season', 'round_code', 'round_type', 'is_final', 'match_date',
      'venue_raw', 'home_club_id', 'away_club_id',
      'home_goals', 'home_behinds', 'home_score',
      'away_goals', 'away_behinds', 'away_score',
      'result', 'margin', 'attendance_status', 'projected_by_batch_id',
    ]) {
      expect(columnLine('afl_api_match', required)).toMatch(/NOT NULL/);
    }
  });

  it('keeps round_number, match_time, venue_id and winner_club_id nullable', () => {
    for (const nullable of ['round_number', 'match_time', 'venue_id', 'winner_club_id']) {
      expect(columnLine('afl_api_match', nullable)).not.toMatch(/NOT NULL/);
    }
  });

  it('pins attendance to NULL / not_collected structurally, never a range', () => {
    expect(flat).toContain('afl_api_match_attendance_ck');
    expect(flat).toMatch(
      /attendance IS NULL\s+AND attendance_source_id IS NULL\s+AND attendance_status = 'not_collected'/,
    );
    // Not 076's complete-xor-non-complete range: afl_api has no complete branch.
    expect(schemaFlat).not.toMatch(/afl_api_match[\s\S]*?attendance_status = 'complete'/);
  });

  it('requires goal/behind breakdown always, unlike the nullable afltables shape', () => {
    for (const col of ['home_goals', 'home_behinds', 'away_goals', 'away_behinds']) {
      expect(columnLine('afl_api_match', col)).toMatch(/smallint\s+NOT NULL/);
    }
    expect(flat).toMatch(/afl_api_match_components_ck[\s\S]{0,20}CHECK \(\s*home_score = 6 \* home_goals \+ home_behinds/);
  });

  it('keys the row on the source observation and ties provider identity to it', () => {
    expect(flat).toContain('PRIMARY KEY (source_id, family, external_record_id)');
    expect(flat).toMatch(
      /FOREIGN KEY \(source_id, family, external_record_id, version_seq\) REFERENCES staging\.source_record_versions\s*\(source_id, family, external_record_id, version_seq\)/,
    );
    expect(flat).toContain("CHECK (family = 'match')");
    expect(flat).toMatch(/afl_api_match_external_record_id_ck CHECK \(\s*external_record_id = provider_match_id/);
  });

  it('carries the full 24-column cumulative period-score shape from 076', () => {
    for (const side of ['home', 'away']) {
      for (const q of [1, 2, 3, 4]) {
        for (const part of ['goals', 'behinds', 'points']) {
          expect(flat).toContain(`${side}_q${q}_${part} smallint`);
        }
      }
    }
  });
});

describe('migration 103 — staging.afl_api_player_match shape', () => {
  it('makes provider identity, resolved identity and stats-family columns NOT NULL', () => {
    for (const required of [
      'source_id', 'family', 'external_record_id', 'version_seq',
      'provider_match_id', 'provider_team_id', 'provider_player_id',
      'season', 'match_key', 'player_id', 'club_id', 'projected_by_batch_id',
    ]) {
      expect(columnLine('afl_api_player_match', required)).toMatch(/NOT NULL/);
    }
  });

  it('carries every stat column nullable, never brownlow_votes or afltables_id', () => {
    for (const stat of [
      'kicks', 'marks', 'handballs', 'disposals', 'goals', 'behinds', 'hitouts',
      'tackles', 'rebounds', 'inside_50s', 'clearances', 'clangers', 'frees_for',
      'frees_against', 'contested', 'uncontested', 'contested_marks',
      'marks_inside_50', 'one_percenters', 'bounces', 'goal_assists',
      'career_game_no', 'jumper_number',
    ]) {
      expect(columnLine('afl_api_player_match', stat)).not.toMatch(/NOT NULL/);
    }
    expect(schemaFlat).not.toMatch(/afl_api_player_match[\s\S]*?\bbrownlow_votes\b/);
    expect(schemaFlat).not.toMatch(/afl_api_player_match[\s\S]*?\bbrownlow_round_number\b/);
    expect(schemaFlat).not.toMatch(/afl_api_player_match[\s\S]*?\bafltables_id\b/);
  });

  it('has no match_id column, mirroring 076 exactly', () => {
    const body = tableBody('afl_api_player_match').join('\n');
    expect(body).not.toMatch(/^\s{2}match_id\s/m);
  });

  it('extracts a body bounded to its own table, never leaking the next CREATE TABLE', () => {
    const body = tableBody('afl_api_player_match').join('\n');
    expect(body).not.toContain('CREATE TABLE staging.afl_api_brownlow_vote');
    expect(body).not.toContain('CREATE TABLE staging.afl_api_match');
  });

  it('keys the composite provider identity to the declared external_record_id encoding', () => {
    expect(flat).toContain("CHECK (family = 'player_match_stats')");
    expect(flat).toMatch(
      /afl_api_player_match_external_record_id_ck CHECK \(\s*external_record_id =\s*provider_match_id \|\| '\|' \|\| provider_team_id \|\| '\|' \|\| provider_player_id/,
    );
  });

  it('grains on provider_player_id, not the resolved player_id (§12.2)', () => {
    expect(flat).toContain(
      'CONSTRAINT afl_api_player_match_grain_uq UNIQUE (source_id, provider_player_id, match_key)',
    );
    expect(schemaFlat).not.toMatch(/UNIQUE \(source_id, player_id, match_key\)/);
  });
});

describe('migration 103 — staging.afl_api_brownlow_vote shape', () => {
  it('grains the primary key on provider_player_id beyond the spine triple', () => {
    expect(flat).toContain(
      'PRIMARY KEY (source_id, family, external_record_id, provider_player_id)',
    );
    expect(flat).toMatch(
      /FOREIGN KEY \(source_id, family, external_record_id, version_seq\) REFERENCES staging\.source_record_versions\s*\(source_id, family, external_record_id, version_seq\)/,
    );
    expect(flat).toContain("CHECK (family = 'brownlow_match_votes')");
  });

  it('ties external_record_id to the match-grain spine record, not the per-vote row', () => {
    expect(flat).toMatch(
      /afl_api_brownlow_vote_external_record_id_ck CHECK \(\s*external_record_id = provider_match_id/,
    );
  });

  it('keeps canonical identity nullable (Option B) and provider/vote fields required', () => {
    for (const nullable of ['match_id', 'player_id', 'club_id']) {
      expect(columnLine('afl_api_brownlow_vote', nullable)).not.toMatch(/NOT NULL/);
      expect(columnLine('afl_api_brownlow_vote', nullable)).toMatch(/REFERENCES/);
    }
    for (const required of [
      'provider_match_id', 'provider_player_id', 'provider_team_id',
      'season', 'api_round_number', 'canonical_round_number', 'votes', 'eligible',
      'projected_by_batch_id',
    ]) {
      expect(columnLine('afl_api_brownlow_vote', required)).toMatch(/NOT NULL/);
    }
  });

  it('constrains votes to exactly {1,2,3} structurally', () => {
    expect(flat).toContain('afl_api_brownlow_vote_votes_ck');
    expect(flat).toMatch(/CHECK \(votes IN \(1, 2, 3\)\)/);
  });

  it('never carries a leaderboard-only field', () => {
    expect(schemaFlat).not.toMatch(/afl_api_brownlow_vote[\s\S]*?\btotal_votes\b/i);
    expect(schemaFlat).not.toMatch(/afl_api_brownlow_vote[\s\S]*?\bwinner\b/i);
    expect(schemaFlat).not.toMatch(/afl_api_brownlow_vote[\s\S]*?\bleader\b/i);
  });
});

describe('migration 103 — source description update', () => {
  it('updates only the afl_api description, guarded by existence', () => {
    expect(flat).toContain("UPDATE sources");
    expect(flat).toContain("WHERE key = 'afl_api'");
    expect(flat).toMatch(/IF NOT EXISTS \(SELECT 1 FROM sources WHERE key = 'afl_api'\)/);
    expect(flat).toContain('RAISE EXCEPTION');
    // Never touches kind or url (077's identity-bearing, refused fields).
    expect(schemaFlat).not.toMatch(/UPDATE sources[^;]*\b(kind|url)\s*=/);
  });

  it('describes both the direct-HTTP and fitzRoy-mediated access paths', () => {
    const withoutComments = raw.replace(/--[^\n]*/g, '');
    const literal = /UPDATE sources[\s\S]*?WHERE key = 'afl_api';/.exec(withoutComments);
    expect(literal).not.toBeNull();
    const description = [...(literal![0].matchAll(/'((?:[^']|'')*)'/g))]
      .map((m) => m[1])
      .filter((s) => s !== 'afl_api')
      .join('')
      .replace(/''/g, "'");
    expect(description).toContain('ISSUE-228');
    expect(description).toContain('ISSUE-100/118');
    expect(description).toContain('No operator credential');
  });
});

describe('migration 103 — indexes and grants', () => {
  it('covers every foreign key it introduces for the read patterns the runbook names', () => {
    for (const [table, cols] of [
      ['afl_api_match', ['home_club_id', 'away_club_id', 'season']],
      ['afl_api_player_match', ['player_id', 'club_id', 'season', 'match_key']],
      ['afl_api_brownlow_vote', ['match_id', 'player_id', 'club_id', 'season']],
    ] as const) {
      const indexed = statements
        .filter((s) => s.startsWith(`CREATE INDEX`) && s.includes(`staging.${table}`))
        .map((s) => s.replace(new RegExp(`^CREATE INDEX \\w+ ON staging\\.${table} \\(`), '').replace(/\)( WHERE.*)?$/, ''));
      const leading = indexed.map((c) => c.split(',')[0].trim());
      for (const col of cols) expect(leading).toContain(col);
      expect(indexed).toContain('source_id, family, external_record_id, version_seq');
    }
  });

  it('grants staging rights consistent with migrations 076 and 077, no TRUNCATE', () => {
    for (const table of TABLES) {
      expect(flat).toContain(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON staging.${table} TO afldb_import`,
      );
      expect(flat).toContain(`GRANT SELECT ON staging.${table} TO afldb_app`);
    }
    expect(schemaFlat).not.toMatch(/GRANT[^;]*TRUNCATE/);
  });
});
