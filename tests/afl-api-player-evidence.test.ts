/**
 * AFLDB-ISSUE-228 S9 — DB-free contract tests for the full-season AFL API
 * player-identity evidence engine (`src/lib/acquisition/afl-api-player-evidence.ts`)
 * and for the shared snapshot reader the settle CLI refactor moved into
 * `src/lib/acquisition/afl-api-snapshot.ts`.
 *
 * Nothing here opens a database connection, makes a network request, or reads
 * an acquired snapshot from `data/sources/`. Every canonical row is synthetic.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  AFL_API_EVIDENCE_DATABASE,
  AFL_API_EVIDENCE_DSN_ENV,
  AFL_API_SEASON_EVIDENCE_MATCH_METHOD,
  AGREEMENT_STAT_COLUMNS,
  AflApiEvidenceTargetError,
  CORE_STAT_COLUMNS,
  EXISTING_CLAIM_COMPARISON_UNPROVED,
  MIN_MATCHES_FOR_LINK,
  MIN_SINGLE_MATCH_AGREEMENT,
  assertAflApiEvidenceDsn,
  assertAflApiEvidenceSession,
  buildAflApiPlayerEvidence,
  checkAflApiSnapshotCensus,
  compareAflApiExistingClaims,
  compareStatVectors,
  indexCanonicalJumpers,
  normaliseJumperNumber,
  normaliseSurname,
  readAflApiObservedPlayerNames,
  type AflApiCanonicalEvidenceRow,
  type AflApiEvidenceStatColumn,
  type AflApiMatchEvidenceInput,
  type AflApiProviderEvidenceRow,
} from '@/lib/acquisition/afl-api-player-evidence';
import {
  aflApiSnapshotManifestSha256,
  aflApiSnapshotRoot,
  aflApiUnitSourcesFrom,
  verifyAflApiSnapshotManifest,
} from '@/lib/acquisition/afl-api-snapshot';

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

type Stats = Partial<Record<AflApiEvidenceStatColumn, number | null>>;

/** A distinctive, all-non-zero, all-distinct 20-column vector. */
function stats(overrides: Stats = {}): Stats {
  const base: Stats = {};
  AGREEMENT_STAT_COLUMNS.forEach((column, index) => { base[column] = index + 1; });
  return { ...base, ...overrides };
}

/** All 13 core columns zero; the wider columns zero too. */
function zeroStats(overrides: Stats = {}): Stats {
  const base: Stats = {};
  for (const column of AGREEMENT_STAT_COLUMNS) base[column] = 0;
  return { ...base, ...overrides };
}

/** Only the 13 core columns present; every wider column NULL. */
function coreOnlyStats(): Stats {
  const base: Stats = {};
  AGREEMENT_STAT_COLUMNS.forEach((column, index) => {
    base[column] = (CORE_STAT_COLUMNS as readonly string[]).includes(column) ? index + 1 : null;
  });
  return base;
}

function providerRow(
  providerMatchId: string, providerPlayerId: string,
  overrides: Partial<AflApiProviderEvidenceRow> = {},
): AflApiProviderEvidenceRow {
  return {
    providerMatchId,
    providerPlayerId,
    clubId: 10,
    jumperNumber: 7,
    observedGivenName: 'Test',
    observedSurname: 'Player',
    stats: stats(),
    ...overrides,
  };
}

function canonicalRow(
  playerId: number, overrides: Partial<AflApiCanonicalEvidenceRow> = {},
): AflApiCanonicalEvidenceRow {
  return {
    playerId,
    clubId: 10,
    jumperNumberRaw: '7',
    surname: 'Player',
    stats: stats(),
    ...overrides,
  };
}

function match(
  providerMatchId: string, canonicalMatchId: number | null,
  providerRows: AflApiProviderEvidenceRow[], canonicalRows: AflApiCanonicalEvidenceRow[],
  unresolvedReason: string | null = null,
): AflApiMatchEvidenceInput {
  return { providerMatchId, canonicalMatchId, unresolvedReason, providerRows, canonicalRows };
}

function providerOf(result: ReturnType<typeof buildAflApiPlayerEvidence>, providerId: string) {
  const entry = result.providers.find((p) => p.providerId === providerId);
  if (entry === undefined) throw new Error(`no classification for ${providerId}`);
  return entry;
}

/* ------------------------------------------------------------------ *
 * 1. Two exact matches -> same player -> linked
 * ------------------------------------------------------------------ */

describe('S9 acceptance rule (a)/(c): multi-match exact evidence', () => {
  it('links a provider whose two exact matches both resolve to the same canonical player', () => {
    const result = buildAflApiPlayerEvidence([
      match('CD_M1', 1, [providerRow('CD_M1', 'CD_I1')], [canonicalRow(100)]),
      match('CD_M2', 2, [providerRow('CD_M2', 'CD_I1')], [canonicalRow(100)]),
    ]);

    const provider = providerOf(result, 'CD_I1');
    expect(provider.disposition).toBe('linked');
    expect(provider.candidatePlayerId).toBe(100);
    expect(provider.reason).toBeNull();
    expect(provider.matchedEvidenceCount).toBe(2);
    expect(provider.snapshotRowCount).toBe(2);
    expect(result.counters.providersLinked).toBe(1);
    expect(result.counters.playerMatchRowsCoveredByLinkedProviders).toBe(2);
    expect(result.counters.playerMatchRowsUncovered).toBe(0);
    expect(MIN_MATCHES_FOR_LINK).toBe(2);
  });

  it('still links on multi-match evidence when one of the matches is an all-zero vector', () => {
    // S9 hardening C is scoped to SINGLE-match evidence only: a zero game
    // alongside a qualifying exact match must not withhold anything.
    const result = buildAflApiPlayerEvidence([
      match('CD_M1', 1, [providerRow('CD_M1', 'CD_I1')], [canonicalRow(100)]),
      match('CD_M2', 2,
        [providerRow('CD_M2', 'CD_I1', { stats: zeroStats() })],
        [canonicalRow(100, { stats: zeroStats() })]),
    ]);

    const provider = providerOf(result, 'CD_I1');
    expect(provider.disposition).toBe('linked');
    expect(provider.matches.filter((hit) => hit.allZeroCoreVector)).toHaveLength(1);
    expect(result.counters.allZeroSingleMatchWithheld).toBe(0);
    expect(provider.evidenceSummary).toContain('1 of them an all-zero vector');
  });
});

/* ------------------------------------------------------------------ *
 * 2. One provider -> two canonical players -> contradictory
 * ------------------------------------------------------------------ */

describe('S9 acceptance rule (a): one provider id must map to one player', () => {
  it('withholds a provider whose matches resolve to two different canonical players', () => {
    const result = buildAflApiPlayerEvidence([
      match('CD_M1', 1, [providerRow('CD_M1', 'CD_I1')], [canonicalRow(100)]),
      match('CD_M2', 2, [providerRow('CD_M2', 'CD_I1')], [canonicalRow(200)]),
    ]);

    const provider = providerOf(result, 'CD_I1');
    expect(provider.disposition).toBe('contradictory');
    expect(provider.reason).toBe('multiple_candidate_players(100,200)');
    expect(provider.candidatePlayerId).toBeNull();
    expect(result.counters.providersContradictory).toBe(1);
    expect(provider.competingCandidates.map((c) => c.canonicalPlayerId)).toEqual([100, 200]);
    expect(provider.competingCandidates[0].providerMatchIds).toEqual(['CD_M1']);
    expect(provider.competingCandidates[1].providerMatchIds).toEqual(['CD_M2']);
  });
});

/* ------------------------------------------------------------------ *
 * 3. Two providers -> one canonical player -> both withheld
 * ------------------------------------------------------------------ */

describe('S9 acceptance rule (b): one canonical player must be claimed once', () => {
  it('withholds BOTH providers that claim the same canonical player, never arbitrating', () => {
    const result = buildAflApiPlayerEvidence([
      match('CD_M1', 1, [providerRow('CD_M1', 'CD_I1')], [canonicalRow(100)]),
      match('CD_M2', 2, [providerRow('CD_M2', 'CD_I2')], [canonicalRow(100)]),
    ]);

    for (const providerId of ['CD_I1', 'CD_I2']) {
      const provider = providerOf(result, providerId);
      expect(provider.disposition).toBe('contradictory');
      expect(provider.reason).toBe('shared_player_id(100: CD_I1, CD_I2)');
      expect(provider.candidatePlayerId).toBeNull();
      expect(provider.competingCandidates[0].competingProviderIds).toEqual(['CD_I1', 'CD_I2']);
    }
    expect(result.counters.providersLinked).toBe(0);
    expect(result.counters.providersContradictory).toBe(2);
  });
});

/* ------------------------------------------------------------------ *
 * 4 & 5. The single-match floor
 * ------------------------------------------------------------------ */

describe('S9 acceptance rule (c): the single-match floor', () => {
  it('links one strong non-zero match carrying well over the agreeing-statistic floor', () => {
    const result = buildAflApiPlayerEvidence([
      match('CD_M1', 1, [providerRow('CD_M1', 'CD_I1')], [canonicalRow(100)]),
    ]);

    const provider = providerOf(result, 'CD_I1');
    expect(provider.disposition).toBe('linked');
    expect(provider.candidatePlayerId).toBe(100);
    expect(provider.matches[0].agreeingStatCount).toBe(AGREEMENT_STAT_COLUMNS.length);
    expect(provider.matches[0].agreeingStatCount).toBeGreaterThanOrEqual(MIN_SINGLE_MATCH_AGREEMENT);
  });

  it(
    'retains the >=10 floor although a core-vector hit can never fall below 13 agreeing statistics',
    () => {
      // MEASURED CONTRACT FACT, recorded rather than assumed: a "matched
      // match" requires all 13 CORE columns non-NULL and exactly equal on both
      // sides, and CORE is a subset of the agreement set — so the minimum
      // achievable `agreeingStatCount` for any hit is 13. The S5 rule (c)
      // single-match clause (`>= 10`) is therefore retained unweakened but is
      // structurally non-binding; S9 hardening C (all-zero vectors) is the
      // only single-match gate that can actually withhold a hit.
      const comparison = compareStatVectors(coreOnlyStats(), coreOnlyStats());
      expect(comparison.coreAgrees).toBe(true);
      expect(comparison.agreeingStatCount).toBe(CORE_STAT_COLUMNS.length);
      expect(comparison.agreeingStatCount).toBe(13);
      expect(comparison.agreeingStatCount).toBeGreaterThanOrEqual(MIN_SINGLE_MATCH_AGREEMENT);

      const result = buildAflApiPlayerEvidence([
        match('CD_M1', 1,
          [providerRow('CD_M1', 'CD_I1', { stats: coreOnlyStats() })],
          [canonicalRow(100, { stats: coreOnlyStats() })]),
      ]);
      expect(providerOf(result, 'CD_I1').disposition).toBe('linked');
      expect(MIN_SINGLE_MATCH_AGREEMENT).toBe(10);
    },
  );
});

/* ------------------------------------------------------------------ *
 * 6. One all-zero single match -> unresolved (S9 hardening C)
 * ------------------------------------------------------------------ */

describe('S9 hardening C: an all-zero single-match vector is not distinguishing evidence', () => {
  it('withholds a provider whose only exact match is an all-zero core vector', () => {
    const result = buildAflApiPlayerEvidence([
      match('CD_M1', 1,
        [providerRow('CD_M1', 'CD_I1', { stats: zeroStats() })],
        [canonicalRow(100, { stats: zeroStats() })]),
    ]);

    const provider = providerOf(result, 'CD_I1');
    expect(provider.disposition).toBe('unresolved');
    expect(provider.reason).toMatch(/^all_zero_single_match_vector\(CD_M1, /);
    expect(provider.candidatePlayerId).toBeNull();
    expect(result.counters.allZeroSingleMatchWithheld).toBe(1);
    expect(result.counters.playerMatchRowsUncovered).toBe(1);
  });

  it('does not treat a vector that is merely low-scoring as all-zero', () => {
    const lowButNonZero = zeroStats({ kicks: 1 });
    const result = buildAflApiPlayerEvidence([
      match('CD_M1', 1,
        [providerRow('CD_M1', 'CD_I1', { stats: lowButNonZero })],
        [canonicalRow(100, { stats: lowButNonZero })]),
    ]);
    expect(providerOf(result, 'CD_I1').disposition).toBe('linked');
  });
});

/* ------------------------------------------------------------------ *
 * 7. A NULL core statistic contributes no exact hit
 * ------------------------------------------------------------------ */

describe('S9 core-vector completeness', () => {
  it('contributes no hit when a core column is NULL on either side', () => {
    const canonicalResult = buildAflApiPlayerEvidence([
      match('CD_M1', 1,
        [providerRow('CD_M1', 'CD_I1')],
        [canonicalRow(100, { stats: stats({ hitouts: null }) })]),
    ]);
    const provider = providerOf(canonicalResult, 'CD_I1');
    expect(provider.disposition).toBe('unresolved');
    expect(provider.reason).toBe('no_matching_evidence');
    expect(provider.unmatched).toEqual([{ providerMatchId: 'CD_M1', reason: 'core_stat_incomplete' }]);

    const providerSideResult = buildAflApiPlayerEvidence([
      match('CD_M1', 1,
        [providerRow('CD_M1', 'CD_I1', { stats: stats({ goal_assists: null }) })],
        [canonicalRow(100)]),
    ]);
    expect(providerOf(providerSideResult, 'CD_I1').unmatched[0].reason).toBe('core_stat_incomplete');
  });

  it('separates a genuine value disagreement from an incomplete vector', () => {
    const result = buildAflApiPlayerEvidence([
      match('CD_M1', 1,
        [providerRow('CD_M1', 'CD_I1')],
        [canonicalRow(100, { stats: stats({ kicks: 99 }) })]),
    ]);
    expect(providerOf(result, 'CD_I1').unmatched[0].reason).toBe('core_stat_mismatch');
  });

  it('never discovers a candidate by name: a different jumper is simply a miss', () => {
    const result = buildAflApiPlayerEvidence([
      match('CD_M1', 1,
        [providerRow('CD_M1', 'CD_I1', { jumperNumber: 7, observedSurname: 'Player' })],
        // Same surname, same club, same statistics — but jumper 8.
        [canonicalRow(100, { jumperNumberRaw: '8' })]),
    ]);
    const provider = providerOf(result, 'CD_I1');
    expect(provider.disposition).toBe('unresolved');
    expect(provider.matchedEvidenceCount).toBe(0);
    expect(provider.unmatched[0].reason).toBe('no_canonical_row_at_jumper');
  });
});

/* ------------------------------------------------------------------ *
 * 8. Surname disagreement -> unresolved (validation only)
 * ------------------------------------------------------------------ */

describe('S9 acceptance rule (d): surname equality is validation-only', () => {
  it('withholds an otherwise-accepted pair whose normalised surnames disagree', () => {
    const result = buildAflApiPlayerEvidence([
      match('CD_M1', 1, [providerRow('CD_M1', 'CD_I1')], [canonicalRow(100, { surname: 'Different' })]),
      match('CD_M2', 2, [providerRow('CD_M2', 'CD_I1')], [canonicalRow(100, { surname: 'Different' })]),
    ]);
    const provider = providerOf(result, 'CD_I1');
    expect(provider.disposition).toBe('unresolved');
    expect(provider.reason).toMatch(/^surname_disagrees\(/);
    expect(provider.candidatePlayerId).toBeNull();
    expect(provider.matchedEvidenceCount).toBe(2);
  });

  it('accepts accent, case and punctuation differences, which are not disagreements', () => {
    expect(normaliseSurname('O’Halloran')).toBe(normaliseSurname('ohalloran'));
    expect(normaliseSurname('Šimunić')).toBe('SIMUNIC');
    expect(normaliseSurname(null)).toBe('');

    const result = buildAflApiPlayerEvidence([
      match('CD_M1', 1,
        [providerRow('CD_M1', 'CD_I1', { observedSurname: "O'Halloran" })],
        [canonicalRow(100, { surname: 'OHalloran' })]),
    ]);
    expect(providerOf(result, 'CD_I1').disposition).toBe('linked');
  });

  it('treats a missing published surname as a disagreement, never a silent pass', () => {
    const result = buildAflApiPlayerEvidence([
      match('CD_M1', 1,
        [providerRow('CD_M1', 'CD_I1', { observedSurname: null, observedGivenName: null })],
        [canonicalRow(100)]),
    ]);
    const provider = providerOf(result, 'CD_I1');
    expect(provider.disposition).toBe('unresolved');
    expect(provider.reason).toMatch(/^surname_disagrees\(/);
    expect(provider.observedName).toBeNull();
  });

  // FAIL-CLOSED. `normaliseSurname(null)` is `''`, so a bare inequality test
  // would read two ABSENT surnames as agreement and link a pair that rule (d)
  // never actually validated. An empty normalisation on either side — or on
  // both — is a disagreement.
  it('treats a missing CANONICAL surname as a disagreement', () => {
    const result = buildAflApiPlayerEvidence([
      match('CD_M1', 1,
        [providerRow('CD_M1', 'CD_I1', { observedSurname: 'Player' })],
        [canonicalRow(100, { surname: null })]),
    ]);
    const provider = providerOf(result, 'CD_I1');
    expect(provider.disposition).toBe('unresolved');
    expect(provider.reason).toMatch(/^surname_disagrees\(/);
    expect(provider.candidatePlayerId).toBeNull();
    // The stat-vector evidence itself was sound — it is rule (d) that withheld.
    expect(provider.matchedEvidenceCount).toBe(1);
  });

  it('treats BOTH surnames missing as a disagreement, never as two equal empty strings', () => {
    expect(normaliseSurname(null)).toBe(normaliseSurname(null));

    const result = buildAflApiPlayerEvidence([
      match('CD_M1', 1,
        [providerRow('CD_M1', 'CD_I1', { observedSurname: null, observedGivenName: null })],
        [canonicalRow(100, { surname: null })]),
      match('CD_M2', 2,
        [providerRow('CD_M2', 'CD_I1', { observedSurname: null, observedGivenName: null })],
        [canonicalRow(100, { surname: null })]),
    ]);
    const provider = providerOf(result, 'CD_I1');
    expect(provider.disposition).toBe('unresolved');
    expect(provider.reason).toBe('surname_disagrees(observed=null, canonical=null)');
    expect(provider.candidatePlayerId).toBeNull();
    expect(provider.matchedEvidenceCount).toBe(2);
  });

  it('treats BOTH surnames empty, and a punctuation-only surname, as a disagreement', () => {
    expect(normaliseSurname('')).toBe('');
    expect(normaliseSurname("'-")).toBe('');

    const empty = buildAflApiPlayerEvidence([
      match('CD_M1', 1,
        [providerRow('CD_M1', 'CD_I1', { observedSurname: '' })],
        [canonicalRow(100, { surname: '' })]),
    ]);
    expect(providerOf(empty, 'CD_I1').disposition).toBe('unresolved');
    expect(providerOf(empty, 'CD_I1').reason).toMatch(/^surname_disagrees\(/);

    // Normalising to nothing is a "no value", not a comparable value.
    const punctuationOnly = buildAflApiPlayerEvidence([
      match('CD_M1', 1,
        [providerRow('CD_M1', 'CD_I1', { observedSurname: "'-" })],
        [canonicalRow(100, { surname: '.' })]),
    ]);
    expect(providerOf(punctuationOnly, 'CD_I1').disposition).toBe('unresolved');
  });

  it('still links two equal NON-EMPTY normalised surnames', () => {
    const result = buildAflApiPlayerEvidence([
      match('CD_M1', 1,
        [providerRow('CD_M1', 'CD_I1', { observedSurname: 'player' })],
        [canonicalRow(100, { surname: 'PLAYER' })]),
    ]);
    const provider = providerOf(result, 'CD_I1');
    expect(provider.disposition).toBe('linked');
    expect(provider.candidatePlayerId).toBe(100);
    expect(provider.canonicalSurname).toBe('PLAYER');
  });
});

/* ------------------------------------------------------------------ *
 * 9. Duplicate canonical (club, jumper) -> refusal (S9 hardening A)
 * ------------------------------------------------------------------ */

describe('S9 hardening A: a duplicate canonical (match, club, jumper) key refuses the match', () => {
  it('refuses the whole match rather than letting the last row win', () => {
    const result = buildAflApiPlayerEvidence([
      match('CD_M1', 1,
        [providerRow('CD_M1', 'CD_I1')],
        [canonicalRow(100), canonicalRow(200)]),
      match('CD_M2', 2, [providerRow('CD_M2', 'CD_I1')], [canonicalRow(100)]),
    ]);

    expect(result.counters.duplicateCanonicalJumperKeys).toBe(1);
    expect(result.counters.matchesRefusedDuplicateJumperKey).toBe(1);
    const refused = result.matches.find((m) => m.providerMatchId === 'CD_M1');
    expect(refused?.resolution).toBe('refused_duplicate_jumper_key');
    expect(refused?.duplicateJumperKeys).toEqual(['10|7']);

    const provider = providerOf(result, 'CD_I1');
    // The refused match contributed NO hit — the surviving single hit comes
    // from CD_M2 alone, and it is never silently attributed to 100 or 200.
    expect(provider.matchedEvidenceCount).toBe(1);
    expect(provider.matches[0].providerMatchId).toBe('CD_M2');
    expect(provider.unmatched.map((miss) => miss.reason))
      .toContain('duplicate_canonical_jumper_key(10|7)');
    // The rows of the refused match still count towards the snapshot census.
    expect(provider.snapshotRowCount).toBe(2);
  });

  it('removes a duplicated key from the lookup entirely, so it cannot be matched', () => {
    // The guarantee is intrinsic to the index, not only to the caller's
    // refusal: a duplicated (club, jumper) key identifies nobody, so it must
    // not remain available as a candidate lookup at all.
    const index = indexCanonicalJumpers([
      canonicalRow(100),
      canonicalRow(200),
      canonicalRow(300, { clubId: 20, jumperNumberRaw: '9' }),
    ]);
    expect(index.duplicateKeys).toEqual(['10|7']);
    expect(index.byClubJumper.has('10|7')).toBe(false);
    // The unambiguous key of the same index is untouched.
    expect(index.byClubJumper.get('20|9')?.playerId).toBe(300);
    expect(index.byClubJumper.size).toBe(1);
  });

  it('does not refuse a match where two clubs legitimately share a jumper number', () => {
    const result = buildAflApiPlayerEvidence([
      match('CD_M1', 1,
        [providerRow('CD_M1', 'CD_I1'), providerRow('CD_M1', 'CD_I2', { clubId: 20 })],
        [canonicalRow(100), canonicalRow(200, { clubId: 20 })]),
    ]);
    expect(result.counters.matchesRefusedDuplicateJumperKey).toBe(0);
    expect(providerOf(result, 'CD_I1').matches[0].canonicalPlayerId).toBe(100);
    expect(providerOf(result, 'CD_I2').matches[0].canonicalPlayerId).toBe(200);
  });
});

/* ------------------------------------------------------------------ *
 * 10 & 11. Jumper normalisation (S9 hardening B)
 * ------------------------------------------------------------------ */

describe('S9 hardening B: explicit jumper-number normalisation', () => {
  it('classifies every jumper form explicitly', () => {
    expect(normaliseJumperNumber(null)).toEqual({ kind: 'absent' });
    expect(normaliseJumperNumber(undefined)).toEqual({ kind: 'absent' });
    expect(normaliseJumperNumber('')).toEqual({ kind: 'absent' });
    expect(normaliseJumperNumber('   ')).toEqual({ kind: 'absent' });
    expect(normaliseJumperNumber('7')).toEqual({ kind: 'ok', value: 7 });
    expect(normaliseJumperNumber(' 42 ')).toEqual({ kind: 'ok', value: 42 });
    expect(normaliseJumperNumber('0')).toEqual({ kind: 'ok', value: 0 });
    expect(normaliseJumperNumber(7)).toEqual({ kind: 'ok', value: 7 });
    // A value that cannot be rendered back identically is never reinterpreted.
    expect(normaliseJumperNumber('07')).toEqual({ kind: 'nonstandard', raw: '07' });
    expect(normaliseJumperNumber('7A')).toEqual({ kind: 'nonstandard', raw: '7A' });
    expect(normaliseJumperNumber('N/A')).toEqual({ kind: 'nonstandard', raw: 'N/A' });
    expect(normaliseJumperNumber('-1')).toEqual({ kind: 'nonstandard', raw: '-1' });
    expect(normaliseJumperNumber('1000')).toEqual({ kind: 'nonstandard', raw: '1000' });
    expect(normaliseJumperNumber(-1)).toEqual({ kind: 'nonstandard', raw: '-1' });
    expect(normaliseJumperNumber(7.5)).toEqual({ kind: 'nonstandard', raw: '7.5' });
  });

  it('reports a malformed canonical jumper under its own reason, never a silent miss', () => {
    const result = buildAflApiPlayerEvidence([
      match('CD_M1', 1,
        [providerRow('CD_M1', 'CD_I1')],
        [canonicalRow(100, { jumperNumberRaw: '07' })]),
    ]);

    expect(result.counters.nonstandardCanonicalJumpers).toBe(1);
    const reported = result.matches[0].nonstandardJumpers;
    expect(reported).toEqual([{ playerId: 100, clubId: 10, raw: '07' }]);

    const provider = providerOf(result, 'CD_I1');
    expect(provider.disposition).toBe('unresolved');
    expect(provider.unmatched[0].reason)
      .toBe('no_canonical_row_at_jumper(nonstandard_canonical_jumper_present)');
  });

  it('reports an absent or malformed provider jumper under its own reason', () => {
    const result = buildAflApiPlayerEvidence([
      match('CD_M1', 1, [providerRow('CD_M1', 'CD_I1', { jumperNumber: null })], [canonicalRow(100)]),
      match('CD_M2', 2, [providerRow('CD_M2', 'CD_I2', { jumperNumber: -3 })], [canonicalRow(200)]),
    ]);
    expect(providerOf(result, 'CD_I1').unmatched[0].reason).toBe('absent_provider_jumper');
    expect(providerOf(result, 'CD_I2').unmatched[0].reason).toBe('nonstandard_provider_jumper(-3)');
  });

  it('counts an absent canonical jumper separately from a malformed one', () => {
    const index = indexCanonicalJumpers([
      canonicalRow(1, { jumperNumberRaw: null }),
      canonicalRow(2, { jumperNumberRaw: 'x' }),
      canonicalRow(3, { jumperNumberRaw: '9' }),
    ]);
    expect(index.absentJumpers).toBe(1);
    expect(index.nonstandardJumpers).toEqual([{ playerId: 2, clubId: 10, raw: 'x' }]);
    expect(index.duplicateKeys).toEqual([]);
    expect(index.byClubJumper.size).toBe(1);
  });

  it('reports a provider row whose team is neither side of the match', () => {
    const result = buildAflApiPlayerEvidence([
      match('CD_M1', 1, [providerRow('CD_M1', 'CD_I1', { clubId: null })], [canonicalRow(100)]),
    ]);
    expect(providerOf(result, 'CD_I1').unmatched[0].reason).toBe('provider_team_id_unknown');
  });
});

/* ------------------------------------------------------------------ *
 * Unresolved matches still classify every provider
 * ------------------------------------------------------------------ */

describe('S9 classification covers every provider id in the snapshot', () => {
  it('classifies providers seen only in matches that did not resolve canonically', () => {
    const result = buildAflApiPlayerEvidence([
      match('CD_M1', 1, [providerRow('CD_M1', 'CD_I1')], [canonicalRow(100)]),
      match('CD_M2', null, [providerRow('CD_M2', 'CD_I2')], [], 'no_canonical_match'),
    ]);

    expect(result.counters.canonicalMatchesResolved).toBe(1);
    expect(result.counters.canonicalMatchesUnresolved).toBe(1);
    expect(result.counters.snapshotDistinctProviderPlayers).toBe(2);
    expect(result.counters.snapshotPlayerMatchRows).toBe(2);

    const orphan = providerOf(result, 'CD_I2');
    expect(orphan.disposition).toBe('unresolved');
    expect(orphan.reason).toBe('no_matching_evidence');
    expect(orphan.unmatched).toEqual([
      { providerMatchId: 'CD_M2', reason: 'match_unresolved(no_canonical_match)' },
    ]);
    expect(result.counters.playerMatchRowsUncovered).toBe(1);
  });
});

/* ------------------------------------------------------------------ *
 * 12. Deterministic classification
 * ------------------------------------------------------------------ */

describe('S9 determinism', () => {
  it('produces byte-identical output regardless of input ordering', () => {
    const inputs: AflApiMatchEvidenceInput[] = [
      match('CD_M3', 3, [providerRow('CD_M3', 'CD_I3', { clubId: 20, jumperNumber: 12 })],
        [canonicalRow(300, { clubId: 20, jumperNumberRaw: '12' })]),
      match('CD_M1', 1,
        [providerRow('CD_M1', 'CD_I1'), providerRow('CD_M1', 'CD_I2', { jumperNumber: 8 })],
        [canonicalRow(100), canonicalRow(200, { jumperNumberRaw: '8' })]),
      match('CD_M2', null, [providerRow('CD_M2', 'CD_I9')], [], 'unproved_match_date'),
    ];

    const forward = JSON.stringify(buildAflApiPlayerEvidence(inputs));
    const reversed = JSON.stringify(buildAflApiPlayerEvidence([...inputs].reverse()));
    const shuffled = JSON.stringify(buildAflApiPlayerEvidence([inputs[1], inputs[2], inputs[0]]));
    expect(reversed).toBe(forward);
    expect(shuffled).toBe(forward);
  });

  it('sorts providers, hits and misses on stable keys', () => {
    const result = buildAflApiPlayerEvidence([
      match('CD_M2', 2, [providerRow('CD_M2', 'CD_I2')], [canonicalRow(200)]),
      match('CD_M1', 1, [providerRow('CD_M1', 'CD_I1')], [canonicalRow(100)]),
    ]);
    expect(result.providers.map((p) => p.providerId)).toEqual(['CD_I1', 'CD_I2']);
    expect(result.matches.map((m) => m.providerMatchId)).toEqual(['CD_M1', 'CD_M2']);
  });
});

/* ------------------------------------------------------------------ *
 * 13. The acceptance census is report-scoped, never a global constant
 * ------------------------------------------------------------------ */

describe('S9 acceptance-snapshot census gate', () => {
  const observed = { matches: 217, playerMatchRows: 9983, distinctProviderPlayers: 669 };

  it('is not applied at all when no expectation is supplied', () => {
    expect(checkAflApiSnapshotCensus({ matches: 1, playerMatchRows: 2, distinctProviderPlayers: 3 }, null))
      .toEqual({ ok: true, mismatches: [] });
  });

  it('passes when the supplied expectation matches', () => {
    expect(checkAflApiSnapshotCensus(observed, {
      matches: 217, playerMatchRows: 9983, distinctProviderPlayers: 669,
    })).toEqual({ ok: true, mismatches: [] });
  });

  it('names every mismatching figure', () => {
    const verdict = checkAflApiSnapshotCensus(observed, {
      matches: 216, playerMatchRows: 9063, distinctProviderPlayers: 577,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.mismatches).toHaveLength(3);
    expect(verdict.mismatches[0]).toContain('SNAPSHOT_MATCHES 217 != expected 216');
    expect(verdict.mismatches[1]).toContain('SNAPSHOT_PLAYER_MATCH_ROWS 9983 != expected 9063');
    expect(verdict.mismatches[2]).toContain('SNAPSHOT_DISTINCT_PROVIDER_PLAYERS 669 != expected 577');
  });

  it('hard-codes no acceptance-snapshot figure as a module constant', () => {
    // The 217/9,983/669 census belongs to ONE immutable snapshot, not to AFL
    // and not to this engine. If a future edit bakes it in, this fails.
    const source = readFileSync(
      join(__dirname, '..', 'src', 'lib', 'acquisition', 'afl-api-player-evidence.ts'), 'utf8',
    );
    for (const figure of ['217', '9983', '9,983', '669']) {
      expect(source).not.toContain(figure);
    }
  });
});

/* ------------------------------------------------------------------ *
 * 14. Database-target guards (pure)
 * ------------------------------------------------------------------ */

describe('S9 read-only DEV target guards', () => {
  it('names the dedicated read-only DEV DSN variable, never an elevated one', () => {
    expect(AFL_API_EVIDENCE_DSN_ENV).toBe('AFLDB_DEV_DATABASE_URL');
    expect(AFL_API_EVIDENCE_DATABASE).toBe('afldb_dev');
    expect(AFL_API_EVIDENCE_DSN_ENV).not.toBe('AFLDB_IMPORT_DATABASE_URL');
    expect(AFL_API_EVIDENCE_DSN_ENV).not.toBe('AFLDB_OWNER_DATABASE_URL');
  });

  it('refuses an unset, malformed or wrongly-targeted DSN before connecting', () => {
    expect(() => assertAflApiEvidenceDsn(undefined)).toThrow(AflApiEvidenceTargetError);
    expect(() => assertAflApiEvidenceDsn('   ')).toThrow(/is not set/);
    expect(() => assertAflApiEvidenceDsn('not-a-url')).toThrow(/not a valid URL/);
    expect(() => assertAflApiEvidenceDsn('mysql://u:p@h:3306/afldb_dev')).toThrow(/postgresql/);
    expect(() => assertAflApiEvidenceDsn('postgresql://u:p@h:5432/afldb_test'))
      .toThrow(/does not target \/afldb_dev/);
    expect(() => assertAflApiEvidenceDsn('postgresql://u:p@h:5432/afldb_prod'))
      .toThrow(/does not target \/afldb_dev/);
    expect(assertAflApiEvidenceDsn(' postgresql://u:p@h:5432/afldb_dev '))
      .toBe('postgresql://u:p@h:5432/afldb_dev');
    expect(assertAflApiEvidenceDsn('postgres://u:p@h:5432/afldb_dev'))
      .toBe('postgres://u:p@h:5432/afldb_dev');
  });

  it('never echoes the DSN (and therefore the password) in a refusal', () => {
    try {
      assertAflApiEvidenceDsn('postgresql://someuser:sup3rs3cret@host:5432/afldb_prod');
      throw new Error('expected a refusal');
    } catch (error) {
      expect((error as Error).message).not.toContain('sup3rs3cret');
      expect((error as Error).message).not.toContain('someuser');
    }
  });

  it('requires the LIVE session to prove all three facts', () => {
    const ok = {
      currentDatabase: 'afldb_dev', transactionReadOnly: 'on', defaultTransactionReadOnly: 'on',
    };
    expect(() => assertAflApiEvidenceSession(ok)).not.toThrow();
    expect(() => assertAflApiEvidenceSession({ ...ok, currentDatabase: 'afldb_test' }))
      .toThrow(/connected database is 'afldb_test'/);
    expect(() => assertAflApiEvidenceSession({ ...ok, currentDatabase: 'afldb_prod' }))
      .toThrow(/connected database is 'afldb_prod'/);
    expect(() => assertAflApiEvidenceSession({ ...ok, transactionReadOnly: 'off' }))
      .toThrow(/transaction_read_only is 'off'/);
    expect(() => assertAflApiEvidenceSession({ ...ok, defaultTransactionReadOnly: 'off' }))
      .toThrow(/default_transaction_read_only is 'off'/);
    expect(() => assertAflApiEvidenceSession({ ...ok, currentDatabase: undefined }))
      .toThrow(AflApiEvidenceTargetError);
  });
});

/* ------------------------------------------------------------------ *
 * Evidence-class identity and the unproved cross-database comparison
 * ------------------------------------------------------------------ */

describe('S9 evidence-class identity', () => {
  it('declares its own match_method, never the S5/S5b bootstrap classes', () => {
    expect(AFL_API_SEASON_EVIDENCE_MATCH_METHOD).toBe('afl_api_stat_vector_season');
    expect(AFL_API_SEASON_EVIDENCE_MATCH_METHOD).not.toBe('afl_api_stat_vector_bootstrap');
    expect(AFL_API_SEASON_EVIDENCE_MATCH_METHOD).not.toBe('afl_api_name_team_season_bootstrap');
  });

  it('compares provider-id SETS only and never claims cross-database id parity', () => {
    const result = buildAflApiPlayerEvidence([
      match('CD_M1', 1, [providerRow('CD_M1', 'CD_I1')], [canonicalRow(100)]),
      match('CD_M2', 2, [providerRow('CD_M2', 'CD_I2')], [canonicalRow(200)]),
      match('CD_M3', 3, [providerRow('CD_M3', 'CD_I3')], [canonicalRow(300)]),
      match('CD_M4', 4, [providerRow('CD_M4', 'CD_I3')], [canonicalRow(400)]),
    ]);

    const comparison = compareAflApiExistingClaims(result.providers, ['CD_I1', 'CD_I3', 'CD_I8']);
    expect(comparison.idParity).toBe(EXISTING_CLAIM_COMPARISON_UNPROVED);
    expect(comparison.idParity).toBe('unproved_cross_database_id_parity');
    expect(comparison.existingLinkedProviders).toBe(3);
    expect(comparison.bothLinked).toBe(1);
    expect(comparison.newlyLinked).toBe(1);
    expect(comparison.existingOnly).toEqual(['CD_I3', 'CD_I8']);
    expect(comparison.existingLinkedNowContradictory).toEqual(['CD_I3']);
    expect(Object.keys(comparison)).not.toContain('playerIdAgreements');
  });
});

/* ------------------------------------------------------------------ *
 * Observed names (validation-only input)
 * ------------------------------------------------------------------ */

describe('S9 observed player names', () => {
  it('reads names from the flat playerStats.player identity copy, both sides', () => {
    const names = readAflApiObservedPlayerNames({
      homeTeamPlayerStats: [{
        teamId: 'CD_T10',
        playerStats: {
          player: { playerId: 'CD_I1', playerName: { givenName: 'Sam', surname: 'Walsh' } },
        },
      }],
      awayTeamPlayerStats: [{
        teamId: 'CD_T20',
        playerStats: { player: { playerId: 'CD_I2', playerName: { surname: 'Bontempelli' } } },
      }],
    });
    expect(names.get('CD_I1')).toEqual({ givenName: 'Sam', surname: 'Walsh' });
    expect(names.get('CD_I2')).toEqual({ givenName: null, surname: 'Bontempelli' });
    expect(names.size).toBe(2);
  });

  it('returns nothing rather than throwing on an unexpected shape', () => {
    expect(readAflApiObservedPlayerNames(null).size).toBe(0);
    expect(readAflApiObservedPlayerNames({ homeTeamPlayerStats: 'nope' }).size).toBe(0);
    expect(readAflApiObservedPlayerNames({ homeTeamPlayerStats: [{}] }).size).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * 15. The moved snapshot helpers keep the settle CLI's exact behaviour
 * ------------------------------------------------------------------ */

describe('S9 refactor: the shared AFL API snapshot reader', () => {
  const roots: string[] = [];

  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  function snapshotFixture(options: {
    label?: string;
    manifestOverrides?: Record<string, unknown>;
    fileOverrides?: (files: { file: string; sha256: string; status?: string }[]) => void;
  } = {}): { projectRoot: string; snapshotDir: string; label: string } {
    const label = options.label ?? 'afl-api-2026-test';
    const projectRoot = mkdtempSync(join(tmpdir(), 'afldb-issue-228-s9-snapshot-'));
    roots.push(projectRoot);
    const snapshotDir = join(aflApiSnapshotRoot(projectRoot), label);
    mkdirSync(join(snapshotDir, 'CD_M20260100001'), { recursive: true });

    const payloads: Record<string, unknown> = {
      'CD_M20260100001/fixture.json': { providerId: 'CD_M20260100001' },
      'CD_M20260100001/match-roster.json': { match: { venueLocalStartTime: '2026-03-12T19:40:00' } },
      'CD_M20260100001/player-stats.json': { homeTeamPlayerStats: [], awayTeamPlayerStats: [] },
    };
    const files: { file: string; sha256: string; status?: string }[] = [];
    for (const [relative, body] of Object.entries(payloads)) {
      const text = `${JSON.stringify(body)}\n`;
      writeFileSync(join(snapshotDir, ...relative.split('/')), text, 'utf8');
      files.push({ file: relative, sha256: createHash('sha256').update(text).digest('hex') });
    }
    options.fileOverrides?.(files);

    writeFileSync(
      join(snapshotDir, 'manifest.json'),
      JSON.stringify({ source_key: 'afl_api', season: 2026, files, ...options.manifestOverrides }, null, 2),
      'utf8',
    );
    return { projectRoot, snapshotDir, label };
  }

  it('verifies every manifested file and discovers one unit per match directory', () => {
    const { snapshotDir } = snapshotFixture();
    const { manifest, files } = verifyAflApiSnapshotManifest(snapshotDir);
    expect(manifest.season).toBe(2026);
    expect(files).toHaveLength(3);

    const sources = aflApiUnitSourcesFrom(snapshotDir, files);
    expect(sources).toHaveLength(1);
    expect((sources[0].fixtureRaw as { providerId: string }).providerId).toBe('CD_M20260100001');
    expect(sources[0].rosterRaw).not.toBeNull();
    expect(sources[0].playerStatsRaw).not.toBeNull();
  });

  it('refuses a missing manifest, a missing file and a changed file, with the settle CLI messages', () => {
    const bare = mkdtempSync(join(tmpdir(), 'afldb-issue-228-s9-bare-'));
    roots.push(bare);
    expect(() => verifyAflApiSnapshotManifest(bare))
      .toThrow(/No manifest\.json under .* — the acquisition did not complete/);

    const missing = snapshotFixture({
      fileOverrides: (files) => { files.push({ file: 'CD_M20260100001/absent.json', sha256: 'x'.repeat(64) }); },
    });
    expect(() => verifyAflApiSnapshotManifest(missing.snapshotDir))
      .toThrow("Manifest names 'CD_M20260100001/absent.json' but it is not on disk.");

    const tampered = snapshotFixture();
    writeFileSync(
      join(tampered.snapshotDir, 'CD_M20260100001', 'fixture.json'),
      '{"providerId":"CD_M99999999999"}\n', 'utf8',
    );
    expect(() => verifyAflApiSnapshotManifest(tampered.snapshotDir))
      .toThrow(/has changed since acquisition \(sha256 mismatch\) — refusing to settle it\./);
  });

  it('refuses a foreign source_key and a --fixtures-only acquisition', () => {
    const foreign = snapshotFixture({ manifestOverrides: { source_key: 'afltables' } });
    expect(() => verifyAflApiSnapshotManifest(foreign.snapshotDir))
      .toThrow("manifest.json names source_key 'afltables', expected 'afl_api'.");

    const fixturesOnly = snapshotFixture({
      manifestOverrides: { acquisition_kind: 'afl_api_fixture_snapshot' },
    });
    expect(() => verifyAflApiSnapshotManifest(fixturesOnly.snapshotDir))
      .toThrow(/is a --fixtures-only acquisition/);
  });

  it("skips a 'fixture_absent' manifest entry without re-hashing it", () => {
    const { snapshotDir } = snapshotFixture({
      fileOverrides: (files) => {
        files.push({ file: 'CD_M20260100002/fixture.json', sha256: 'y'.repeat(64), status: 'fixture_absent' });
      },
    });
    const { files } = verifyAflApiSnapshotManifest(snapshotDir);
    expect(files).toHaveLength(4);
    // The absent entry still names a `fixture.json`, so it is discovered as a
    // match directory — and reading it would fail. Unit discovery is
    // unchanged from the settle CLI, so this documents the existing contract.
    expect(() => aflApiUnitSourcesFrom(snapshotDir, files)).toThrow();
  });

  it('reports the manifest\'s own sha256 for artefact provenance', () => {
    const { snapshotDir } = snapshotFixture();
    const expected = createHash('sha256')
      .update(readFileSync(join(snapshotDir, 'manifest.json')))
      .digest('hex');
    expect(aflApiSnapshotManifestSha256(snapshotDir)).toBe(expected);
    expect(aflApiSnapshotManifestSha256(snapshotDir)).toMatch(/^[0-9a-f]{64}$/);
  });
});
