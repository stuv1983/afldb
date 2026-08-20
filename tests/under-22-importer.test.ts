import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const importer = readFileSync(join(root, 'tools', 'migration', 'import_awards.py'), 'utf8');
const coreImporter = readFileSync(join(root, 'tools', 'migration', 'import_legacy_afl.py'), 'utf8');
const migration = readFileSync(
  join(root, 'src', 'db', 'migrations', '060_wikipedia_22_under_22_source.sql'),
  'utf8',
);
const orderingMigration = readFileSync(
  join(root, 'src', 'db', 'migrations', '061_award_winner_sort_order.sql'),
  'utf8',
);
const awardQueries = readFileSync(join(root, 'src', 'db', 'queries', 'awards.ts'), 'utf8');
const ignoreRules = readFileSync(join(root, '.gitignore'), 'utf8');
const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');

function expandGroups(...groups: string[]): string[] {
  const program = [
    'import json, sys, types',
    'stub = types.ModuleType("psycopg")',
    'stub.Connection = object',
    'stub.connect = lambda *args, **kwargs: None',
    'sys.modules["psycopg"] = stub',
    'sys.path.insert(0, "tools/migration")',
    'import import_awards',
    'print(json.dumps(import_awards.expand_groups(sys.argv[1:])[0]))',
  ].join('\n');
  const result = spawnSync(python, ['-c', program, ...groups], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout.trim()) as string[];
}

function between(source: string, start: string, end: string): string {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt + start.length);
  expect(startAt).toBeGreaterThanOrEqual(0);
  expect(endAt).toBeGreaterThan(startAt);
  return source.slice(startAt, endAt);
}

describe('22 Under 22 awards import contract', () => {
  it('registers dedicated, reproducible provenance in migrations and fresh imports', () => {
    for (const source of [migration, coreImporter]) {
      expect(source).toContain('wikipedia_22under22');
      expect(source).toContain('https://en.wikipedia.org/wiki/22_Under_22_team');
      expect(source).toContain('2026-08-20');
    }
    expect(migration).toContain("'scrape'");
    expect(migration).toMatch(/ON CONFLICT \(key\) DO UPDATE/);
  });

  it('keeps the curated manifest visible to a fresh checkout', () => {
    expect(ignoreRules).toContain('!/data/awards/');
    expect(ignoreRules).toContain('!/data/awards/22-under-22.csv');
  });

  it('allows a targeted non-destructive run without the legacy SQLite database', () => {
    expect(importer).toContain('needs_legacy = any(key != "under_22" for key in selected)');
    expect(importer).toContain('elif key == "under_22":');
    expect(importer).toContain(
      'pg, under_22_rows, clubs, preserved_under_22_resolutions',
    );
    expect(importer).toContain("column_name = 'sort_order'");
    expect(importer).toContain('run database migration 061 first');
    expect(importer).toContain(
      'batch_source = UNDER_22_SOURCE_KEY if key == "under_22" else "sports_data_lab"',
    );
  });

  it('makes every destructive awards reload restore the independent team data', () => {
    const dependencies = between(importer, 'GROUP_REQUIRES = {', '\n\n\ndef expand_groups');
    expect(dependencies).toContain(
      '"awards": {"all_australian", "under_22", "rising_star"}',
    );
    expect(dependencies).toContain('"all_australian": {"awards"}');
    expect(dependencies).not.toMatch(/^\s*"under_22":/m);
    const shared = ['awards', 'all_australian', 'under_22', 'rising_star'];
    expect(expandGroups('awards')).toEqual(shared);
    expect(expandGroups('all_australian')).toEqual(shared);
    expect(expandGroups('rising_star')).toEqual(shared);
    expect(expandGroups('under_22')).toEqual(['under_22']);
    const legacyAwardsLoader = between(
      importer,
      'def import_awards(',
      '\n\n\n# ---------------------------------------------------------------------------\n# Group: All-Australian',
    );
    expect(legacyAwardsLoader).not.toContain('truncate(pg, "awards")');
    expect(legacyAwardsLoader).not.toContain('truncate(pg, "award_winners")');
    expect(legacyAwardsLoader).toContain('DELETE FROM awards WHERE slug <> %s');
    expect(legacyAwardsLoader).toContain('a.slug <> %s');
  });

  it('uses names only to find candidates and requires season/club evidence to trust one', () => {
    const resolver = between(
      importer,
      'def resolve_under_22_player(',
      '\n\n\ndef import_under_22(',
    );
    expect(resolver).toContain('player_name_aliases');
    expect(resolver).toContain('player_match_stats');
    expect(resolver).toContain('JOIN matches m ON m.id = pms.match_id');
    expect(resolver).toContain('pms.club_id = %s');
    expect(resolver).toContain('m.season = %s');
    expect(resolver).toContain('if len(corroborated) == 1:');
    expect(resolver).toContain('status = "unique" if len(candidates) == 1 else "resolved"');
    expect(resolver).toContain('return None, "ambiguous"');
    expect(resolver).toContain('return None, "implausible"');
    expect(resolver).toContain('return None, "unmatched", 0');
    expect(importer).toContain('trusted_player_seasons: dict[tuple[int, int], str]');
    expect(importer).toContain('is already selected');
  });

  it('upserts only its own facts and preserves deliberate identity resolutions', () => {
    const loader = between(
      importer,
      'def import_under_22(',
      '\n\n\n# ---------------------------------------------------------------------------\n# Group: Rising Star',
    );
    expect(loader).not.toContain('truncate(');
    expect(loader).toMatch(
      /DELETE FROM award_winners[\s\S]*?WHERE award_id = %s[\s\S]*?AND source_id = %s/,
    );
    expect(loader).toContain(
      'source_record_id IS NULL OR source_record_id <> ALL(%s)',
    );
    expect(loader).toContain('ON CONFLICT ON CONSTRAINT award_winners_source_uq DO UPDATE');
    expect(loader).toContain('if prior_status == "resolved" and prior_player_id is not None:');
    expect(loader).toContain('review the existing manual resolution first');
    expect(loader).toContain('source_id, row.source_key, batch.id');
    const preparer = between(importer, 'def prepare_under_22(', '\n\n\ndef import_under_22(');
    expect(preparer).toContain('preserved = preserved_resolutions.get(row.source_key)');
    expect(preparer).toContain('review the preserved manual resolution first');
    expect(preparer).toContain('resolve_under_22_player(pg, row, club_id)');
    expect(preparer).toContain('has no AFL identity active');
    expect(importer).toContain("AND w.link_status_value = 'resolved'");
    expect(importer.indexOf('preserved_under_22_resolutions = {')).toBeLessThan(
      importer.lastIndexOf('for key in selected:'),
    );
    expect(importer.indexOf('under_22_prepared = prepare_under_22(')).toBeLessThan(
      importer.lastIndexOf('for key in selected:'),
    );
  });

  it('creates the existing seasonal honour-team shape consumed by Awards pages', () => {
    const loader = between(
      importer,
      'def import_under_22(',
      '\n\n\n# ---------------------------------------------------------------------------\n# Group: Rising Star',
    );
    expect(loader).toContain('"22 Under 22 Team"');
    expect(loader).toContain("'honour_team', 'AFL'");
    expect(loader).toContain('first_season = EXCLUDED.first_season');
    expect(loader).toContain('position,');
    expect(loader).toContain('row.position, row.sort_order');
    expect(loader).toContain('sort_order = EXCLUDED.sort_order');
    expect(loader).toContain('is_captain, is_vice_captain');
    expect(orderingMigration).toContain('ADD COLUMN sort_order smallint');
    expect(orderingMigration).toContain('sort_order BETWEEN 1 AND 100');
    expect(awardQueries).toMatch(
      /getAwardSeason[\s\S]*?ORDER BY w\.sort_order NULLS LAST/,
    );
  });
});
