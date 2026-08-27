/**
 * AFLDB-ISSUE-093 Phase 1: the static/reference datasets under data/reference/
 * and their standalone loader, tools/migration/load_reference_data.py.
 *
 * The datasets replace hand-curated constants that lived inside the
 * legacy-dependent import_legacy_afl.py. These tests pin what porting must
 * not change: stable identifiers (club hist strings, slugs, stat keys), the
 * organization model (mergers link, never combine), and the loader's zero
 * dependency on AFLDB_LEGACY_SQLITE. No database is touched: the loader run
 * here is --print-plan only, which validates and counts without connecting.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  assertProjectableColumns,
  countIndependentWitnesses,
  getSourceFamily,
  independenceGroups,
  isPromotable,
  parseSourceFamilyRegistry,
  roundKey,
  roundKeysEqual,
  translateRound,
} from '@/lib/acquisition/source-families';

const root = join(__dirname, '..');
const refDir = join(root, 'data', 'reference');

function readJson(name: string): any {
  return JSON.parse(readFileSync(join(refDir, name), 'utf8'));
}

const sources = readJson('sources.json');
const seasons = readJson('seasons.json');
const clubs = readJson('clubs.json');
const statDefs = readJson('stat-definitions.json');
const statAvail = readJson('stat-availability.json');
const venueCanonical = readJson('venue-canonical.json');
const sourceFamiliesRaw = readJson('source-families.json');

describe('sources dataset', () => {
  it('carries the seven registry rows with unique keys and valid kinds', () => {
    const keys = sources.sources.map((s: any) => s.key);
    expect(keys).toEqual([
      'fitzroy_afldata', 'afltables', 'wikipedia', 'wikipedia_22under22',
      'draftguru', 'footywire', 'sports_data_lab',
    ]);
    const kinds = new Set(['upstream_dataset', 'scrape', 'manual', 'derived']);
    for (const s of sources.sources) expect(kinds.has(s.kind)).toBe(true);
  });
});

describe('seasons dataset', () => {
  it('starts at 1897 and tiles the league eras contiguously', () => {
    expect(seasons.first_season).toBe(1897);
    expect(seasons.last_season).toBeGreaterThanOrEqual(2026);
    let year = seasons.first_season;
    for (const era of seasons.league_eras) {
      expect(era.first_season).toBe(year);
      year = (era.last_season ?? seasons.last_season) + 1;
    }
    expect(year).toBe(seasons.last_season + 1);
    // The league renamed for 1990: VFL through 1989, AFL after.
    expect(seasons.league_eras).toEqual([
      { league: 'VFL', first_season: 1897, last_season: 1989 },
      { league: 'AFL', first_season: 1990, last_season: null },
    ]);
  });

  it('keeps in-progress seasons inside the range', () => {
    for (const y of seasons.in_progress_seasons) {
      expect(y).toBeGreaterThanOrEqual(seasons.first_season);
      expect(y).toBeLessThanOrEqual(seasons.last_season);
    }
  });
});

describe('clubs dataset', () => {
  const identities = clubs.identities;
  const byHist = new Map(identities.map((c: any) => [c.hist, c]));

  it('holds all 24 historical identities with unique stable identifiers', () => {
    expect(identities).toHaveLength(24);
    for (const field of ['hist', 'slug', 'name']) {
      expect(new Set(identities.map((c: any) => c[field])).size).toBe(24);
    }
    expect(identities.filter((c: any) => c.is_current_afl_club)).toHaveLength(18);
  });

  it('preserves the succession model exactly', () => {
    expect((byHist.get('Footscray') as any).successor_hist).toBe('Western Bulldogs');
    expect((byHist.get('Kangaroos') as any).successor_hist).toBe('North Melbourne');
    expect((byHist.get('South Melbourne') as any).successor_hist).toBe('Sydney');
    // Mergers do NOT point at a successor identity: Fitzroy's and the
    // Bears' records stay their own; the link is an organization relation.
    expect((byHist.get('Fitzroy') as any).successor_hist).toBeNull();
    expect((byHist.get('Brisbane Bears') as any).successor_hist).toBeNull();
    expect((byHist.get('University') as any).succession).toBe('defunct');
    for (const c of identities) {
      if (c.successor_hist !== null) expect(byHist.has(c.successor_hist)).toBe(true);
      expect(c.is_current_afl_club).toBe(c.succession === 'current');
    }
  });

  it('keeps the three organization relations, targeting organizations only', () => {
    const orgSlugs = new Set(
      identities.filter((c: any) => c.successor_hist === null).map((c: any) => c.slug),
    );
    expect(clubs.organization_relations).toHaveLength(3);
    for (const rel of clubs.organization_relations) {
      expect(orgSlugs.has(rel.from_slug)).toBe(true);
      if (rel.relation === 'folded') expect(rel.to_slug).toBeNull();
      else expect(orgSlugs.has(rel.to_slug)).toBe(true);
    }
    const merged = clubs.organization_relations
      .filter((r: any) => r.relation === 'merged_into')
      .map((r: any) => r.from_slug)
      .sort();
    expect(merged).toEqual(['brisbane-bears', 'fitzroy']);
  });

  it('keeps identity spans inside the season range', () => {
    for (const c of identities) {
      const last = c.last_season ?? seasons.last_season;
      expect(c.first_season).toBeGreaterThanOrEqual(seasons.first_season);
      expect(last).toBeGreaterThanOrEqual(c.first_season);
      // Only non-current identities may have a closed span.
      if (c.last_season !== null) expect(c.is_current_afl_club).toBe(false);
    }
  });
});

describe('stat definitions dataset', () => {
  it('carries the 21 per-match keys plus the three Brownlow grains, never the generic key', () => {
    const keys = statDefs.definitions.map((d: any) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(24);
    for (const grain of ['brownlow_match_votes', 'brownlow_round_votes', 'brownlow_season_total']) {
      expect(keys).toContain(grain);
    }
    // The single 'brownlow' key gave one answer to three questions; the
    // importer deletes it and the static dataset must never resurrect it.
    expect(keys).not.toContain('brownlow');
    expect(keys).toContain('marks_i50');
    expect(keys).toContain('inside50s');
  });
});

describe('stat availability dataset', () => {
  it('is either pending extraction or a valid coverage grid', () => {
    expect(['PENDING_EXTRACTION', 'READY']).toContain(statAvail.status);
    if (statAvail.status !== 'READY') {
      expect(statAvail.coverage_ranges).toHaveLength(0);
      return;
    }
    const defined = new Set(statDefs.definitions.map((d: any) => d.key));
    const coverage = new Set(['complete', 'partial', 'not_collected', 'not_applicable', 'pending']);
    const seen = new Set<string>();
    for (const r of statAvail.coverage_ranges) {
      expect(defined.has(r.stat_key)).toBe(true);
      expect(coverage.has(r.coverage)).toBe(true);
      expect(r.first_season).toBeGreaterThanOrEqual(seasons.first_season);
      expect(r.last_season).toBeLessThanOrEqual(seasons.last_season);
      for (let y = r.first_season; y <= r.last_season; y++) {
        const cell = `${r.stat_key}:${y}`;
        expect(seen.has(cell), `${cell} covered twice`).toBe(false);
        seen.add(cell);
      }
    }
    // The NULL-era semantics ISSUE-093 exists to preserve: the 1935-1983
    // per-match Brownlow gap must survive the port. Inside it, 1942-1945 is
    // not_applicable (no medal awarded in the war years), not not_collected —
    // as extracted from the pre-rebuild baseline.
    for (let y = 1935; y <= 1983; y++) {
      const gap = statAvail.coverage_ranges.find(
        (r: any) => r.stat_key === 'brownlow_match_votes'
          && r.first_season <= y && y <= r.last_season,
      );
      expect(gap, `brownlow_match_votes ${y} missing from grid`).toBeDefined();
      expect(gap.coverage).toBe(y >= 1942 && y <= 1945 ? 'not_applicable' : 'not_collected');
    }
  });
});

describe('venue canonical dataset', () => {
  it('carries the three unambiguous expansions unchanged', () => {
    expect(venueCanonical.canonical_names).toEqual({
      'M.C.G.': 'Melbourne Cricket Ground',
      'S.C.G.': 'Sydney Cricket Ground',
      'W.A.C.A.': 'WACA Ground',
    });
  });
});

describe('load_reference_data.py', () => {
  const loaderSource = readFileSync(
    join(root, 'tools', 'migration', 'load_reference_data.py'), 'utf8');

  const commonSource = readFileSync(
    join(root, 'tools', 'migration', 'common.py'), 'utf8');

  /*
   * AFLDB-ISSUE-093 §H12 — the REFERENCE stage of the first clean rebuild died here.
   *
   * guard_cascade() probed every transitive FK dependent of its truncate roots with
   * `SELECT count(*)`. That closure reaches admin and link-review relations the
   * afldb_import role is deliberately denied, so the run ended in
   * InsufficientPrivilege on player_link_match_candidates — after the destructive
   * reset had already emptied the database. Granting that one table would only have
   * moved the failure to player_match_period_stats, the next unregistered relation
   * in the same closure.
   *
   * These tests are the reason another destructive rebuild does not have to be the
   * thing that discovers the next one.
   */
  describe('cascade guard under the restricted import role (§H12)', () => {
    it('never probes a dependent with an unguarded count', () => {
      // The exact shape that failed: a count over a table named by the FK closure.
      expect(loaderSource).not.toMatch(/scalar\(pg,\s*f?["']SELECT count\(\*\) FROM \{/);
    });

    it('classifies dependents through the catalogue, not by reading them', () => {
      expect(loaderSource).toContain('selectable(pg, outside)');
      expect(commonSource).toContain('has_table_privilege');
      // has_table_privilege() needs no privilege on its argument; that is the point.
      expect(commonSource).toMatch(/def selectable\(/);
    });

    it('counts rows only in dependents it has proven readable', () => {
      expect(loaderSource).toContain('any_rows(pg, [t for t in outside if t in readable])');
    });

    it('refuses, rather than assuming, when a dependent cannot be read', () => {
      expect(loaderSource).toContain('unreadable = [t for t in outside if t not in readable]');
      expect(loaderSource).toMatch(/if unreadable and not allow_cascade:[\s\S]{0,400}sys\.exit/);
      expect(loaderSource).toContain('cannot be shown to be');
    });

    it('keeps the populated-dependent refusal it always had', () => {
      expect(loaderSource).toMatch(/if populated:[\s\S]{0,400}sys\.exit/);
      expect(loaderSource).toContain('which hold data this loader does not rebuild');
    });

    it('takes the cascade closure from the POPULATED roots, not the union (§H13)', () => {
      // The §H12 defect. Migrations 015/016 SEED stat_definitions and
      // stat_availability, so a freshly migrated database is never fully empty —
      // the whole-union short circuit could never fire, and the closure of the
      // EMPTY clubs/seasons roots was adjudicated anyway. A truncate that will be
      // skipped cascades into nothing, so only populated roots may contribute.
      expect(loaderSource).toContain('populated_roots = any_rows(pg, sorted(to_truncate))');
      expect(loaderSource).toContain('cascade_dependents(pg, populated_roots)');
      expect(loaderSource).not.toContain('cascade_dependents(pg, sorted(to_truncate))');
      // The behavioural proof of this lives in tests/python/reference_cascade_contract.py;
      // this assertion only pins the shape it depends on.
    });

    it('will not let the guard and the truncate disagree about the roots (§H13)', () => {
      expect(loaderSource).toContain('_cleared_roots');
      expect(loaderSource).toMatch(/unadjudicated = sorted\(set\(populated\) - _cleared_roots\)/);
    });

    it('skips a TRUNCATE whose targets are already empty', () => {
      // TRUNCATE ... CASCADE needs privileges on the whole cascade set, not just on
      // the tables named — and the cascade from clubs reaches relations afldb_import
      // may not touch. Truncating an empty table removes nothing, so it is skipped.
      expect(loaderSource).toMatch(/def reload_truncate\(/);
      const body = loaderSource.slice(loaderSource.indexOf('def reload_truncate('));
      // the emptiness check comes BEFORE the statement it guards
      expect(body.indexOf('populated = any_rows(')).toBeGreaterThan(-1);
      expect(body.indexOf('populated = any_rows('))
        .toBeLessThan(body.indexOf('truncate(pg, *tables)'));
      expect(body).toMatch(/if not populated:\s*\n\s*return/);
      for (const call of ['reload_truncate(pg, "seasons")',
                          'reload_truncate(pg, "clubs", "club_aliases")',
                          'reload_truncate(pg, "stat_definitions", "stat_availability")']) {
        expect(loaderSource).toContain(call);
      }
      // No GROUP LOADER calls the raw truncate() any more. Scoped to a quoted table
      // literal, which is how the group loaders name their targets — reload_truncate's
      // own `truncate(pg, *tables)` delegation is the one legitimate call site.
      expect(loaderSource).not.toMatch(/^\s{4}truncate\(pg, "/m);
    });

    it('needs no new grant: privileges.sql is untouched by this repair', () => {
      const privileges = readFileSync(
        join(root, 'tools', 'maintenance', 'privileges.sql'), 'utf8');
      // The two relations in the closure that afldb_import cannot read stay that way.
      expect(privileges).not.toContain('GRANT SELECT ON player_link_match_candidates');
      expect(privileges).not.toContain('GRANT SELECT ON player_match_period_stats');
    });
  });

  /*
   * The generalisation. Migration 045 seeded import_writable_tables from every
   * public base table that then existed, so anything created AFTER 045 is revoked
   * from afldb_import unless it calls afldb_meta.grant_import_write(). That is the
   * mechanism, and it will keep producing relations the FK closure reaches and the
   * import role cannot read. This test pins the set so a new one is a visible,
   * DB-free change rather than a surprise mid-rebuild.
   */
  describe('post-045 tables unreadable to afldb_import (§H12)', () => {
    const migrations = join(root, 'src', 'db', 'migrations');
    const files = readdirSync(migrations).filter((f) => f.endsWith('.sql')).sort();

    const created: { table: string; migration: string }[] = [];
    const registered = new Set<string>();
    for (const f of files) {
      const sql = readFileSync(join(migrations, f), 'utf8')
        .split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
      if (Number(f.slice(0, 3)) > 45) {
        for (const m of sql.matchAll(
          /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z0-9_]+)\s*\(/gi)) {
          created.push({ table: m[1].toLowerCase(), migration: f });
        }
      }
      for (const m of sql.matchAll(/grant_import_write\('([a-z0-9_]+)'\)/gi)) {
        registered.add(m[1].toLowerCase());
      }
    }

    it('finds the tables created after 045 that never registered import write', () => {
      const unregistered = created
        .filter((c) => !registered.has(c.table)).map((c) => c.table).sort();
      // If this list grows, check whether the new table is in the reference
      // loader's FK cascade closure before running another destructive rebuild.
      expect(unregistered).toEqual([
        'app_health_events',
        'data_edits',
        'nl_search_feedback',
        'nl_search_log',
        'nl_search_review',
        'player_link_match_candidates',
        'player_link_resolutions',
        'player_link_suggestions',
        'player_match_period_stats',
      ]);
    });

    it('confirms the two that sit in the reference loader cascade closure', () => {
      // player_link_match_candidates -> players -> clubs/seasons  (migration 067)
      // player_match_period_stats.club_id -> clubs                (migration 062)
      // player_link_resolutions is also in the closure but privileges.sql grants it
      // SELECT explicitly (migration 068), so it reads fine.
      for (const t of ['player_link_match_candidates', 'player_match_period_stats']) {
        expect(registered.has(t)).toBe(false);
      }
      const privileges = readFileSync(
        join(root, 'tools', 'maintenance', 'privileges.sql'), 'utf8');
      expect(privileges).toContain('GRANT SELECT ON player_link_resolutions TO afldb_import');
    });
  });

  it('has zero dependency on the legacy SQLite path', () => {
    // The docstring may name AFLDB_LEGACY_SQLITE to say it is not used; the
    // code must never read it or open the legacy database.
    expect(loaderSource).not.toContain('require_env("AFLDB_LEGACY_SQLITE"');
    expect(loaderSource).not.toContain("require_env('AFLDB_LEGACY_SQLITE'");
    expect(loaderSource).not.toContain('connect_legacy');
    expect(loaderSource).not.toMatch(/import sqlite|sqlite3/);
  });

  // .venv layout differs by platform: POSIX venvs put the interpreter under
  // bin/, Windows venvs under Scripts/ with a .exe suffix.
  const venvPython = process.platform === 'win32'
    ? join(root, '.venv', 'Scripts', 'python.exe')
    : join(root, '.venv', 'bin', 'python');
  const python = process.env.AFLDB_PYTHON
    ?? (existsSync(venvPython) ? venvPython : (process.platform === 'win32' ? 'python' : 'python3'));
  // common.py imports psycopg at module level, so --print-plan needs it even
  // though it never connects.
  const probe = spawnSync(python, ['-c', 'import psycopg'], { encoding: 'utf8' });
  const canRun = !probe.error && probe.status === 0;

  it.skipIf(!canRun)('--print-plan validates the datasets and is deterministic', () => {
    const run = () => spawnSync(
      python, ['tools/migration/load_reference_data.py', '--print-plan'],
      { cwd: root, encoding: 'utf8' },
    );
    const first = run();
    expect(first.status, `stderr:\n${first.stderr}`).toBe(0);
    expect(first.stdout).toContain('reference datasets valid');
    expect(first.stdout).toContain('clubs:            24');
    expect(first.stdout).toContain('stat definitions: 24');
    const second = run();
    expect(second.status).toBe(0);
    expect(second.stdout).toBe(first.stdout);
  });

  /*
   * AFLDB-ISSUE-093 §H13 — the BEHAVIOURAL contract.
   *
   * The §H12 tests above are source-string contracts. They passed while the control
   * flow was wrong, because they could assert the shape of the short circuit but not
   * that it ever fired. This drives the real guard_cascade() and reload_truncate()
   * against a fake connection and asserts what they actually do. No database.
   */
  it.skipIf(!canRun)('cascade guard behaves correctly (tests/python/reference_cascade_contract.py)',
    () => {
      const run = spawnSync(python, ['tests/python/reference_cascade_contract.py'],
        { cwd: root, encoding: 'utf8' });
      expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
      expect(run.stdout).toContain('All cascade-guard scenarios hold.');
      expect(run.stdout).not.toContain('FAIL ');
      // the scenarios that matter most, named so a silent removal is visible here
      for (const scenario of [
        'A2 the closure is taken from the POPULATED roots only',
        'A4 no readability split is needed at all',
        'B1 the loader refuses',
        'C2 the guarded TRUNCATE is issued',
        'D2 an unadjudicated root is refused, not truncated',
      ]) {
        expect(run.stdout).toContain(`PASS  ${scenario}`);
      }
    });
});

/*
 * AFLDB-ISSUE-096 S1 — the source-family acquisition contract.
 *
 * data/reference/source-families.json declares, per (source key, family), the
 * external key shape, hash exclusions, required/known columns, round vocabulary
 * and independence group; src/lib/acquisition/source-families.ts parses it
 * fail-closed. These tests pin the parts of the contract that a later family
 * issue must not quietly relax: Kali and Squiggle stay ONE match witness,
 * lineups are never promotable, zero is not a weight, and round integers are
 * not comparable across sources. No database.
 */
describe('source families dataset (AFLDB-ISSUE-096 S1)', () => {
  const registry = parseSourceFamilyRegistry(sourceFamiliesRaw);

  const clone = (): any => JSON.parse(JSON.stringify(sourceFamiliesRaw));
  const familyIn = (data: any, sourceKey: string, family: string): any =>
    data.families.find((f: any) => f.source_key === sourceKey && f.family === family);
  const refuses = (mutate: (data: any) => void): void => {
    const data = clone();
    mutate(data);
    expect(() => parseSourceFamilyRegistry(data)).toThrow();
  };

  it('declares the four 2026 acquisition sources by stable key only', () => {
    expect([...registry.sources.keys()].sort()).toEqual([
      'afl_api', 'afltables', 'kali_afl_stats', 'squiggle_api',
    ]);
    // A database-local sources.id must never appear in a tracked contract.
    expect(JSON.stringify(sourceFamiliesRaw)).not.toContain('source_id');

    // Each declared key must exist where the registration says it does.
    expect(sources.sources.map((s: any) => s.key)).toContain('afltables');
    const migration063 = readFileSync(
      join(root, 'src', 'db', 'migrations', '063_external_current_match_sources.sql'), 'utf8');
    for (const key of ['squiggle_api', 'kali_afl_stats']) {
      expect(registry.sources.get(key)!.registeredBy).toBe('migration');
      expect(migration063).toContain(`('${key}'`);
    }
    // The AFL API has no sources row anywhere yet; that is recorded, not assumed away.
    expect(registry.sources.get('afl_api')!.registeredBy).toBe('unregistered');
    expect(registry.sources.get('afl_api')!.registrationOwner).toBe('AFLDB-ISSUE-100');
  });

  /*
   * AMENDED 2026-08-28 by probe P1, which ran once the Kali key became
   * available. The registry previously placed Kali /matches in the `squiggle`
   * group as the fail-closed default while P1 was blocked; P1 disproved
   * derivation, so the two are now two witnesses. The /fixture endpoint stays
   * a proven verbatim proxy, so the derived-group rule is pinned there.
   */
  it('counts Squiggle and Kali as TWO match witnesses now that P1 has run', () => {
    const both = ['squiggle_api', 'kali_afl_stats'];
    expect(independenceGroups(registry, 'match', both)).toEqual(['kali', 'squiggle']);
    expect(countIndependentWitnesses(registry, 'match', both)).toBe(2);
    expect(getSourceFamily(registry, 'kali_afl_stats', 'match').independence).toMatchObject({
      derivesFrom: null,
      group: 'kali',
      evidence: 'proven_independent',
    });
    // The proven /fixture proxy is still recorded explicitly rather than
    // omitted: a derived endpoint stays in its upstream's group.
    expect(getSourceFamily(registry, 'kali_afl_stats', 'fixture').independence).toMatchObject({
      derivesFrom: 'squiggle_api',
      group: 'squiggle',
      evidence: 'proven_derived',
    });
    expect(independenceGroups(registry, 'fixture', ['kali_afl_stats'])).toEqual(['squiggle']);
    // A derived source may not invent its own group and become a second witness.
    refuses((data) => { familyIn(data, 'kali_afl_stats', 'fixture').independence.group = 'kali'; });
    refuses((data) => {
      familyIn(data, 'kali_afl_stats', 'fixture').independence.derives_from = null;
    });
  });

  /*
   * P2 ran at the same time and found NO player id on the Kali stat grain,
   * so the player_stats family must stay unprojectable. This pins the gap: if
   * someone later declares a column contract for it, they must also declare an
   * identity, and this test is where that decision surfaces.
   */
  it('keeps the Kali player grain fail-closed after P2', () => {
    const stats = getSourceFamily(registry, 'kali_afl_stats', 'player_stats');
    expect(stats.status).toBe('identity_only');
    expect(stats.externalKey).toBeNull();
    expect(isPromotable(stats)).toBe(false);
    expect(() => assertProjectableColumns(stats, ['matchId', 'playerName', 'teamId']))
      .toThrow(/no column contract/);
    // Name + team is a heuristic, and the notes must keep saying so.
    expect(stats.notes.join(' ').toLowerCase()).toContain('heuristic');
  });

  it('promotes nothing in v1, and lineups never at all', () => {
    expect(registry.families.filter(isPromotable)).toEqual([]);
    expect(getSourceFamily(registry, 'afl_api', 'lineup').promotionPolicy).toBe('never');
    expect(getSourceFamily(registry, 'squiggle_api', 'match').promotionPolicy).toBe('never');
    // Reviewed promotion cannot be declared for a source with no sources row.
    refuses((data) => { familyIn(data, 'afl_api', 'roster').promotion_policy = 'reviewed'; });
    // ...nor for a family whose column contract was never proven.
    refuses((data) => {
      familyIn(data, 'afltables', 'player_match_stats').promotion_policy = 'reviewed';
    });
  });

  it('keeps AFL API zero-as-missing and the fetch date out of the change oracle', () => {
    const roster = getSourceFamily(registry, 'afl_api', 'roster');
    expect(roster.zeroIsMissingColumns).toEqual(['weightInKg']);
    expect(roster.hashExclusions).toEqual(['data_accessed']);
    // data_accessed is AFLDB's own fetch date: excluded from the hash, and never
    // an upstream mutation timestamp.
    expect(roster.sourceUpdatedAtField).toBeNull();
    refuses((data) => {
      familyIn(data, 'afl_api', 'roster').source_updated_at_field = 'data_accessed';
    });
    // utcStartTime is a scheduled start time, so the lineup family declares none.
    const lineup = getSourceFamily(registry, 'afl_api', 'lineup');
    expect(lineup.sourceUpdatedAtField).toBeNull();
    expect(lineup.knownColumns).toContain('utcStartTime');
  });

  it('treats Squiggle `updated` as the one genuine upstream mutation timestamp', () => {
    const squiggle = getSourceFamily(registry, 'squiggle_api', 'match');
    expect(squiggle.sourceUpdatedAtField).toBe('updated');
    // It is content, not volatile response noise: it stays inside the hash.
    expect(squiggle.hashExclusions).toEqual([]);
    const withUpdatedAt = registry.families.filter((f) => f.sourceUpdatedAtField !== null);
    expect(withUpdatedAt.map((f) => `${f.sourceKey}/${f.family}`).sort()).toEqual([
      'kali_afl_stats/fixture', 'kali_afl_stats/match', 'squiggle_api/match',
    ]);
  });

  it('refuses to project a family whose shape was never proven', () => {
    const stats = getSourceFamily(registry, 'afltables', 'player_match_stats');
    expect(stats.status).toBe('identity_only');
    expect(stats.requiredColumns).toBeNull();
    expect(() => assertProjectableColumns(stats, ['url', 'ID'])).toThrow(/no column contract/);
    // P5: `ID` is 82 NA in-season, so it must never become a required column.
    expect(stats.notes.join(' ').toLowerCase()).toContain('never be required');
    expect(() => assertProjectableColumns(
      getSourceFamily(registry, 'kali_afl_stats', 'player_stats'), ['matchId'])).toThrow();
  });

  it('accepts the proven lineup columns and refuses drift in either direction', () => {
    const lineup = getSourceFamily(registry, 'afl_api', 'lineup');
    const r25 = [...lineup.knownColumns!];
    expect(r25).toHaveLength(19);
    expect(() => assertProjectableColumns(lineup, r25)).not.toThrow();

    // A missing required column is a refusal, not a silent NULL.
    expect(() => assertProjectableColumns(lineup, r25.filter((c) => c !== 'teamStatus')))
      .toThrow(/missing required column\(s\): teamStatus/);

    // P3 measured 20 columns at round 20 and never enumerated the extra one, so
    // known_columns is deliberately incomplete and a round-20 payload refuses.
    // That refusal is AFLDB-ISSUE-100's signal to enumerate it.
    expect(lineup.knownColumnsStatus).toBe('incomplete');
    expect(() => assertProjectableColumns(lineup, [...r25, 'someUnenumeratedColumn']))
      .toThrow(/undeclared column\(s\): someUnenumeratedColumn/);
  });

  it('keeps round integers inside their own vocabulary', () => {
    const afltables = getSourceFamily(registry, 'afltables', 'player_match_stats');
    const squiggle = getSourceFamily(registry, 'squiggle_api', 'match');
    // Opening Round 2026 is round 1 to AFL Tables and round 0 to Squiggle.
    const openingAfltables = roundKey(afltables, 1, null);
    const openingSquiggle = roundKey(squiggle, 0, null);
    expect(roundKeysEqual(openingAfltables, roundKey(afltables, 1, null))).toBe(true);
    expect(roundKeysEqual(openingAfltables, roundKey(afltables, 25, null))).toBe(false);
    expect(() => roundKeysEqual(openingAfltables, openingSquiggle))
      .toThrow(/different vocabularies/);

    // Every declared mapping is anchors-only, so translation stays refused.
    for (const vocabulary of registry.roundVocabularies.values()) {
      expect(vocabulary.mappingStatus).toBe('anchors_only');
    }
    expect(() => translateRound(registry, openingSquiggle, 'afltables_2026'))
      .toThrow(/anchors_only/);
    expect(translateRound(registry, openingSquiggle, 'squiggle_2026')).toBe(openingSquiggle);
    // A family with no proven round vocabulary cannot produce a round key at all.
    expect(() => roundKey(getSourceFamily(registry, 'afl_api', 'roster'), 1, null))
      .toThrow(/no round vocabulary/);
    // Kali agrees with Squiggle on every jointly observed round, but the
    // vocabularies stay separate declarations, so the integers stay uncomparable.
    expect(() => roundKeysEqual(
      roundKey(getSourceFamily(registry, 'kali_afl_stats', 'match'), 0, null),
      roundKey(squiggle, 0, null),
    )).toThrow(/different vocabularies/);
  });

  it('fails closed on registry drift', () => {
    refuses((data) => { data.contract_version = 2; });
    refuses((data) => { data.families.push(familyIn(data, 'squiggle_api', 'match')); });
    refuses((data) => { familyIn(data, 'squiggle_api', 'match').source_key = 'not_a_source'; });
    refuses((data) => { familyIn(data, 'squiggle_api', 'match').round_vocabulary = 'not_declared'; });
    refuses((data) => { familyIn(data, 'squiggle_api', 'match').hash_exclusions = ['not_a_column']; });
    refuses((data) => { familyIn(data, 'squiggle_api', 'match').required_columns = ['not_a_column']; });
    refuses((data) => { familyIn(data, 'squiggle_api', 'match').surprise = true; });
    // An identity_only family may not smuggle in a column contract.
    refuses((data) => {
      familyIn(data, 'kali_afl_stats', 'player_stats').required_columns = ['matchId'];
    });
    // ...and a declared one may not drop it.
    refuses((data) => { familyIn(data, 'afl_api', 'roster').known_columns = null; });
  });
});
