import 'server-only';

/**
 * Route state for /clubs/compare (AFLDB-ISSUE-144 Stage 7; season removed by
 * the Club Rivalry Explorer follow-up, FR-1 — the comparison is all-time
 * only).
 *
 * The route resolves one discriminated state and hands it to the view.
 * The discriminant is the point: the presentation stage must not have to
 * infer "this is the landing page" from a null organisation, or "these
 * are the same club" from two equal ids.
 *
 * Order of resolution, which is also the safety contract:
 *
 *   1. Parse and normalise the parameters. Nothing in a query string is
 *      trusted.
 *   2. Read the canonical organisations. Read on every request, so a
 *      newly ingested organisation is selectable with no release; no
 *      club list is named in this file.
 *   3. Resolve the pair. A missing, invalid or identical pair returns
 *      BEFORE any pair-specific query runs.
 *   4. Only then load the comparison data, concurrently.
 */
import {
  getClubBrownlowHistory,
  getComparisonOrganizations,
  getCrossoverPlayers,
  getCrossoverSummary,
  getHeadToHeadBrownlow,
  getHeadToHeadByDecade,
  getHeadToHeadMeetings,
  getHeadToHeadPeriodRecords,
  getHeadToHeadPlayerAverages,
  getHeadToHeadPlayerLeaders,
  getHeadToHeadRecords,
  getHeadToHeadStreaks,
  getHeadToHeadSummary,
  getHeadToHeadVenueRecords,
  getOrganizationBySlug,
  type ClubBrownlowHistory,
  type ComparisonOrganization,
  type CrossoverPlayer,
  type CrossoverSummary,
  type H2HBrownlow,
  type H2HDecade,
  type H2HPeriodRecords,
  type H2HPlayerAverages,
  type H2HPlayerLeaders,
  type H2HRecords,
  type H2HStreaks,
  type H2HSummary,
  type H2HVenueRecord,
  type MatchType,
  type MeetingsPage,
} from '@/db/queries/club-comparison';
import {
  CLUB_COMPARE_PATH,
  DEFAULT_MATCH_TYPE,
  canonicalClubComparePath,
  clubComparePath,
  isMatchType,
  swapClubComparePath,
} from '@/lib/club-comparison-url';
import { firstValue, parsePage, parseSlug } from '@/lib/params';

export type RawSearchParams = Record<string, string | string[] | undefined>;

/**
 * A parameter that could not be honoured as supplied. Surfaced rather
 * than silently corrected: a reader who hand-edits `matchType=finalz` is
 * owed the sentence explaining what they are actually looking at.
 */
export type ComparisonNotice = {
  field: 'club' | 'matchType' | 'page' | 'era';
  message: string;
};

/** The parameters the page actually ran with, after normalisation. */
export type ComparisonEffectiveParams = {
  club1: string | null;
  club2: string | null;
  matchType: MatchType;
  /**
   * A decade's first season (1990 for the 1990s), or null for all time.
   * Unlike `matchType`/`page`, this cannot be validated from the raw
   * parameter alone -- it is only known to be legitimate once it is
   * checked against the pair's own decade population, which requires the
   * pair to be resolved first (Club Rivalry Explorer follow-up, FR-2).
   */
  era: number | null;
  page: number;
};

/** Everything a selector needs, read from canonical rows on every request. */
export type ComparisonOptions = {
  organizations: ComparisonOrganization[];
};

/** The loaded comparison. Every field comes from the Stage 1-6 query surface. */
export type ClubComparisonData = {
  summary: H2HSummary;
  meetings: MeetingsPage;
  venues: H2HVenueRecord[];
  records: H2HRecords;
  streaks: H2HStreaks;
  crossoverSummary: CrossoverSummary;
  crossoverPlayers: CrossoverPlayer[];
  playerLeaders: H2HPlayerLeaders;
  brownlowA: ClubBrownlowHistory;
  brownlowB: ClubBrownlowHistory;
  h2hBrownlow: H2HBrownlow;
  decades: H2HDecade[];
  periodRecords: H2HPeriodRecords;
  playerAverages: H2HPlayerAverages;
};

type BaseRouteState = {
  params: ComparisonEffectiveParams;
  notices: ComparisonNotice[];
  options: ComparisonOptions;
  /** The SEO canonical path: ordered pair only, never the current view. */
  canonicalPath: string;
  /** The current view, exactly as it should be shared. */
  sharePath: string;
  noindex: boolean;
};

export type ClubComparisonRouteState =
  | (BaseRouteState & { kind: 'unselected' })
  | (BaseRouteState & { kind: 'invalid-club'; invalidSlugs: string[] })
  | (BaseRouteState & { kind: 'same-organization'; organization: ComparisonOrganization })
  | (BaseRouteState & {
      kind: 'comparison';
      /** Presentation order is the REQUESTED order, not the canonical one. */
      organizationA: ComparisonOrganization;
      organizationB: ComparisonOrganization;
      /** The same view with the two clubs reversed; Stage 8 links it. */
      swapPath: string;
      data: ClubComparisonData;
    });

/**
 * A decade's first season, e.g. `1990` for the 1990s. Deliberately not
 * checked against any hard-coded range here: the only thing that makes an
 * `era` legitimate is appearing in the pair's own decade population
 * (`getHeadToHeadByDecade`), which is checked once that is known, further
 * down in `resolveClubComparisonState`.
 */
function parseEra(value: string | undefined): number | null {
  if (value === undefined) return null;
  const year = Number(value);
  if (!Number.isSafeInteger(year)) return null;
  return year;
}

/**
 * Normalise the query string. This surface carries no `season` parameter
 * (Club Rivalry Explorer follow-up, FR-1): the comparison is all-time
 * only, so there is nothing here to validate against a canonical season
 * list. `era` (FR-2) is parsed here but not yet validated -- see
 * `parseEra`.
 */
function parseParams(raw: RawSearchParams): {
  club1: string | null;
  club2: string | null;
  rawClub1: string | undefined;
  rawClub2: string | undefined;
  matchType: MatchType;
  matchTypeInvalid: boolean;
  era: number | null;
  rawEra: string | undefined;
  page: number;
  pageInvalid: boolean;
} {
  const rawClub1 = firstValue(raw.club1)?.trim() || undefined;
  const rawClub2 = firstValue(raw.club2)?.trim() || undefined;
  const rawMatchType = firstValue(raw.matchType)?.trim() || undefined;
  const rawEra = firstValue(raw.era)?.trim() || undefined;
  const rawPage = firstValue(raw.page)?.trim() || undefined;

  const page = parsePage(rawPage);

  return {
    club1: parseSlug(rawClub1) ?? null,
    club2: parseSlug(rawClub2) ?? null,
    rawClub1,
    rawClub2,
    matchType: isMatchType(rawMatchType) ? rawMatchType : DEFAULT_MATCH_TYPE,
    matchTypeInvalid: rawMatchType !== undefined && !isMatchType(rawMatchType),
    era: parseEra(rawEra),
    rawEra,
    page,
    pageInvalid: rawPage !== undefined && String(page) !== rawPage,
  };
}

/**
 * The whole route state, including its data when — and only when — the
 * pair is valid and distinct.
 */
export async function resolveClubComparisonState(
  raw: RawSearchParams,
): Promise<ClubComparisonRouteState> {
  const parsed = parseParams(raw);
  const notices: ComparisonNotice[] = [];

  const organizations = await getComparisonOrganizations();

  if (parsed.matchTypeInvalid) {
    notices.push({
      field: 'matchType',
      message: 'That match filter is not one of all, home-and-away or finals; showing all matches.',
    });
  }
  if (parsed.pageInvalid) {
    notices.push({
      field: 'page',
      message: `That page number is not valid; showing page ${parsed.page}.`,
    });
  }

  const params: ComparisonEffectiveParams = {
    club1: parsed.club1,
    club2: parsed.club2,
    matchType: parsed.matchType,
    // Unvalidated here -- see the era-population check in step 4 below.
    // A missing or unresolvable pair never reaches that check, so this
    // value is what the unselected/invalid-club/same-organization states
    // carry in their shareable URL.
    era: parsed.era,
    page: parsed.page,
  };

  const options: ComparisonOptions = { organizations };
  const sharePath = clubComparePath(params);

  const base = { params, notices, options, sharePath };

  // 1. Nothing chosen, or only half a pair. No pair query runs, and no
  //    club is ever chosen on the reader's behalf.
  if (!parsed.rawClub1 || !parsed.rawClub2) {
    return {
      ...base,
      kind: 'unselected',
      canonicalPath: CLUB_COMPARE_PATH,
      noindex: false,
    };
  }

  // 2. A pair was asked for, so resolve it before anything expensive.
  const [organizationA, organizationB] = await Promise.all([
    parsed.club1 ? getOrganizationBySlug(parsed.club1) : Promise.resolve(null),
    parsed.club2 ? getOrganizationBySlug(parsed.club2) : Promise.resolve(null),
  ]);

  if (!organizationA || !organizationB) {
    const invalidSlugs = [
      ...(organizationA ? [] : [parsed.rawClub1]),
      ...(organizationB ? [] : [parsed.rawClub2]),
    ];
    notices.push({
      field: 'club',
      message: invalidSlugs.length === 1
        ? `${invalidSlugs[0]} is not a club on record.`
        : `${invalidSlugs.join(' and ')} are not clubs on record.`,
    });
    return {
      ...base,
      kind: 'invalid-club',
      invalidSlugs,
      canonicalPath: CLUB_COMPARE_PATH,
      noindex: true,
    };
  }

  // 3. Same organisation. Historical identities are not separate
  //    choices, so this is the only rejection the pair itself can earn:
  //    related-but-distinct organisations (Brisbane Bears, Fitzroy,
  //    Brisbane Lions) pass straight through.
  if (organizationA.id === organizationB.id) {
    notices.push({ field: 'club', message: 'Choose two different clubs.' });
    return {
      ...base,
      kind: 'same-organization',
      organization: organizationA,
      canonicalPath: CLUB_COMPARE_PATH,
      noindex: true,
    };
  }

  const a = organizationA.id;
  const b = organizationB.id;

  // 4. Everything that does not depend on `era` runs at once, INCLUDING
  //    the decade breakdown -- it is the pair's own era population, and
  //    an `era` in the URL cannot be told legitimate from invented
  //    without it. This is the one way this composition differs from the
  //    Stage 5 route-equivalent shape it otherwise matches.
  const [
    summary,
    venues,
    streaks,
    crossoverSummary,
    crossoverPlayers,
    playerLeaders,
    h2hBrownlow,
    brownlowA,
    brownlowB,
    decades,
    periodRecords,
    playerAverages,
  ] = await Promise.all([
    getHeadToHeadSummary(a, b),
    getHeadToHeadVenueRecords(a, b),
    getHeadToHeadStreaks(a, b),
    getCrossoverSummary(a, b),
    getCrossoverPlayers(a, b),
    getHeadToHeadPlayerLeaders(a, b),
    getHeadToHeadBrownlow(a, b),
    getClubBrownlowHistory(a),
    getClubBrownlowHistory(b),
    getHeadToHeadByDecade(a, b),
    getHeadToHeadPeriodRecords(a, b),
    getHeadToHeadPlayerAverages(a, b),
  ]);

  // 5. An `era` is legitimate only when it names one of this pair's own
  //    decades -- never a hard-coded list, and never a decade the two
  //    organisations simply never met in. A reader who hand-edits the
  //    URL to an era outside this rivalry's history is owed the sentence
  //    explaining that, exactly as an invalid matchType or page is.
  let era: number | null = null;
  if (parsed.rawEra !== undefined) {
    if (parsed.era !== null && decades.some((decade) => decade.decade === parsed.era)) {
      era = parsed.era;
    } else {
      notices.push({
        field: 'era',
        message: 'That era is not part of this rivalry’s recorded history; showing all time.',
      });
    }
  }

  const effectiveParams: ComparisonEffectiveParams = { ...params, era };

  // 6. Only rivalry records and the meetings list are ever era-scoped
  //    (FR-2's contract): streaks, venues, players and Brownlow above are
  //    already resolved all-time and are never recomputed for an era.
  const [records, meetings] = await Promise.all([
    getHeadToHeadRecords(a, b, { era: era ?? undefined }),
    getHeadToHeadMeetings(a, b, {
      matchType: effectiveParams.matchType,
      page: effectiveParams.page,
      era: era ?? undefined,
    }),
  ]);

  return {
    ...base,
    kind: 'comparison',
    params: effectiveParams,
    sharePath: clubComparePath(effectiveParams),
    organizationA,
    organizationB,
    swapPath: swapClubComparePath(effectiveParams),
    canonicalPath: canonicalClubComparePath(organizationA.slug, organizationB.slug),
    noindex: false,
    data: {
      summary,
      meetings,
      venues,
      records,
      streaks,
      crossoverSummary,
      crossoverPlayers,
      playerLeaders,
      brownlowA,
      brownlowB,
      h2hBrownlow,
      decades,
      periodRecords,
      playerAverages,
    },
  };
}

export type ClubComparisonMetadataState = {
  title: string;
  description: string;
  canonicalPath: string;
  noindex: boolean;
};

/**
 * Metadata resolution, deliberately separate from the page's own
 * resolution: Next calls `generateMetadata` and the page independently,
 * so resolving the full state twice would double every query on the
 * surface. A title needs the two organisation names and nothing else.
 */
export async function resolveClubComparisonMetadata(
  raw: RawSearchParams,
): Promise<ClubComparisonMetadataState> {
  const parsed = parseParams(raw);

  const landing: ClubComparisonMetadataState = {
    title: 'Compare AFL & VFL Clubs — Head-to-Head Records and Shared History',
    description:
      'Compare any two VFL/AFL clubs: complete all-time head-to-head history, rivalry '
      + 'records by decade and the players who played for both.',
    canonicalPath: CLUB_COMPARE_PATH,
    noindex: false,
  };

  if (!parsed.rawClub1 || !parsed.rawClub2) return landing;

  const [organizationA, organizationB] = await Promise.all([
    parsed.club1 ? getOrganizationBySlug(parsed.club1) : Promise.resolve(null),
    parsed.club2 ? getOrganizationBySlug(parsed.club2) : Promise.resolve(null),
  ]);

  // An unresolvable or identical pair describes no comparison, so it
  // gets no pair metadata and is not offered to an index.
  if (!organizationA || !organizationB || organizationA.id === organizationB.id) {
    return { ...landing, noindex: true };
  }

  const title = `${organizationA.name} vs ${organizationB.name} — Club Comparison`;
  return {
    title,
    description:
      `Compare ${organizationA.name} and ${organizationB.name}: complete all-time `
      + 'head-to-head history, rivalry records by decade, Brownlow history and shared players.',
    canonicalPath: canonicalClubComparePath(organizationA.slug, organizationB.slug),
    noindex: false,
  };
}
