/**
 * AFLDB-ISSUE-170 Stage 2A — route state for /coaches/compare.
 *
 * These exercise the route's own resolution against real `afldb_test`
 * data, because every rule this stage adds is a rule about canonical
 * `coaches` rows: which ids are real, whether an id is coach-only or
 * player-linked, and which canonical public page a coach's profile link
 * should point to. Fixtures could not prove any of it -- the same
 * reasoning tests/integration/club-comparison-route.test.ts already uses
 * for /clubs/compare.
 *
 * Identities are discovered dynamically, never a hardcoded coach id
 * (tests/integration/club-coach-records.test.ts's convention).
 */
import './guard';

import { afterAll, describe, expect, it } from 'vitest';

import { generateMetadata } from '@/app/coaches/compare/page';
import { resolveCoachCompareMetadata, resolveCoachCompareState } from '@/app/coaches/compare/state';
import { sql } from '@/db/client';
import { coachSlug } from '@/lib/slugs';

afterAll(async () => {
  await sql.end();
});

async function distinctCoachIds(): Promise<[number, number]> {
  const rows = await sql<{ id: number }[]>`SELECT id FROM coaches ORDER BY id LIMIT 2`;
  expect(rows.length, 'afldb_test needs at least two coaches').toBeGreaterThanOrEqual(2);
  return [rows[0].id, rows[1].id];
}

/** A coach with at least one canonical `match_coaches` assignment (Stage 2B needs a non-empty career to compare). */
async function coachWithGamesId(): Promise<number> {
  const [row] = await sql<{ id: number }[]>`
    SELECT c.id FROM coaches c
     WHERE EXISTS (SELECT 1 FROM match_coaches mc WHERE mc.coach_id = c.id)
     ORDER BY c.id LIMIT 1
  `;
  expect(row, 'afldb_test needs at least one coach with match_coaches rows').toBeDefined();
  return row.id;
}

/** A coach with zero canonical `match_coaches` rows (Stage 0 §0.2's Jim Adamson case). */
async function zeroGameCoachId(): Promise<number | null> {
  const [row] = await sql<{ id: number }[]>`
    SELECT c.id FROM coaches c
     WHERE NOT EXISTS (SELECT 1 FROM match_coaches mc WHERE mc.coach_id = c.id)
     ORDER BY c.id LIMIT 1
  `;
  return row?.id ?? null;
}

async function coachOnlyId(): Promise<number> {
  const [row] = await sql<{ id: number }[]>`
    SELECT id FROM coaches WHERE player_id IS NULL ORDER BY id LIMIT 1
  `;
  expect(row, 'afldb_test needs at least one coach-only identity').toBeDefined();
  return row.id;
}

async function playerLinkedId(): Promise<number> {
  const [row] = await sql<{ id: number }[]>`
    SELECT id FROM coaches WHERE player_id IS NOT NULL ORDER BY id LIMIT 1
  `;
  expect(row, 'afldb_test needs at least one player-linked coach').toBeDefined();
  return row.id;
}

/** An id no `coaches` row can hold, for stale/invalid-selection cases. */
async function unusedCoachId(): Promise<number> {
  const [row] = await sql<{ id: number }[]>`SELECT max(id) + 1000000 AS id FROM coaches`;
  return row.id;
}

describe('Stage 2A route state: unselected landing', () => {
  it('renders a landing state and chooses nobody', async () => {
    const state = await resolveCoachCompareState({});

    expect(state.kind).toBe('unselected');
    expect(state.params.a).toBeNull();
    expect(state.params.b).toBeNull();
    // No pair-specific identity exists on this state, so no pair lookup ran.
    expect('coachA' in state).toBe(false);
    expect(state.canonicalPath).toBe('/coaches/compare');
    expect(state.noindex).toBe(false);
    expect(state.notices).toEqual([]);
  });

  it('offers the full canonical coach population to the selectors', async () => {
    const state = await resolveCoachCompareState({});
    // Stage 0 §0.2: 386 coaches total, not just the 18 coach-only profiles.
    expect(state.options.coaches.length).toBeGreaterThan(300);
  });

  it('treats one selected coach as unselected, but echoes it back', async () => {
    const [idA] = await distinctCoachIds();
    const state = await resolveCoachCompareState({ a: String(idA) });

    expect(state.kind).toBe('unselected');
    expect(state.params.a).toBe(idA);
    expect(state.params.b).toBeNull();
  });

  it('does the same for only the second coach selected', async () => {
    const [, idB] = await distinctCoachIds();
    const state = await resolveCoachCompareState({ b: String(idB) });

    expect(state.kind).toBe('unselected');
    expect(state.params.a).toBeNull();
    expect(state.params.b).toBe(idB);
  });
});

describe('Stage 2A route state: valid pair', () => {
  it('resolves two distinct coaches by id, never by name', async () => {
    const [idA, idB] = await distinctCoachIds();
    const state = await resolveCoachCompareState({ a: String(idA), b: String(idB) });

    expect(state.kind).toBe('selected');
    if (state.kind !== 'selected') return;

    expect(state.coachA.coach.id).toBe(idA);
    expect(state.coachB.coach.id).toBe(idB);
    expect(state.notices).toEqual([]);
    expect(state.noindex).toBe(false);
    expect(state.swapPath).toBe(`/coaches/compare?a=${idB}&b=${idA}`);
  });

  it('accepts a coach-only identity paired with a player-linked identity', async () => {
    const idA = await coachOnlyId();
    const idB = await playerLinkedId();
    const state = await resolveCoachCompareState({ a: String(idA), b: String(idB) });

    expect(state.kind).toBe('selected');
    if (state.kind !== 'selected') return;

    // Both sides link to their own coach page. AFLDB-ISSUE-170 Stage 1E: a
    // comparison OF COACHES links to coaching profiles, so a player-linked
    // coach is no longer sent to /players (which used to be the only
    // non-redirecting destination for them).
    expect(state.coachA.coach.playerId).toBeNull();
    expect(state.coachA.profilePath).toBe(`/coaches/${coachSlug(state.coachA.coach.displayName)}-${state.coachA.coach.id}`);

    expect(state.coachB.coach.playerId).not.toBeNull();
    expect(state.coachB.profilePath).toBe(`/coaches/${coachSlug(state.coachB.coach.displayName)}-${state.coachB.coach.id}`);
    expect(state.coachB.profilePath).not.toContain('/players/');
  });

  it('orders the SEO canonical path by id, independent of requested order', async () => {
    const [idA, idB] = await distinctCoachIds();
    const [lower, higher] = idA <= idB ? [idA, idB] : [idB, idA];

    const forward = await resolveCoachCompareState({ a: String(idA), b: String(idB) });
    const reversed = await resolveCoachCompareState({ a: String(idB), b: String(idA) });

    expect(forward.canonicalPath).toBe(`/coaches/compare?a=${lower}&b=${higher}`);
    expect(reversed.canonicalPath).toBe(forward.canonicalPath);
  });
});

describe('Stage 2A route state: same coach', () => {
  it('rejects the same coach on both sides', async () => {
    const [idA] = await distinctCoachIds();
    const state = await resolveCoachCompareState({ a: String(idA), b: String(idA) });

    expect(state.kind).toBe('same-coach');
    if (state.kind !== 'same-coach') return;

    expect(state.coach.coach.id).toBe(idA);
    expect(state.noindex).toBe(true);
    expect(state.notices).toEqual([{ field: 'b', message: 'Choose two different coaches.' }]);
  });
});

describe('Stage 2A route state: invalid/stale selection', () => {
  it('flags a stale second coach id', async () => {
    const [idA] = await distinctCoachIds();
    const staleId = await unusedCoachId();
    const state = await resolveCoachCompareState({ a: String(idA), b: String(staleId) });

    expect(state.kind).toBe('invalid');
    if (state.kind !== 'invalid') return;

    expect(state.invalidRaw).toEqual([String(staleId)]);
    expect(state.noindex).toBe(true);
  });

  it('flags a stale first coach id', async () => {
    const [, idB] = await distinctCoachIds();
    const staleId = await unusedCoachId();
    const state = await resolveCoachCompareState({ a: String(staleId), b: String(idB) });

    expect(state.kind).toBe('invalid');
    if (state.kind !== 'invalid') return;
    expect(state.invalidRaw).toEqual([String(staleId)]);
  });

  it('flags both stale coach ids', async () => {
    const staleId = await unusedCoachId();
    const state = await resolveCoachCompareState({ a: String(staleId), b: String(staleId + 1) });

    expect(state.kind).toBe('invalid');
    if (state.kind !== 'invalid') return;
    expect(state.invalidRaw.length).toBe(2);
  });

  it('fails safely on a malformed full pair, classified as invalid rather than a thrown error', async () => {
    // Both sides are present (so this is a full pair, not a half-pair) but
    // neither parses to a coach id -- the same "full pair, unresolvable
    // identity" case as a stale numeric id, just malformed instead of
    // merely unknown. `/clubs/compare`'s equivalent (a malformed-but-present
    // slug alongside a second present value) resolves the same way: never
    // silently downgraded to the bare landing state.
    const state = await resolveCoachCompareState({ a: 'not-a-number', b: ['also', 'not'] });

    expect(state.kind).toBe('invalid');
    expect(state.noindex).toBe(true);
    // No pair identity was resolved -- proves this never quietly became a comparison.
    expect('coachA' in state).toBe(false);
    // The selector list is still available so the reader can recover.
    expect(state.options.coaches.length).toBeGreaterThan(0);
  });

  it('flags one malformed side of an otherwise resolvable full pair', async () => {
    await expect(
      resolveCoachCompareState({ a: 'not-a-number', b: '5' }),
    ).resolves.toMatchObject({ kind: 'invalid' });
  });

  it('treats a malformed HALF-selection as unselected, per the half-pair convention', async () => {
    // Only one side supplied at all -- this must still collapse to
    // 'unselected' exactly like a well-formed half-selection, never
    // 'invalid': the half-pair rule is decided from raw presence, before
    // either side's value is parsed or validated.
    const state = await resolveCoachCompareState({ a: 'not-a-number' });

    expect(state.kind).toBe('unselected');
    expect(state.params.a).toBeNull();
    expect(state.params.b).toBeNull();
  });
});

describe('Stage 2A metadata', () => {
  it('is generic and indexable on the landing page', async () => {
    const meta = await resolveCoachCompareMetadata({});
    expect(meta.canonicalPath).toBe('/coaches/compare');
    expect(meta.noindex).toBe(false);
  });

  it('names both coaches for a valid pair, canonical URL ordered by id', async () => {
    const [idA, idB] = await distinctCoachIds();
    const [lower, higher] = idA <= idB ? [idA, idB] : [idB, idA];
    const meta = await resolveCoachCompareMetadata({ a: String(idA), b: String(idB) });

    expect(meta.noindex).toBe(false);
    expect(meta.canonicalPath).toBe(`/coaches/compare?a=${lower}&b=${higher}`);
  });

  it('is noindex for the same coach twice', async () => {
    const [idA] = await distinctCoachIds();
    const meta = await resolveCoachCompareMetadata({ a: String(idA), b: String(idA) });
    expect(meta.noindex).toBe(true);
  });

  it('is noindex for a stale coach id', async () => {
    const [idA] = await distinctCoachIds();
    const staleId = await unusedCoachId();
    const meta = await resolveCoachCompareMetadata({ a: String(idA), b: String(staleId) });
    expect(meta.noindex).toBe(true);
  });
});

describe('Stage 2A: page generateMetadata delegates to the state resolver', () => {
  it('resolves the landing page without throwing', async () => {
    const meta = await generateMetadata({ searchParams: Promise.resolve({}) });
    expect(meta.title).toBeTruthy();
  });
});

describe('Stage 2B route state: career comparison', () => {
  it('loads both coaches\' CoachCareer records for a resolved pair, using getCoachCareer', async () => {
    const [idA, idB] = await distinctCoachIds();
    const state = await resolveCoachCompareState({ a: String(idA), b: String(idB) });

    expect(state.kind).toBe('selected');
    if (state.kind !== 'selected') return;

    expect(state.careerA).not.toBeNull();
    expect(state.careerB).not.toBeNull();
    expect(state.careerA?.coachId).toBe(idA);
    expect(state.careerB?.coachId).toBe(idB);
  });

  it('resolves internally consistent career totals: games = wins + draws + losses', async () => {
    const [idA, idB] = await distinctCoachIds();
    const state = await resolveCoachCompareState({ a: String(idA), b: String(idB) });
    if (state.kind !== 'selected') return;

    const totalsA = state.careerA?.totals;
    const totalsB = state.careerB?.totals;
    expect(totalsA?.games).toBe((totalsA?.wins ?? 0) + (totalsA?.draws ?? 0) + (totalsA?.losses ?? 0));
    expect(totalsB?.games).toBe((totalsB?.wins ?? 0) + (totalsB?.draws ?? 0) + (totalsB?.losses ?? 0));
  });

  it('resolves a real zero-game career safely when paired with a coach who has games (Stage 0 §0.2)', async () => {
    const zeroId = await zeroGameCoachId();
    if (zeroId === null) return; // no zero-game coach currently on this database; not this test's concern
    const gamesId = await coachWithGamesId();

    const state = await resolveCoachCompareState({ a: String(zeroId), b: String(gamesId) });
    expect(state.kind).toBe('selected');
    if (state.kind !== 'selected') return;

    expect(state.careerA).not.toBeNull();
    expect(state.careerA?.totals.games).toBe(0);
    expect(state.careerA?.totals.winPct).toBeNull();
    expect(state.careerA?.biggestWin).toBeNull();
    expect(state.careerA?.biggestLoss).toBeNull();
    expect(state.careerA?.venues).toEqual([]);
    // The paired coach's real career still resolves alongside it.
    expect(state.careerB?.totals.games).toBeGreaterThan(0);
  });

  it('resolves both careers for a coach-only + player-linked pair', async () => {
    const idA = await coachOnlyId();
    const idB = await playerLinkedId();
    const state = await resolveCoachCompareState({ a: String(idA), b: String(idB) });

    expect(state.kind).toBe('selected');
    if (state.kind !== 'selected') return;

    expect(state.careerA?.coachId).toBe(idA);
    expect(state.careerB?.coachId).toBe(idB);
  });

  it('does not attempt career comparison for the unselected state', async () => {
    const state = await resolveCoachCompareState({});
    expect('careerA' in state).toBe(false);
    expect('careerB' in state).toBe(false);
  });

  it('does not attempt career comparison for the same-coach state', async () => {
    const [idA] = await distinctCoachIds();
    const state = await resolveCoachCompareState({ a: String(idA), b: String(idA) });
    expect(state.kind).toBe('same-coach');
    expect('careerA' in state).toBe(false);
    expect('careerB' in state).toBe(false);
  });

  it('does not attempt career comparison for the invalid/stale state', async () => {
    const [idA] = await distinctCoachIds();
    const staleId = await unusedCoachId();
    const state = await resolveCoachCompareState({ a: String(idA), b: String(staleId) });
    expect(state.kind).toBe('invalid');
    expect('careerA' in state).toBe(false);
    expect('careerB' in state).toBe(false);
  });
});

describe('Stage 2C route state: direct head-to-head', () => {
  it("loads the pair's head-to-head using getCoachHeadToHead, oriented to the requested A/B order", async () => {
    const [idA, idB] = await distinctCoachIds();
    const state = await resolveCoachCompareState({ a: String(idA), b: String(idB) });

    expect(state.kind).toBe('selected');
    if (state.kind !== 'selected') return;

    expect(state.headToHead).not.toBeNull();
    expect(state.headToHead?.coachAId).toBe(idA);
    expect(state.headToHead?.coachBId).toBe(idB);
  });

  it('a real, distinct pair returns a deliberate zero-meeting object rather than null when they never opposed each other', async () => {
    const zeroId = await zeroGameCoachId();
    if (zeroId === null) return; // no zero-game coach currently on this database; not this test's concern
    const gamesId = await coachWithGamesId();

    const state = await resolveCoachCompareState({ a: String(zeroId), b: String(gamesId) });
    expect(state.kind).toBe('selected');
    if (state.kind !== 'selected') return;

    // A zero-game coach cannot have directly opposed anyone.
    expect(state.headToHead).not.toBeNull();
    expect(state.headToHead?.totals.meetings).toBe(0);
    expect(state.headToHead?.totals.aWinPct).toBeNull();
    expect(state.headToHead?.biggestWinA).toBeNull();
    expect(state.headToHead?.biggestWinB).toBeNull();
    expect(state.headToHead?.venues).toEqual([]);
    // The paired coach's real career still resolves alongside it (Stage 2B unaffected).
    expect(state.careerB?.totals.games).toBeGreaterThan(0);
  });

  it('swapping the requested pair order swaps the head-to-head orientation too', async () => {
    const [idA, idB] = await distinctCoachIds();
    const forward = await resolveCoachCompareState({ a: String(idA), b: String(idB) });
    const reversed = await resolveCoachCompareState({ a: String(idB), b: String(idA) });
    if (forward.kind !== 'selected' || reversed.kind !== 'selected') return;

    expect(reversed.headToHead?.coachAId).toBe(idB);
    expect(reversed.headToHead?.coachBId).toBe(idA);
    expect(reversed.headToHead?.totals.meetings).toBe(forward.headToHead?.totals.meetings);
    expect(reversed.headToHead?.totals.aWins).toBe(forward.headToHead?.totals.bWins);
  });

  it('does not attempt head-to-head for the unselected state', async () => {
    const state = await resolveCoachCompareState({});
    expect('headToHead' in state).toBe(false);
  });

  it('does not attempt head-to-head for the same-coach state', async () => {
    const [idA] = await distinctCoachIds();
    const state = await resolveCoachCompareState({ a: String(idA), b: String(idA) });
    expect(state.kind).toBe('same-coach');
    expect('headToHead' in state).toBe(false);
  });

  it('does not attempt head-to-head for the invalid/stale state', async () => {
    const [idA] = await distinctCoachIds();
    const staleId = await unusedCoachId();
    const state = await resolveCoachCompareState({ a: String(idA), b: String(staleId) });
    expect(state.kind).toBe('invalid');
    expect('headToHead' in state).toBe(false);
  });
});
