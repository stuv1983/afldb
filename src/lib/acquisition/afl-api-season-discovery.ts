/**
 * AFLDB-ISSUE-233 — AFL API season discovery: which AFL seasons does the
 * provider list that AFLDB has not registered, and do the ones it has
 * registered still agree with the provider?
 *
 * PROPOSAL ONLY (D-233-1, operator 2026-09-26). The output is a deterministic,
 * reviewable proposal document plus a human-readable summary. Nothing here
 * writes `data/reference/afl-api-identities.json`, `seasons.json` or
 * `in_progress_seasons`. A registered season the provider disagrees with is a
 * finding, never a rewrite.
 *
 * MEASURED SHAPE ONLY. Built against one authentic response,
 * `tests/fixtures/afl_api/seasons/00-compseasons.raw.json` (sha256
 * fe3f1641…d965, 1,959 bytes; GET
 * `aflapi.afl.com.au/afl/v2/competitions/1/compseasons?pageSize=100`, captured
 * 2026-09-19 by `testAFLGrab/grab-afl-historical-samples.ps1`; a second
 * capture 2m17s later is byte-identical):
 *
 *   {meta{code, pagination{page, numPages, pageSize, numEntries}},
 *    compSeasons[{id, providerId, name, shortName, currentRoundNumber}]}
 *
 * The response carries NO year field and NO competition field. The year is
 * read from two places, and both must agree or the entry is refused:
 * `providerId` `CD_S<YYYY>014` and `name` `"<YYYY> Toyota AFL Premiership"`
 * (all 15 measured entries). The `014` suffix is every measured AFL men's
 * premiership id, including the five AFLDB registered (2022–2026). An entry
 * that fits neither pattern is reported, never guessed at.
 *
 * Noted, not relied on: the request asked `pageSize=100` and the response
 * echoed `pageSize: 15` (= numEntries). Completeness is judged from
 * `numEntries`, `page` and `numPages`, never from `pageSize`.
 *
 * WHAT IT IS NOT. Not the ISSUE-231 season enumeration (which asks whether one
 * registered season's feed listed every match). And discovering a season
 * never makes it current: that stays the rollover and the operator's edit of
 * `in_progress_seasons`.
 */

export const AFL_API_COMP_SEASONS_FILE = '00-compseasons.raw.json';
export const AFL_API_SEASON_DISCOVERY_KIND = 'afl_api_season_discovery_proposal';
export const AFL_API_SEASON_DISCOVERY_CONTRACT_VERSION = 1;

/** Every measured AFL men's premiership compSeason id: `CD_S<YYYY>014`. */
const PROVIDER_ID_PATTERN = /^CD_S(\d{4})014$/;
/** Every measured `name`: `"<YYYY> Toyota AFL Premiership"`. Only the leading year is read. */
const NAME_YEAR_PATTERN = /^(\d{4}) .*AFL Premiership$/;

export type AflApiCompSeasonEntry = {
  id: number;
  providerId: string;
  name: string;
  currentRoundNumber: number | null;
};

export type AflApiCompSeasonsListing = {
  entries: readonly AflApiCompSeasonEntry[];
  numEntries: number | null;
  complete: boolean;
  /** Empty exactly when `complete`. */
  gaps: readonly string[];
};

/** The registry side: `afl-api-identities.json` `seasons`, keyed by year. */
export type RegisteredAflApiSeason = { compSeasonId: number; providerId: string };

export type AflApiSeasonDiscoveryFindingKind =
  | 'listing_incomplete'
  | 'unrecognised_entry'
  | 'year_disagreement'
  | 'duplicate_year'
  | 'registered_mismatch'
  | 'registered_absent_from_listing'
  | 'unregistered_within_registered_range';

export type AflApiSeasonDiscoveryFinding = {
  kind: AflApiSeasonDiscoveryFindingKind;
  year: number | null;
  detail: string;
};

export type AflApiSeasonProposal = {
  year: number;
  compSeasonId: number;
  providerId: string;
  name: string;
  currentRoundNumber: number | null;
};

export type AflApiSeasonDiscoveryProposal = {
  kind: typeof AFL_API_SEASON_DISCOVERY_KIND;
  contract_version: number;
  /** Where the bytes came from and their hash. No timestamp: same input, same document. */
  input: { file: string; sha256: string };
  listing: { complete: boolean; numEntries: number | null; entries: number; gaps: readonly string[] };
  /** `refused` when the listing is incomplete or any finding exists; nothing is proposed then. */
  verdict: 'proposals' | 'no_change' | 'refused';
  /** Years AFLDB has not registered and that are newer than every registered year. */
  proposals: readonly AflApiSeasonProposal[];
  /** The exact `seasons` entries a reviewer would add by hand. Never applied by this tool. */
  identitiesSeasonsAdditions: Readonly<Record<string, RegisteredAflApiSeason>>;
  /** Registered years the listing confirms unchanged. */
  confirmedRegistered: readonly number[];
  /** Unregistered years older than every registered year. Reported, never proposed. */
  historicalUnregistered: readonly number[];
  findings: readonly AflApiSeasonDiscoveryFinding[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Read one retained `compseasons` response. A malformed envelope (not JSON, no
 * `compSeasons` array, an entry without an integer `id` or string
 * `providerId`/`name`) throws: verified bytes are never half-read. Every other
 * shortfall is a gap.
 */
export function parseAflApiCompSeasons(bodyText: string): AflApiCompSeasonsListing {
  const parsed: unknown = JSON.parse(bodyText);
  if (!isRecord(parsed) || !Array.isArray(parsed.compSeasons)) {
    throw new Error("The compseasons response has no 'compSeasons' array.");
  }
  const entries = parsed.compSeasons.map((raw, index): AflApiCompSeasonEntry => {
    if (!isRecord(raw)) throw new Error(`compSeasons[${index}] is not an object.`);
    const { id, providerId, name, currentRoundNumber } = raw;
    if (typeof id !== 'number' || !Number.isInteger(id)) throw new Error(`compSeasons[${index}] has no integer id.`);
    if (typeof providerId !== 'string') throw new Error(`compSeasons[${index}] has no string providerId.`);
    if (typeof name !== 'string') throw new Error(`compSeasons[${index}] has no string name.`);
    return {
      id, providerId, name,
      currentRoundNumber: typeof currentRoundNumber === 'number' && Number.isInteger(currentRoundNumber)
        ? currentRoundNumber
        : null,
    };
  });

  const gaps: string[] = [];
  const pagination = isRecord(parsed.meta) && isRecord(parsed.meta.pagination) ? parsed.meta.pagination : null;
  const numEntries = typeof pagination?.numEntries === 'number' && Number.isInteger(pagination.numEntries)
    && pagination.numEntries >= 0 ? pagination.numEntries : null;
  if (numEntries === null) {
    gaps.push('The response carries no integer meta.pagination.numEntries.');
  } else if (numEntries !== entries.length) {
    gaps.push(`meta.pagination.numEntries is ${numEntries} but the response returned ${entries.length} season(s).`);
  }
  if (pagination !== null && (pagination.page !== 0 || pagination.numPages !== 1)) {
    gaps.push(`meta.pagination reports page ${String(pagination.page)} of ${String(pagination.numPages)}, not page 0 of 1.`);
  }
  if (entries.length === 0) gaps.push('The response lists no seasons.');
  return { entries, numEntries, complete: gaps.length === 0, gaps };
}

/** The year an entry names, or a reason it cannot be trusted. */
function yearOf(entry: AflApiCompSeasonEntry): { year: number } | { refusal: AflApiSeasonDiscoveryFinding } {
  const fromId = PROVIDER_ID_PATTERN.exec(entry.providerId)?.[1];
  const fromName = NAME_YEAR_PATTERN.exec(entry.name)?.[1];
  if (fromId === undefined || fromName === undefined) {
    return {
      refusal: {
        kind: 'unrecognised_entry', year: null,
        detail: `compSeason ${entry.id} (${entry.providerId}, "${entry.name}") does not fit the measured `
          + 'CD_S<YYYY>014 / "<YYYY> … AFL Premiership" shape.',
      },
    };
  }
  if (fromId !== fromName) {
    return {
      refusal: {
        kind: 'year_disagreement', year: null,
        detail: `compSeason ${entry.id}: providerId says ${fromId}, name says ${fromName}.`,
      },
    };
  }
  return { year: Number(fromId) };
}

/**
 * Compare a listing with the registered seasons and draft the proposal. Pure:
 * no file, no network, no clock. Same inputs, same document, byte for byte
 * once serialised with `serialiseAflApiSeasonDiscoveryProposal()`.
 */
export function proposeAflApiSeasons(input: {
  listing: AflApiCompSeasonsListing;
  registered: ReadonlyMap<number, RegisteredAflApiSeason>;
  source: { file: string; sha256: string };
}): AflApiSeasonDiscoveryProposal {
  const { listing, registered } = input;
  const findings: AflApiSeasonDiscoveryFinding[] = [];
  if (!listing.complete) {
    for (const gap of listing.gaps) findings.push({ kind: 'listing_incomplete', year: null, detail: gap });
  }

  const byYear = new Map<number, AflApiCompSeasonEntry[]>();
  for (const entry of listing.entries) {
    const resolved = yearOf(entry);
    if ('refusal' in resolved) {
      findings.push(resolved.refusal);
      continue;
    }
    byYear.set(resolved.year, [...(byYear.get(resolved.year) ?? []), entry]);
  }

  const registeredYears = [...registered.keys()].sort((a, b) => a - b);
  const minRegistered = registeredYears[0] ?? Number.POSITIVE_INFINITY;
  const maxRegistered = registeredYears[registeredYears.length - 1] ?? Number.NEGATIVE_INFINITY;

  const proposals: AflApiSeasonProposal[] = [];
  const confirmedRegistered: number[] = [];
  const historicalUnregistered: number[] = [];
  for (const year of [...byYear.keys()].sort((a, b) => a - b)) {
    const entries = byYear.get(year) ?? [];
    if (entries.length > 1) {
      findings.push({
        kind: 'duplicate_year', year,
        detail: `${entries.length} compSeasons name ${year}: ${entries.map((e) => `${e.id}/${e.providerId}`).join(', ')}.`,
      });
      continue;
    }
    const [entry] = entries;
    const known = registered.get(year);
    if (known !== undefined) {
      if (known.compSeasonId === entry.id && known.providerId === entry.providerId) {
        confirmedRegistered.push(year);
      } else {
        findings.push({
          kind: 'registered_mismatch', year,
          detail: `Registered ${year} is {compSeasonId ${known.compSeasonId}, providerId ${known.providerId}}; `
            + `the listing says {id ${entry.id}, providerId ${entry.providerId}}. Not rewritten.`,
        });
      }
    } else if (year > maxRegistered) {
      proposals.push({
        year, compSeasonId: entry.id, providerId: entry.providerId, name: entry.name,
        currentRoundNumber: entry.currentRoundNumber,
      });
    } else if (year < minRegistered) {
      historicalUnregistered.push(year);
    } else {
      findings.push({
        kind: 'unregistered_within_registered_range', year,
        detail: `${year} lies between registered ${minRegistered} and ${maxRegistered} but is not registered.`,
      });
    }
  }
  for (const year of registeredYears) {
    if (!byYear.has(year)) {
      findings.push({
        kind: 'registered_absent_from_listing', year,
        detail: `Registered ${year} does not appear in the listing (or its entry was refused above).`,
      });
    }
  }

  findings.sort((a, b) => (a.year ?? 0) - (b.year ?? 0) || a.kind.localeCompare(b.kind) || a.detail.localeCompare(b.detail));
  const refused = findings.length > 0;
  const accepted = refused ? [] : proposals;
  return {
    kind: AFL_API_SEASON_DISCOVERY_KIND,
    contract_version: AFL_API_SEASON_DISCOVERY_CONTRACT_VERSION,
    input: { file: input.source.file, sha256: input.source.sha256 },
    listing: {
      complete: listing.complete, numEntries: listing.numEntries, entries: listing.entries.length, gaps: listing.gaps,
    },
    verdict: refused ? 'refused' : accepted.length > 0 ? 'proposals' : 'no_change',
    proposals: accepted,
    identitiesSeasonsAdditions: Object.fromEntries(
      accepted.map((p) => [String(p.year), { compSeasonId: p.compSeasonId, providerId: p.providerId }]),
    ),
    confirmedRegistered,
    historicalUnregistered,
    findings,
  };
}

/** Stable bytes: two-space JSON, trailing newline, key order as constructed. */
export function serialiseAflApiSeasonDiscoveryProposal(proposal: AflApiSeasonDiscoveryProposal): string {
  return `${JSON.stringify(proposal, null, 2)}\n`;
}

/** The human-readable stdout summary. */
export function describeAflApiSeasonDiscovery(proposal: AflApiSeasonDiscoveryProposal): string[] {
  const lines = [
    `AFL API season discovery — ${proposal.input.file} (sha256 ${proposal.input.sha256})`,
    `  listing: ${proposal.listing.entries} season(s), `
      + (proposal.listing.complete ? 'complete' : `INCOMPLETE (${proposal.listing.gaps.join(' ')})`),
    `  registered and confirmed: ${proposal.confirmedRegistered.join(', ') || 'none'}`,
    `  historical, not registered, not proposed: ${proposal.historicalUnregistered.join(', ') || 'none'}`,
  ];
  for (const p of proposal.proposals) {
    lines.push(`  PROPOSE ${p.year}: {"compSeasonId": ${p.compSeasonId}, "providerId": "${p.providerId}"} (${p.name})`);
  }
  for (const f of proposal.findings) lines.push(`  FINDING ${f.kind}${f.year === null ? '' : ` ${f.year}`}: ${f.detail}`);
  lines.push(`  verdict: ${proposal.verdict.toUpperCase()}. Nothing was written to data/reference/.`);
  return lines;
}
