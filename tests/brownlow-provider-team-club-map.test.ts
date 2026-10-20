/**
 * V2-GAP-023 - the provider-team-to-club mapping: derived whole from the committed identities and
 * the clubs, corroborated by the fixtures, and refused whole on any missing, ambiguous or
 * conflicting evidence. Pure: no database. The 18-team table is the committed
 * data/reference/afl-api-identities.json; clubs and fixtures here are SYNTHETIC.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  deriveProviderTeamClubMapping,
  type ClubIdentity,
  type FixtureTeamEvidence,
  type ProviderTeamIdentity,
} from '@/lib/brownlow/provider-team-club-map';
import {
  ProviderTeamIdentityError,
  loadProviderTeamIdentities,
  parseProviderTeamIdentities,
} from '@/lib/brownlow/provider-team-identities';

const IDENTITIES: ProviderTeamIdentity[] = [
  { providerTeamId: 'CD_T1', legacyClubHist: 'Alpha' },
  { providerTeamId: 'CD_T2', legacyClubHist: 'Beta' },
  { providerTeamId: 'CD_T3', legacyClubHist: 'Gamma' },
];
const CLUBS: ClubIdentity[] = [
  { clubId: 10, legacyClubHist: 'Alpha' },
  { clubId: 20, legacyClubHist: 'Beta' },
  { clubId: 30, legacyClubHist: 'Gamma' },
];
const FIXTURE: FixtureTeamEvidence = {
  providerMatchId: 'CD_M1', matchId: 100,
  providerHomeTeamId: 'CD_T1', providerAwayTeamId: 'CD_T2', homeClubId: 10, awayClubId: 20,
};

function derive(overrides: Partial<Parameters<typeof deriveProviderTeamClubMapping>[0]> = {}) {
  return deriveProviderTeamClubMapping({
    requiredProviderTeamIds: ['CD_T1', 'CD_T2', 'CD_T3'],
    identities: IDENTITIES, clubs: CLUBS, fixtureEvidence: [FIXTURE], ...overrides,
  });
}

function refusalCodes(result: ReturnType<typeof derive>): string[] {
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.refusals.map((refusal) => refusal.code);
}

describe('deriveProviderTeamClubMapping', () => {
  it('derives every committed team to exactly one club and counts the corroborating fixture slots', () => {
    const result = derive();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entries.map((e) => [e.providerTeamId, e.clubId, e.corroboratingSlots])).toEqual([
      ['CD_T1', 10, 1], ['CD_T2', 20, 1], ['CD_T3', 30, 0],
    ]);
    expect(result.byProviderTeam.get('CD_T2')).toBe(20);
    // A team no fixture speaks for is mapped but reported, never silently trusted as corroborated.
    expect(result.uncorroborated).toEqual(['CD_T3']);
  });

  it('refuses a team the votes name that has no committed identity', () => {
    expect(refusalCodes(derive({ requiredProviderTeamIds: ['CD_T1', 'CD_T9'] }))).toEqual(['provider_team_unmapped']);
  });

  it('refuses an identity committed twice with different histories', () => {
    expect(refusalCodes(derive({
      identities: [...IDENTITIES, { providerTeamId: 'CD_T1', legacyClubHist: 'Beta' }],
    }))).toEqual(['provider_team_identity_conflict']);
  });

  it('refuses a history name that matches no club, and one that matches several', () => {
    expect(refusalCodes(derive({ clubs: CLUBS.filter((club) => club.legacyClubHist !== 'Gamma') })))
      .toEqual(['club_identity_unresolved']);
    expect(refusalCodes(derive({ clubs: [...CLUBS, { clubId: 31, legacyClubHist: 'Gamma' }] })))
      .toEqual(['club_identity_ambiguous']);
  });

  it('refuses two provider teams that resolve to the same club', () => {
    expect(refusalCodes(derive({
      identities: [...IDENTITIES.slice(0, 2), { providerTeamId: 'CD_T3', legacyClubHist: 'Alpha' }],
    }))).toEqual(['provider_teams_share_club']);
  });

  it('refuses when a fixture contradicts the committed mapping instead of preferring either', () => {
    const result = derive({ fixtureEvidence: [{ ...FIXTURE, homeClubId: 20, awayClubId: 10 }] });
    expect(refusalCodes(result)).toEqual(['fixture_evidence_conflict', 'fixture_evidence_conflict']);
    if (!result.ok) expect(result.refusals.map((r) => r.providerTeamId)).toEqual(['CD_T1', 'CD_T2']);
  });

  it('refuses a fixture naming a provider team the committed table lacks', () => {
    expect(refusalCodes(derive({ fixtureEvidence: [{ ...FIXTURE, providerAwayTeamId: 'CD_T9' }] })))
      .toEqual(['fixture_team_unmapped']);
  });

  it('reports every refusal together, in a stable order, and applies none of the mapping', () => {
    const result = derive({
      requiredProviderTeamIds: ['CD_T1', 'CD_T9'],
      clubs: CLUBS.filter((club) => club.legacyClubHist !== 'Beta'),
    });
    expect(refusalCodes(result)).toEqual(['provider_team_unmapped', 'club_identity_unresolved']);
    expect(result).not.toHaveProperty('byProviderTeam');
  });

  it('does not treat a fixture whose canonical club is unknown as either support or conflict', () => {
    const result = derive({ fixtureEvidence: [{ ...FIXTURE, homeClubId: null }] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.uncorroborated).toEqual(['CD_T1', 'CD_T3']);
  });
});

describe('provider team identities file', () => {
  it('the committed table lists 18 distinct provider teams with distinct club histories', () => {
    const identities = loadProviderTeamIdentities(join(__dirname, '..'));
    expect(identities).toHaveLength(18);
    expect(new Set(identities.map((i) => i.providerTeamId)).size).toBe(18);
    expect(new Set(identities.map((i) => i.legacyClubHist)).size).toBe(18);
    const raw = JSON.parse(readFileSync(join(__dirname, '..', 'data', 'reference', 'afl-api-identities.json'), 'utf8'));
    expect(identities.map((i) => i.providerTeamId)).toEqual(
      Object.keys(raw.teams).filter((key) => !key.startsWith('$')).sort((a, b) => a.localeCompare(b)),
    );
  });

  it.each([
    ['a non-object', 'x'],
    ['no teams', {}],
    ['teams that is an array', { teams: [] }],
    ['an empty teams object', { teams: {} }],
    ['a malformed key', { teams: { T1: { hist: 'A' } } }],
    ['a missing history', { teams: { CD_T1: {} } }],
    ['a blank history', { teams: { CD_T1: { hist: '  ' } } }],
  ])('fails closed on %s', (_label, value) => {
    expect(() => parseProviderTeamIdentities(value)).toThrow(ProviderTeamIdentityError);
  });

  it('fails closed when the file cannot be read', () => {
    expect(() => loadProviderTeamIdentities(join(__dirname, 'does-not-exist'))).toThrow(ProviderTeamIdentityError);
  });
});
