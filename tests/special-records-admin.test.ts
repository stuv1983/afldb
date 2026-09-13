/**
 * AFLDB-ISSUE-167 Stage 3 — the read-only special-records admin surface, as a
 * source contract.
 *
 * What these assert is deliberately structural, because the things Stage 3 can
 * get wrong are structural: a route that trusts the sidebar instead of a guard,
 * an "edit seam" opened a stage early, a read quietly moved onto the wrong
 * pool, or a decision (D-1, D-2, D-5) eroded by a convenience. The behavioural
 * half of Stage 3 — that a void row is listed, that an unlinked row survives
 * the joins, that provenance comes back — needs a real PostgreSQL and lives in
 * `tests/integration/special-records-lifecycle.test.ts` beside Stage 2's.
 *
 * Nothing here mocks the database: every claim is read out of the committed
 * source, the same idiom `tests/auth.test.ts` uses for the capability contract.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

// The query module opens the application pool at import time. These assertions
// are about its SOURCE and its pure vocabulary, never about a query it runs,
// so the pool is stubbed rather than configured — the same reason
// `tests/awards-admin.test.ts` stubs `postgres`. The queries themselves are
// exercised against a real database in `tests/integration/`.
vi.mock('@/db/client', () => ({
  sql: Object.assign(vi.fn(), { unsafe: vi.fn() }),
}));

import {
  DEFAULT_ADMIN_STATUS_FILTER, SPECIAL_RECORD_STATUSES, isSpecialRecordLinkFilter,
  isSpecialRecordProvenance, isSpecialRecordStatusFilter, provenanceOf,
} from '@/db/queries/admin-special-records';
import { DATA_EDIT_TABLE_NAMES } from '@/db/queries/audit-log';
import { LINK_TARGET_TABLES } from '@/db/queries/player-links';
import { DATA_EDIT_TABLE_LABELS } from '@/lib/audit-view';
import { SPECIAL_RECORD_TABLES } from '@/lib/special-records/identity';

const REPO = process.cwd();
const RECORDS_ROOT = join(REPO, 'src', 'app', 'admin', 'records');

/** Sources are read as LF whatever the checkout's line endings are. */
const readSource = (file: string): string => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

/**
 * The same source with its comments removed.
 *
 * Several assertions below are about what the CODE does, and every one of them
 * would otherwise be defeated by a comment explaining that the code does not
 * do it — this module's own header discusses `status = 'active'` at length in
 * order to say that no admin query may carry it, and `privileges.sql` mentions
 * `player_achievements` in a comment about a different table's grant.
 */
const withoutComments = (source: string): string => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*(?:\/\/|--).*$/gm, '');
const repoPath = (file: string): string => relative(REPO, file).split(sep).join('/');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const RECORDS_FILES = walk(RECORDS_ROOT);
const RECORDS_PAGES = RECORDS_FILES.filter((f) => basename(f) === 'page.tsx');
const QUERY_MODULE = readSource(join(REPO, 'src', 'db', 'queries', 'admin-special-records.ts'));
const QUERY_CODE = withoutComments(QUERY_MODULE);

/** The five routes Stage 3 ships, and no sixth. */
const STAGE_3_ROUTES = [
  'src/app/admin/records/page.tsx',
  'src/app/admin/records/first-kick-goal/page.tsx',
  'src/app/admin/records/first-kick-goal/[id]/page.tsx',
  'src/app/admin/records/after-the-siren/page.tsx',
  'src/app/admin/records/after-the-siren/[id]/page.tsx',
];

describe('the Stage 3 route surface', () => {
  it('ships exactly the five read-only routes, and no /new', () => {
    expect(RECORDS_PAGES.map(repoPath).sort()).toEqual([...STAGE_3_ROUTES].sort());
    // /admin/records/<family>/new is a CREATION route. It belongs to Stage 6
    // with the mutation it implies, and shipping the shell early would be an
    // edit seam with nothing behind it.
    expect(RECORDS_FILES.map(repoPath).filter((p) => p.includes('/new/'))).toEqual([]);
  });

  it('enforces data.specialRecords.read server-side on every one of them', () => {
    // Not "the nav hides it": nav-model.ts says of itself that a link omitted
    // there is not a link that is protected. Each route awaits the guard, and
    // the guard redirects — so a Contributor is denied at the HTTP layer.
    for (const page of RECORDS_PAGES) {
      const source = readSource(page);
      expect(source, `${repoPath(page)} does not await requireCapability`)
        .toContain("await requireCapability('data.specialRecords.read')");
    }
  });

  it('opens no route-level loading boundary of its own (AFLDB-ISSUE-166)', () => {
    // tests/auth.test.ts asserts this for the whole admin area; asserted again
    // here so the reason travels with the domain that must not acquire one.
    // A loading.tsx commits the 200 shell before the guard runs, degrading the
    // redirect denial to a meta-refresh inside a 200 body.
    expect(RECORDS_FILES.map(repoPath).filter((p) => p.endsWith('/loading.tsx'))).toEqual([]);
    for (const file of RECORDS_FILES) {
      expect(/<(?:React\.)?Suspense[\s>]/.test(readSource(file)), `${repoPath(file)} opens a Suspense boundary`)
        .toBe(false);
    }
  });

  it('opens no edit seam: no Server Action, no form post, no mutation import', () => {
    // Stage 3 is read-only by contract. A 'use server' module here would also
    // be a new admin boundary, and an unguarded one would fail the ISSUE-158
    // contract — but the point is earlier than that: there is nothing to write
    // yet, and a placeholder endpoint is how a half-built write path ships.
    for (const file of RECORDS_FILES) {
      const source = readSource(file);
      const path = repoPath(file);
      expect(/^\s*'use server';/m.test(source), `${path} declares a Server Action`).toBe(false);
      expect(/<form[^>]*method=["']POST["']/i.test(source), `${path} posts a form`).toBe(false);
      expect(/method=\{?["']post/i.test(source), `${path} posts a form`).toBe(false);
      expect(/\buseActionState\b|\bformAction\b/.test(source), `${path} wires a form action`).toBe(false);
    }
  });

  it('keeps the derived and identity fields off every control (§3.4.1, §19.1)', () => {
    // link_status_value, candidate_count, player_achievements.match_id and
    // after_siren_kicks.club_id are DERIVED; source_id / source_record_id are
    // IDENTITY. All six are displayed and none is offered as a field. With no
    // form anywhere in the domain (above) the only way one could become
    // editable is an <input>/<select>/<textarea>, so no page may carry a
    // writable control at all in this stage.
    for (const file of RECORDS_PAGES) {
      const source = readSource(file);
      const path = repoPath(file);
      // A GET filter form is the one legitimate input: it narrows a list and
      // writes nothing. Detail pages have no controls whatsoever.
      if (path.includes('[id]')) {
        expect(/<(input|select|textarea|button)\b/i.test(source), `${path} carries a control`).toBe(false);
      }
    }
  });
});

describe('D-2 — after-siren link state is read-only (2026-09-13)', () => {
  it('leaves LINK_TARGET_TABLES exactly as it was: no after_siren_kicks', () => {
    // Option (a) was refused because it collides with AFLDB-ISSUE-164's live,
    // uncommitted confidence work and adds an eighth target. P4 displays the
    // link state and adds no queue.
    expect([...LINK_TARGET_TABLES]).toEqual([
      'award_winners', 'award_nominations', 'hall_of_fame', 'honour_team_members',
      'captaincies', 'player_achievements', 'draft_picks',
    ]);
    expect(LINK_TARGET_TABLES).not.toContain('after_siren_kicks');
  });

  it('creates no second link authority in the records domain', () => {
    // Option (b) was refused for being a second authority over one table.
    // Nothing here may write player_id, link_status_value or a resolution.
    const sources = [...RECORDS_FILES.map(readSource), QUERY_MODULE];
    for (const source of sources) {
      expect(/player_link_resolutions/.test(source)).toBe(false);
      expect(/\b(resolvePlayerLink|recordLinkResolution|linkPlayer)\b/.test(source)).toBe(false);
      expect(/\bUPDATE\s+(player_achievements|after_siren_kicks)\b/i.test(source)).toBe(false);
    }
  });

  it('still surfaces the gap rather than hiding it', () => {
    // The whole point of (c): link status and candidate count are SHOWN, so an
    // unlinked after-siren row is visible as unlinked instead of silently
    // absent. A follow-up carries the gap.
    expect(QUERY_MODULE).toContain('link_status_value');
    expect(QUERY_MODULE).toContain('candidate_count');
  });
});

describe('D-5 — the pool these reads run on (2026-09-13)', () => {
  it('reads both special-record tables on the app/public client, never on authSql', () => {
    expect(QUERY_MODULE).toContain("from '@/db/client'");
    expect(QUERY_MODULE).not.toContain('@/db/authClient');
    for (const file of RECORDS_FILES) {
      expect(readSource(file), `${repoPath(file)} reaches for the auth pool`).not.toContain('@/db/authClient');
    }
  });

  it('leaves tools/maintenance/privileges.sql naming neither table', () => {
    // The Stage 2 decision, re-asserted from the other side: if Stage 3 had
    // needed an afldb_auth grant, the read would have been on the wrong pool.
    // Comments stripped: the file mentions `player_achievements` in a note
    // about why afldb_import may READ player_link_suggestions. What must stay
    // absent is a GRANT, which is the thing D-5 decided against.
    const privileges = withoutComments(readSource(join(REPO, 'tools', 'maintenance', 'privileges.sql')));
    for (const table of SPECIAL_RECORD_TABLES) {
      expect(privileges, `privileges.sql grants something on ${table}`).not.toContain(table);
    }
  });
});

describe('the admin read contract', () => {
  it('defaults the admin lists to every status, active and void alike', () => {
    // The one admin surface whose job is to say what the lifecycle has taken
    // out of the public site cannot open with those rows filtered away. This
    // is a deliberate departure from AFLDB-ISSUE-165's active-by-default
    // lists: 334 + 126 rows make a whole-table default cheap, and Stage 5's
    // active-only filtering is a PUBLIC concern, never an admin one.
    expect(DEFAULT_ADMIN_STATUS_FILTER).toBe('all');
    expect([...SPECIAL_RECORD_STATUSES]).toEqual(['active', 'void']);
  });

  it('carries no public status filter into the admin queries', () => {
    // Stage 5 filters the PUBLIC read models. An admin query that had already
    // acquired `status = 'active'` would hide exactly what it exists to show.
    expect(/status\s*=\s*'active'/.test(QUERY_CODE)).toBe(false);
  });

  it('accepts only the filter vocabularies it declares', () => {
    expect(isSpecialRecordStatusFilter('all')).toBe(true);
    expect(isSpecialRecordStatusFilter('void')).toBe(true);
    expect(isSpecialRecordStatusFilter('ended')).toBe(false);
    expect(isSpecialRecordProvenance('manual')).toBe(true);
    expect(isSpecialRecordProvenance('other')).toBe(false);
    expect(isSpecialRecordLinkFilter('unlinked')).toBe(true);
    expect(isSpecialRecordLinkFilter('maybe')).toBe(false);
  });

  it('reads provenance from the row\'s own source key', () => {
    expect(provenanceOf('manual_admin_edit')).toBe('manual');
    expect(provenanceOf('wikipedia_first_kick_goal')).toBe('source');
    // A row with no source at all is source-owned, not administrator-owned:
    // manual_admin_edit IS a source, and its absence claims nothing.
    expect(provenanceOf(null)).toBe('source');
  });

  it('preserves unresolved rows instead of inner-joining them away', () => {
    // Every player / club / match / opponent join is a LEFT JOIN, because an
    // unlinked row is the one an administrator most needs to see. An inner
    // join anywhere here would silently shorten the list.
    const joins = [...QUERY_CODE.matchAll(/^\s*(LEFT\s+)?JOIN\s+(\w+)/gm)];
    expect(joins.length).toBeGreaterThanOrEqual(6);
    for (const [, left, table] of joins) {
      expect(left, `${table} is joined without LEFT, which drops unresolved rows`).toBeDefined();
    }
  });

  it('returns lifecycle, provenance and link state for both families', () => {
    for (const column of [
      'status', 'status_reason', 'updated_at',
      'source_id', 'source_record_id', 'import_batch_id',
      'link_status_value', 'candidate_count',
    ]) {
      expect(QUERY_MODULE, `the admin SELECTs omit ${column}`).toContain(column);
    }
    // sources.key travels with every row: it is half the durable identity and
    // the whole of the provenance badge.
    expect(QUERY_MODULE).toMatch(/s\.key AS "sourceKey"/);
  });

  it('bounds every list', () => {
    expect(QUERY_MODULE).toContain('LIMIT');
    expect(QUERY_MODULE).toContain('OFFSET');
  });
});

describe('D-1 — the surface covers two families and no third (2026-09-13)', () => {
  it('is pinned to the two tables the identity module names', () => {
    expect([...SPECIAL_RECORD_TABLES]).toEqual(['player_achievements', 'after_siren_kicks']);
  });

  it('claims no /records/family namespace', () => {
    expect(RECORDS_FILES.map(repoPath).some((p) => p.includes('family') || p.includes('father-son')))
      .toBe(false);
  });

  it('notices if player_achievements ever admits a second achievement type', () => {
    // The admin list does NOT filter on achievement_type, because the enum has
    // exactly one member and a predicate would silently HIDE a future family
    // row rather than surface it. This assertion is the alarm that makes that
    // choice safe: admit a second type and this fails, which is the moment to
    // decide what /admin/records/first-kick-goal should do about it.
    const migration = readSource(join(REPO, 'src', 'db', 'migrations', '053_player_achievements.sql'));
    expect(migration).toContain("CREATE TYPE player_achievement_type AS ENUM ('first_kick_goal');");
  });
});

describe('the audit viewer carries its own table-name allowlist (§12)', () => {
  it('admits both special-record tables, so a record\'s history can be read at all', () => {
    // Migration 102 widened data_edits_table_name_check in the database. The
    // TypeScript allowlist is a SECOND list, and §12 left open whether the
    // ISSUE-157 viewer carried one. It does — this is that question answered.
    for (const table of SPECIAL_RECORD_TABLES) {
      expect(DATA_EDIT_TABLE_NAMES, `${table} is absent from the read-side allowlist`).toContain(table);
      expect(DATA_EDIT_TABLE_LABELS[table], `${table} has no viewer label`).toBeTruthy();
    }
  });

  it('keeps the TypeScript allowlist and migration 102 in step', () => {
    const migration = readSource(join(REPO, 'src', 'db', 'migrations', '102_special_records_lifecycle.sql'));
    const check = migration.match(/data_edits_table_name_check CHECK \(table_name IN \(([\s\S]*?)\)\)/);
    expect(check, 'migration 102 no longer widens data_edits_table_name_check').not.toBeNull();
    const literals = [...check![1].matchAll(/'(\w+)'/g)].map((m) => m[1]).sort();
    expect([...DATA_EDIT_TABLE_NAMES].sort()).toEqual(literals);
  });
});
