import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const readNormalized = (...parts: string[]) => readFileSync(join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');
const importer = readNormalized('tools', 'migration', 'import_awards.py');
const coreImporter = readNormalized('tools', 'migration', 'import_legacy_afl.py');
const migration = readNormalized('src', 'db', 'migrations', '060_wikipedia_22_under_22_source.sql');
const orderingMigration = readNormalized('src', 'db', 'migrations', '061_award_winner_sort_order.sql');
const awardQueries = readNormalized('src', 'db', 'queries', 'awards.ts');
const coreCommon = readNormalized('tools', 'migration', 'common.py');
const linkResolutionGrant = readNormalized('src', 'db', 'migrations', '068_import_reads_link_resolutions.sql');
const privileges = readNormalized('tools', 'maintenance', 'privileges.sql');
const ignoreRules = readNormalized('.gitignore');
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
    // AFLDB-ISSUE-111 generalised the single under_22 exemption into a set, so the
    // derived Coleman group is legacy-free on the same terms. under_22 must still be in
    // it, and the predicate must still be membership of that set.
    expect(importer).toContain(
      'needs_legacy = any(key not in LEGACY_FREE_GROUPS for key in selected)',
    );
    expect(importer).toMatch(/LEGACY_FREE_GROUPS = \{[^}]*"under_22"[^}]*\}/);
    expect(importer).toContain('elif key == "under_22":');
    expect(importer).toContain(
      'pg, under_22_rows, clubs, preserved_under_22_resolutions',
    );
    expect(importer).toContain("column_name = 'sort_order'");
    expect(importer).toContain('run database migration 061 first');
    expect(importer).toContain('batch_source = BATCH_SOURCE_KEYS.get(key, "sports_data_lab")');
    expect(importer).toMatch(/BATCH_SOURCE_KEYS = \{[^}]*"under_22": UNDER_22_SOURCE_KEY/);
  });

  it('makes every destructive awards reload restore the independent team data', () => {
    const dependencies = between(importer, 'GROUP_REQUIRES = {', '\n\n\ndef expand_groups');
    expect(dependencies).toContain(
      '"awards": {"all_australian", "under_22", "rising_star"}',
    );
    expect(dependencies).toContain('"all_australian": {"awards"}');
    // under_22 and — since AFLDB-ISSUE-112 phase 4 — rising_star are both
    // independently sourced legacy-free reloads: a full 'awards' refresh
    // still closes over them, but neither is a GROUP_REQUIRES key, so each
    // may run alone without dragging in the legacy 'awards' group.
    expect(dependencies).not.toMatch(/^\s*"under_22":/m);
    expect(dependencies).not.toMatch(/^\s*"rising_star":/m);
    const shared = ['awards', 'all_australian', 'under_22', 'rising_star'];
    expect(expandGroups('awards')).toEqual(shared);
    expect(expandGroups('all_australian')).toEqual(shared);
    expect(expandGroups('rising_star')).toEqual(['rising_star']);
    expect(expandGroups('under_22')).toEqual(['under_22']);
    const legacyAwardsLoader = between(
      importer,
      'def import_awards(',
      '\n\n\n# ---------------------------------------------------------------------------\n# Group: All-Australian',
    );
    // The legacy group must never empty these tables wholesale, and must
    // leave the independently sourced 22 Under 22 award and its winners
    // alone. Since AFLDB-ISSUE-044 it no longer deletes and rebuilds at all:
    // it reloads by key and scopes itself out of the Under-22 rows, which is
    // the same guarantee expressed against a stronger mechanism.
    expect(legacyAwardsLoader).not.toContain('truncate(');
    expect(legacyAwardsLoader).not.toContain('DELETE FROM awards');
    expect(legacyAwardsLoader).not.toContain('DELETE FROM award_winners');
    expect(legacyAwardsLoader).toMatch(
      /reload_keyed\([\s\S]*?"awards", \["slug"\][\s\S]*?scope_column="slug", scope_values=\[UNDER_22_SLUG\], scope_exclude=True/,
    );
    expect(legacyAwardsLoader).toContain('other_group_awards = [');
    expect(legacyAwardsLoader).toContain(
      'for slug in (UNDER_22_SLUG, ALL_AUSTRALIAN_SLUG, COLEMAN_SLUG)',
    );
    expect(legacyAwardsLoader).toMatch(
      /reload_keyed\([\s\S]*?"award_winners", \["source_id", "source_record_id"\][\s\S]*?scope_column="award_id", scope_values=other_group_awards, scope_exclude=True/,
    );
    // A row belonging to another group must be rejected rather than inserted
    // outside this reload's scope, where it could never be matched again.
    expect(legacyAwardsLoader).toContain('is loaded by another group');
  });

  it('preserves the manual identity decisions a legacy reload used to discard', () => {
    // AFLDB-ISSUE-044: the honours loaders keep their target row ids, so
    // player_link_resolutions.target_id stays valid, and they re-apply the
    // admin's decision on top of the refreshed source facts.
    for (const table of [
      'award_winners', 'award_nominations', 'hall_of_fame',
      'honour_team_members', 'captaincies',
    ]) {
      expect(importer).toContain(`target_table="${table}"`);
    }
    expect(importer).not.toContain('truncate(');
    // Definitions carry no player link at all, so no resolution is read.
    expect(importer).toContain('link_columns=None');
    const helper = between(
      coreCommon,
      'def reload_keyed(',
      '\n\n\ndef report_reload(',
    );
    // Classification is complete before the first write, so a strict abort
    // rolls back with the target table untouched.
    expect(helper.indexOf('raise LinkDecisionLoss'))
      .toBeLessThan(helper.indexOf('UPDATE public.{table} e'));
    expect(helper).toContain('DISTINCT ON (target_id)');
    expect(helper).toContain('ORDER BY target_id, created_at DESC, id DESC');
    expect(helper).toContain("WHEN 'linked' THEN i._dec_player");
    expect(helper).toContain("WHEN 'confirmed_unlinked' THEN NULL");
    expect(helper).toContain('the source no longer carries this key');
    expect(helper).toContain('the source name changed to');
    // The grant the read depends on, and its deployment order.
    expect(linkResolutionGrant).toContain('GRANT SELECT ON player_link_resolutions TO afldb_import');
    expect(linkResolutionGrant).not.toMatch(/GRANT[^;]*\b(UPDATE|DELETE|TRUNCATE)\b[^;]*player_link_resolutions/);
    expect(privileges).toContain('GRANT SELECT ON player_link_resolutions TO afldb_import;');
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
      '\n\n\n# ---------------------------------------------------------------------------\n# Group: Coleman Medal',
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
      '\n\n\n# ---------------------------------------------------------------------------\n# Group: Coleman Medal',
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
