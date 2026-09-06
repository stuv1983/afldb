import 'server-only';

/**
 * Route state for /clubs/compare (AFLDB-ISSUE-144 Stage 7).
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
 *   2. Read the canonical seasons and organisations. Both are read on
 *      every request, so a newly ingested season is selectable with no
 *      release; no year and no club list is named in this file.
 *   3. Resolve the pair. A missing, invalid or identical pair returns
 *      BEFORE any pair-specific query runs.
 *   4. Only then load the comparison data, concurrently.
 */
import {
  getClubBrownlowHistory,
  getClubSeasonComparison,
  getComparisonOrganizations,
  getComparisonSeasons,
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
  type ClubSeasonComparison,
  type ComparisonOrganization,
  type ComparisonSeason,
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
 * than silently corrected: a reader who hand-edits `season=1066` is
 * owed the sentence explaining what they are actually looking at.
 */
export type ComparisonNotice = {
  field: 'club' | 'season' | 'matchType' | 'page';
  message: string;
};

/** The parameters the page actually ran with, after normalisation. */
export type ComparisonEffectiveParams = {
  club1: string | null;
  club2: string | null;
  /** Null only when `seasons` is empty, which no populated database is. */
  season: number | null;
  matchType: MatchType;
  page: number;
};

/** Everything a selector needs, read from canonical rows on every request. */
export type ComparisonOptions = {
  seasons: ComparisonSeason[];
  organizations: ComparisonOrganization[];
};

/** The loaded comparison. Every field comes from the Stage 1-6 query surface. */
export type ClubComparisonData = {
  /** Selected-season comparison for the FIRST requested club. */
  seasonA: ClubSeasonComparison | null;
  /** Selected-season comparison for the SECOND requested club. */
  seasonB: ClubSeasonComparison | null;
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
  /** Canonical metadata for the selected season, or null when none exists. */
  seasonMeta: ComparisonSeason | null;
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
 * Normalise the query string.
 *
 * `season` is parsed as a plain integer and validated against the
 * canonical season list by the caller: a numeric range check here would
 * be a hard-coded year boundary, which this surface must not contain.
 */
function parseParams(raw: RawSearchParams): {
  club1: string | null;
  club2: string | null;
  rawClub1: string | undefined;
  rawClub2: string | undefined;
  season: number | null;
  rawSeason: string | undefined;
  matchType: MatchType;
  matchTypeInvalid: boolean;
  page: number;
  pageInvalid: boolean;
} {
  const rawClub1 = firstValue(raw.club1)?.trim() || undefined;
  const rawClub2 = firstValue(raw.club2)?.trim() || undefined;
  const rawSeason = firstValue(raw.season)?.trim() || undefined;
  const rawMatchType = firstValue(raw.matchType)?.trim() || undefined;
  const rawPage = firstValue(raw.page)?.trim() || undefined;

  const seasonNumber = rawSeason === undefined ? null : Number(rawSeason);

  const page = parsePage(rawPage);

  return {
    club1: parseSlug(rawClub1) ?? null,
    club2: parseSlug(rawClub2) ?? null,
    rawClub1,
    rawClub2,
    season: seasonNumber !== null && Number.isSafeInteger(seasonNumber) ? seasonNumber : null,
    rawSeason,
    matchType: isMatchType(rawMatchType) ? rawMatchType : DEFAULT_MATCH_TYPE,
    matchTypeInvalid: rawMatchType !== undefined && !isMatchType(rawMatchType),
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

  const [seasons, organizations] = await Promise.all([
    getComparisonSeasons(),
    getComparisonOrganizations(),
  ]);

  // The maximum canonical season is the default, discovered from the
  // rows that exist rather than from the calendar.
  const latest = seasons[0] ?? null;
  let seasonMeta: ComparisonSeason | null = latest;

  if (parsed.rawSeason !== undefined) {
    const requested = parsed.season === null
      ? null
      : seasons.find((s) => s.season === parsed.season) ?? null;
    if (requested) {
      seasonMeta = requested;
    } else {
      notices.push({
        field: 'season',
        message: latest
          ? `${parsed.rawSeason} is not a season on record; showing ${latest.season}.`
          : `${parsed.rawSeason} is not a season on record.`,
      });
    }
  }

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
    season: seasonMeta?.season ?? null,
    matchType: parsed.matchType,
    page: parsed.page,
  };

  const options: ComparisonOptions = { seasons, organizations };
  const sharePath = clubComparePath(params);

  const base = { params, notices, options, seasonMeta, sharePath };

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
  const season = params.season;

  // 4. Everything else is independent, so it all runs at once. The
  //    Stage 5 route-equivalent composition measured exactly this shape.
  const [
    summary,
    meetings,
    venues,
    records,
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
    seasonA,
    seasonB,
  ] = await Promise.all([
    getHeadToHeadSummary(a, b),
    getHeadToHeadMeetings(a, b, { matchType: params.matchType, page: params.page }),
    getHeadToHeadVenueRecords(a, b),
    getHeadToHeadRecords(a, b),
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
    season === null ? Promise.resolve(null) : getClubSeasonComparison(a, season),
    season === null ? Promise.resolve(null) : getClubSeasonComparison(b, season),
  ]);

  return {
    ...base,
    kind: 'comparison',
    organizationA,
    organizationB,
    swapPath: swapClubComparePath(params),
    canonicalPath: canonicalClubComparePath(organizationA.slug, organizationB.slug),
    noindex: false,
    data: {
      seasonA,
      seasonB,
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
      'Compare any two VFL/AFL clubs: selected-season records, complete head-to-head '
      + 'history, rivalry records and the players who played for both.',
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
      `Compare ${organizationA.name} and ${organizationB.name}: season records, complete `
      + 'head-to-head history, rivalry records, Brownlow history and shared players.',
    canonicalPath: canonicalClubComparePath(organizationA.slug, organizationB.slug),
    noindex: false,
  };
}
