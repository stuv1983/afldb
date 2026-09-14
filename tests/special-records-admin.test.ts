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
  AFTER_SIREN_CORRECTABLE, DEFAULT_ADMIN_STATUS_FILTER, FIRST_KICK_CORRECTABLE,
  SPECIAL_RECORD_STATUSES, isSpecialRecordLinkFilter, isSpecialRecordProvenance,
  isSpecialRecordStatusFilter, provenanceOf, uncorrectableFieldRefusal,
} from '@/db/queries/admin-special-records';
import {
  AFTER_SIREN_CORRECTABLE_FIELDS, FIRST_KICK_CORRECTABLE_FIELDS,
} from '@/app/admin/records/actions';
import { isAllowedRevalidatePath } from '@/app/admin/records/revalidate-paths';
import { validateAfterSirenEvent } from '@/lib/special-records/after-siren-rules';
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

/**
 * The five READ routes (Stage 3) and the two creation routes Stage 6 adds.
 *
 * The `/new` pair is a CREATION surface and could not ship before the mutation
 * it implies: shipping the shell early would have been an edit seam with
 * nothing behind it, which is why Stage 3 asserted its absence.
 */
const READ_ROUTES = [
  'src/app/admin/records/page.tsx',
  'src/app/admin/records/first-kick-goal/page.tsx',
  'src/app/admin/records/first-kick-goal/[id]/page.tsx',
  'src/app/admin/records/after-the-siren/page.tsx',
  'src/app/admin/records/after-the-siren/[id]/page.tsx',
];

/** Guarded by `.edit`, not `.read`: every path they reach is a mutation. */
const CREATE_ROUTES = [
  'src/app/admin/records/first-kick-goal/new/page.tsx',
  'src/app/admin/records/after-the-siren/new/page.tsx',
];

describe('the records route surface', () => {
  it('ships exactly the five read routes and the two creation routes', () => {
    expect(RECORDS_PAGES.map(repoPath).sort())
      .toEqual([...READ_ROUTES, ...CREATE_ROUTES].sort());
  });

  it('enforces a special-records capability server-side on every one of them', () => {
    // Not "the nav hides it": nav-model.ts says of itself that a link omitted
    // there is not a link that is protected. Each route awaits the guard, and
    // the guard redirects — so a Contributor is denied at the HTTP layer.
    for (const page of READ_ROUTES) {
      expect(readSource(join(REPO, page)), `${page} does not await requireCapability`)
        .toContain("await requireCapability('data.specialRecords.read')");
    }
    // The creation pages take the NARROWER capability, following
    // /admin/awards/winners/new: an Admin who could not complete the form is
    // turned away at the door rather than shown one that will refuse them.
    for (const page of CREATE_ROUTES) {
      expect(readSource(join(REPO, page)), `${page} does not await requireCapability`)
        .toContain("await requireCapability('data.specialRecords.edit')");
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

  it('has exactly ONE Server Action module, and it guards the edit capability', () => {
    // A second 'use server' module in this domain would be a second write
    // boundary to keep guarded, and the ISSUE-158 contract is enforced per
    // module. One module, one guard, asserted from both directions.
    const actionModules = RECORDS_FILES
      .filter((file) => /^\s*'use server';/m.test(readSource(file)))
      .map(repoPath);
    expect(actionModules).toEqual(['src/app/admin/records/actions.ts']);

    const actions = readSource(join(REPO, 'src/app/admin/records/actions.ts'));
    const guards = [...actions.matchAll(/await requireCapability\('([^']+)'\)/g)].map((m) => m[1]);
    expect(guards.length).toBeGreaterThanOrEqual(10);
    expect([...new Set(guards)]).toEqual(['data.specialRecords.edit']);
  });

  it('keeps the derived and identity fields off every control (§3.4.1, §19.1)', () => {
    // link_status_value, candidate_count, player_achievements.match_id and
    // after_siren_kicks.club_id are DERIVED; source_id / source_record_id are
    // IDENTITY. Stage 6 gives this domain real controls, so the rule can no
    // longer be "no controls at all" — it becomes "no control NAMED after one
    // of them". A `matchId` / `playerId` input on a CREATION field set is the
    // one admitted case and is admitted only there: a manual row's link travels
    // durably as a natural identity inside its record payload, while a
    // CORRECTION has no carrier for one, so no correction panel may offer it.
    const FORBIDDEN = [
      'linkStatus', 'link_status_value', 'candidateCount', 'candidate_count',
      'clubId', 'club_id', 'opponentClubId', 'opponent_club_id',
      'sourceId', 'source_id', 'sourceRecordId', 'source_record_id',
      'achievementType', 'achievement_type',
    ];
    const CREATION_ONLY = ['matchId', 'playerId'];
    for (const file of RECORDS_FILES) {
      const path = repoPath(file);
      const source = readSource(file);
      const controls = [
        ...source.matchAll(/<(?:input|select|textarea)\b[^>]*\bname=\{?[`'"]([^`'"}]+)/gi),
        ...source.matchAll(/draft\.set\(\s*'([^']+)'/g),
      ].map((m) => m[1].replace(/^\$\{prefix\}/, ''));
      for (const control of controls) {
        expect(FORBIDDEN.includes(control), `${path} offers a derived/identity control: ${control}`)
          .toBe(false);
        if (CREATION_ONLY.includes(control)) {
          expect(/Fields\.tsx$/.test(path), `${path} offers ${control} outside a creation field set`)
            .toBe(true);
        }
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
    }
    // Stage 6 DOES update both tables — that is the whole stage — so the rule
    // becomes precise rather than absent: no statement anywhere in this domain
    // may ASSIGN a link column. The correctable specs are the assignment
    // vocabulary and neither names one; the only places player_id,
    // link_status_value or match_id are written are the two manual-creation
    // INSERTs, whose values the Stage 4 replay reconstructs from the record
    // payload's natural identities.
    const assignments = [...QUERY_CODE.matchAll(
      /(?:SET|,)\s+(player_id|link_status_value|club_id|opponent_club_id|match_id)\s*=/gi,
    )].map((m) => m[1]);
    expect(assignments, 'a link column is assigned by an UPDATE in this domain').toEqual([]);
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
    //
    // Stage 6 makes the literal appear legitimately in one shape and one only:
    // `SET status = 'active'`, the reinstatement's own assignment. That is a
    // WRITE of the lifecycle, not a filter on it, so the rule is stated as
    // "every occurrence is an assignment" rather than "no occurrence" — which
    // keeps the assertion about the thing it was always about.
    const occurrences = [...QUERY_CODE.matchAll(/(.{0,8})status\s*=\s*'active'/g)];
    const filters = occurrences.filter((m) => !/\bSET\s+$/.test(m[1]));
    expect(filters.map((m) => m[0]), 'an admin query filters on status').toEqual([]);
    // And the assignment really is there, so the rule cannot pass vacuously.
    expect(occurrences.length).toBeGreaterThan(0);
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

// =========================================================================
// Stage 6 — the write side, as a source contract
// =========================================================================

const REPLAY_ADAPTER = readSource(join(REPO, 'tools', 'records', 'special-records-replay.ts'));
const MIGRATION_089 = readSource(join(REPO, 'src', 'db', 'migrations', '089_after_siren_kicks.sql'));
const MATCH_ADMIN = readSource(join(REPO, 'src', 'db', 'queries', 'match-admin.ts'));
const ACTIONS = readSource(join(REPO, 'src', 'app', 'admin', 'records', 'actions.ts'));

/**
 * The column names the Stage 4 replay adapter carries for one table, read out
 * of its own `COLUMNS` literal rather than restated here — a restatement would
 * be free to drift from the thing it claims to mirror.
 */
function replayColumnsFor(table: string): string[] {
  const start = REPLAY_ADAPTER.indexOf(`  ${table}: [`);
  expect(start, `the replay adapter declares no COLUMNS for ${table}`).toBeGreaterThan(-1);
  const end = REPLAY_ADAPTER.indexOf('\n  ],', start);
  const block = REPLAY_ADAPTER.slice(start, end);
  return [...block.matchAll(/\{\s*column:\s*'([^']+)'/g)].map((m) => m[1]);
}

describe('Stage 6 — what a correction may touch (§3.4, and the replay that must carry it)', () => {
  it.each([
    ['player_achievements', FIRST_KICK_CORRECTABLE],
    ['after_siren_kicks', AFTER_SIREN_CORRECTABLE],
  ] as const)(
    '%s: the correctable columns are EXACTLY the ones the Stage 4 replay carries',
    (table, correctable) => {
      // This is the load-bearing assertion of the whole stage. A mutation that
      // wrote a column the replay does not carry would create state a
      // destructive rebuild silently reverts — the one failure the durable
      // decision design exists to prevent — and a replay column the admin
      // surface cannot reach would be an amendable field with no way to amend
      // it. Both directions, so neither list can drift alone.
      const columns = Object.values(correctable).map((spec) => spec.column).sort();
      expect(columns).toEqual([...replayColumnsFor(table)].sort());
    },
  );

  it('names no derived, link or identity column in either correctable spec', () => {
    // §3.4.1 proved all three of the apparently-manual fields genuinely
    // derived; D-2 keeps after-siren linkage out entirely; identity is repaired
    // by suppression plus replacement, never by a rekey (P10's).
    const forbidden = [
      'link_status_value', 'candidate_count', 'player_id', 'club_id', 'opponent_club_id',
      'match_id', 'source_id', 'source_record_id', 'import_batch_id', 'imported_at',
      'achievement_type', 'status', 'status_reason', 'updated_at', 'id',
    ];
    for (const spec of [FIRST_KICK_CORRECTABLE, AFTER_SIREN_CORRECTABLE]) {
      for (const { column } of Object.values(spec)) {
        expect(forbidden.includes(column), `${column} is not correctable`).toBe(false);
      }
    }
  });

  it("names each forbidden field in the refusal, so a crafted payload gets a sentence", () => {
    const sentence = uncorrectableFieldRefusal(['matchId', 'sourceRecordId'], 'record');
    expect(sentence).toContain('matchId');
    expect(sentence).toContain('sourceRecordId');
    expect(sentence).toMatch(/suppression plus a manual replacement/);
  });

  it('exposes the same correctable vocabulary to the actions, and no more', () => {
    // The action's allowlist is what the FORM may post; the query module's spec
    // is what the TRANSACTION will write. A field in the first and not the
    // second would be silently dropped; the reverse would be unreachable.
    expect([...FIRST_KICK_CORRECTABLE_FIELDS].sort())
      .toEqual(Object.keys(FIRST_KICK_CORRECTABLE).sort());
    expect([...AFTER_SIREN_CORRECTABLE_FIELDS].sort())
      .toEqual(Object.keys(AFTER_SIREN_CORRECTABLE).sort());
  });
});

describe('Stage 6 — the after-siren coupled rules mirror migration 089 (§10.3)', () => {
  it('still faces the four CHECK constraints it claims to mirror', () => {
    // If 089's constraint text moves, the pure rule module must move with it.
    // The four names are the contract; the rules below are transcribed from
    // their bodies.
    for (const name of [
      'after_siren_kicks_effect_ck', 'after_siren_kicks_regulation_ck',
      'after_siren_kicks_match_ck', 'after_siren_kicks_points_ck',
    ]) {
      expect(MIGRATION_089, `${name} is gone from migration 089`).toContain(name);
    }
    expect(MIGRATION_089).toContain("WHEN 'goal' THEN 6 ELSE 1 END");
    expect(MIGRATION_089).toContain("siren <> 'end_of_regulation' OR kick_effect = 'none'");
    expect(MIGRATION_089).toContain('premiership_season OR match_id IS NULL');
  });

  const legal = {
    kickScored: 'goal', kickEffect: 'won', kickerResult: 'win', siren: 'final',
    kickerPoints: 82, opponentPoints: 76, premiershipSeason: true, hasMatch: true,
  } as const;

  it('admits a legal after-siren winner', () => {
    expect(validateAfterSirenEvent({ ...legal })).toBeNull();
  });

  it.each([
    ['a win by more than a goal', { kickerPoints: 90 }, /1 to 6 points/],
    ['a kick that scored nothing winning the match', { kickScored: 'none' }, /must have scored/],
    ['a win recorded against a loss', { kickerResult: 'loss' }, /cannot be recorded against a loss/],
    ['a decisive kick after the end-of-regulation siren', { siren: 'end_of_regulation' }, /extra time/],
    ['a draw with unequal scores', { kickEffect: 'drew', kickerResult: 'draw' }, /level/],
    ['a match link on a non-premiership row', { premiershipSeason: false }, /premiership-season/],
    ['a negative score', { kickerPoints: -1 }, /cannot be negative/],
  ] as const)('refuses %s, in words', (_case, overrides, expected) => {
    const problem = validateAfterSirenEvent({ ...legal, ...(overrides as object) });
    expect(problem, 'the combination was admitted').not.toBeNull();
    expect(problem!).toMatch(expected);
    // A readable sentence, never a constraint name.
    expect(problem!).not.toMatch(/_ck\b/);
  });

  it('refuses "changed nothing" beside a win only when the siren was final', () => {
    expect(validateAfterSirenEvent({
      ...legal, kickEffect: 'none', kickScored: 'behind',
    })).toMatch(/either won the match or followed/);
    // The third branch's escape hatch: end_of_regulation admits it.
    expect(validateAfterSirenEvent({
      ...legal, kickEffect: 'none', kickScored: 'behind', siren: 'end_of_regulation',
    })).toBeNull();
  });
});

describe('Stage 6 — bounded revalidation (R-7, the ISSUE-156 contract)', () => {
  it('admits exactly the shapes the server computes', () => {
    for (const path of [
      '/records/first-kick-goal', '/records/after-the-siren',
      '/admin/records/first-kick-goal', '/admin/records/after-the-siren/42',
      '/players/tony-lockett-1234', '/clubs/carlton', '/matches/9876',
    ]) {
      expect(isAllowedRevalidatePath(path), `${path} should be allowed`).toBe(true);
    }
  });

  it('refuses traversal, other origins, query strings and anything else', () => {
    for (const path of [
      '/', '/awards', '/admin', '/admin/records', '/admin/records/family',
      '/records/first-kick-goal?x=1', '//evil.example/records/first-kick-goal',
      'https://evil.example/players/x-1', '/players/../../etc/passwd',
      '/matches/9876/edit', '/players/Tony-1234', '/clubs/carlton/',
    ]) {
      expect(isAllowedRevalidatePath(path), `${path} should be refused`).toBe(false);
    }
  });

  it('is reached only through the capability-gated route, never from the action', () => {
    const route = readSource(join(REPO, 'src/app/admin/records/revalidate/route.ts'));
    expect(route).toContain("await requireCapability('data.specialRecords.edit')");
    expect(ACTIONS).not.toMatch(/\brevalidatePath\s*\(/);
    expect(ACTIONS).not.toContain('next/cache');
    // The client posts them; the action only names them.
    expect(withoutComments(ACTIONS)).toContain('revalidatePaths');
  });
});

describe('Stage 6 — the third destruction path is closed (§8.3)', () => {
  it('no longer deletes a first-kick achievement as match-delete collateral', () => {
    const code = withoutComments(MATCH_ADMIN);
    expect(/DELETE\s+FROM\s+player_achievements/i.test(code),
      'match deletion still destroys a curated first-kick record').toBe(false);
    expect(/DELETE\s+FROM\s+after_siren_kicks/i.test(code)).toBe(false);
  });

  it('refuses the delete for BOTH families, before anything destructive runs', () => {
    const code = withoutComments(MATCH_ADMIN);
    const refusalAt = code.indexOf('cannot be deleted');
    const firstDeleteAt = code.search(/DELETE\s+FROM\s+player_match_stats/i);
    expect(refusalAt).toBeGreaterThan(-1);
    expect(firstDeleteAt).toBeGreaterThan(-1);
    expect(refusalAt, 'the refusal must precede every destructive statement')
      .toBeLessThan(firstDeleteAt);
    expect(code).toContain('player_achievements WHERE match_id');
    expect(code).toContain('after_siren_kicks WHERE match_id');
    // Actionable, in the shape §8.3 asks for: it names where to go next.
    expect(MATCH_ADMIN).toContain('/admin/records/');
  });
});
