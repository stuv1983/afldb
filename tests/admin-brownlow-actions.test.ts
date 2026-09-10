/**
 * The Brownlow administration Server Actions (AFLDB-ISSUE-155 Phase C2 §27.26).
 *
 * The mocked-module style of tests/admin-lifecycle-actions.test.ts: the C1
 * transactions are `vi.fn()`s, so what is proven here is the SHAPE of the
 * action — which capability guard it calls, what it parses out of the form,
 * which transaction it invokes with which arguments, which refusals it
 * writes to the audit trail, and which paths it revalidates. That the
 * transactions themselves lock, CAS and roll back is
 * tests/integration/admin-brownlow.test.ts; the two files are meant to be
 * read together.
 */
import { revalidatePath } from 'next/cache';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  correctAction,
  finaliseAction,
  publishSeasonAction,
  saveDraftAction,
  voidAction,
} from '@/app/admin/brownlow/actions';
import {
  correctBrownlowMatch,
  finaliseBrownlowMatch,
  publishBrownlowSeason,
  saveDraftBrownlowMatch,
  voidBrownlowMatch,
  type BrownlowMutationResult,
  type PublishSeasonResult,
} from '@/db/queries/admin-brownlow';
import { audit, requireCapability } from '@/lib/auth/session';
import type {
  BrownlowEntryStatus,
  BrownlowRefusalCode,
} from '@/lib/brownlow/entry';

const ACTOR = { id: 7, email: 'super@afldb.test', role: 'super_admin', canManageAdmins: false };

const state = vi.hoisted(() => ({
  /** Capabilities the guard refuses (throws NEXT_REDIRECT for). */
  denied: new Set<string>(),
  actor: { id: 7, email: 'super@afldb.test', role: 'super_admin', canManageAdmins: false },
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@/lib/acquisition/season-revalidation', () => ({
  // No host provisioning in a unit test: the actions fall back to the local
  // revalidatePath and never open a socket.
  readRevalidateConfig: vi.fn(() => null),
  revalidateSeason: vi.fn(async () => ({ ok: true })),
}));

vi.mock('@/db/queries/admin-brownlow', () => ({
  saveDraftBrownlowMatch: vi.fn(),
  finaliseBrownlowMatch: vi.fn(),
  correctBrownlowMatch: vi.fn(),
  voidBrownlowMatch: vi.fn(),
  publishBrownlowSeason: vi.fn(),
}));

vi.mock('@/lib/auth/session', () => ({
  requireCapability: vi.fn(async (capability: string) => {
    if (state.denied.has(capability)) throw new Error('NEXT_REDIRECT');
    return state.actor;
  }),
  audit: vi.fn(async () => undefined),
}));

const okMatch = (over: Partial<{
  matchId: number;
  status: BrownlowEntryStatus;
  revision: number;
  selection: { three: number | null; two: number | null; one: number | null };
  republishedSeason: number | null;
}> = {}): BrownlowMutationResult => ({
  ok: true,
  value: {
    matchId: 101,
    status: 'final',
    revision: 2,
    selection: { three: 11, two: 22, one: 33 },
    republishedSeason: null,
    ...over,
  },
});

const refusal = (code: string, message = 'nope'): BrownlowMutationResult & PublishSeasonResult =>
  ({ ok: false, code: code as BrownlowRefusalCode, message }) as BrownlowMutationResult & PublishSeasonResult;

function matchForm(over: Record<string, string> = {}): FormData {
  const data = new FormData();
  data.set('matchId', '101');
  data.set('season', '2024');
  data.set('round', '5');
  data.set('expectedRevision', '1');
  data.set('expectedCanonicalFingerprint', 'fp-abc');
  data.set('three', '11');
  data.set('two', '22');
  data.set('one', '33');
  for (const [k, v] of Object.entries(over)) {
    if (v === '__delete__') data.delete(k);
    else data.set(k, v);
  }
  return data;
}

function publishForm(over: Record<string, string | string[]> = {}): FormData {
  const data = new FormData();
  data.set('season', '2024');
  data.set('expectedRevision', '0');
  for (const [k, v] of Object.entries(over)) {
    data.delete(k);
    if (v === '__delete__') continue;
    for (const one of Array.isArray(v) ? v : [v]) data.append(k, one);
  }
  return data;
}

beforeEach(() => {
  state.denied = new Set();
  state.actor = { ...ACTOR };
  vi.clearAllMocks();
  vi.mocked(saveDraftBrownlowMatch).mockResolvedValue(okMatch({ status: 'draft' }));
  vi.mocked(finaliseBrownlowMatch).mockResolvedValue(okMatch());
  vi.mocked(correctBrownlowMatch).mockResolvedValue(okMatch());
  vi.mocked(voidBrownlowMatch).mockResolvedValue(okMatch({ status: 'void', selection: { three: null, two: null, one: null } }));
  vi.mocked(publishBrownlowSeason).mockResolvedValue({
    ok: true, value: { season: 2024, revision: 1, rowCount: 40, votesTotal: 220, winners: [9] },
  });
});

describe('capability boundary', () => {
  it('saveDraft is gated on data.brownlow.draft', async () => {
    await saveDraftAction({}, matchForm());
    expect(requireCapability).toHaveBeenCalledWith('data.brownlow.draft');
  });

  it.each([
    ['finalise', finaliseAction],
    ['correct', correctAction],
    ['void', voidAction],
  ] as const)('%s is gated on data.brownlow.finalise', async (_name, action) => {
    await action({}, matchForm());
    expect(requireCapability).toHaveBeenCalledWith('data.brownlow.finalise');
  });

  it('publish is gated on data.brownlow.finalise', async () => {
    await publishSeasonAction({}, publishForm());
    expect(requireCapability).toHaveBeenCalledWith('data.brownlow.finalise');
  });

  it('an Admin (finalise denied, draft allowed) can draft but not finalise/correct/void/publish', async () => {
    state.denied = new Set(['data.brownlow.finalise']);

    await expect(finaliseAction({}, matchForm())).rejects.toThrow('NEXT_REDIRECT');
    await expect(correctAction({}, matchForm())).rejects.toThrow('NEXT_REDIRECT');
    await expect(voidAction({}, matchForm())).rejects.toThrow('NEXT_REDIRECT');
    await expect(publishSeasonAction({}, publishForm())).rejects.toThrow('NEXT_REDIRECT');
    expect(finaliseBrownlowMatch).not.toHaveBeenCalled();
    expect(correctBrownlowMatch).not.toHaveBeenCalled();
    expect(voidBrownlowMatch).not.toHaveBeenCalled();
    expect(publishBrownlowSeason).not.toHaveBeenCalled();

    const result = await saveDraftAction({}, matchForm());
    expect(result.ok).toBe(true);
    expect(saveDraftBrownlowMatch).toHaveBeenCalledOnce();
  });

  it('a fully denied viewer reaches no transaction and no audit', async () => {
    state.denied = new Set(['data.brownlow.draft', 'data.brownlow.finalise']);
    await expect(saveDraftAction({}, matchForm())).rejects.toThrow('NEXT_REDIRECT');
    expect(saveDraftBrownlowMatch).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });
});

describe('form parsing', () => {
  it.each([
    ['a non-numeric matchId', { matchId: 'seven' }],
    ['a zero matchId', { matchId: '0' }],
    ['a missing expectedRevision', { expectedRevision: '__delete__' }],
    ['a negative expectedRevision', { expectedRevision: '-1' }],
    ['a non-participant-shaped slot', { three: 'abc' }],
    ['a missing season', { season: '__delete__' }],
  ])('refuses %s as invalid, before any transaction', async (_label, over) => {
    const result = await finaliseAction({}, matchForm(over));
    expect(result.code).toBe('invalid');
    expect(finaliseBrownlowMatch).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it('passes an empty vote slot through as null (a draft may hold one)', async () => {
    await saveDraftAction({}, matchForm({ two: '', one: '' }));
    expect(saveDraftBrownlowMatch).toHaveBeenCalledWith(
      expect.objectContaining({ selection: { three: 11, two: null, one: null } }),
    );
  });
});

describe('saveDraft', () => {
  it('calls the C1 transaction with the parsed ids, revision, fingerprint and actor', async () => {
    await saveDraftAction({}, matchForm());
    expect(saveDraftBrownlowMatch).toHaveBeenCalledWith({
      matchId: 101,
      expectedRevision: 1,
      expectedCanonicalFingerprint: 'fp-abc',
      actorId: 7,
      reason: null,
      selection: { three: 11, two: 22, one: 33 },
    });
  });

  it('revalidates only the admin routes on success', async () => {
    await saveDraftAction({}, matchForm());
    const paths = vi.mocked(revalidatePath).mock.calls.map((c) => c[0]);
    expect(paths).toContain('/admin/brownlow/2024/5');
    expect(paths).toContain('/admin/brownlow/2024');
    expect(paths).toContain('/admin/brownlow');
    expect(paths).not.toContain('/seasons/2024');
    expect(paths).not.toContain('/matches/101');
  });
});

describe('finalise and correct', () => {
  it('finalise forwards the fingerprint and revalidates the public season and match', async () => {
    const result = await finaliseAction({}, matchForm());
    expect(result.ok).toBe(true);
    expect(finaliseBrownlowMatch).toHaveBeenCalledWith(
      expect.objectContaining({ matchId: 101, expectedCanonicalFingerprint: 'fp-abc' }),
    );
    const paths = vi.mocked(revalidatePath).mock.calls.map((c) => c[0]);
    expect(paths).toEqual(expect.arrayContaining(['/seasons/2024', '/matches/101', '/admin/brownlow/2024/5']));
  });

  it('correct forwards the typed reason', async () => {
    await correctAction({}, matchForm({ reason: 'AFL post-count adjustment' }));
    expect(correctBrownlowMatch).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'AFL post-count adjustment' }),
    );
  });

  it('a re-derived published season revalidates the public Brownlow and record routes and says so', async () => {
    vi.mocked(correctBrownlowMatch).mockResolvedValue(okMatch({ republishedSeason: 2024 }));
    const result = await correctAction({}, matchForm({ reason: 'swap 2 and 3' }));
    expect(result.message).toMatch(/re-derived/i);
    const paths = vi.mocked(revalidatePath).mock.calls.map((c) => c[0]);
    expect(paths).toEqual(expect.arrayContaining(['/brownlow', '/brownlow/2024', '/players/[slug]', '/records/[category]']));
  });
});

describe('void', () => {
  it('calls voidBrownlowMatch with no selection but with the fingerprint and reason', async () => {
    await voidAction({}, matchForm({ reason: 'match abandoned, no votes' }));
    const call = vi.mocked(voidBrownlowMatch).mock.calls[0][0] as Record<string, unknown>;
    expect(call).not.toHaveProperty('selection');
    expect(call).toMatchObject({
      matchId: 101,
      expectedCanonicalFingerprint: 'fp-abc',
      reason: 'match abandoned, no votes',
    });
  });
});

describe('refusal audit (§27.13)', () => {
  it.each(['stale', 'already_final', 'forbidden'])('audits a %s refusal', async (code) => {
    vi.mocked(finaliseBrownlowMatch).mockResolvedValue(refusal(code));
    const result = await finaliseAction({}, matchForm());

    expect(result.error).toBe('nope');
    expect(result.code).toBe(code);
    // The submitted selection is echoed back so the editor keeps it.
    expect(result.selection).toEqual({ three: 11, two: 22, one: 33 });
    expect(audit).toHaveBeenCalledWith(
      'admin.brownlow_refused',
      { action: 'finalise', matchId: 101, season: 2024, code },
      { userId: 7, label: 'super@afldb.test' },
    );
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each(['duplicate_player', 'participants_incomplete', 'incomplete', 'not_participant', 'db_error'])(
    'does not audit a %s refusal',
    async (code) => {
      vi.mocked(finaliseBrownlowMatch).mockResolvedValue(refusal(code));
      const result = await finaliseAction({}, matchForm());
      expect(result.code).toBe(code);
      expect(audit).not.toHaveBeenCalled();
    },
  );
});

describe('publish', () => {
  it('parses a de-duplicated ineligible id list and forwards the revision', async () => {
    await publishSeasonAction({}, publishForm({ ineligible: ['9', '12', '9'] }));
    expect(publishBrownlowSeason).toHaveBeenCalledWith({
      season: 2024,
      expectedRevision: 0,
      ineligiblePlayerIds: [9, 12],
      actorId: 7,
      note: null,
    });
  });

  it('refuses a malformed ineligible id without calling the transaction', async () => {
    const result = await publishSeasonAction({}, publishForm({ ineligible: ['9', 'x'] }));
    expect(result.code).toBe('invalid');
    expect(publishBrownlowSeason).not.toHaveBeenCalled();
  });

  it('revalidates the public season and Brownlow routes and summarises the outcome', async () => {
    const result = await publishSeasonAction({}, publishForm());
    expect(result.message).toMatch(/40 polling players, 220 votes, 1 medallist/);
    const paths = vi.mocked(revalidatePath).mock.calls.map((c) => c[0]);
    expect(paths).toEqual(expect.arrayContaining([
      '/admin/brownlow/2024', '/seasons/2024', '/brownlow', '/brownlow/2024', '/players/[slug]',
    ]));
  });

  it('audits a stale publication and reports it for a reload prompt', async () => {
    vi.mocked(publishBrownlowSeason).mockResolvedValue(refusal('stale', 'the season moved'));
    const result = await publishSeasonAction({}, publishForm());
    expect(result.code).toBe('stale');
    expect(result.key).toBe('season:2024');
    expect(audit).toHaveBeenCalledWith(
      'admin.brownlow_refused',
      { action: 'publish', season: 2024, code: 'stale' },
      { userId: 7, label: 'super@afldb.test' },
    );
  });
});
