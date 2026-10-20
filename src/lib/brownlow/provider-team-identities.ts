import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ProviderTeamIdentity } from './provider-team-club-map';

/**
 * Reads the committed provider team identities (`data/reference/afl-api-identities.json` `teams`:
 * `CD_T…` -> the repository's `clubs.legacy_club_hist`). The file is read on every call, like the
 * season registry (src/lib/seasons/sealed-seasons.ts), and `projectRoot` defaults to
 * `process.cwd()`, the repository root under `next start`.
 *
 * Fail closed: an unreadable or malformed file throws {@link ProviderTeamIdentityError}; a caller
 * must treat the mapping as unavailable, never as empty.
 */

export const PROVIDER_TEAM_IDENTITY_SEGMENTS = ['data', 'reference', 'afl-api-identities.json'] as const;

export class ProviderTeamIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderTeamIdentityError';
  }
}

/** Parse an already-`JSON.parse()`d identities file. Throws {@link ProviderTeamIdentityError}. */
export function parseProviderTeamIdentities(root: unknown): ProviderTeamIdentity[] {
  if (root === null || typeof root !== 'object' || Array.isArray(root)) {
    throw new ProviderTeamIdentityError('The provider identities file is not a JSON object.');
  }
  const teams = (root as Record<string, unknown>).teams;
  if (teams === null || typeof teams !== 'object' || Array.isArray(teams)) {
    throw new ProviderTeamIdentityError("The provider identities file has no 'teams' object.");
  }
  const identities: ProviderTeamIdentity[] = [];
  for (const [key, value] of Object.entries(teams as Record<string, unknown>)) {
    if (key.startsWith('$')) continue; // `$comment`
    const hist = value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>).hist
      : undefined;
    if (!/^CD_T[0-9]+$/.test(key) || typeof hist !== 'string' || hist.trim() === '') {
      throw new ProviderTeamIdentityError(`The provider team identity '${key}' is malformed.`);
    }
    identities.push({ providerTeamId: key, legacyClubHist: hist });
  }
  if (identities.length === 0) throw new ProviderTeamIdentityError('The provider identities file lists no teams.');
  return identities.sort((a, b) => a.providerTeamId.localeCompare(b.providerTeamId));
}

export function loadProviderTeamIdentities(projectRoot: string = process.cwd()): ProviderTeamIdentity[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(projectRoot, ...PROVIDER_TEAM_IDENTITY_SEGMENTS), 'utf8'));
  } catch (error) {
    throw new ProviderTeamIdentityError(
      `The provider team identities (${PROVIDER_TEAM_IDENTITY_SEGMENTS.join('/')}) could not be read: ${
        error instanceof Error ? error.message.split('\n')[0] : 'unknown error'
      }`,
    );
  }
  return parseProviderTeamIdentities(parsed);
}
