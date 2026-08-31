/**
 * AFLDB-ISSUE-100 L3B1 — migration 077 source-contract gate (UNAPPLIED).
 *
 * Proves migration 077's intent BEFORE it is applied, because application
 * freezes its checksum. Its own semantic home, following the precedent of
 * `tests/audit-link-fk-indexes.test.ts`: this suite reasons about one
 * migration's SQL, while `tests/afl-api-lineup.test.ts` drives the L2
 * acquisition and emitter.
 *
 * **Every assertion runs over comment-stripped, executable SQL.** 077 explains
 * each invariant in prose immediately above the SQL that upholds it, so a
 * regex over the raw file matches the *explanation* of a forbidden rule
 * instead of the rule itself. That exact false positive cost ISSUE-096 a red
 * run and cost this issue two more in L2; the two places below that
 * deliberately assert prose say so explicitly.
 *
 * DB-free: nothing here connects to PostgreSQL, and the migration is not
 * applied by this suite.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  getSourceFamily,
  parseSourceFamilyRegistry,
} from '../src/lib/acquisition/source-families';

const MIGRATION = 'src/db/migrations/077_afl_api_lineups.sql';
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

/**
 * The STRUCTURAL statements: everything except `COMMENT ON`.
 *
 * `COMMENT ON` is executable SQL, so stripping `--` lines does not remove it,
 * but its payload is a documentation string — 077's column comments name
 * `player_match_stats` and `venue_raw` precisely to explain what this table is
 * NOT and which precedent it follows. Asserting "no canonical reference" over
 * text that includes those comments is the same false positive as before,
 * one layer down.
 *
 * Excluding them weakens nothing: a `COMMENT ON` cannot declare a column, a
 * foreign key, a constraint, a trigger or any DML, so every structural claim
 * below is still tested against everything capable of expressing it.
 */
const schemaStatements = statements.filter((s) => !s.startsWith('COMMENT ON'));
const schemaFlat = schemaStatements.join(' ; ');

/** The executable CREATE TABLE body, line by line. */
const tableBody = (() => {
  const start = executable.indexOf('CREATE TABLE staging.afl_api_lineup');
  if (start === -1) throw new Error('migration 077 creates no staging.afl_api_lineup');
  return executable.slice(start).split('\n');
})();

/** The column's own definition line — not the whole file, not a comment. */
function columnLine(name: string): string {
  const line = tableBody.find((l) => new RegExp(`^\\s{2}${name}\\s`).test(l));
  if (line === undefined) throw new Error(`no column definition line for '${name}'`);
  return line;
}

const registry = parseSourceFamilyRegistry(
  JSON.parse(readFileSync('data/reference/source-families.json', 'utf8')),
);

describe('migration 077 — source registration', () => {
  it('registers afl_api with the intended provenance', () => {
    expect(flat).toContain('INSERT INTO sources (key, name, url, kind, description)');
    expect(flat).toContain("'afl_api'");
    expect(flat).toContain("'AFL.com.au API (via fitzRoy)'");
    expect(flat).toContain("'upstream_dataset'");
  });

  it('carries the URL as a plain SQL literal, not a Markdown link', () => {
    // Chat and terminal renderers auto-link a bare URL, which can make a clean
    // file look like it contains `[url](url)`. This asserts the actual bytes:
    // the plain literal appears exactly twice — once in the INSERT and once in
    // the conflict comparison — and no Markdown link syntax exists at all.
    expect(raw.split("'https://www.afl.com.au/'")).toHaveLength(3);
    expect(raw).not.toMatch(/\]\(http/);
    expect(raw).not.toMatch(/\[http/);
    // The comparison must test the same plain string the INSERT writes.
    expect(flat).toMatch(/existing\.url IS DISTINCT FROM 'https:\/\/www\.afl\.com\.au\/'/);
  });

  /** The description literal, reassembled from its `||` concatenation. */
  const description = (() => {
    const withoutComments = raw.replace(/--[^\n]*/g, '');
    const literal = /'Unofficial[\s\S]*?participation\.'/.exec(withoutComments);
    if (literal === null) throw new Error('no source description literal found');
    return [...literal[0].matchAll(/'((?:[^']|'')*)'/g)]
      .map((m) => m[1]).join('').replace(/''/g, "'");
  })();

  it('describes the provider generally and the lineup family specifically', () => {
    // The one binding family policy AFLDB-ISSUE-100 established.
    expect(description).toContain(
      'afl_api.lineup is staging-only and never canonical match participation',
    );
    expect(description).toContain('fetch_lineup_afl for team announcements');
    expect(description).toMatch(/^Unofficial AFL\.com\.au API/);
  });

  it('does not freeze a policy for every future afl_api family', () => {
    // roster is not_yet_declared and later families are separately
    // adjudicated, so a source row must not bind them.
    expect(description).not.toMatch(/every family/i);
    expect(description).not.toMatch(/corroborating/i);
    expect(description).not.toMatch(/sole path to a canonical fact/i);
    expect(description).not.toMatch(/\broster\b/i);
  });

  it('states the access mechanism precisely, not as "unauthenticated"', () => {
    // AFLDB configures no AFL credential, but fitzRoy handles the AFL.com.au
    // access mechanism itself. Claiming "unauthenticated" would assert there
    // is no token, cookie or header underneath it, which was never established.
    expect(description).toContain('requires no operator-supplied API key');
    expect(description).not.toMatch(/unauthenticated/i);
    expect(description).toMatch(/may change without notice/);
  });

  it('refuses a conflicting pre-existing afl_api row instead of overwriting it', () => {
    // Migrations 060 and 063 use ON CONFLICT DO UPDATE. That is safe for a key
    // they introduced, but here it would silently take ownership of a row this
    // migration did not create.
    expect(schemaFlat).not.toMatch(/INSERT INTO sources[^;]*ON CONFLICT/);
    expect(flat).toContain('RAISE EXCEPTION');
    expect(flat).toMatch(/existing\.kind IS DISTINCT FROM 'upstream_dataset'/);
    expect(flat).toMatch(/existing\.url IS DISTINCT FROM 'https:\/\/www\.afl\.com\.au\/'/);
    // ...while staying idempotent on a row that already means the same thing.
    expect(flat).toContain('IF NOT FOUND THEN');
    // Identical provenance must not rewrite existing prose: there is no
    // UPDATE of sources anywhere, so name and description are left untouched.
    expect(schemaFlat).not.toMatch(/UPDATE sources/);
    expect(schemaFlat).not.toMatch(/SET (name|description)/);
  });

  it('does not make any afl_api family promotable', () => {
    // Registration removes the validator's "unregistered source" guard. These
    // are the suspenders that must still hold afterwards.
    expect(getSourceFamily(registry, 'afl_api', 'lineup').promotionPolicy).toBe('never');
    expect(getSourceFamily(registry, 'afl_api', 'roster').promotionPolicy)
      .toBe('not_yet_declared');
  });
});

describe('migration 077 — staging.afl_api_lineup shape', () => {
  it('creates the staging table', () => {
    expect(flat).toContain('CREATE TABLE staging.afl_api_lineup');
  });

  it('makes provider and observation identity NOT NULL', () => {
    for (const required of [
      'source_id', 'family', 'external_record_id', 'version_seq',
      'provider_match_id', 'provider_team_id', 'provider_player_id',
      'season', 'round_number', 'status', 'team_status', 'projected_by_batch_id',
    ]) {
      expect(columnLine(required)).toMatch(/NOT NULL/);
    }
  });

  it('keeps every canonical identity and optional evidence field nullable', () => {
    for (const nullable of [
      'match_id', 'club_id', 'player_id',
      'team_type', 'position', 'jumper_number', 'round_name',
      'team_name_raw', 'team_abbr_raw', 'team_nickname_raw',
    ]) {
      expect(columnLine(nullable)).not.toMatch(/NOT NULL/);
    }
    // match_id is nullable by structural necessity: matches requires NOT NULL
    // scores/result/margin, so an unplayed fixture cannot exist there.
    expect(columnLine('match_id')).toMatch(/REFERENCES matches\(id\)/);
    expect(columnLine('club_id')).toMatch(/REFERENCES clubs\(id\)/);
    expect(columnLine('player_id')).toMatch(/REFERENCES players\(id\)/);
  });

  it('keys the row on the source observation, never on canonical identity', () => {
    expect(flat).toContain('PRIMARY KEY (source_id, family, external_record_id)');
    expect(flat).toMatch(
      /FOREIGN KEY \(source_id, family, external_record_id, version_seq\) REFERENCES staging\.source_record_versions \(source_id, family, external_record_id, version_seq\)/,
    );
    for (const statement of statements) {
      for (const canonical of ['match_id', 'club_id', 'player_id']) {
        expect(statement).not.toMatch(
          new RegExp(`(PRIMARY KEY|UNIQUE)\\s*\\([^)]*\\b${canonical}\\b`),
        );
      }
    }
  });
});

describe('migration 077 — staging-only boundary', () => {
  it('never references canonical participation', () => {
    // The single most important assertion here: selected != played.
    expect(schemaFlat).not.toContain('player_match_stats');
    expect(schemaFlat).not.toContain('match_participation');
  });

  it('writes no canonical DML and installs no trigger or rule', () => {
    for (const statement of statements) {
      // The source registration is the only INSERT permitted.
      expect(statement).not.toMatch(/^INSERT INTO (?!sources\b)/);
      expect(statement).not.toMatch(/^(UPDATE|DELETE FROM|TRUNCATE)\b/);
      expect(statement).not.toMatch(/CREATE (TRIGGER|RULE)/);
    }
    expect(statements.filter((s) => /(^|\s)INSERT INTO/.test(s))).toHaveLength(1);
  });

  it('does not edit a checksum-frozen migration', () => {
    expect(schemaFlat).not.toMatch(/(ALTER|DROP) TABLE staging\.(source_|afltables_)/);
    expect(schemaFlat).not.toMatch(/(ALTER|DROP) TABLE (matches|players|clubs|player_match_stats)/);
  });

  it('types no field the evidence does not support', () => {
    // lateChanges stays raw-observation-only: no column, no table, no parsing.
    expect(schemaFlat).not.toMatch(/late_?changes/i);
    // player.captain is a 572/572 FALSE sentinel, so never a typed column.
    expect(schemaFlat).not.toMatch(/\bcaptain\b/i);
    // Player names are payload evidence, never typed staging identity.
    expect(schemaFlat).not.toMatch(/given_?name|surname/i);
    // No typed venue or scheduled-start column was added "because we could".
    expect(schemaFlat).not.toMatch(/venue/i);
    expect(schemaFlat).not.toMatch(/utc_?start|scheduled_at|source_updated_at/i);
  });
});

describe('migration 077 — constraints are structural, not vocabulary', () => {
  it('requires present, unambiguous provider ids', () => {
    expect(flat).toContain('afl_api_lineup_provider_ids_ck');
    for (const col of ['provider_match_id', 'provider_team_id', 'provider_player_id']) {
      expect(flat).toMatch(
        new RegExp(`btrim\\(${col}\\) <> '' AND ${col} NOT LIKE '%\\|%'`),
      );
    }
  });

  it('pins external_record_id to its three declared components in order', () => {
    expect(flat).toMatch(
      /external_record_id = provider_match_id \|\| '\|' \|\| provider_team_id \|\| '\|' \|\| provider_player_id/,
    );
  });

  it('encodes the numeric domain invariants', () => {
    expect(flat).toContain('CHECK (round_number >= 0)');
    // "> 0" in the text encoding this schema uses for a jumper number.
    expect(flat).toMatch(/jumper_number ~ '\^\[1-9\]\[0-9\]\*\$'/);
    expect(flat).toContain("CHECK (family = 'lineup')");
  });

  it('declares no closed enum for any measured vocabulary', () => {
    // Two rounds of one competition is a measurement, not a provider contract.
    for (const observed of [
      'CONCLUDED', 'UNCONFIRMED_TEAMS', 'FINAL_TEAM', 'PROVISIONAL_TEAM',
      'EMERG', 'Premiership',
    ]) {
      expect(schemaFlat).not.toContain(observed);
    }
    for (const col of ['status', 'team_status', 'team_type', 'position', 'round_name']) {
      expect(schemaFlat).not.toMatch(new RegExp(`\\b${col} IN \\(`));
    }
    expect(schemaFlat).not.toMatch(/CREATE TYPE/);
  });
});

describe('migration 077 — indexes and grants', () => {
  /** Index column lists, in declaration order. */
  const indexed = statements
    .filter((s) => s.startsWith('CREATE INDEX'))
    .map((s) => s.replace(/^CREATE INDEX \w+ ON staging\.afl_api_lineup \(/, '').replace(/\)$/, ''));

  it('covers every foreign key it introduces', () => {
    // fk-indexes.test.ts interrogates pg_catalog for nspname = 'public' ONLY,
    // so this staging table is NOT covered by that gate and these indexes are
    // added by reading. `players` is the one parent outside that test's
    // DELETE_FREE_PARENTS exemptions (sources, seasons, clubs, matches and
    // import_batches are all exempt), so its index is the mandatory one.
    const leading = indexed.map((cols) => cols.split(',')[0].trim());
    expect(leading).toContain('player_id');
    for (const alsoIndexed of ['club_id', 'match_id', 'projected_by_batch_id', 'season']) {
      expect(leading).toContain(alsoIndexed);
    }
    expect(indexed).toContain('source_id, family, external_record_id, version_seq');
  });

  it('grants staging rights consistent with migration 076', () => {
    expect(flat).toContain(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON staging.afl_api_lineup TO afldb_import',
    );
    expect(flat).toContain('GRANT SELECT ON staging.afl_api_lineup TO afldb_app');
    expect(schemaFlat).not.toMatch(/GRANT[^;]*TRUNCATE/);
  });

  it('states plainly that this grant is not the real no-delete boundary', () => {
    // DELIBERATELY over `raw`: this assertion is ABOUT the comment. The grant
    // above withholds TRUNCATE, but privileges.sql grants it schema-wide, so
    // the migration must not let a reader infer a boundary it does not have.
    expect(raw).toMatch(/privileges\.sql grants afldb_import[\s\S]{0,240}ALL TABLES IN SCHEMA/);
    expect(raw).toMatch(/EXECUTABLE[\s\S]{0,60}PERSISTENCE CODE/);
  });
});
