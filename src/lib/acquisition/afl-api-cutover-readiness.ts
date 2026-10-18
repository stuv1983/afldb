/**
 * AFL API cutover — the repository half of the readiness check, DB-free.
 *
 * Answers one question from tracked reference data and one authentic season
 * feed: could the AFL API settle own season S's published matches without AFL
 * Tables? Each check below is a precondition the settle code ALREADY enforces
 * at run time (a missing one HALTs the night or refuses the match there); this
 * reports them all at once, before a host is touched. It reads files and
 * nothing else: no database, no network, no host.
 *
 * THE FEED. Venue, team and round coverage are judged against the season's
 * own matches feed (`00-season-matches.json` as an acquisition retains it, or
 * the retained registration evidence), never against the tracked maps alone: a
 * map can only be shown complete against the list of matches it must cover. No
 * feed, a malformed feed or an incomplete enumeration (ISSUE-231's rules) fails
 * every coverage check. Coverage is as of the feed's bytes: a venue the AFL adds
 * later is caught only by re-running this on a newer feed (§7 of the runbook
 * re-runs it at C4, C4b and C5).
 *
 * WHAT READY DOES NOT MEAN. It is not the cutover go (D-316-4). The host (units,
 * timers, `acquisition.%` site settings, the polkit rule) and the database (a
 * `venues` row for every mapped `legacy_name`) are not knowable from here; the
 * CLI prints those as operator checks instead of claiming them.
 */
import { assessAflApiSeasonEnumeration } from './afl-api-season-enumeration';
import { parseAflApiIdentities, type AflApiIdentities } from './afl-api-bundle';
import { getAflRoundVocabulary, translateAflRound } from './afl-api-rounds';
import { parseAfltablesNetworkStatus, type AfltablesNetworkStatus } from './afltables-network';
import { parseSourceFamilyRegistry, type SourceFamilyRegistry } from './source-families';

export type ReadinessCheck = {
  id: string;
  ok: boolean;
  detail: string;
};

export type CutoverReadiness = {
  season: number;
  /** Every repository and feed precondition holds. Never the cutover go. */
  ready: boolean;
  checks: ReadinessCheck[];
  /** Reported, never part of `ready`: the rollover retires it (C2). */
  afltablesNetwork: AfltablesNetworkStatus;
  /**
   * The `legacy_name` of every feed venue, for the operator's database check.
   * ALL OR NOTHING: empty unless `venue_coverage` passed, so a list that stops
   * at the first malformed or unmapped entry can never be mistaken for the set.
   */
  feedVenueLegacyNames: string[];
};

/** The four tracked files, already `JSON.parse()`d (absent or unparseable is `undefined`), and the feed. */
export type ReadinessInputs = {
  seasons: unknown;
  identities: unknown;
  sourceFamilies: unknown;
  afltablesNetwork: unknown;
  /** The season matches feed's exact text and where it came from, or `undefined` when none was supplied. */
  seasonFeed?: { path: string; text: string } | undefined;
};

function attempt(id: string, fn: () => string): ReadinessCheck {
  try {
    return { id, ok: true, detail: fn() };
  } catch (error) {
    return { id, ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

function field(value: unknown, key: string): unknown {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
}

function nonEmptyString(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${what} is not a non-empty string.`);
  return value;
}

/** At most `n` items, then how many more. */
function sample(items: readonly string[], n = 8): string {
  return items.length <= n ? items.join('; ') : `${items.slice(0, n).join('; ')}; and ${items.length - n} more`;
}

type Feed = { entries: unknown[]; detail: string };

/** The feed, proved a complete enumeration of the REGISTERED season, or a thrown reason. */
function completeFeed(season: number, inputs: ReadinessInputs, identities: AflApiIdentities | null): Feed {
  if (!inputs.seasonFeed) {
    throw new Error('No season matches feed was supplied (--season-feed <00-season-matches.json>). '
      + 'Venue, team and round coverage cannot be shown without the matches they must cover.');
  }
  const identity = identities?.seasons.get(season);
  if (!identity) {
    throw new Error(`The feed cannot be judged without afl-api-identities.json seasons.${season}.`);
  }
  const enumeration = assessAflApiSeasonEnumeration(inputs.seasonFeed.text, {
    season, compSeasonProviderId: identity.providerId,
  });
  if (!enumeration.complete) {
    throw new Error(`${inputs.seasonFeed.path} is not a complete enumeration of ${identity.providerId}: `
      + enumeration.gaps.map((g) => `${g.reason} (${g.detail})`).join('; '));
  }
  return {
    entries: (JSON.parse(inputs.seasonFeed.text) as { matches: unknown[] }).matches,
    detail: `${inputs.seasonFeed.path}: ${enumeration.providerMatchIds.length} match(es), complete for `
      + `${identity.providerId}, sha256 ${enumeration.sourceSha256}`,
  };
}

export function assessAflApiCutoverReadiness(season: number, inputs: ReadinessInputs): CutoverReadiness {
  let identities: AflApiIdentities | null = null;
  let registry: SourceFamilyRegistry | null = null;
  let feed: Feed | null = null;
  let feedError = 'the season feed check did not run';
  /** Set only by a fully passing `venue_coverage`; never a partial list. */
  let feedVenueLegacyNames: string[] = [];

  const usableFeed = (): Feed => {
    if (feed === null) throw new Error(`Unproved: ${feedError}`);
    return feed;
  };

  const checks: ReadinessCheck[] = [
    attempt('in_progress_season', () => {
      const list = field(inputs.seasons, 'in_progress_seasons');
      if (!Array.isArray(list) || list.length !== 1 || list[0] !== season) {
        throw new Error(
          `data/reference/seasons.json in_progress_seasons is ${JSON.stringify(list ?? null)}; `
          + `the settle needs exactly [${season}].`,
        );
      }
      return `data/reference/seasons.json in_progress_seasons = [${season}]`;
    }),
    attempt('season_identity', () => {
      identities = parseAflApiIdentities(inputs.identities);
      const identity = identities.seasons.get(season);
      if (!identity) {
        throw new Error(
          `data/reference/afl-api-identities.json has no seasons.${season} entry `
          + '(compSeasonId and CD_S providerId, from the authentic season feed; ISSUE-233 D-233-2).',
        );
      }
      return `afl-api-identities.json seasons.${season} = ${identity.providerId}`;
    }),
    attempt('round_vocabulary', () => {
      registry = parseSourceFamilyRegistry(inputs.sourceFamilies);
      const vocabulary = getAflRoundVocabulary(registry, season);
      return `source-families.json round_vocabularies.afl_api_${season} declared (${vocabulary.rounds.length} round row(s))`;
    }),
    attempt('season_feed', () => {
      try {
        feed = completeFeed(season, inputs, identities);
      } catch (error) {
        feedError = error instanceof Error ? error.message : String(error);
        throw error;
      }
      return feed.detail;
    }),
    attempt('venue_coverage', () => {
      // An unmapped venue is a per-match REFUSAL at settle (ISSUE-244 I244-F003): the match is withheld.
      const { entries } = usableFeed();
      const ids = identities!;
      const unmapped = new Map<string, { name: string; matches: number }>();
      const mapped = new Set<string>();
      // Collected locally and published only on a complete pass (below).
      const legacyNames = new Set<string>();
      entries.forEach((entry, index) => {
        const venue = field(entry, 'venue');
        const providerId = nonEmptyString(field(venue, 'providerId'), `feed entry ${index} venue.providerId`);
        const identity = ids.venues.get(providerId);
        if (identity) {
          mapped.add(providerId);
          legacyNames.add(identity.legacyName);
          return;
        }
        const seen = unmapped.get(providerId);
        const name = typeof field(venue, 'name') === 'string' ? field(venue, 'name') as string : '?';
        unmapped.set(providerId, { name, matches: (seen?.matches ?? 0) + 1 });
      });
      if (unmapped.size > 0) {
        throw new Error(`${unmapped.size} feed venue(s) not in afl-api-identities.json venues; each match there `
          + 'is refused at settle: '
          + sample([...unmapped].sort().map(([id, v]) => `${id} '${v.name}' (${v.matches} match(es))`)));
      }
      if (legacyNames.size === 0) throw new Error('The feed names no venue, so venue coverage is unproved.');
      feedVenueLegacyNames = [...legacyNames].sort();
      return `every feed venue is mapped (${mapped.size} distinct provider venue(s), ${entries.length} match(es))`;
    }),
    attempt('team_coverage', () => {
      // An unmapped team HALTs the whole night (afl-api-bundle.ts resolveTeam).
      const { entries } = usableFeed();
      const ids = identities!;
      const unmapped = new Set<string>();
      const seen = new Set<string>();
      entries.forEach((entry, index) => {
        for (const side of ['home', 'away'] as const) {
          const providerId = nonEmptyString(
            field(field(field(entry, side), 'team'), 'providerId'), `feed entry ${index} ${side}.team.providerId`);
          seen.add(providerId);
          if (!ids.teams.has(providerId)) unmapped.add(providerId);
        }
      });
      if (unmapped.size > 0) {
        throw new Error(`${unmapped.size} feed team(s) not in afl-api-identities.json teams; the settle HALTs on `
          + `the first: ${sample([...unmapped].sort())}`);
      }
      return `every feed team is mapped (${seen.size} distinct provider team(s))`;
    }),
    attempt('round_coverage', () => {
      // An untranslatable round HALTs the whole night (afl-api-rounds.ts translateAflRound).
      const { entries } = usableFeed();
      if (registry === null) throw new Error('Unproved: source-families.json did not parse.');
      const failures = new Map<string, string>();
      entries.forEach((entry, index) => {
        const round = field(entry, 'round');
        const label = field(field(entry, 'metadata'), 'finals_match_label');
        try {
          translateAflRound(registry!, season, {
            apiRoundNumber: field(round, 'roundNumber') as number,
            apiAbbreviation: field(round, 'abbreviation') as string,
            apiName: field(round, 'name') as string,
            finalsMatchLabel: typeof label === 'string' ? label : null,
          });
        } catch (error) {
          const key = `round ${String(field(round, 'roundNumber'))}`;
          if (!failures.has(key)) {
            failures.set(key, `entry ${index}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      });
      if (failures.size > 0) {
        throw new Error(`${failures.size} feed round(s) do not translate through afl_api_${season}: `
          + sample([...failures.values()], 4));
      }
      return `every feed entry translates through round_vocabularies.afl_api_${season}`;
    }),
  ];

  const venueCoverage = checks.find((c) => c.id === 'venue_coverage');
  return {
    season,
    ready: checks.every((c) => c.ok),
    checks,
    afltablesNetwork: parseAfltablesNetworkStatus(inputs.afltablesNetwork, inputs.seasons),
    feedVenueLegacyNames: venueCoverage?.ok === true ? feedVenueLegacyNames : [],
  };
}

export function renderAflApiCutoverReadiness(r: CutoverReadiness): string[] {
  const lines = [`AFL API cutover readiness — season ${r.season} (repository and season feed only, DB-free)`];
  for (const c of r.checks) lines.push(`  ${c.ok ? 'PASS' : 'FAIL'} ${c.id}: ${c.detail}`);
  const network: Record<AfltablesNetworkStatus, string> = {
    active: ' (AFL Tables is still fetched; the season rollover retires it, C2)',
    retired: ' (AFL Tables network acquisition refused by every gated path)',
    out_of_bounds: ' (an active switch behind the in-progress register: every gated path refuses, the AFL Tables unit FAILS; fix the switch)',
  };
  lines.push(`  INFO afltables_network: ${r.afltablesNetwork}${network[r.afltablesNetwork]}`);
  lines.push(r.ready
    ? 'VERDICT: REPOSITORY READY — the tracked files and this feed meet the settle\'s preconditions. '
      + 'This is NOT the cutover go (D-316-4): the host and database checks below are the operator\'s.'
    : 'VERDICT: NOT READY (repository and season feed preconditions)');
  return lines;
}
