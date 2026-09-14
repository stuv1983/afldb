import 'server-only';

/**
 * Route state for /coaches/compare (AFLDB-ISSUE-170 Stage 2A).
 *
 * The route resolves one discriminated state and hands it to the view,
 * the same shape `/clubs/compare`'s `resolveClubComparisonState` uses:
 * the presentation stage must not have to infer "this is the landing
 * page" from a null id, or "these are the same coach" from two equal
 * ids.
 *
 * Order of resolution, which is also the safety contract:
 *
 *   1. Parse and normalise the parameters. Nothing in a query string is
 *      trusted; a non-numeric or out-of-range value simply parses to
 *      `null`, never throws.
 *   2. Read the canonical coach list for the selectors. Read on every
 *      request, so a newly ingested coach is selectable with no release.
 *   3. Resolve the pair. Half a pair never runs a lookup -- exactly
 *      `/clubs/compare`'s "half a pair is unselected" convention -- and a
 *      full pair is resolved by id (`getCoach`), never by name, before
 *      any other state is decided.
 *   4. Only then are same-coach and invalid/stale states distinguished
 *      from a genuine, distinct, resolved pair.
 *
 * Stage 2A renders only the comparison shell: the resolved pair carries
 * each coach's canonical identity and public profile link, never career,
 * venue, opponent or head-to-head data.
 *
 * Stage 2B adds each coach's full `CoachCareer` (Stage 1A/1B's existing
 * read model -- `getCoachCareer`, never a second, comparison-specific
 * aggregation) to a resolved pair.
 *
 * Stage 2C adds the pair's direct coach-v-coach head-to-head
 * (`getCoachHeadToHead`), oriented to the REQUESTED A/B order -- never the
 * canonical/ordered pair. All three reads (careerA, careerB, headToHead)
 * are independent, so they are loaded concurrently. Stage 2D's comparison
 * context (overlapping coaching seasons, first/most recent direct meeting)
 * travels on that same `headToHead` result rather than a fourth read --
 * see `CoachHeadToHead.overlap`/`firstMeeting`/`lastMeeting`.
 */
import {
  getCoach, getCoachCareer, getCoachHeadToHead, getCoachOptions,
  type CoachCareer, type CoachHeadToHead, type CoachIdentity,
} from '@/db/queries/coaches';
import {
  COACH_COMPARE_PATH,
  canonicalCoachComparePath,
  coachComparePath,
  swapCoachComparePath,
} from '@/lib/coach-comparison-url';
import { coachProfilePath } from '@/lib/format';
import { firstValue, parseIntInRange } from '@/lib/params';
import { coachSlug } from '@/lib/slugs';

export type RawSearchParams = Record<string, string | string[] | undefined>;

/**
 * A parameter that could not be honoured as supplied. Surfaced rather
 * than silently corrected, the same `/clubs/compare` convention: a reader
 * who hand-edits `a=99999999` is owed the sentence explaining what they
 * are actually looking at.
 */
export type CoachCompareNotice = {
  field: 'a' | 'b';
  message: string;
};

/** The parameters the page actually ran with, after normalisation. */
export type CoachCompareEffectiveParams = {
  a: number | null;
  b: number | null;
};

export type CoachCompareOption = Awaited<ReturnType<typeof getCoachOptions>>[number];

/** Everything a selector needs, read from canonical rows on every request. */
export type CoachCompareOptions = {
  coaches: CoachCompareOption[];
};

/**
 * One resolved coach plus where its coach profile lives: always that
 * coach's own `/coaches/[slug]-id` page (Stage 1E — a comparison OF COACHES
 * links to coach pages, player-linked or not; `coachProfilePath`'s
 * contract).
 */
export type ResolvedCoach = {
  coach: CoachIdentity;
  profilePath: string;
};

function resolveCoach(coach: CoachIdentity): ResolvedCoach {
  return {
    coach,
    profilePath: coachProfilePath({ slug: coachSlug(coach.displayName), coachId: coach.id }),
  };
}

type BaseRouteState = {
  params: CoachCompareEffectiveParams;
  notices: CoachCompareNotice[];
  options: CoachCompareOptions;
  /** The SEO canonical path: ordered pair only, never the current view. */
  canonicalPath: string;
  /** The current view, exactly as it should be shared. */
  sharePath: string;
  noindex: boolean;
};

export type CoachCompareRouteState =
  | (BaseRouteState & { kind: 'unselected' })
  | (BaseRouteState & { kind: 'invalid'; invalidRaw: string[] })
  | (BaseRouteState & { kind: 'same-coach'; coach: ResolvedCoach })
  | (BaseRouteState & {
      kind: 'selected';
      /** Presentation order is the REQUESTED order, not the canonical one. */
      coachA: ResolvedCoach;
      coachB: ResolvedCoach;
      /**
       * Each coach's full career (Stage 2B), loaded concurrently from
       * {@link getCoachCareer}. `null` only in the unexpected case where
       * an already-resolved, valid coach id's career fails to load -- the
       * view must fail safely rather than throw.
       */
      careerA: CoachCareer | null;
      careerB: CoachCareer | null;
      /**
       * Direct coach-v-coach head-to-head (Stage 2C), oriented to the
       * REQUESTED A/B order -- `null` only in the unexpected case where an
       * already-resolved, valid pair's head-to-head fails to load, the same
       * fail-safe convention `careerA`/`careerB` already use. A real,
       * distinct pair that never met returns a real zero-meeting object,
       * never `null` (see {@link getCoachHeadToHead}).
       */
      headToHead: CoachHeadToHead | null;
      /** The same view with the two coaches reversed. */
      swapPath: string;
    });

function parseParams(raw: RawSearchParams): {
  rawA: string | undefined;
  rawB: string | undefined;
  idA: number | null;
  idB: number | null;
} {
  const rawA = firstValue(raw.a)?.trim() || undefined;
  const rawB = firstValue(raw.b)?.trim() || undefined;
  return {
    rawA,
    rawB,
    idA: parseIntInRange(rawA, 1, 2_147_483_647) ?? null,
    idB: parseIntInRange(rawB, 1, 2_147_483_647) ?? null,
  };
}

/**
 * The whole route state, including the resolved pair when -- and only
 * when -- it is valid and distinct.
 */
export async function resolveCoachCompareState(
  raw: RawSearchParams,
): Promise<CoachCompareRouteState> {
  const parsed = parseParams(raw);
  const notices: CoachCompareNotice[] = [];

  const coaches = await getCoachOptions();
  const options: CoachCompareOptions = { coaches };

  // Echoed back even from a half-selection, so a reader who has only
  // chosen the first coach sees that choice reflected in the selector --
  // it just never triggers a lookup on its own (step 1 below).
  const params: CoachCompareEffectiveParams = { a: parsed.idA, b: parsed.idB };
  const sharePath = coachComparePath(params);
  const base = { params, notices, options, sharePath };

  // 1. Nothing chosen, or only half a pair. No pair query runs, and no
  //    coach is ever chosen on the reader's behalf (`/clubs/compare`'s
  //    "half a pair is unselected" convention).
  if (!parsed.rawA || !parsed.rawB) {
    return { ...base, kind: 'unselected', canonicalPath: COACH_COMPARE_PATH, noindex: false };
  }

  // 2. A pair was asked for, so resolve it BY ID before anything else --
  //    never by name, so two coaches sharing a display name stay
  //    unambiguous.
  const [coachA, coachB] = await Promise.all([
    parsed.idA ? getCoach(parsed.idA) : Promise.resolve(null),
    parsed.idB ? getCoach(parsed.idB) : Promise.resolve(null),
  ]);

  if (!coachA || !coachB) {
    const invalidRaw = [
      ...(coachA ? [] : [parsed.rawA]),
      ...(coachB ? [] : [parsed.rawB]),
    ];
    notices.push({
      field: coachA ? 'b' : 'a',
      message: invalidRaw.length === 1
        ? `${invalidRaw[0]} is not a coach on record.`
        : `${invalidRaw.join(' and ')} are not coaches on record.`,
    });
    return {
      ...base,
      kind: 'invalid',
      invalidRaw,
      canonicalPath: COACH_COMPARE_PATH,
      noindex: true,
    };
  }

  // 3. Same coach, deliberately rejected rather than treated as a
  //    meaningful (degenerate) comparison.
  if (coachA.id === coachB.id) {
    notices.push({ field: 'b', message: 'Choose two different coaches.' });
    return {
      ...base,
      kind: 'same-coach',
      coach: resolveCoach(coachA),
      canonicalPath: COACH_COMPARE_PATH,
      noindex: true,
    };
  }

  // Stage 2B/2C: careers and the direct head-to-head are three independent
  // reads, so load them concurrently rather than sequentially -- the same
  // reasoning the pair lookup above already applies to coachA/coachB.
  // headToHead is requested in the REQUESTED order (coachA.id, coachB.id),
  // never the canonical/ordered pair, so A/B orientation survives intact.
  const [careerA, careerB, headToHead] = await Promise.all([
    getCoachCareer(coachA.id),
    getCoachCareer(coachB.id),
    getCoachHeadToHead(coachA.id, coachB.id),
  ]);

  return {
    ...base,
    kind: 'selected',
    coachA: resolveCoach(coachA),
    coachB: resolveCoach(coachB),
    careerA,
    careerB,
    headToHead,
    swapPath: swapCoachComparePath(params),
    canonicalPath: canonicalCoachComparePath(coachA.id, coachB.id),
    noindex: false,
  };
}

export type CoachCompareMetadataState = {
  title: string;
  description: string;
  canonicalPath: string;
  noindex: boolean;
};

/**
 * Metadata resolution, deliberately separate from the page's own
 * resolution: Next calls `generateMetadata` and the page independently,
 * so resolving the full state (including the ~386-row selector list)
 * twice would double every request on this surface for no reason -- the
 * same trade-off `resolveClubComparisonMetadata` already makes.
 */
export async function resolveCoachCompareMetadata(
  raw: RawSearchParams,
): Promise<CoachCompareMetadataState> {
  const parsed = parseParams(raw);

  const landing: CoachCompareMetadataState = {
    title: 'Compare AFL & VFL Coaches',
    description:
      'Compare any two VFL/AFL coaches -- coach-only or player-linked -- side by side.',
    canonicalPath: COACH_COMPARE_PATH,
    noindex: false,
  };

  if (!parsed.rawA || !parsed.rawB) return landing;

  const [coachA, coachB] = await Promise.all([
    parsed.idA ? getCoach(parsed.idA) : Promise.resolve(null),
    parsed.idB ? getCoach(parsed.idB) : Promise.resolve(null),
  ]);

  // An unresolvable or identical pair describes no comparison, so it
  // gets no pair metadata and is not offered to an index.
  if (!coachA || !coachB || coachA.id === coachB.id) {
    return { ...landing, noindex: true };
  }

  return {
    title: `${coachA.displayName} vs ${coachB.displayName} — Coach Comparison`,
    description: `Compare ${coachA.displayName} and ${coachB.displayName} as VFL/AFL coaches.`,
    canonicalPath: canonicalCoachComparePath(coachA.id, coachB.id),
    noindex: false,
  };
}
