/**
 * AFLDB V2 Stage 4 — SYNTHETIC fixtures shared by tests/v2-coleman-publication.test.ts and
 * tests/v2-coleman-publication-pglite.test.ts (a support module, not a test file).
 *
 * EVERYTHING HERE IS SYNTHETIC. There is no committed per-match goal data in this repository, so
 * every match, club, player, goal and profile path below is invented (`Synthetic_Player_*`); none of
 * it is a real season's result. Season 2024 is only a label: it is complete in the REAL season
 * registry (data/reference/seasons.json) and 2026 is the real in-progress season. The CONTRACT is the
 * real committed data/reference/coleman-derivation.json. The fixtures deliberately mirror the
 * builders in tests/v2-coleman.test.ts (same shape, same totals) so the two suites read alike.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { CapabilityViewer } from '@/lib/auth/capabilities';
import type { AuditedCorrection, SeasonRegistry } from '@afldb/domain';
import {
  COLEMAN_DERIVATION_VERSION,
  deriveColeman,
  parseColemanContract,
  type ColemanContract,
  type ColemanDerivation,
  type ColemanDerivationInput,
  type ColemanGoalFact,
  type ColemanIdentityRow,
  type ColemanMatchRow,
} from '@afldb/derived';

export const REGISTRY: SeasonRegistry = JSON.parse(
  readFileSync(join(__dirname, '..', 'data', 'reference', 'seasons.json'), 'utf8'),
);
export const CONTRACT: ColemanContract = parseColemanContract(JSON.parse(
  readFileSync(join(__dirname, '..', 'data', 'reference', 'coleman-derivation.json'), 'utf8'),
));

export const SEASON = 2024;
export const DERIVED_AT = '2026-10-19T00:00:00Z';

const SYNTH_PLAYERS = [
  { id: 11, letter: 'A', club: 1 },
  { id: 12, letter: 'B', club: 1 },
  { id: 13, letter: 'C', club: 2 },
  { id: 14, letter: 'D', club: 2 },
  { id: 15, letter: 'E', club: 3 },
  { id: 16, letter: 'F', club: 3 },
  { id: 17, letter: 'G', club: 4 },
  { id: 18, letter: 'H', club: 4 },
] as const;

export const SYNTH_FINALS_MATCH_ID = 5;
export const synthPath = (letter: string): string => `players/S/Synthetic_Player_${letter}.html`;

export function synthMatches(): ColemanMatchRow[] {
  return [
    { matchId: 1, season: SEASON, roundType: 'home_and_away', homeClubId: 1, awayClubId: 2 },
    { matchId: 2, season: SEASON, roundType: 'home_and_away', homeClubId: 3, awayClubId: 4 },
    { matchId: 3, season: SEASON, roundType: 'home_and_away', homeClubId: 1, awayClubId: 3 },
    { matchId: 4, season: SEASON, roundType: 'home_and_away', homeClubId: 2, awayClubId: 4 },
    { matchId: SYNTH_FINALS_MATCH_ID, season: SEASON, roundType: 'elimination_final', homeClubId: 1, awayClubId: 2 },
  ];
}

/** Home-and-away totals: A=5, B=2, C=3, D=2, E=3, F=1, G=3, H=0. Finals rows (match 5) never count. */
export const BASE_GOALS: Record<string, number | null> = {
  '11:1': 3, '11:3': 2, '11:5': 1,
  '12:1': 1, '12:3': 1,
  '13:1': 2, '13:4': 1, '13:5': 2,
  '14:4': 2,
  '15:2': 3,
  '16:3': 1,
  '17:2': 1, '17:4': 2,
};

/** Goal facts keyed `<playerId>:<matchId>`; unlisted (player, match) pairs of a club that played are 0. */
export function synthFacts(overrides: Record<string, number | null> = {}): ColemanGoalFact[] {
  const goals = { ...BASE_GOALS, ...overrides };
  const facts: ColemanGoalFact[] = [];
  for (const match of synthMatches()) {
    for (const player of SYNTH_PLAYERS) {
      if (player.club !== match.homeClubId && player.club !== match.awayClubId) continue;
      const key = `${player.id}:${match.matchId}`;
      facts.push({ matchId: match.matchId, playerId: player.id, clubId: player.club, goals: key in goals ? goals[key] : 0 });
    }
  }
  return facts;
}

export function synthIdentities(): ColemanIdentityRow[] {
  return SYNTH_PLAYERS.map((p) => ({
    playerId: p.id,
    matchMethod: 'afltables_profile_url',
    externalId: synthPath(p.letter),
    status: 'unique',
  }));
}

export function makeInput(over: Partial<ColemanDerivationInput> = {}): ColemanDerivationInput {
  return {
    contract: CONTRACT,
    season: SEASON,
    seasonState: { registry: REGISTRY, settled: true },
    matches: synthMatches(),
    playerMatchGoals: synthFacts(),
    identities: synthIdentities(),
    derivedAt: DERIVED_AT,
    derivationVersion: COLEMAN_DERIVATION_VERSION,
    ...over,
  };
}

/** Derive a SYNTHETIC input and return the derivation (throws if it is refused). */
export function derive(over: Partial<ColemanDerivationInput> = {}): ColemanDerivation {
  const outcome = deriveColeman(makeInput(over));
  if (!outcome.ok) throw new Error(`fixture refused: ${outcome.refusal.code}: ${outcome.refusal.message}`);
  return outcome.result;
}

export const CORRECTION_NOTE = 'SYNTHETIC: publish the derived Coleman result for the test season.';

/** A valid publication correction for `actorUserId` (the seal requires a 20..2000 character note). */
export function correction(over: Partial<AuditedCorrection> = {}): AuditedCorrection {
  return {
    workflow: 'derived_award_publication',
    actorUserId: 1,
    note: CORRECTION_NOTE,
    evidenceRef: 'SYNTHETIC-EVIDENCE-1',
    ...over,
  };
}

export const SUPER_ADMIN: CapabilityViewer = { role: 'super_admin', canManageAdmins: true };
export const ADMIN: CapabilityViewer = { role: 'admin', canManageAdmins: false };
export const CONTRIBUTOR: CapabilityViewer = { role: 'contributor', canManageAdmins: false };
