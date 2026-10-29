/**
 * V2-GAP-023 — the provider-team-to-club mapping the Brownlow reconciliation needs, derived from
 * authentic identifiers and existing club identities, and refused whole when it cannot be shown
 * to be complete, unambiguous and consistent.
 *
 * PURE: no database, no file system, no clock. The caller supplies the three evidence sets.
 *
 *  1. IDENTITIES — the committed provider team table (`data/reference/afl-api-identities.json`
 *     `teams`: `CD_T…` -> the repository's `clubs.legacy_club_hist` name, transcribed from the
 *     provider's own season feeds and never guessed). It is the PRIMARY source: it does not depend
 *     on any vote, so a vote's team id can later be checked against the match rather than the
 *     mapping being fitted to the vote.
 *  2. CLUBS — the `clubs` rows. A history name must resolve to exactly one club.
 *  3. FIXTURE EVIDENCE — for each voted provider match, the provider's own home and away team ids
 *     (the fixtures observation) beside the canonical match's home and away clubs. This is
 *     independent corroboration: a committed mapping that disagrees with the fixture is refused
 *     rather than preferred.
 *
 * Nothing is inferred from names, abbreviations or nicknames, and nothing is partially accepted: any
 * refusal withholds the whole mapping, because a mapping with one wrong team silently misreports
 * every vote cast for it.
 */

export interface ProviderTeamIdentity {
  providerTeamId: string;
  /** The committed `clubs.legacy_club_hist` name for the team. */
  legacyClubHist: string;
}

export interface ClubIdentity {
  clubId: number;
  legacyClubHist: string;
}

/** One voted match: the provider's two team ids and the canonical match's two clubs. */
export interface FixtureTeamEvidence {
  providerMatchId: string;
  matchId: number;
  providerHomeTeamId: string;
  providerAwayTeamId: string;
  homeClubId: number | null;
  awayClubId: number | null;
}

export const PROVIDER_TEAM_MAPPING_REFUSAL_CODES = [
  /** A provider team id that cast or received votes has no committed identity. */
  'provider_team_unmapped',
  /** The same provider team id is committed twice with different club history names. */
  'provider_team_identity_conflict',
  /** A committed history name resolves to no club. */
  'club_identity_unresolved',
  /** A committed history name resolves to more than one club. */
  'club_identity_ambiguous',
  /** Two provider team ids resolve to the same club. */
  'provider_teams_share_club',
  /** The fixture's provider team ids contradict the committed mapping. */
  'fixture_evidence_conflict',
  /** A fixture names a provider team id the committed table does not contain. */
  'fixture_team_unmapped',
] as const;
export type ProviderTeamMappingRefusalCode = (typeof PROVIDER_TEAM_MAPPING_REFUSAL_CODES)[number];

export interface ProviderTeamMappingRefusal {
  code: ProviderTeamMappingRefusalCode;
  providerTeamId: string | null;
  detail: string;
}

export interface ProviderTeamMappingEntry {
  providerTeamId: string;
  clubId: number;
  legacyClubHist: string;
  /** Fixture slots (home or away) of this team that agree with the mapping. */
  corroboratingSlots: number;
}

export type ProviderTeamClubMapping =
  | {
    ok: true;
    entries: readonly ProviderTeamMappingEntry[];
    byProviderTeam: ReadonlyMap<string, number>;
    /** Required provider team ids with no fixture slot to corroborate them (still mapped). */
    uncorroborated: readonly string[];
    fixtureMatches: number;
  }
  | { ok: false; refusals: readonly ProviderTeamMappingRefusal[]; fixtureMatches: number };

export interface DeriveProviderTeamClubMappingInput {
  /** The provider team ids the votes and leaderboard name; every one must be mapped. */
  requiredProviderTeamIds: readonly string[];
  identities: readonly ProviderTeamIdentity[];
  clubs: readonly ClubIdentity[];
  fixtureEvidence: readonly FixtureTeamEvidence[];
}

const refusalOrder = new Map<string, number>(PROVIDER_TEAM_MAPPING_REFUSAL_CODES.map((code, i) => [code, i]));

function compareRefusals(a: ProviderTeamMappingRefusal, b: ProviderTeamMappingRefusal): number {
  return (refusalOrder.get(a.code) ?? 0) - (refusalOrder.get(b.code) ?? 0)
    || (a.providerTeamId ?? '').localeCompare(b.providerTeamId ?? '')
    || a.detail.localeCompare(b.detail);
}

export function deriveProviderTeamClubMapping(input: DeriveProviderTeamClubMappingInput): ProviderTeamClubMapping {
  const refusals: ProviderTeamMappingRefusal[] = [];
  const refuse = (code: ProviderTeamMappingRefusalCode, providerTeamId: string | null, detail: string): void => {
    refusals.push({ code, providerTeamId, detail });
  };

  // 1. The committed identity table must be a function: one history name per provider team id.
  const histByTeam = new Map<string, string>();
  for (const identity of input.identities) {
    const existing = histByTeam.get(identity.providerTeamId);
    if (existing !== undefined && existing !== identity.legacyClubHist) {
      refuse('provider_team_identity_conflict', identity.providerTeamId,
        `committed twice, as '${existing}' and as '${identity.legacyClubHist}'`);
    } else {
      histByTeam.set(identity.providerTeamId, identity.legacyClubHist);
    }
  }

  // 2. Every history name resolves to exactly one existing club.
  const clubsByHist = new Map<string, number[]>();
  for (const club of input.clubs) {
    const ids = clubsByHist.get(club.legacyClubHist) ?? [];
    ids.push(club.clubId);
    clubsByHist.set(club.legacyClubHist, ids);
  }
  const clubByTeam = new Map<string, number>();
  for (const [providerTeamId, hist] of histByTeam) {
    const ids = clubsByHist.get(hist) ?? [];
    if (ids.length === 0) refuse('club_identity_unresolved', providerTeamId, `'${hist}' matches no club`);
    else if (ids.length > 1) refuse('club_identity_ambiguous', providerTeamId, `'${hist}' matches clubs ${[...ids].sort((a, b) => a - b).join(', ')}`);
    else clubByTeam.set(providerTeamId, ids[0]);
  }

  // 3. The mapping must be injective: one club per provider team id.
  const teamsByClub = new Map<number, string[]>();
  for (const [providerTeamId, clubId] of clubByTeam) {
    const teams = teamsByClub.get(clubId) ?? [];
    teams.push(providerTeamId);
    teamsByClub.set(clubId, teams);
  }
  for (const [clubId, teams] of teamsByClub) {
    if (teams.length > 1) {
      refuse('provider_teams_share_club', null, `club ${clubId} is the target of ${[...teams].sort().join(', ')}`);
    }
  }

  // 4. Every provider team the evidence names is mapped.
  const required = [...new Set(input.requiredProviderTeamIds)].sort();
  for (const providerTeamId of required) {
    if (!clubByTeam.has(providerTeamId) && !histByTeam.has(providerTeamId)) {
      refuse('provider_team_unmapped', providerTeamId, 'no committed identity');
    }
  }

  // 5. The fixtures corroborate the mapping slot by slot; a contradiction refuses it.
  const slots = new Map<string, number>();
  const conflicts = new Map<string, number>();
  for (const fixture of input.fixtureEvidence) {
    const pairs: ReadonlyArray<readonly [string, number | null]> = [
      [fixture.providerHomeTeamId, fixture.homeClubId],
      [fixture.providerAwayTeamId, fixture.awayClubId],
    ];
    for (const [providerTeamId, canonicalClubId] of pairs) {
      const mapped = clubByTeam.get(providerTeamId);
      if (mapped === undefined) {
        if (!histByTeam.has(providerTeamId)) {
          refuse('fixture_team_unmapped', providerTeamId, `named by fixture ${fixture.providerMatchId}`);
        }
        continue;
      }
      if (canonicalClubId === null) continue;
      if (mapped === canonicalClubId) slots.set(providerTeamId, (slots.get(providerTeamId) ?? 0) + 1);
      else conflicts.set(providerTeamId, (conflicts.get(providerTeamId) ?? 0) + 1);
    }
  }
  for (const [providerTeamId, count] of conflicts) {
    refuse('fixture_evidence_conflict', providerTeamId,
      `${count} fixture slot(s) name a club other than ${clubByTeam.get(providerTeamId)}`);
  }

  if (refusals.length > 0) {
    return { ok: false, refusals: refusals.sort(compareRefusals), fixtureMatches: input.fixtureEvidence.length };
  }

  const entries: ProviderTeamMappingEntry[] = [...clubByTeam]
    .map(([providerTeamId, clubId]) => ({
      providerTeamId,
      clubId,
      legacyClubHist: histByTeam.get(providerTeamId) as string,
      corroboratingSlots: slots.get(providerTeamId) ?? 0,
    }))
    .sort((a, b) => a.providerTeamId.localeCompare(b.providerTeamId));
  return {
    ok: true,
    entries,
    byProviderTeam: new Map(entries.map((entry) => [entry.providerTeamId, entry.clubId])),
    uncorroborated: required.filter((providerTeamId) => (slots.get(providerTeamId) ?? 0) === 0),
    fixtureMatches: input.fixtureEvidence.length,
  };
}
