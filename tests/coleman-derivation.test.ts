import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/*
 * AFLDB-ISSUE-111 — the Coleman Medal derivation contract, proved without a database.
 *
 * AFLDB does not acquire Coleman winners. It derives them from its own canonical
 * home-and-away match facts, and every boundary that derivation obeys is declared in
 * data/reference/coleman-derivation.json. These tests hold the loader and the tracked
 * declaration to each other, so neither can drift on its own: the span, the
 * home-and-away rule, the tie rule, the club rule, the provenance and the durable
 * identity are all asserted against the same file the loader reads.
 *
 * The database-backed half of ISSUE-111 — the oracle, the synthetic multi-club fixture,
 * the transition preflight and the 46/0/0 first-load signal — lives in
 * tests/integration/awards-reload-links.test.ts.
 */

const root = process.cwd();
const readNormalized = (...parts: string[]) =>
  readFileSync(join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');

const importer = readNormalized('tools', 'migration', 'import_awards.py');
const referenceLoader = readNormalized('tools', 'migration', 'load_reference_data.py');
const seasonQueries = readNormalized('src', 'db', 'queries', 'seasons.ts');
const contract = JSON.parse(
  readNormalized('data', 'reference', 'coleman-derivation.json'),
) as Record<string, any>;

const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');

function between(source: string, start: string, end: string): string {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt + start.length);
  expect(startAt).toBeGreaterThanOrEqual(0);
  expect(endAt).toBeGreaterThan(startAt);
  return source.slice(startAt, endAt);
}

const RISING_STAR_HEADER =
  '\n\n\n# ---------------------------------------------------------------------------'
  + '\n# Group: Rising Star';
const TRANSITION_HEADER = '# One-time legacy -> derived transition';

/** The derived loader itself: contract, query, key composition, reload. */
const colemanGroup = between(importer, '# Group: Coleman Medal', TRANSITION_HEADER);
/** The one-time ownership transition, separately. */
const transition = between(importer, TRANSITION_HEADER, RISING_STAR_HEADER);

/**
 * Run the loader's PURE key-composition step over synthetic derivation rows.
 *
 * `build_coleman_winners` is deliberately split from the SQL so the identity contract —
 * which is the part that must never degrade — is testable with no database at all.
 * Each row is (season, player_id, goals, display_name, club_id, club_count, paths).
 */
type DerivationRow = [number, number, number, string, number | null, number, string[] | null];

function buildWinners(
  rows: DerivationRow[],
  overrides: Record<string, unknown> = {},
): { winners?: any[]; error?: string } {
  const program = [
    'import json, sys, types',
    'stub = types.ModuleType("psycopg")',
    'stub.Connection = object',
    'stub.connect = lambda *args, **kwargs: None',
    'sys.modules["psycopg"] = stub',
    'sys.path.insert(0, "tools/migration")',
    'import import_awards',
    'payload = json.loads(sys.argv[1])',
    'contract = import_awards.load_coleman_contract()',
    'contract.update(payload["overrides"])',
    'rows = [tuple(r) for r in payload["rows"]]',
    'try:',
    '    winners = import_awards.build_coleman_winners(rows, contract)',
    'except Exception as exc:',
    '    print(json.dumps({"error": f"{type(exc).__name__}: {exc}"}))',
    'else:',
    '    print(json.dumps({"winners": winners}))',
  ].join('\n');
  const result = spawnSync(python, ['-c', program, JSON.stringify({ rows, overrides })], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout.trim());
}

/** The measured 1982 case: Malcolm Blight, North Melbourne, 94 home-and-away goals. */
const BLIGHT_1982: DerivationRow =
  [1982, 1534, 94, 'Malcolm Blight', 115, 1, ['players/B/Malcolm_Blight.html']];

describe('Coleman derivation contract (AFLDB-ISSUE-111)', () => {
  describe('the tracked declaration', () => {
    it('declares the measured span, and says whose contract it preserves', () => {
      // 1980 is NOT a claim about when the medal began. It is where AFLDB's own measured
      // award contract begins: 46 legacy rows, one per season 1980-2025, no gaps (G0).
      expect(contract.first_season).toBe(1980);
      expect(contract.first_season_basis).toContain('PRESERVES');
      expect(contract.first_season_basis).toContain('1980');
      expect(contract.first_season_basis).toMatch(/NOT a claim about when/i);
      expect(Number.isInteger(contract.method_version)).toBe(true);
    });

    it('names the canonical fact tables and forbids the aggregate that includes finals', () => {
      expect(contract.derivation_method).toContain('player_match_stats');
      expect(contract.derivation_method).toContain('matches');
      expect(contract.derivation_method).toContain('is_final');
      expect(contract.excluded_source).toBe('player_season_stats');
      expect(contract.excluded_source_reason).toContain('finals included');
      // The concept the derivation must not merge with, and must not change.
      expect(contract.excluded_source_reason).toContain('getSeasonGoalkickers');
      expect(seasonQueries).toContain('getSeasonGoalkickers');
    });

    it('keeps every tied maximum scorer, with no invented tie-break', () => {
      expect(contract.tie_rule).toContain('EVERY player tied');
      expect(contract.tie_rule).toMatch(/no tie-break/i);
    });

    it('states the club rule as one-or-NULL, with no invented primary club', () => {
      expect(contract.club_rule).toContain('exactly one distinct club');
      expect(contract.club_rule).toContain('more than one -> persist NULL');
    });

    it('materialises only completed seasons', () => {
      expect(contract.completed_seasons_only).toBe(true);
      expect(contract.completed_seasons_rule).toContain("status = 'complete'");
    });

    it('stamps the canonical source of the facts, never the retired award scrape', () => {
      expect(contract.source_key).toBe('afltables');
      expect(contract.source_key_basis).toContain('club_seasons');
      expect(contract.source_key_basis).toContain('draftguru is deliberately no longer claimed');
      expect(contract.source_key_basis).toContain('no migration is required');
    });

    it('keys rows on the durable profile path, not on a surrogate id', () => {
      expect(contract.source_record_id_format)
        .toBe('coleman:<season>:<normalised AFL Tables profile path>');
      expect(contract.source_record_id_example)
        .toBe('coleman:1982:players/B/Malcolm_Blight.html');
      expect(contract.source_record_id_basis).toContain('players.id is NOT');
      expect(contract.identity_match_method).toBe('afltables_profile_url');
      expect(contract.identity_statuses).toEqual(['unique', 'resolved']);
      expect(contract.identity_rule).toContain('FAIL CLOSED');
      expect(contract.key_separator_rule).toContain('REFUSE, do not sanitise');
    });

    it('is a contract declaration, never loaded into a table', () => {
      // data/reference/ is the established home for tracked contracts, but
      // load_reference_data.py TRUNCATEs its targets — this file must never be one.
      expect(referenceLoader).not.toContain('coleman-derivation');
      expect(referenceLoader).not.toContain('coleman');
    });
  });

  describe('the loader reads the declaration rather than restating it', () => {
    it('carries no hard-coded span, provenance or identity rule', () => {
      expect(colemanGroup).toContain('load_coleman_contract');
      expect(colemanGroup).toContain('contract["first_season"]');
      expect(colemanGroup).toContain('require_source(sources, contract["source_key"])');
      expect(colemanGroup).toContain('contract["identity_match_method"]');
      expect(colemanGroup).toContain('contract["key_separator"]');
      // The boundary is auditable without reading Python, so Python must not restate it.
      expect(colemanGroup).not.toContain('1980');
    });

    it('refuses a contract that does not declare what the loader must obey', () => {
      expect(colemanGroup).toContain('_COLEMAN_REQUIRED_CONTRACT_KEYS');
      expect(colemanGroup).toContain('will not invent a span');
      expect(colemanGroup).toContain('completed_seasons_only must be true');
    });
  });

  describe('the derivation query', () => {
    const sql = between(colemanGroup, 'COLEMAN_DERIVATION_SQL = """', '"""');

    it('reads canonical match facts and never the finals-inclusive aggregate', () => {
      expect(sql).toContain('FROM player_match_stats pms');
      expect(sql).toContain('JOIN matches  m ON m.id = pms.match_id');
      // The only mention of the forbidden aggregate is the comment saying why.
      expect(sql).not.toContain('player_season_stats');
      expect(colemanGroup).toContain('Deliberately NOT player_season_stats');
      expect(colemanGroup.split('player_season_stats')).toHaveLength(2);
    });

    it('excludes finals exactly, not approximately', () => {
      // migration 003 CHECK-constrains is_final = (round_type <> 'home_and_away'), so
      // this predicate IS "home-and-away round" rather than an approximation of it.
      expect(sql).toContain('WHERE NOT m.is_final');
    });

    it('materialises no winner for a season still in progress', () => {
      expect(sql).toContain('JOIN seasons  s ON s.year = m.season');
      expect(sql).toContain("s.status = 'complete'");
    });

    it('takes the span from a bound parameter, never a literal year', () => {
      expect(sql).toContain('m.season >= %(first_season)s');
      expect(sql).not.toMatch(/\b(19|20)\d\d\b/);
    });

    it('keeps every player tied at the season maximum', () => {
      expect(sql).toContain('max(goals) OVER (PARTITION BY season) AS top');
      expect(sql).toContain('WHERE goals = top');
      // No arbitrary discriminator may reduce a tie to one row.
      expect(sql).not.toContain('LIMIT 1');
      expect(sql).not.toContain('DISTINCT ON');
      expect(sql).not.toContain('ORDER BY goals DESC');
    });

    it('resolves the club as one-or-NULL over the qualifying matches', () => {
      expect(sql).toContain('count(DISTINCT ha.club_id) AS club_count');
      expect(sql).toContain('CASE WHEN c.club_count = 1 THEN c.sole_club END');
      // The rules the design explicitly forbade inventing.
      for (const invented of ['most_games', 'first_club', 'last_club', 'primary_club']) {
        expect(sql).not.toContain(invented);
      }
    });

    it('reads identity from external_identities under the declared match method', () => {
      expect(sql).toContain('FROM external_identities ei');
      expect(sql).toContain('ei.match_method = %(match_method)s');
      expect(sql).toContain('ei.status::text = ANY(%(statuses)s)');
    });

    it('proves the NULL-is-not-zero invariant per run rather than assuming it', () => {
      const guard = between(colemanGroup, 'COLEMAN_NULL_GOALS_SQL = """', '"""');
      expect(guard).toContain('pms.goals IS NULL');
      expect(colemanGroup).toContain('missing statistic is not zero');
    });
  });

  describe('durable identity', () => {
    it('builds the key from season and the normalised profile path', () => {
      const { winners } = buildWinners([BLIGHT_1982]);
      expect(winners).toHaveLength(1);
      expect(winners![0].key).toBe('coleman:1982:players/B/Malcolm_Blight.html');
    });

    it('puts neither players.id nor the display name in the key', () => {
      const { winners } = buildWinners([BLIGHT_1982]);
      const key = winners![0].key as string;
      // players.id is re-seeded by a canonical rebuild, so it cannot be identity.
      expect(key).not.toContain('1534');
      expect(key).not.toContain('Malcolm Blight');
      expect(key).not.toMatch(/^coleman:\d{4}:\d+$/);
    });

    it('does not move when the display name is corrected', () => {
      const renamed: DerivationRow = [...BLIGHT_1982] as DerivationRow;
      renamed[3] = 'Malcolm G. Blight';
      expect(buildWinners([renamed]).winners![0].key)
        .toBe(buildWinners([BLIGHT_1982]).winners![0].key);
    });

    it('refuses a winner with no durable identity, and never falls back', () => {
      const { error, winners } = buildWinners([[1999, 42, 80, 'No Identity', 7, 1, null]]);
      expect(winners).toBeUndefined();
      expect(error).toContain('hold no');
      expect(error).toContain('afltables_profile_url');
      expect(error).toContain('will not fall back to players.id');
      expect(error).toContain('Nothing has been written');
    });

    it('refuses a winner holding more than one profile identity', () => {
      const { error } = buildWinners([[
        1999, 42, 80, 'Two Identities', 7, 1,
        ['players/A/A_Player.html', 'players/B/A_Player.html'],
      ]]);
      expect(error).toContain('hold more than one');
    });

    it('refuses a path carrying the key separator rather than sanitising it', () => {
      const { error, winners } = buildWinners([[
        1999, 42, 80, 'Bad Path', 7, 1, ['players/B/Odd:Name.html'],
      ]]);
      expect(winners).toBeUndefined();
      expect(error).toContain('key separator');
      expect(error).toContain('REFUSED, not sanitised');
    });

    it('gives tied winners distinct keys in a deterministic order', () => {
      const { winners } = buildWinners([
        [2001, 9, 100, 'Zeta Player', 3, 1, ['players/Z/Zeta_Player.html']],
        [2001, 8, 100, 'Alpha Player', 4, 1, ['players/A/Alpha_Player.html']],
      ]);
      expect(winners).toHaveLength(2);
      expect(winners!.map((w) => w.key)).toEqual([
        'coleman:2001:players/A/Alpha_Player.html',
        'coleman:2001:players/Z/Zeta_Player.html',
      ]);
    });

    it('carries the multi-club NULL through unchanged', () => {
      const { winners } = buildWinners([[
        2001, 9, 100, 'Traded Player', null, 2, ['players/T/Traded_Player.html'],
      ]]);
      expect(winners![0].club_id).toBeNull();
      expect(winners![0].club_count).toBe(2);
    });
  });

  describe('provenance and reload ownership', () => {
    it('stamps the canonical source of the facts, never draftguru', () => {
      expect(colemanGroup).toContain('require_source(sources, contract["source_key"])');
      expect(colemanGroup).not.toContain('require_source(sources, "draftguru")');
      expect(contract.source_key).toBe('afltables');
    });

    it('scopes the reload by domain AND provenance', () => {
      expect(colemanGroup).toMatch(
        /reload_keyed\([\s\S]*?"award_winners", \["source_id", "source_record_id"\]/,
      );
      expect(colemanGroup).toContain('scope_column="award_id", scope_values=[award_id]');
      expect(colemanGroup).toContain('scopes=[("source_id", [source_id], False)]');
      expect(colemanGroup).toContain('target_table="award_winners"');
    });

    it('never truncates, and never deletes outside its own scope', () => {
      expect(colemanGroup).not.toContain('truncate(');
      expect(colemanGroup).not.toContain('DELETE FROM award_winners');
    });

    it('does not take ownership of the award definition', () => {
      // AFLDB-ISSUE-112 owns award definitions. Create-if-missing is only what makes a
      // canonical rebuild — which runs no legacy awards group — able to parent the rows.
      expect(colemanGroup).toContain('created only when it does not exist');
      expect(colemanGroup).toContain('INSERT INTO awards');
      expect(colemanGroup).not.toContain('UPDATE awards');
      expect(colemanGroup).not.toContain('ON CONFLICT (slug) DO UPDATE');
    });

    it('surfaces ties and multi-club winners instead of reconciling them silently', () => {
      expect(colemanGroup).toContain('produced tied winners');
      expect(colemanGroup).toContain('represented more than one');
    });
  });

  describe('legacy independence', () => {
    it('reads no legacy SQLite database anywhere in the group', () => {
      for (const legacy of ['AFLDB_LEGACY_SQLITE', 'connect_legacy', 'lite.execute']) {
        expect(colemanGroup).not.toContain(legacy);
        expect(transition).not.toContain(legacy);
      }
      expect(importer).toMatch(/LEGACY_FREE_GROUPS = \{[^}]*COLEMAN_GROUP[^}]*\}/);
      expect(importer).toContain(
        'needs_legacy = any(key not in LEGACY_FREE_GROUPS for key in selected)',
      );
    });

    it('acquires nothing: no network, no scrape, no manifest', () => {
      for (const acquisition of ['http', 'requests', 'urllib', 'csv']) {
        expect(colemanGroup).not.toContain(acquisition);
      }
    });

    it('stops the legacy awards group from ever writing a Coleman winner again', () => {
      const legacyGroup = between(importer, 'def import_awards(', '\n\n\n# ----');
      expect(legacyGroup).toContain(
        'for slug in (UNDER_22_SLUG, ALL_AUSTRALIAN_SLUG, COLEMAN_SLUG)',
      );
      expect(legacyGroup).toContain(
        'scope_column="award_id", scope_values=other_group_awards, scope_exclude=True',
      );
      // A row belonging to another group is rejected, never inserted out of scope.
      expect(legacyGroup).toContain('is loaded by another group');
    });

    it('runs alone, requiring no other group', () => {
      expect(importer).toMatch(/GROUP_ORDER = \[[\s\S]*?COLEMAN_GROUP/);
      const requires = between(importer, 'GROUP_REQUIRES = {', '\n\n\ndef expand_groups');
      expect(requires).not.toContain('coleman');
      expect(requires).not.toContain('COLEMAN');
    });
  });

  describe('the one-time legacy transition', () => {
    it('explains the duplication hazard it exists to prevent', () => {
      expect(transition).toContain('92 Coleman rows');
      expect(transition).toContain('import-first-kick-goal.ts');
    });

    it('is retry-safe by state, and refuses a mixture', () => {
      expect(transition).toContain('state: already transitioned -> verify and no-op');
      expect(transition).toContain('state: mixed -> abort');
      expect(transition).toContain('state: all legacy -> exact 1:1 rekey');
      expect(transition).toContain('Mixed ownership state');
      expect(transition).toContain('nothing was written');
    });

    it('holds the scope to the exact expected population', () => {
      expect(transition).toContain('expected_rows = int(transition["expected_rows"])');
      expect(transition).toContain('expected exactly');
      expect(contract.legacy_transition.expected_rows).toBe(46);
      expect(contract.legacy_transition.legacy_source_key).toBe('draftguru');
      expect(contract.legacy_transition.bridge).toBe('(award_id, season)');
      expect(contract.legacy_transition.first_load_expectation)
        .toBe('46 updated, 0 inserted, 0 deleted');
    });

    it('re-verifies the human-decision count at run time', () => {
      // The first derived load rewrites player_name_raw to the canonical display name,
      // which is safe only while no decision is attached. The runbook is not trusted.
      expect(transition).toContain('coleman_link_decision_count');
      expect(transition).toContain('player_link_resolutions');
      expect(transition).toContain('human player-link decision(s) now exist');
      expect(transition).toContain('Re-verified at run time');
    });

    it('preserves every surrogate id and changes only the two ownership columns', () => {
      expect(transition).toContain('UPDATE award_winners');
      expect(transition).toContain('SET source_id = %s, source_record_id = %s');
      expect(transition).toContain('WHERE id = %s');
      expect(transition).toContain('every surrogate id is unchanged');
      expect(transition).not.toContain('DELETE FROM award_winners');
      expect(contract.legacy_transition.preserves_row_ids).toBe(true);
      expect(contract.legacy_transition.columns_changed)
        .toEqual(['source_id', 'source_record_id']);
    });

    it('leaves rows it does not own strictly alone', () => {
      expect(transition).toContain('owned by neither (left untouched)');
    });

    it('is a deliberate one-time mode, not part of an ordinary run', () => {
      expect(importer).toContain('"--rekey-coleman", action="store_true"');
      expect(importer).toContain('return rekey_coleman(pg, rep, sources, contract)');
    });
  });
});
