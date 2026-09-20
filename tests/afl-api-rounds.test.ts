/**
 * AFLDB-ISSUE-228 S1 (§6.4, T4) — the AFL API round translation contract.
 *
 * `translateAflRound()` is the ONLY code path allowed to turn an AFL API
 * round into AFLDB's canonical `(round_code, round_number, round_type,
 * is_final)`. These tests pin its five typed refusals against the FIVE
 * per-season explicit tables declared in `data/reference/source-families.json`
 * (§19.7), and replay it against every one of the 14 captured historical/2026
 * samples so the mapping is proven against real payloads, not just hand-built
 * fixtures. No database.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  aflApiRoundVocabularyKey,
  AflRoundTranslationError,
  type AflRoundRefusalCode,
  getAflRoundVocabulary,
  translateAflRound,
} from '@/lib/acquisition/afl-api-rounds';
import { parseSourceFamilyRegistry } from '@/lib/acquisition/source-families';

const root = join(__dirname, '..');
const registry = parseSourceFamilyRegistry(
  JSON.parse(readFileSync(join(root, 'data', 'reference', 'source-families.json'), 'utf8')),
);

/** Runs `fn` and returns the refusal code it threw, or fails the test if it
 * did not refuse at all (or refused with something other than
 * `AflRoundTranslationError`). */
function refusalCode(fn: () => unknown): AflRoundRefusalCode {
  try {
    fn();
  } catch (e) {
    if (e instanceof AflRoundTranslationError) return e.code;
    throw e;
  }
  throw new Error('expected translateAflRound to refuse, but it returned a value');
}

describe('translateAflRound (AFLDB-ISSUE-228 §6.4, §19.7)', () => {
  it('translates every declared 2026 round shape (§19.7a)', () => {
    expect(translateAflRound(registry, 2026, {
      apiRoundNumber: 0, apiAbbreviation: 'OR', apiName: 'Opening Round', finalsMatchLabel: null,
    })).toEqual({ roundCode: '1', roundNumber: 1, roundType: 'home_and_away', isFinal: false });

    expect(translateAflRound(registry, 2026, {
      apiRoundNumber: 24, apiAbbreviation: 'Rd 24', apiName: 'Round 24', finalsMatchLabel: null,
    })).toEqual({ roundCode: '25', roundNumber: 25, roundType: 'home_and_away', isFinal: false });

    expect(translateAflRound(registry, 2026, {
      apiRoundNumber: 25, apiAbbreviation: 'WF', apiName: 'Wildcard Finals',
      finalsMatchLabel: 'First Wildcard Final',
    })).toEqual({ roundCode: 'WF', roundNumber: null, roundType: 'wildcard_final', isFinal: true });

    expect(translateAflRound(registry, 2026, {
      apiRoundNumber: 26, apiAbbreviation: 'QE', apiName: 'Qualifying & Elimination Finals',
      finalsMatchLabel: 'First Qualifying Final',
    })).toEqual({ roundCode: 'QF', roundNumber: null, roundType: 'qualifying_final', isFinal: true });

    expect(translateAflRound(registry, 2026, {
      apiRoundNumber: 26, apiAbbreviation: 'QE', apiName: 'Qualifying & Elimination Finals',
      finalsMatchLabel: 'Second Elimination Final',
    })).toEqual({ roundCode: 'EF', roundNumber: null, roundType: 'elimination_final', isFinal: true });

    expect(translateAflRound(registry, 2026, {
      apiRoundNumber: 27, apiAbbreviation: 'SF', apiName: 'Semi Finals', finalsMatchLabel: 'First Semi Final',
    })).toEqual({ roundCode: 'SF', roundNumber: null, roundType: 'semi_final', isFinal: true });

    expect(translateAflRound(registry, 2026, {
      apiRoundNumber: 28, apiAbbreviation: 'PF', apiName: 'Preliminary Finals',
      finalsMatchLabel: 'First Preliminary Final',
    })).toEqual({ roundCode: 'PF', roundNumber: null, roundType: 'preliminary_final', isFinal: true });

    expect(translateAflRound(registry, 2026, {
      apiRoundNumber: 29, apiAbbreviation: 'GF', apiName: 'Grand Final',
      finalsMatchLabel: '2026 Toyota AFL Grand Final',
    })).toEqual({ roundCode: 'GF', roundNumber: null, roundType: 'grand_final', isFinal: true });
  });

  it('translates the 2022 shape (no Opening Round) and refuses its unlabelled finals week (§19.7b)', () => {
    expect(translateAflRound(registry, 2022, {
      apiRoundNumber: 1, apiAbbreviation: 'Rd 1', apiName: 'Round 1', finalsMatchLabel: null,
    })).toEqual({ roundCode: '1', roundNumber: 1, roundType: 'home_and_away', isFinal: false });

    expect(translateAflRound(registry, 2022, {
      apiRoundNumber: 23, apiAbbreviation: 'Rd 23', apiName: 'Round 23', finalsMatchLabel: null,
    })).toEqual({ roundCode: '23', roundNumber: 23, roundType: 'home_and_away', isFinal: false });

    // 2022 (and 2023/2024) publish no metadata.finals_match_label at all, so
    // the combined Qualifying/Elimination round can never split — the
    // documented §9 backtest limitation, asserted as a refusal, never a guess.
    expect(refusalCode(() => translateAflRound(registry, 2022, {
      apiRoundNumber: 24, apiAbbreviation: 'FW1', apiName: 'Finals Week 1', finalsMatchLabel: null,
    }))).toBe('finals_label_required');
  });

  it('HALTs before any DB connection when a season has no declared vocabulary (§19.7c)', () => {
    const observed = { apiRoundNumber: 1, apiAbbreviation: 'Rd 1', apiName: 'Round 1', finalsMatchLabel: null };
    expect(refusalCode(() => translateAflRound(registry, 2021, observed))).toBe('round_vocabulary_missing');
    expect(() => getAflRoundVocabulary(registry, 2021)).toThrow(/no declared afl api round vocabulary/i);
    expect(aflApiRoundVocabularyKey(2021)).toBe('afl_api_2021');
  });

  it('refuses an api_round_number outside the declared table (§19.7d)', () => {
    expect(refusalCode(() => translateAflRound(registry, 2026, {
      apiRoundNumber: 99, apiAbbreviation: 'Rd 99', apiName: 'Round 99', finalsMatchLabel: null,
    }))).toBe('round_unmapped');
    // The record stays present in an enumeration; only the record itself is
    // refused, never the whole season. Nothing about the OTHER, valid rounds
    // is affected by an unmapped one.
    expect(translateAflRound(registry, 2026, {
      apiRoundNumber: 0, apiAbbreviation: 'OR', apiName: 'Opening Round', finalsMatchLabel: null,
    }).roundType).toBe('home_and_away');
  });

  it('refuses a renamed round rather than translating it anyway (§19.7e)', () => {
    expect(refusalCode(() => translateAflRound(registry, 2026, {
      apiRoundNumber: 0, apiAbbreviation: 'OPR', apiName: 'Opening Round', finalsMatchLabel: null,
    }))).toBe('round_vocabulary_drift');
    expect(refusalCode(() => translateAflRound(registry, 2026, {
      apiRoundNumber: 0, apiAbbreviation: 'OR', apiName: 'Opener Round', finalsMatchLabel: null,
    }))).toBe('round_vocabulary_drift');
  });

  it('refuses a label that would also resolve a different mixed_finals round in the same season', () => {
    // A synthetic registry with a second (invalid) mixed_finals row sharing a
    // rule with the declared QE row: this can never happen from real 2026
    // data (one mixed_finals row per season), so it is exercised directly
    // against a hand-built vocabulary rather than the tracked registry.
    const raw = JSON.parse(readFileSync(join(root, 'data', 'reference', 'source-families.json'), 'utf8'));
    const vocab = raw.round_vocabularies.afl_api_2026;
    const mutated = {
      ...raw,
      round_vocabularies: {
        ...raw.round_vocabularies,
        afl_api_2026: {
          ...vocab,
          rounds: [
            ...vocab.rounds,
            {
              api_round_number: 30, api_abbreviation: 'X2', api_name: 'Extra Mixed Round',
              round_type: 'mixed_finals',
              finals_label_rules: [{ contains: 'Qualifying', round_type: 'semi_final' }],
            },
          ],
        },
      },
    };
    const ambiguous = parseSourceFamilyRegistry(mutated);
    expect(refusalCode(() => translateAflRound(ambiguous, 2026, {
      apiRoundNumber: 26, apiAbbreviation: 'QE', apiName: 'Qualifying & Elimination Finals',
      finalsMatchLabel: 'First Qualifying Final',
    }))).toBe('round_inconsistent');
  });

  it('has no scattered roundNumber offset outside afl-api-rounds.ts (§19.7f)', () => {
    // Scoped to the plausible homes for AFL API round-handling code, not the
    // whole repository: the offset this guards against is exactly the kind
    // of thing that would otherwise be reinvented in an emitter or a CLI.
    const scanDirs = [
      join(root, 'src', 'lib', 'acquisition'),
      join(root, 'tools', 'current-season'),
    ];
    const offsetPattern = /round\s*number\s*\+\s*1|round_number\s*\+\s*1/i;
    const hits: string[] = [];
    const walk = (dir: string): void => {
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = join(dir, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) { walk(full); continue; }
        if (!/\.(ts|tsx|py|R)$/.test(entry)) continue;
        if (entry === 'afl-api-rounds.ts') continue;
        const content = readFileSync(full, 'utf8');
        if (offsetPattern.test(content)) hits.push(full);
      }
    };
    for (const dir of scanDirs) walk(dir);
    expect(hits).toEqual([]);
  });

  /*
   * §9 assertion 2 / §19.7h — the 14 captured samples (12 historical, 2 from
   * the 2026 preliminary finals), each independently verified against the
   * season-matches file's own round object. Every one is a home-and-away or
   * a genuine (non-mixed) finals round, so this is the H&A/offset half of
   * the backtest; the QE/FW1 splitting behaviour is covered above.
   */
  it('translates all 14 captured samples to their folder round', () => {
    const cases: {
      season: number; apiRoundNumber: number; apiAbbreviation: string; apiName: string;
      expectedRoundNumber: number | null; expectedRoundType: string;
    }[] = [
      { season: 2022, apiRoundNumber: 8, apiAbbreviation: 'Rd 8', apiName: 'Round 8', expectedRoundNumber: 8, expectedRoundType: 'home_and_away' },
      { season: 2022, apiRoundNumber: 14, apiAbbreviation: 'Rd 14', apiName: 'Round 14', expectedRoundNumber: 14, expectedRoundType: 'home_and_away' },
      { season: 2022, apiRoundNumber: 19, apiAbbreviation: 'Rd 19', apiName: 'Round 19', expectedRoundNumber: 19, expectedRoundType: 'home_and_away' },
      { season: 2023, apiRoundNumber: 8, apiAbbreviation: 'Rd 8', apiName: 'Round 8', expectedRoundNumber: 8, expectedRoundType: 'home_and_away' },
      { season: 2023, apiRoundNumber: 9, apiAbbreviation: 'Rd 9', apiName: 'Round 9', expectedRoundNumber: 9, expectedRoundType: 'home_and_away' },
      // two 2023 R9 samples share one round; both are asserted for completeness.
      { season: 2023, apiRoundNumber: 9, apiAbbreviation: 'Rd 9', apiName: 'Round 9', expectedRoundNumber: 9, expectedRoundType: 'home_and_away' },
      { season: 2024, apiRoundNumber: 7, apiAbbreviation: 'Rd 7', apiName: 'Round 7', expectedRoundNumber: 8, expectedRoundType: 'home_and_away' },
      { season: 2024, apiRoundNumber: 18, apiAbbreviation: 'Rd 18', apiName: 'Round 18', expectedRoundNumber: 19, expectedRoundType: 'home_and_away' },
      { season: 2024, apiRoundNumber: 21, apiAbbreviation: 'Rd 21', apiName: 'Round 21', expectedRoundNumber: 22, expectedRoundType: 'home_and_away' },
      { season: 2025, apiRoundNumber: 8, apiAbbreviation: 'Rd 8', apiName: 'Round 8', expectedRoundNumber: 9, expectedRoundType: 'home_and_away' },
      { season: 2025, apiRoundNumber: 9, apiAbbreviation: 'Rd 9', apiName: 'Round 9', expectedRoundNumber: 10, expectedRoundType: 'home_and_away' },
      { season: 2025, apiRoundNumber: 23, apiAbbreviation: 'Rd 23', apiName: 'Round 23', expectedRoundNumber: 24, expectedRoundType: 'home_and_away' },
      { season: 2026, apiRoundNumber: 28, apiAbbreviation: 'PF', apiName: 'Preliminary Finals', expectedRoundNumber: null, expectedRoundType: 'preliminary_final' },
      { season: 2026, apiRoundNumber: 28, apiAbbreviation: 'PF', apiName: 'Preliminary Finals', expectedRoundNumber: null, expectedRoundType: 'preliminary_final' },
    ];
    expect(cases).toHaveLength(14);
    for (const c of cases) {
      const result = translateAflRound(registry, c.season, {
        apiRoundNumber: c.apiRoundNumber, apiAbbreviation: c.apiAbbreviation, apiName: c.apiName,
        finalsMatchLabel: c.expectedRoundType === 'home_and_away' ? null : 'First Preliminary Final',
      });
      expect(result.roundNumber).toBe(c.expectedRoundNumber);
      expect(result.roundType).toBe(c.expectedRoundType);
      expect(result.isFinal).toBe(c.expectedRoundType !== 'home_and_away');
    }
  });
});
