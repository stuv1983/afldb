import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * AFLDB-ISSUE-129 §8.4 — the two finals questions, and the rule that only one
 * definition of the second one exists.
 *
 *   matches.is_final          STRUCTURAL: not a home-and-away premiership-points
 *                             match. CHECK-derived. TRUE for a Wildcard Final.
 *   matches.is_finals_series  SEMANTIC: part of the traditional finals series.
 *                             Generated column. FALSE for a Wildcard Final.
 *
 * These tests are source contracts, not behaviour tests: the behaviour lives in
 * PostgreSQL and is covered by the integration suites. What is pinned here is
 * the thing a future edit is most likely to get wrong — reaching for `is_final`
 * when the question is "did they play finals", or re-spelling the finals-series
 * predicate at a call site instead of reading the canonical column (§8.4 item 12).
 */

function source(...parts: string[]): string {
  return readFileSync(join(process.cwd(), ...parts), 'utf8');
}

/** Every consumer that answers an affirmative "is this a finals game?" question. */
const AFFIRMATIVE_CONSUMERS = [
  ['src', 'db', 'queries', 'grid-solver.ts'],
  ['src', 'db', 'queries', 'db-health.ts'],
  ['src', 'db', 'queries', 'nl', 'head-to-head.ts'],
  ['src', 'db', 'queries', 'nl', 'player-career.ts'],
  ['src', 'db', 'queries', 'nl', 'player-game.ts'],
  ['src', 'db', 'queries', 'nl', 'team-match.ts'],
  ['src', 'db', 'queries', 'nl', 'team-streak.ts'],
];

describe('AFLDB-ISSUE-129 — finals-series semantics are defined once', () => {
  it('defines is_finals_series in exactly one place, and keeps is_final untouched', () => {
    const migration = source('src', 'db', 'migrations', '085_matches_is_finals_series.sql');
    expect(migration).toMatch(
      /GENERATED ALWAYS AS \(round_type NOT IN \('home_and_away', 'wildcard_final'\)\) STORED/,
    );
    // §8.4 item 11: the structural CHECK is deliberately not altered, so 129
    // seasons of history keep their existing is_final values.
    expect(migration).not.toMatch(/matches_is_final_ck/);
    expect(migration).not.toMatch(/ALTER TABLE matches\s+DROP|ALTER COLUMN is_final/i);
  });

  it('adds the enum value in its own migration, because Postgres requires it', () => {
    // tools/db/migrate.ts wraps each file in one transaction, and a new enum
    // label cannot be USED in the transaction that adds it. 084 must therefore
    // contain the ALTER TYPE and nothing that references the label as a value.
    const enumMigration = source('src', 'db', 'migrations', '084_round_type_wildcard_final.sql');
    const statements = enumMigration
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--') && line.trim() !== '');
    expect(statements).toEqual([
      "ALTER TYPE round_type ADD VALUE IF NOT EXISTS 'wildcard_final' AFTER 'home_and_away';",
    ]);
  });

  it('never re-spells the finals-series predicate at a call site', () => {
    // §8.4 item 12. The literal exclusion belongs in migration 085 alone; a copy
    // anywhere else is a second definition that can silently drift.
    for (const parts of [...AFFIRMATIVE_CONSUMERS,
      ['src', 'db', 'queries', 'match-search.ts'],
      ['src', 'db', 'queries', 'player-derived.ts'],
      ['tools', 'migration', 'rebuild_derived.py'],
    ]) {
      const text = source(...parts);
      expect(text, parts.join('/')).not.toMatch(/NOT IN \(\s*'home_and_away'\s*,\s*'wildcard_final'/);
      expect(text, parts.join('/')).not.toMatch(/round_type\s*<>\s*'wildcard_final'/);
      expect(text, parts.join('/')).not.toMatch(/round_type\s*!=\s*'wildcard_final'/);
    }
  });

  it('asks the finals-series question with is_finals_series, never is_final', () => {
    for (const parts of AFFIRMATIVE_CONSUMERS) {
      const text = source(...parts);
      expect(text, parts.join('/')).toContain('is_finals_series');
      // A bare is_final read would silently count Wildcard Finals as finals.
      // Comments are stripped first: they discuss the distinction on purpose.
      const code = text
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*(?:\/\/|#|--).*$/gm, '');
      expect(code.match(/\b[a-z_]*\.?is_final\b(?!s_series)/g) ?? [], parts.join('/'))
        .toEqual([]);
    }
  });

  it('keeps the ladder and Brownlow scoping on is_final, where it is correct', () => {
    // The other half of the decision: a Wildcard Final earns no premiership
    // points and is never polled, so the EXCLUSIONARY consumers must keep
    // reading is_final and must NOT be "fixed" to is_finals_series.
    const rebuild = source('tools', 'migration', 'rebuild_derived.py');
    expect(rebuild).toContain('FROM matches WHERE NOT is_final');
    const playerDerived = source('src', 'db', 'queries', 'player-derived.ts');
    expect(playerDerived).toContain('NOT is_final');
    expect(source('tools', 'migration', 'import_awards.py')).toContain('NOT m.is_final');
  });

  it('builds every finals aggregate from is_finals_series', () => {
    const rebuild = source('tools', 'migration', 'rebuild_derived.py');
    // player_season_stats.finals, player_career_stats.finals (x2 paths) and
    // club_seasons.finals_played.
    expect(rebuild.match(/FILTER \(WHERE (?:c\.)?is_finals_series\)/g)).toHaveLength(3);
    expect(rebuild).toContain('FROM matches WHERE is_finals_series');

    const playerDerived = source('src', 'db', 'queries', 'player-derived.ts');
    expect(playerDerived.match(/FILTER \(WHERE c\.is_finals_series\)/g)).toHaveLength(3);
    expect(playerDerived).toContain('WHERE is_finals_series AND season =');
  });

  it('keeps the db-health parity check on the same predicate as the builder', () => {
    // If these two ever disagree, db-health reports drift that does not exist.
    const dbHealth = source('src', 'db', 'queries', 'db-health.ts');
    expect(dbHealth).toContain('WHERE m.is_finals_series');
    expect(dbHealth).toContain('matches.is_finals_series');
  });

  it('teaches both source vocabularies together, or every player row is rejected', () => {
    // import_fitzroy_core.py:1436-1439 cross-checks the player grain's round
    // against results.csv, so one grain without the other rejects all 92 rows.
    const importer = source('tools', 'migration', 'import_fitzroy_core.py');
    expect(importer).toMatch(/"WF": "wildcard_final"/);
    expect(importer).toMatch(/STATS_ROUND_ALIASES = \{\s*"Wildcard Final": "WF",/);
    // The manual CSV ingest path must agree with the automated one.
    expect(source('src', 'lib', 'ingest', 'datasets.ts')).toMatch(/WF: 'wildcard_final'/);
  });

  it('gives the Wildcard Final a deliberate display label', () => {
    // AFL call sites pass no fallback, so a missing entry renders the raw
    // identifier. Covered behaviourally in tests/format.test.ts.
    const format = source('src', 'lib', 'format.ts');
    expect(format).toContain("wildcard_final: 'Wildcard Final',");
    expect(format).toContain("wildcard_final: 'WF',");
  });

  it('preserves the ladder witness rather than loosening it', () => {
    // §8.4 item 10: fitzRoy labels a WF row Round.Type="Regular" and counts it
    // on its ladder. Those seasons are declared uncomparable by name; the check
    // itself is not relaxed for any other season.
    const witness = source('tools', 'rebuild', 'fitzroy', 'validate_ladder_witness.py');
    expect(witness).toContain("WHERE round_type = 'wildcard_final'");
    expect(witness).toContain('wildcard_seasons');
    expect(witness).toContain('comparable club-seasons agree on every compared field');
  });
});
