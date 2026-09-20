/**
 * AFLDB-ISSUE-228 S1 (§6.4 T4) — the AFL API round translation contract.
 *
 * `translateAflRound()` is the ONLY code path that turns one AFL API round
 * observation into AFLDB's `(round_code, round_number, round_type, is_final)`
 * triple. No offset arithmetic (`roundNumber + 1`) exists outside this
 * module: the emitter and the Brownlow emitter both call it, and a source
 * scan for a scattered offset is a registry acceptance test (§19.7f).
 *
 * The translation itself is driven entirely by the per-season explicit round
 * table declared in `data/reference/source-families.json`
 * (`round_vocabularies.afl_api_<year>`, parsed by `source-families.ts`). This
 * module adds no vocabulary of its own; it only interprets the declared
 * table and renders the same `round_code` vocabulary `createMatch()`
 * (`match-admin.ts`) and `renderRound()` (`admin-fixtures.ts`) already use,
 * via the shared constants in `@/lib/fixtures/spec` — so the three writers
 * cannot disagree.
 *
 * Pure: no filesystem, no database, no network. The caller supplies the
 * already-parsed registry and the observed round fields.
 */

import { FINALS_ROUND_CODES, type FixtureRoundType } from '@/lib/fixtures/spec';
import {
  type DeclaredRoundRow,
  type DeclaredRoundVocabulary,
  type SourceFamilyRegistry,
} from './source-families';

/**
 * §6.4's typed refusal table, verbatim:
 *   - `round_vocabulary_missing` — no `afl_api_<year>` vocabulary at all for
 *     the observed season. A run-level HALT before any DB connection.
 *   - `round_unmapped` — `api_round_number` is not a row in the declared
 *     table. A record rejection; the record stays in the enumeration.
 *   - `round_vocabulary_drift` — the observed `api_abbreviation`/`api_name`
 *     differ from the declared row for that `api_round_number`. A renamed
 *     round is a contract change, never a guess.
 *   - `finals_label_required` — the row is `mixed_finals` and
 *     `metadata.finals_match_label` is absent, or matches none of the row's
 *     `finalsLabelRules`. Covers both the 2026 case (label present but
 *     unrecognised) and the 2022–2024 case (no label published at all).
 *   - `round_inconsistent` — the label DID match a rule, but that same label
 *     would also match a rule on a DIFFERENT `mixed_finals` row in the same
 *     season's table. Two rows resolving one label is a badly-declared
 *     vocabulary, not a fact about the match, so this can only ever fire
 *     from registry drift, never from real 2026 data (its one `mixed_finals`
 *     row is unique per season).
 *   - `brownlow_round_not_home_and_away` — §6.4/§10's Brownlow-specific
 *     defensive refusal: the vote's `api_round_number` translates to a
 *     declared row whose `round_type` is not `home_and_away`. The Brownlow
 *     feed never publishes finals votes in practice (§2.5), so this is a
 *     belt-and-braces check, never a guess, raised only by
 *     `translateAflApiBrownlowRound()` below.
 */
export type AflRoundRefusalCode =
  | 'round_vocabulary_missing'
  | 'round_unmapped'
  | 'round_vocabulary_drift'
  | 'finals_label_required'
  | 'round_inconsistent'
  | 'brownlow_round_not_home_and_away';

export class AflRoundTranslationError extends Error {
  constructor(
    public readonly code: AflRoundRefusalCode,
    message: string,
  ) {
    super(message);
    this.name = 'AflRoundTranslationError';
  }
}

/** What the season-matches feed publishes for one match's round. */
export type ObservedAflRound = {
  apiRoundNumber: number;
  apiAbbreviation: string;
  apiName: string;
  /** `metadata.finals_match_label`, or `null` when the fixture carries none
   * (every 2022–2024 finals-week-1 sample, and every non-finals round). */
  finalsMatchLabel: string | null;
};

export type CanonicalRound = {
  roundCode: string;
  roundNumber: number | null;
  roundType: FixtureRoundType;
  isFinal: boolean;
};

function fail(code: AflRoundRefusalCode, message: string): never {
  throw new AflRoundTranslationError(code, message);
}

export function aflApiRoundVocabularyKey(season: number): string {
  return `afl_api_${season}`;
}

/**
 * Looks up the declared per-season table for `season`, or HALTs with
 * `round_vocabulary_missing`. Exported separately from `translateAflRound()`
 * so a caller (the future bundle emitter) can HALT a whole run before
 * opening a database connection, per §6.4's refusal table.
 */
export function getAflRoundVocabulary(
  registry: SourceFamilyRegistry, season: number,
): DeclaredRoundVocabulary {
  const key = aflApiRoundVocabularyKey(season);
  const vocabulary = registry.roundVocabularies.get(key);
  if (!vocabulary || vocabulary.shape !== 'declared') {
    fail(
      'round_vocabulary_missing',
      `No declared AFL API round vocabulary for season ${season} (expected `
      + `round_vocabularies.'${key}' with mapping_status 'declared').`,
    );
  }
  return vocabulary;
}

function finalRound(roundType: Exclude<FixtureRoundType, 'home_and_away'>): CanonicalRound {
  return { roundCode: FINALS_ROUND_CODES[roundType], roundNumber: null, roundType, isFinal: true };
}

function labelMatches(row: DeclaredRoundRow, label: string | null): boolean {
  if (label === null || row.finalsLabelRules === null) return false;
  return row.finalsLabelRules.some((rule) => label.includes(rule.contains));
}

/**
 * Translates one observed AFL API round into AFLDB's canonical round triple,
 * or throws `AflRoundTranslationError` with one of §6.4's typed refusal
 * codes. Never guesses: every branch either derives the answer from the
 * declared table or refuses.
 */
export function translateAflRound(
  registry: SourceFamilyRegistry, season: number, observed: ObservedAflRound,
): CanonicalRound {
  const vocabulary = getAflRoundVocabulary(registry, season);

  const row = vocabulary.rounds.find((r) => r.apiRoundNumber === observed.apiRoundNumber);
  if (!row) {
    fail(
      'round_unmapped',
      `Season ${season} round ${observed.apiRoundNumber} ('${observed.apiAbbreviation}') is not in `
      + `the declared vocabulary '${vocabulary.key}'.`,
    );
  }

  if (row.apiAbbreviation !== observed.apiAbbreviation || row.apiName !== observed.apiName) {
    fail(
      'round_vocabulary_drift',
      `Season ${season} round ${observed.apiRoundNumber} is declared as `
      + `('${row.apiAbbreviation}', '${row.apiName}') but was observed as `
      + `('${observed.apiAbbreviation}', '${observed.apiName}').`,
    );
  }

  const roundType = row.roundType;
  if (roundType === 'home_and_away') {
    const roundNumber = row.canonicalRoundNumber!;
    return { roundCode: String(roundNumber), roundNumber, roundType: 'home_and_away', isFinal: false };
  }

  if (roundType !== 'mixed_finals') {
    return finalRound(roundType);
  }

  const rule = row.finalsLabelRules!.find(
    (r) => observed.finalsMatchLabel !== null && observed.finalsMatchLabel.includes(r.contains),
  );
  if (!rule) {
    fail(
      'finals_label_required',
      `Season ${season} round ${observed.apiRoundNumber} ('${row.apiAbbreviation}') mixes finals `
      + `types and needs metadata.finals_match_label to contain one of: `
      + `${row.finalsLabelRules!.map((r) => `'${r.contains}'`).join(', ')}. Observed label: `
      + `${observed.finalsMatchLabel === null ? 'none' : `'${observed.finalsMatchLabel}'`}.`,
    );
  }

  // A label that resolves this row must not ALSO resolve a different
  // mixed_finals row in the same season — that would mean the same
  // observed label names two different rounds, which is a declaration
  // defect, not a fact this match can settle on its own.
  const alsoMatches = vocabulary.rounds.filter(
    (other) => other !== row && other.roundType === 'mixed_finals' && labelMatches(other, observed.finalsMatchLabel),
  );
  if (alsoMatches.length > 0) {
    fail(
      'round_inconsistent',
      `Season ${season} label '${observed.finalsMatchLabel}' matches round `
      + `${observed.apiRoundNumber} ('${row.apiAbbreviation}') and also round(s) `
      + `${alsoMatches.map((r) => `${r.apiRoundNumber} ('${r.apiAbbreviation}')`).join(', ')} in the same `
      + `season's vocabulary.`,
    );
  }

  return finalRound(rule.roundType);
}

/**
 * AFLDB-ISSUE-228 S7 (§6.4, §10) — the Brownlow-specific entry point onto
 * this module's one translation path. The `bfawards` feed publishes only
 * `api_round_number` (§2.5: no `abbreviation`, `name` or
 * `metadata.finals_match_label`), so there is nothing independent to compare
 * against a declared row the way `translateAflRound()`'s drift check does for
 * the season-matches feed. Rather than inventing a second offset-arithmetic
 * path (forbidden by §19.7f), this function looks the row up itself and
 * calls `translateAflRound()` with the DECLARED row's own `apiAbbreviation`/
 * `apiName` standing in for "observed" — drift detection is simply
 * unavailable for a feed that never publishes the field, not skipped by
 * choice — then defensively refuses anything that is not a home-and-away
 * round (`brownlow_round_not_home_and_away`, §6.4's Brownlow row): the feed
 * carries no finals votes in every captured season, but the settle must
 * refuse rather than assume that stays true. A `mixed_finals` row (2026's
 * `QE`) refuses one step earlier, as `finals_label_required` — passing
 * `finalsMatchLabel: null` can never satisfy `translateAflRound()`'s label
 * rule — which is an equally fail-closed outcome under a different code, not
 * a second guess.
 */
export function translateAflApiBrownlowRound(
  registry: SourceFamilyRegistry, season: number, apiRoundNumber: number,
): CanonicalRound {
  const vocabulary = getAflRoundVocabulary(registry, season);
  const row = vocabulary.rounds.find((r) => r.apiRoundNumber === apiRoundNumber);
  if (!row) {
    fail(
      'round_unmapped',
      `Season ${season} Brownlow round ${apiRoundNumber} is not in the declared vocabulary `
      + `'${vocabulary.key}'.`,
    );
  }
  const canonical = translateAflRound(registry, season, {
    apiRoundNumber,
    apiAbbreviation: row.apiAbbreviation,
    apiName: row.apiName,
    finalsMatchLabel: null,
  });
  if (canonical.roundType !== 'home_and_away') {
    fail(
      'brownlow_round_not_home_and_away',
      `Season ${season} Brownlow round ${apiRoundNumber} translates to round_type `
      + `'${canonical.roundType}' ('${row.apiAbbreviation}'), not home_and_away; Brownlow votes are `
      + 'never accepted for a final.',
    );
  }
  return canonical;
}
