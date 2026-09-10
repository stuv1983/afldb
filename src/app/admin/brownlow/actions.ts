'use server';

import { revalidatePath } from 'next/cache';

import {
  correctBrownlowMatch,
  finaliseBrownlowMatch,
  publishBrownlowSeason,
  saveDraftBrownlowMatch,
  voidBrownlowMatch,
} from '@/db/queries/admin-brownlow';
import {
  readRevalidateConfig,
  revalidateSeason,
} from '@/lib/acquisition/season-revalidation';
import { audit, requireCapability } from '@/lib/auth/session';
import type { BrownlowRefusalCode } from '@/lib/brownlow/entry';

/**
 * AFLDB-ISSUE-155 Phase C2 — the Brownlow administration Server Actions.
 *
 * Thin, exactly as Phase B's lifecycle actions are: call the capability
 * guard, parse ids / revisions / the fingerprint / the selection out of the
 * form, hand the whole decision to the one C1 transaction, audit the
 * refusals §27.13 names, and revalidate per §27.18. Every rule that matters
 * — participant membership, the revision and fingerprint compare-and-set,
 * the state machine, the reason requirement, the season derivation — is
 * re-derived inside `src/db/queries/admin-brownlow.ts` under a lock, so
 * nothing parsed here can widen what happens. The hidden `expectedRevision`
 * and `expectedCanonicalFingerprint` fields are a staleness check, never an
 * instruction.
 *
 * `requireCapability` is the boundary: `data.brownlow.draft` for a draft
 * save (Admin and up), `data.brownlow.finalise` for finalise / correct /
 * void / publish (Super Admin only, §27.8). A capability table is a
 * description of guards, not a substitute for one; each action calls its
 * own.
 */

export type BrownlowActionState = {
  /**
   * Which subject this result belongs to (`match:<id>` or `season:<year>`),
   * so the round page can show it on the right card and nowhere else — the
   * Phase B lesson that a result held by the control that produced it is
   * discarded by the revalidation it triggers (§26.20).
   */
  key?: string;
  ok?: boolean;
  message?: string;
  error?: string;
  code?: BrownlowRefusalCode | 'invalid';
  /**
   * Echo of the submitted selection, so the editor keeps what the operator
   * chose when the server refuses (§26.20 deviation 4).
   */
  selection?: { three: number | null; two: number | null; one: number | null };
};

/** Refusals worth an `auth_audit_log` line (§27.13). `invalid`/`not_found` say nothing. */
const AUDITED_REFUSALS: ReadonlySet<string> = new Set(['stale', 'forbidden', 'already_final']);

type MatchAction = 'saveDraft' | 'finalise' | 'correct' | 'void';

/** `''` / absent → null; a positive integer → that id; anything else → the `invalid` sentinel. */
const INVALID_ID = Symbol('invalid-id');
function parseSlot(value: FormDataEntryValue | null): number | null | typeof INVALID_ID {
  if (value === null || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : INVALID_ID;
}

function parseNonNegativeInt(value: FormDataEntryValue | null): number | null {
  if (value === null || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

type ParsedMatchForm = {
  matchId: number;
  season: number;
  round: number;
  expectedRevision: number;
  expectedCanonicalFingerprint: string | undefined;
  selection: { three: number | null; two: number | null; one: number | null };
  reason: string;
};

function parseMatchForm(formData: FormData): ParsedMatchForm | null {
  const matchId = parseNonNegativeInt(formData.get('matchId'));
  const season = parseNonNegativeInt(formData.get('season'));
  const round = parseNonNegativeInt(formData.get('round'));
  const expectedRevision = parseNonNegativeInt(formData.get('expectedRevision'));
  if (matchId === null || matchId <= 0 || season === null || round === null || expectedRevision === null) {
    return null;
  }

  const slots = [parseSlot(formData.get('three')), parseSlot(formData.get('two')), parseSlot(formData.get('one'))];
  if (slots.some((slot) => slot === INVALID_ID)) return null;
  const [three, two, one] = slots as Array<number | null>;

  const fp = formData.get('expectedCanonicalFingerprint');
  return {
    matchId,
    season,
    round,
    expectedRevision,
    expectedCanonicalFingerprint: typeof fp === 'string' && fp.length > 0 ? fp : undefined,
    selection: { three, two, one },
    reason: (formData.get('reason') ?? '').toString(),
  };
}

/** §27.18: the admin pages always; the public season/match routes for a fact write. */
async function revalidateAfterMatchWrite(
  action: MatchAction,
  parsed: ParsedMatchForm,
  republishedSeason: number | null,
): Promise<void> {
  revalidatePath(`/admin/brownlow/${parsed.season}/${parsed.round}`, 'page');
  revalidatePath(`/admin/brownlow/${parsed.season}`, 'page');
  revalidatePath('/admin/brownlow', 'page');

  if (action === 'saveDraft') return;

  // A finalise / correct / void changes public facts. The season page has a
  // cross-worker route; everything else refreshes within its ISR window
  // (§27.18 "Known limitation").
  revalidatePath(`/seasons/${parsed.season}`, 'page');
  revalidatePath(`/matches/${parsed.matchId}`, 'page');
  await fanOutSeason(parsed.season);

  if (republishedSeason !== null) {
    revalidatePath('/brownlow', 'page');
    revalidatePath(`/brownlow/${republishedSeason}`, 'page');
    revalidatePath('/players/[slug]', 'page');
    revalidatePath('/clubs/[slug]', 'page');
    revalidatePath('/records/[category]', 'page');
  }
}

/**
 * Best-effort cross-worker invalidation of `/seasons/<year>` (§27.18). Never
 * throws: `revalidateSeason` reports a partial cluster rather than raising,
 * and a host with no `AFLDB_REVALIDATE_URL` simply relies on the local
 * `revalidatePath` above plus the ISR window.
 */
async function fanOutSeason(season: number): Promise<void> {
  try {
    const config = readRevalidateConfig(process.env);
    if (!config) return;
    const outcome = await revalidateSeason(config, season);
    if (!outcome.ok) {
      // eslint-disable-next-line no-console
      console.error('[admin-brownlow] season page fan-out incomplete', outcome.failures);
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[admin-brownlow] season page fan-out failed', error);
  }
}

async function runMatchAction(
  action: MatchAction,
  formData: FormData,
): Promise<BrownlowActionState> {
  const actor = await requireCapability(
    action === 'saveDraft' ? 'data.brownlow.draft' : 'data.brownlow.finalise',
  );

  const parsed = parseMatchForm(formData);
  if (!parsed) {
    return { error: 'That submission is not valid.', code: 'invalid' };
  }
  const key = `match:${parsed.matchId}`;
  const echo = { key, selection: parsed.selection } as const;

  const common = {
    matchId: parsed.matchId,
    expectedRevision: parsed.expectedRevision,
    expectedCanonicalFingerprint: parsed.expectedCanonicalFingerprint,
    actorId: actor.id,
    reason: parsed.reason.trim() === '' ? null : parsed.reason,
  };

  const result = action === 'void'
    ? await voidBrownlowMatch(common)
    : action === 'saveDraft'
      ? await saveDraftBrownlowMatch({ ...common, selection: parsed.selection })
      : action === 'finalise'
        ? await finaliseBrownlowMatch({ ...common, selection: parsed.selection })
        : await correctBrownlowMatch({ ...common, selection: parsed.selection });

  if (!result.ok) {
    if (AUDITED_REFUSALS.has(result.code)) {
      await audit(
        'admin.brownlow_refused',
        { action, matchId: parsed.matchId, season: parsed.season, code: result.code },
        { userId: actor.id, label: actor.email },
      );
    }
    return { ...echo, error: result.message, code: result.code };
  }

  await revalidateAfterMatchWrite(action, parsed, result.value.republishedSeason);

  const done: Record<MatchAction, string> = {
    saveDraft: 'Draft saved.',
    finalise: 'Match finalised.',
    correct: 'Correction saved — the canonical votes have changed.',
    void: 'Match voided — the vote values are withdrawn, the line-up is kept.',
  };
  const suffix = result.value.republishedSeason !== null
    ? ` The published ${result.value.republishedSeason} total was re-derived in the same change.`
    : '';
  return { ...echo, ok: true, message: done[action] + suffix };
}

export async function saveDraftAction(
  _previous: BrownlowActionState,
  formData: FormData,
): Promise<BrownlowActionState> {
  return runMatchAction('saveDraft', formData);
}

export async function finaliseAction(
  _previous: BrownlowActionState,
  formData: FormData,
): Promise<BrownlowActionState> {
  return runMatchAction('finalise', formData);
}

export async function correctAction(
  _previous: BrownlowActionState,
  formData: FormData,
): Promise<BrownlowActionState> {
  return runMatchAction('correct', formData);
}

export async function voidAction(
  _previous: BrownlowActionState,
  formData: FormData,
): Promise<BrownlowActionState> {
  return runMatchAction('void', formData);
}

export async function publishSeasonAction(
  _previous: BrownlowActionState,
  formData: FormData,
): Promise<BrownlowActionState> {
  const actor = await requireCapability('data.brownlow.finalise');

  const season = parseNonNegativeInt(formData.get('season'));
  const expectedRevision = parseNonNegativeInt(formData.get('expectedRevision'));
  if (season === null || season < 1897 || expectedRevision === null) {
    return { error: 'That submission is not valid.', code: 'invalid' };
  }
  const key = `season:${season}`;

  const ineligiblePlayerIds: number[] = [];
  for (const raw of formData.getAll('ineligible')) {
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
      return { key, error: 'That submission is not valid.', code: 'invalid' };
    }
    if (!ineligiblePlayerIds.includes(n)) ineligiblePlayerIds.push(n);
  }
  const note = (formData.get('note') ?? '').toString().trim() || null;

  const result = await publishBrownlowSeason({
    season,
    ineligiblePlayerIds,
    expectedRevision,
    actorId: actor.id,
    note,
  });

  if (!result.ok) {
    if (AUDITED_REFUSALS.has(result.code)) {
      await audit(
        'admin.brownlow_refused',
        { action: 'publish', season, code: result.code },
        { userId: actor.id, label: actor.email },
      );
    }
    return { key, error: result.message, code: result.code };
  }

  revalidatePath(`/admin/brownlow/${season}`, 'page');
  revalidatePath('/admin/brownlow', 'page');
  revalidatePath(`/seasons/${season}`, 'page');
  revalidatePath('/brownlow', 'page');
  revalidatePath(`/brownlow/${season}`, 'page');
  revalidatePath('/players/[slug]', 'page');
  revalidatePath('/clubs/[slug]', 'page');
  revalidatePath('/records/[category]', 'page');
  await fanOutSeason(season);

  const winners = result.value.winners.length;
  return {
    key,
    ok: true,
    message: `Season ${season} published: ${result.value.rowCount} polling players, `
      + `${result.value.votesTotal} votes, ${winners} ${winners === 1 ? 'medallist' : 'medallists'}.`,
  };
}
