/**
 * Centralised formatting.
 *
 * Every date, score, round name and statistic in AFLDB is rendered
 * through these helpers, so presentation cannot drift between pages.
 *
 * The most important rule here is the distinction between a recorded
 * zero and a statistic that was never collected. `formatStat` renders
 * `null` as an em dash, never as `0`.
 */

export const NOT_RECORDED = '—';

/** A count that may not have been recorded. `null` is never shown as 0. */
export function formatStat(value: number | null | undefined): string {
  if (value === null || value === undefined) return NOT_RECORDED;
  return value.toLocaleString('en-AU');
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return NOT_RECORDED;
  return value.toLocaleString('en-AU');
}

/**
 * A Brownlow figure, rendered according to why it may be absent.
 *
 * An absent vote count has three quite different meanings and they must
 * never collapse into "0". A player in 1943 did not fail to poll — there
 * was no medal. A 2026 player has not polled zero — the count is not yet
 * published. Only `complete` makes 0 a fact about the player.
 */
export function formatBrownlow(
  votes: number | null | undefined,
  status: string,
): string {
  switch (status) {
    case 'complete':
      return votes === null || votes === undefined ? NOT_RECORDED : votes.toLocaleString('en-AU');
    case 'pending':
      return 'Not yet awarded';
    case 'not_applicable':
      return 'No medal';
    case 'not_collected':
      return 'Not recorded';
    default:
      return NOT_RECORDED;
  }
}

/** Long-form explanation for a tooltip or footnote. */
export function brownlowStatusNote(status: string): string | null {
  switch (status) {
    case 'pending':
      return 'The season is still in progress; the Brownlow Medal has not been awarded.';
    case 'not_applicable':
      return 'No Brownlow Medal was awarded for this season.';
    case 'not_collected':
      return 'Votes for this season were not recorded in the source data.';
    default:
      return null;
  }
}

/** Australian football score: "12.8 (80)". */
export function formatScore(
  goals: number | null,
  behinds: number | null,
  points: number,
): string {
  if (goals === null || behinds === null) return String(points);
  return `${goals}.${behinds} (${points})`;
}

const ROUND_LABELS: Record<string, string> = {
  elimination_final: 'Elimination Final',
  qualifying_final: 'Qualifying Final',
  semi_final: 'Semi Final',
  preliminary_final: 'Preliminary Final',
  grand_final: 'Grand Final',
};

const ROUND_SHORT: Record<string, string> = {
  elimination_final: 'EF',
  qualifying_final: 'QF',
  semi_final: 'SF',
  preliminary_final: 'PF',
  grand_final: 'GF',
};

/**
 * `fallback` is what a source calls the round in its own words — AFLW
 * carries a `round_code` alongside the type. It stands in for a type this
 * map has never seen and for a home-and-away row with no round number,
 * either of which would otherwise render as a bare identifier or "Rnull".
 */
export function formatRound(
  roundType: string,
  roundNumber: number | null,
  fallback?: string | null,
): string {
  if (roundType === 'home_and_away') {
    return roundNumber === null ? (fallback ?? NOT_RECORDED) : `Round ${roundNumber}`;
  }
  return ROUND_LABELS[roundType] ?? fallback ?? roundType;
}

export function formatRoundShort(
  roundType: string,
  roundNumber: number | null,
  fallback?: string | null,
): string {
  if (roundType === 'home_and_away') {
    return roundNumber === null ? (fallback ?? NOT_RECORDED) : `R${roundNumber}`;
  }
  return ROUND_SHORT[roundType] ?? fallback ?? roundType;
}

export function formatDate(value: Date | string | null): string {
  if (!value) return NOT_RECORDED;
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return NOT_RECORDED;
  return date.toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatDateLong(value: Date | string | null): string {
  if (!value) return NOT_RECORDED;
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return NOT_RECORDED;
  return date.toLocaleDateString('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Career span: "2002–2020", or "2002–" while still playing. */
export function formatSpan(from: number | null, to: number | null, ongoing = false): string {
  if (from === null) return NOT_RECORDED;
  if (ongoing) return `${from}–`;
  if (to === null || to === from) return String(from);
  return `${from}–${to}`;
}

/**
 * The same span rule for endpoints that are labels rather than years.
 *
 * AFLW seasons are named, not numbered — two of them fall in 2022 — so a
 * span there runs between display labels. One season must still collapse
 * to a single label rather than reading "Season 3–Season 3".
 */
export function formatSpanLabel(from: string | null, to: string | null): string {
  if (!from) return to || NOT_RECORDED;
  if (!to || to === from) return from;
  return `${from}–${to}`;
}

export function formatAttendance(value: number | null): string {
  return value === null ? NOT_RECORDED : value.toLocaleString('en-AU');
}

/** Goal average per game, to one decimal. */
export function formatAverage(total: number | null, games: number | null): string {
  if (total === null || !games) return NOT_RECORDED;
  return (total / games).toFixed(1);
}

export function formatPercentage(value: number | string | null): string {
  if (value === null) return NOT_RECORDED;
  return Number(value).toFixed(1);
}

/** Entity URL. The id is authoritative; the slug is for readability. */
export function playerPath(slug: string, id: number): string {
  return `/players/${slug}-${id}`;
}

export function clubPath(slug: string): string {
  return `/clubs/${slug}`;
}

export function venuePath(slug: string): string {
  return `/venues/${slug}`;
}

export function matchPath(id: number): string {
  return `/matches/${id}`;
}

export function seasonPath(year: number): string {
  return `/seasons/${year}`;
}

export function awardPath(slug: string): string {
  return `/awards/${slug}`;
}

export function awardSeasonPath(slug: string, season: number): string {
  return `/awards/${slug}/${season}`;
}

export function honourTeamPath(slug: string): string {
  return `/honour-teams/${slug}`;
}

/**
 * AFLW URLs.
 *
 * Every one is built on the source's own key rather than on a display
 * name: a club is `ade`, not `kuwarna`, and a player is the source's
 * name-derived slug. The scrape applies current club names to historical
 * pages, so a name-based URL would break at the next rename while the
 * code stays put. Keys can contain characters that must not travel raw in
 * a path, so each is encoded.
 */
export function aflwPlayerPath(slug: string): string {
  return `/aflw/players/${encodeURIComponent(slug)}`;
}

export function aflwClubPath(code: string): string {
  return `/aflw/clubs/${encodeURIComponent(code)}`;
}

export function aflwSeasonPath(seasonKey: string): string {
  return `/aflw/seasons/${encodeURIComponent(seasonKey)}`;
}

export function aflwMatchPath(matchKey: string): string {
  return `/aflw/matches/${encodeURIComponent(matchKey)}`;
}

/**
 * A player's name as the AFLW source slugs it, made readable.
 *
 * Only used where the source names a scorer without a slug — the scoring
 * worm before Season Six — so the two spellings can be compared.
 */
export function aflwSlugToName(slug: string): string {
  return slug.replace(/_/g, ' ').replace(/(\D)\d+$/, '$1').trim();
}

/**
 * A source name is only a link when the link is trusted.
 *
 * `ambiguous`, `unmatched` and `implausible` all mean AFLDB does not know
 * which player the source meant. Linking anyway would assert an identity
 * the data does not support.
 */
export function isLinked(status: string): boolean {
  return status === 'unique' || status === 'resolved';
}

/**
 * Split "gary-ablett-jr-12345" into its slug and id.
 * Returns null when the trailing id is absent or not a number.
 */
export function parseEntitySlug(param: string): { slug: string; id: number } | null {
  const match = /^(.*)-(\d+)$/.exec(param);
  if (!match) return null;
  const id = Number(match[2]);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return { slug: match[1], id };
}

export function pluralise(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : (plural ?? `${singular}s`);
}
