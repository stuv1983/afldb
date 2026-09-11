/**
 * The pure half of draft administration (AFLDB-ISSUE-160 gate 5).
 *
 * Everything here is a decision the code makes BEFORE it writes anything: the
 * frozen event enumeration, the two `entity_key` shapes, the tracked-rule
 * refusal, and the duplicate/conflict contract J-1 … J-16 driven over a fake
 * transaction. No database, so each rule is exercised in isolation from
 * whatever rows happen to exist.
 *
 * The half that genuinely needs PostgreSQL -- that a mutation really writes the
 * canonical row, the override and the audit together and rolls all three back
 * on any failure -- is `tests/integration/admin-draft.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isAllowedRevalidatePath } from '@/app/admin/draft/revalidate-paths';
import {
  optionalText,
  parseEventPair,
  parseNullablePickNumber,
  parsePositiveInt,
  requiredText,
} from '@/app/admin/draft/validation';

const mocks = vi.hoisted(() => ({ postgres: vi.fn(), sql: vi.fn() }));
vi.mock('postgres', () => ({ default: mocks.postgres }));
vi.mock('@/db/client', () => ({ sql: mocks.sql }));

import {
  AFLTABLES_PROFILE_PATH_RE,
  DRAFT_EVENT_PAIRS,
  DRAFT_KINDS,
  DRAFT_LIST_STATES,
  MANUAL_SOURCE_KEY,
  MIN_DRAFT_YEAR,
  NO_DRAFT_YEARS,
  NULL_PICK_KINDS,
  checkNewPlayerDuplicates,
  checkSelectionConflicts,
  isDraftListState,
  manualEntityKey,
  manualPlayerUrl,
  needsPlayerLinkReview,
  playerLinksHref,
  provenanceOf,
  sourcePickEntityKey,
  trackedProfilePaths,
} from '@/db/queries/admin-draft';
import { UNRESOLVED_LINK_STATUSES } from '@/db/queries/player-links';

type Responder = (text: string) => unknown[];

/** A postgres.js-shaped tagged template that answers from `respond`. */
type FakeTx = ((first: TemplateStringsArray | string) => unknown) & {
  json: (value: unknown) => unknown;
  unsafe: (text: string) => Promise<unknown>;
};

function fakeTx(respond: Responder) {
  const seen: string[] = [];
  const tx = ((first: TemplateStringsArray | string) => {
    if (typeof first === 'string') return { identifier: first };
    const text = first.join('?').replace(/\s+/g, ' ').trim();
    seen.push(text);
    return Promise.resolve(respond(text));
  }) as FakeTx;
  tx.json = (value: unknown) => ({ json: value });
  tx.unsafe = (text: string) => Promise.resolve(respond(text));
  // The query helpers take a postgres.js TransactionSql; this stands in for one
  // and answers from `respond`, so each rule is exercised in isolation.
  return { tx: tx as unknown as import('postgres').TransactionSql, seen };
}

/** The default answers: a modern max season, and nothing conflicting anywhere. */
function emptyDb(overrides: Record<string, unknown[]> = {}): Responder {
  return (text) => {
    for (const [needle, rows] of Object.entries(overrides)) {
      if (text.includes(needle)) return rows;
    }
    if (text.includes('max(season)')) return [{ maxSeason: 2025 }];
    return [];
  };
}

const NATIONAL = { draftType: 'National', draftKind: 'national' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the frozen event contract (§3.1, J-9)', () => {
  it('reads its pairs from the one authoritative mapping, including the absent-column case', () => {
    const contract = JSON.parse(readFileSync(
      join(process.cwd(), 'data/reference/draftguru-event-kinds.json'), 'utf8'));
    const expected = new Set<string>([
      ...contract.events.map((e: { draft_type: string; draft_kind: string }) =>
        `${e.draft_type}|${e.draft_kind}`),
      `${contract.absent_column.draft_type}|${contract.absent_column.draft_kind}`,
    ]);
    expect(new Set(DRAFT_EVENT_PAIRS.map((p) => `${p.draftType}|${p.draftKind}`))).toEqual(expected);
    // draft_kind is an ENUMERATION and is never derived from draft_type: the
    // 1981/1982/1987 pages carry no Draft column, and those rows are
    // ('National Draft', 'national') while every other national row is
    // ('National', 'national'). Two types, one kind -- which a derivation loses.
    expect(DRAFT_EVENT_PAIRS.filter((p) => p.draftKind === 'national')).toHaveLength(2);
    expect(DRAFT_KINDS).toHaveLength(10);
  });

  it('takes the no-draft years from the tracked acquisition contract, not a literal', () => {
    expect(NO_DRAFT_YEARS).toEqual([1983, 1984, 1985]);
    expect(MIN_DRAFT_YEAR).toBe(1981);
  });

  it('names only the kinds whose whole source population is NULL-numbered (J-5)', () => {
    // Measured at implementation on the rebuilt afldb_test (gate 2 probe (b)):
    // free_agency 138/138, post_draft 188/188, pre_draft 370/370, trade 990/990.
    // Every other kind measured ZERO NULL picks.
    expect([...NULL_PICK_KINDS].sort()).toEqual(['free_agency', 'post_draft', 'pre_draft', 'trade']);
    for (const kind of NULL_PICK_KINDS) expect(DRAFT_KINDS).toContain(kind);
  });
});

describe('identity shapes (§3.1)', () => {
  it('keeps the manual and source namespaces apart', () => {
    expect(manualEntityKey('tok')).toBe('manual_admin_edit:tok');
    expect(manualPlayerUrl('tok')).toBe('manual:tok');
    // Migration 069's reload key, unchanged (R-7). It embeds the per-database
    // sources.id deliberately: rewriting it would orphan every override already
    // written against a source row.
    expect(sourcePickEntityKey({
      sourceId: 13, playerUrl: 'https://www.draftguru.com.au/players/a-player/1',
      draftYear: 2019, draftKind: 'national',
    })).toBe('13|https://www.draftguru.com.au/players/a-player/1|2019|national');
  });

  it('reads provenance from the source key, never from a name or an id', () => {
    expect(provenanceOf(null)).toBe('legacy');
    expect(provenanceOf(MANUAL_SOURCE_KEY)).toBe('manual');
    expect(provenanceOf('draftguru')).toBe('draftguru');
  });
});

describe('J-16: a tracked, evidence-bound rule is never overridden from a browser', () => {
  it('names the AFLDB-ISSUE-136 continuity paths', () => {
    const tracked = trackedProfilePaths();
    expect(tracked.size).toBeGreaterThan(0);
    expect(tracked.has('players/C/Charlie_Cameron.html')).toBe(true);
    expect(tracked.has('players/C/Charlie_Cameron3.html')).toBe(true);
    for (const path of tracked) expect(AFLTABLES_PROFILE_PATH_RE.test(path)).toBe(true);
  });

  it('accepts a real profile path and rejects anything else', () => {
    expect(AFLTABLES_PROFILE_PATH_RE.test('players/S/Some_Player0.html')).toBe(true);
    expect(AFLTABLES_PROFILE_PATH_RE.test("players/O/O'Brien1.html")).toBe(true);
    expect(AFLTABLES_PROFILE_PATH_RE.test('https://afltables.com/afl/stats/players/S/S0.html')).toBe(false);
    expect(AFLTABLES_PROFILE_PATH_RE.test('manual:0f1c2d3e')).toBe(false);
    expect(AFLTABLES_PROFILE_PATH_RE.test('')).toBe(false);
  });
});

describe('checkSelectionConflicts — J-1, J-2, J-3, J-5, J-8, J-9', () => {
  const facts = {
    playerId: 7, draftYear: 2019, ...NATIONAL, pickNumber: 12, pickNote: null,
  };

  it('J-9 refuses a pair the frozen enumeration does not contain', async () => {
    const { tx } = fakeTx(emptyDb());
    const result = await checkSelectionConflicts(tx, { ...facts, draftKind: 'father_son' });
    expect(result).toMatchObject({ ok: false, reason: 'validation' });
  });

  it('J-9 refuses a kind paired with the wrong type', async () => {
    const { tx } = fakeTx(emptyDb());
    // 'national' is real and 'Rookie' is real; the PAIR is not.
    const result = await checkSelectionConflicts(tx, { ...facts, draftType: 'Rookie' });
    expect(result).toMatchObject({ ok: false, reason: 'validation' });
  });

  it('J-8 bounds the year by the data, and refuses a year with no draft held', async () => {
    const { tx } = fakeTx(emptyDb());
    expect(await checkSelectionConflicts(tx, { ...facts, draftYear: 1980 }))
      .toMatchObject({ ok: false, reason: 'validation' });
    // max(season) is 2025 in this fixture, so the ceiling is 2026, not the wall clock.
    expect(await checkSelectionConflicts(tx, { ...facts, draftYear: 2027 }))
      .toMatchObject({ ok: false, reason: 'validation' });
    expect(await checkSelectionConflicts(tx, { ...facts, draftYear: 2026 })).toEqual({ ok: true });
    const gap = await checkSelectionConflicts(tx, { ...facts, draftYear: 1984 });
    expect(gap).toMatchObject({ ok: false, reason: 'validation' });
    expect((gap as { error: string }).error).toContain('No draft was held in 1984');
  });

  it('J-1 refuses a second selection for the same player, year AND kind', async () => {
    const { tx } = fakeTx(emptyDb({
      'FROM draft_picks WHERE player_id': [{ id: 501, draftType: 'National' }],
    }));
    const result = await checkSelectionConflicts(tx, facts);
    expect(result).toMatchObject({ ok: false, reason: 'duplicate' });
    expect((result as { error: string }).error).toContain('#501');
  });

  it('J-2 allows the same player in the same year under a different kind', async () => {
    // 23 people legitimately appear twice in one year under different kinds
    // (migration 069's measured evidence), so the rule is year AND kind, never year.
    const { tx, seen } = fakeTx(emptyDb());
    expect(await checkSelectionConflicts(tx, { ...facts, draftType: 'Rookie', draftKind: 'rookie' }))
      .toEqual({ ok: true });
    expect(seen.some((q) => q.includes('AND draft_kind = ?'))).toBe(true);
  });

  it('J-3 HARD-REFUSES a pick number another player already holds', async () => {
    // D-8 pre-authorised both branches and made gate 2 probe (a) choose. The probe
    // returned ZERO (draft_year, draft_kind, pick_number) collisions across all 6,810
    // source rows on the rebuilt afldb_test and zero on afldb_dev, so refusal ships and
    // the confirmation branch is deliberately not implemented.
    const { tx } = fakeTx(emptyDb({
      'LEFT JOIN clubs c ON c.id = dp.club_id': [
        { id: 604, playerNameRaw: 'Someone Else', clubName: 'Geelong' },
      ],
    }));
    const result = await checkSelectionConflicts(tx, facts);
    expect(result).toMatchObject({ ok: false, reason: 'conflict' });
    // The refusal NAMES the colliding selection; an unexplained refusal is unusable.
    expect((result as { error: string }).error).toMatch(/Someone Else/);
    expect((result as { error: string }).error).toMatch(/Geelong/);
    expect((result as { error: string }).error).toMatch(/#604/);
    expect(result).not.toHaveProperty('needsConfirmation');
  });

  it('J-3 does not compare a NULL pick number against anything', async () => {
    const { tx, seen } = fakeTx(emptyDb());
    await checkSelectionConflicts(tx, {
      ...facts, draftKind: 'trade', draftType: 'Trade', pickNumber: null,
    });
    expect(seen.some((q) => q.includes('AND dp.pick_number = ?'))).toBe(false);
  });

  it('J-5 allows a NULL pick for a kind whose source rows carry none', async () => {
    const { tx } = fakeTx(emptyDb());
    for (const kind of NULL_PICK_KINDS) {
      const pair = DRAFT_EVENT_PAIRS.find((p) => p.draftKind === kind)!;
      expect(await checkSelectionConflicts(tx, {
        ...facts, draftKind: kind, draftType: pair.draftType, pickNumber: null,
      }), kind).toEqual({ ok: true });
    }
  });

  it('J-5 requires a note AND a confirmation for a NULL pick on a numbered board', async () => {
    const { tx } = fakeTx(emptyDb());
    const bare = await checkSelectionConflicts(tx, { ...facts, pickNumber: null });
    expect(bare).toMatchObject({ ok: false, reason: 'validation' });

    const noted = await checkSelectionConflicts(
      tx, { ...facts, pickNumber: null, pickNote: 'Father-son, no board position recorded' });
    expect(noted).toMatchObject({ ok: false, needsConfirmation: true, confirm: 'null_pick_number' });

    const confirmed = await checkSelectionConflicts(
      tx, { ...facts, pickNumber: null, pickNote: 'Father-son, no board position recorded' },
      { confirmed: true });
    expect(confirmed).toEqual({ ok: true });
  });

  it('lets an edit of an existing row ignore itself', async () => {
    const { tx, seen } = fakeTx(emptyDb());
    await checkSelectionConflicts(tx, facts, { excludePickId: 99 });
    expect(seen.filter((q) => q.includes('id <> ?')).length).toBe(2);
  });
});

describe('checkNewPlayerDuplicates — J-10 … J-13', () => {
  const facts = { displayName: 'Sam Namesake', dob: null as string | null, draftYear: 2024, draftKind: 'national' };
  const SAME_NAME = 'WHERE p.search_name = afldb_normalise_name';

  it('J-10 hard-refuses when a same-name player exists and no date of birth was typed', async () => {
    // "Ambiguous identity" is a refusal, never a guess. No fuzzy score decides
    // identity anywhere: the query matches the NORMALISED name exactly, and the only
    // thing it is allowed to do with that match is refuse.
    const { tx } = fakeTx(emptyDb({
      [SAME_NAME]: [{ id: 31, displayName: 'Sam Namesake', dob: '1990-01-01', birthYear: 1990, games: 40, span: '2010–2016' }],
    }));
    const result = await checkNewPlayerDuplicates(tx, facts);
    expect(result).toMatchObject({ ok: false, reason: 'duplicate' });
    expect((result as { error: string }).error).toContain('#31');
    expect((result as { error: string }).error).toContain('date of birth');
  });

  it('J-11 hard-refuses when the typed date agrees with an existing player', async () => {
    const { tx } = fakeTx(emptyDb({
      [SAME_NAME]: [{ id: 31, displayName: 'Sam Namesake', dob: '1990-01-01', birthYear: 1990, games: 40, span: null }],
    }));
    expect(await checkNewPlayerDuplicates(tx, { ...facts, dob: '1990-01-01' }))
      .toMatchObject({ ok: false, reason: 'duplicate' });
  });

  it('J-11 hard-refuses when their date is unknown and the birth years agree', async () => {
    const { tx } = fakeTx(emptyDb({
      [SAME_NAME]: [{ id: 31, displayName: 'Sam Namesake', dob: null, birthYear: 1990, games: 0, span: null }],
    }));
    expect(await checkNewPlayerDuplicates(tx, { ...facts, dob: '1990-06-30' }))
      .toMatchObject({ ok: false, reason: 'duplicate' });
  });

  it('J-11 hard-refuses when their date AND birth year are both unknown', async () => {
    // An unrecorded date distinguishes nobody, so an undated namesake is a likely
    // duplicate rather than a proven different person.
    const { tx } = fakeTx(emptyDb({
      [SAME_NAME]: [{ id: 31, displayName: 'Sam Namesake', dob: null, birthYear: null, games: 0, span: null }],
    }));
    expect(await checkNewPlayerDuplicates(tx, { ...facts, dob: '1990-06-30' }))
      .toMatchObject({ ok: false, reason: 'duplicate' });
  });

  it('J-12 asks for a confirmation when only distinct namesakes exist', async () => {
    const { tx } = fakeTx(emptyDb({
      [SAME_NAME]: [{ id: 31, displayName: 'Sam Namesake', dob: '1955-03-04', birthYear: 1955, games: 112, span: '1975–1984' }],
    }));
    const result = await checkNewPlayerDuplicates(tx, { ...facts, dob: '2006-05-05' });
    expect(result).toMatchObject({ ok: false, needsConfirmation: true, confirm: 'distinct_namesakes' });
    // The candidate list is what makes the confirmation a decision rather than a dare.
    expect((result as { candidates: { id: number; reason: string }[] }).candidates).toEqual([
      { kind: 'player', id: 31, label: 'Sam Namesake (#31)', reason: 'born 1955-03-04, 1975–1984, 112 game(s)' },
    ]);
  });

  it('J-13 warns when DraftGuru already lists the selection unlinked', async () => {
    const { tx } = fakeTx(emptyDb({
      'dp.player_id IS NULL': [{ id: 808, playerNameRaw: 'Sam Namesake', pickNumber: 9 }],
    }));
    const result = await checkNewPlayerDuplicates(tx, { ...facts, dob: '2006-05-05' });
    expect(result).toMatchObject({
      ok: false, needsConfirmation: true, confirm: 'unlinked_source_selection',
    });
    expect((result as { error: string }).error).toContain('Player links');
    expect((result as { candidates: { id: number }[] }).candidates[0].id).toBe(808);
  });

  it('passes a genuinely new person, and never consults a name for anything but a refusal', async () => {
    const { tx, seen } = fakeTx(emptyDb());
    expect(await checkNewPlayerDuplicates(tx, { ...facts, dob: '2006-05-05' })).toEqual({ ok: true });
    // Ranking is the search route's job. Nothing here scores a name.
    const sql = seen.join('\n');
    expect(sql).not.toMatch(/similarity|levenshtein|soundex|ILIKE/i);
    expect(sql).toContain('afldb_normalise_name');
  });

  it('a confirmation suppresses J-12 and J-13, and never suppresses J-10 or J-11', async () => {
    const namesake = { id: 31, displayName: 'Sam Namesake', dob: '1955-03-04', birthYear: 1955, games: 1, span: null };
    const { tx } = fakeTx(emptyDb({ [SAME_NAME]: [namesake] }));
    expect(await checkNewPlayerDuplicates(tx, { ...facts, dob: '2006-05-05' }, { confirmed: true }))
      .toEqual({ ok: true });

    const likely = fakeTx(emptyDb({ [SAME_NAME]: [{ ...namesake, dob: '2006-05-05' }] }));
    expect(await checkNewPlayerDuplicates(likely.tx, { ...facts, dob: '2006-05-05' }, { confirmed: true }))
      .toMatchObject({ ok: false, reason: 'duplicate' });

    const undated = fakeTx(emptyDb({ [SAME_NAME]: [namesake] }));
    expect(await checkNewPlayerDuplicates(undated.tx, facts, { confirmed: true }))
      .toMatchObject({ ok: false, reason: 'duplicate' });
  });
});

/**
 * Stage 2 additions (AFLDB-ISSUE-160 §18): form-parsing helpers behind
 * `/admin/draft`'s actions, and the `/admin/draft/revalidate` allowlist.
 * Pure, DB-free, matching the ISSUE-159 `admin-coach-actions.test.ts`
 * pattern. Action-level DB proofs live in `tests/integration/admin-draft.test.ts`.
 */
describe('Stage 2: parsePositiveInt / optionalText / requiredText', () => {
  it('parsePositiveInt accepts a positive integer and rejects the rest', () => {
    expect(parsePositiveInt('7')).toBe(7);
    expect(parsePositiveInt('0')).toBeNull();
    expect(parsePositiveInt('-3')).toBeNull();
    expect(parsePositiveInt('1.5')).toBeNull();
    expect(parsePositiveInt('')).toBeNull();
    expect(parsePositiveInt(null)).toBeNull();
  });

  it('optionalText / requiredText trim, truncate, and treat blank as absent', () => {
    expect(optionalText('  hello  ', 100)).toBe('hello');
    expect(requiredText('  hello  ', 100)).toBe('hello');
    expect(optionalText('   ', 100)).toBeNull();
    expect(requiredText('   ', 100)).toBeNull();
    expect(optionalText('abcdef', 3)).toBe('abc');
  });
});

describe('Stage 2: parseNullablePickNumber', () => {
  it('treats a blank value as a valid NULL pick number, never a parse failure', () => {
    expect(parseNullablePickNumber('')).toEqual({ ok: true, value: null });
    expect(parseNullablePickNumber(null)).toEqual({ ok: true, value: null });
  });

  it('accepts a positive integer and refuses zero, negative or non-integer text', () => {
    expect(parseNullablePickNumber('12')).toEqual({ ok: true, value: 12 });
    expect(parseNullablePickNumber('0')).toEqual({ ok: false });
    expect(parseNullablePickNumber('-1')).toEqual({ ok: false });
    expect(parseNullablePickNumber('abc')).toEqual({ ok: false });
  });
});

describe('Stage 2: parseEventPair', () => {
  it('splits the posted "type|kind" select value', () => {
    expect(parseEventPair('National|national')).toEqual({ draftType: 'National', draftKind: 'national' });
    expect(parseEventPair('Pre-Draft|pre_draft')).toEqual({ draftType: 'Pre-Draft', draftKind: 'pre_draft' });
  });

  it('refuses a value with no separator, an empty half, or nothing at all', () => {
    expect(parseEventPair('National')).toBeNull();
    expect(parseEventPair('|national')).toBeNull();
    expect(parseEventPair('National|')).toBeNull();
    expect(parseEventPair('')).toBeNull();
    expect(parseEventPair(null)).toBeNull();
  });
});

describe('Stage 2: isAllowedRevalidatePath (/admin/draft/revalidate)', () => {
  it('accepts the two cached public shapes a draft mutation can touch', () => {
    expect(isAllowedRevalidatePath('/players/chris-fagan-123')).toBe(true);
    expect(isAllowedRevalidatePath('/sitemap.xml')).toBe(true);
  });

  it('refuses every force-dynamic draft/player surface -- they need no revalidation', () => {
    expect(isAllowedRevalidatePath('/draft')).toBe(false);
    expect(isAllowedRevalidatePath('/draft/2025')).toBe(false);
    expect(isAllowedRevalidatePath('/players')).toBe(false);
    expect(isAllowedRevalidatePath('/admin/draft')).toBe(false);
  });

  it('refuses a path with no matching shape, path traversal, a scheme/host, or a query/fragment', () => {
    expect(isAllowedRevalidatePath('/players/chris-fagan')).toBe(false);
    expect(isAllowedRevalidatePath('/players/../../etc/passwd')).toBe(false);
    expect(isAllowedRevalidatePath('//evil.example.com')).toBe(false);
    expect(isAllowedRevalidatePath('https://evil.example.com/players/x-1')).toBe(false);
    expect(isAllowedRevalidatePath('/players/chris-fagan-123?x=1')).toBe(false);
    expect(isAllowedRevalidatePath('/players/chris-fagan-123#x')).toBe(false);
    expect(isAllowedRevalidatePath('')).toBe(false);
    expect(isAllowedRevalidatePath('/')).toBe(false);
  });

  it('refuses a case mismatch rather than normalising it', () => {
    expect(isAllowedRevalidatePath('/Players/chris-fagan-123')).toBe(false);
    expect(isAllowedRevalidatePath('/Sitemap.xml')).toBe(false);
  });
});


describe('Stage 2: the §18 list review states', () => {
  it('admits exactly the three states the runbook names, and nothing else', () => {
    expect([...DRAFT_LIST_STATES]).toEqual(['override', 'duplicate', 'awaiting-identity']);
    for (const state of DRAFT_LIST_STATES) expect(isDraftListState(state)).toBe(true);
  });

  it('refuses anything else, so a hand-typed query string cannot widen the filter', () => {
    for (const bad of ['', 'Override', 'awaiting_identity', 'legacy', 'all', 'true', '1']) {
      expect(isDraftListState(bad)).toBe(false);
    }
  });
});

describe('Stage 2: needsPlayerLinkReview / playerLinksHref (the §18 deep link)', () => {
  it('offers the queue for a SOURCE-OWNED selection in an unresolved link status', () => {
    for (const linkStatusValue of UNRESOLVED_LINK_STATUSES) {
      expect(needsPlayerLinkReview({ provenance: 'draftguru', linkStatusValue })).toBe(true);
    }
  });

  it('never offers it for a selection /admin/draft itself owns', () => {
    // Manual rows always carry a player and are relinked by 6.4; legacy rows
    // are repaired by 6.8. Neither belongs in the person-grained queue.
    for (const linkStatusValue of [...UNRESOLVED_LINK_STATUSES, 'resolved', 'unique']) {
      expect(needsPlayerLinkReview({ provenance: 'manual', linkStatusValue })).toBe(false);
      expect(needsPlayerLinkReview({ provenance: 'legacy', linkStatusValue })).toBe(false);
    }
  });

  it('never offers it for a source row that is already linked', () => {
    expect(needsPlayerLinkReview({ provenance: 'draftguru', linkStatusValue: 'resolved' })).toBe(false);
    expect(needsPlayerLinkReview({ provenance: 'draftguru', linkStatusValue: 'unique' })).toBe(false);
  });

  it('builds only the two parameters /admin/player-links actually supports', () => {
    expect(playerLinksHref({ playerNameRaw: 'Chris Fagan' }))
      .toBe('/admin/player-links?table=draft_picks&q=Chris%20Fagan');
  });

  it('encodes a name that would otherwise alter the query string', () => {
    const href = playerLinksHref({ playerNameRaw: "O'Brien & Sons #1" });
    expect(href.startsWith('/admin/player-links?table=draft_picks&q=')).toBe(true);
    // One `q`, no injected parameter, and the name survives a round trip.
    const url = new URL(href, 'https://example.invalid');
    expect([...url.searchParams.keys()]).toEqual(['table', 'q']);
    expect(url.searchParams.get('q')).toBe("O'Brien & Sons #1");
  });
});
