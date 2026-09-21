/**
 * AFLDB-ISSUE-228 S9 — the full-season AFL API player-identity EVIDENCE
 * engine. Pure logic: no filesystem, no database, no network, no clock.
 *
 * WHAT THIS IS. Stage S5 proved a deterministic, name-free way to turn a
 * stable AFL provider player id (`CD_I…`) into a canonical `players.id`:
 * join the provider's own player-stat row to the canonical
 * `player_match_stats` row for the SAME resolved match, the SAME canonical
 * club and the SAME jumper number, and require EXACT equality of a 13-column
 * core statistic vector. S5 did that over 14 tracked sample matches, in
 * Python, against `afldb_test`. S9 needs the same evidence class over a FULL
 * season's acquired snapshot, against DEV canonical evidence — so the rules
 * are ported here, faithfully, as pure TypeScript that the thin CLI
 * (`tools/current-season/emit-afl-api-player-bridge.ts`) feeds from the
 * already-validated snapshot/bundle/match-identity stack.
 *
 * WHAT THIS IS NOT. This module never resolves a player by name. Names are
 * read for ONE purpose — the post-hoc surname-equality validation S5's rule
 * (d) already required — and a surname disagreement (which includes an ABSENT
 * surname on either side, or on both) WITHHOLDS an otherwise accepted pair; it
 * never promotes, discovers or ranks a candidate. There is
 * no fuzzy matching, no nickname handling and no scoring anywhere in this
 * file. The runtime resolver (`afl-api-player-resolver.ts`) is untouched by
 * this milestone and remains trusted-external-identity-only.
 *
 * THE CONTRACT (S5 §6.3 (a)-(d), unweakened, plus three S9 hardenings):
 *
 *   Candidate discovery — same resolved canonical match, same canonical club,
 *   same jumper number. Nothing else discovers a candidate.
 *
 *   (a) every matched match of a provider id maps to the same player_id;
 *   (b) that player_id is claimed by no other provider id;
 *   (c) >= 2 matched matches, OR 1 match with >= 10 non-NULL agreeing
 *       statistics;
 *   (d) normalised surname equality (validation only), fail-closed: an absent
 *       or empty surname on either side — including both — is a disagreement.
 *
 *   A "matched match" requires all 13 core columns non-NULL on BOTH sides and
 *   exactly equal.
 *
 *   S9 hardening A — duplicate canonical key. If a match's canonical
 *   `player_match_stats` rows contain more than one row for the same
 *   (match, club, jumper_number), that match's ENTIRE evidence path is
 *   refused. Never last-wins, never silently picked.
 *
 *   S9 hardening B — jumper format. Canonical `player_match_stats.jumper_number`
 *   is `text` (migration 004). It is parsed explicitly; an unparseable or
 *   non-canonical value is reported under its OWN reason and counter, never
 *   silently folded into "no matching player".
 *
 *   S9 hardening C — all-zero single-match vector. A provider whose ONLY
 *   evidence is a single match whose core vector is all zeros stays
 *   unresolved: an all-zero vector is not distinguishing evidence. Multi-match
 *   evidence is unaffected — one all-zero match among several qualifying
 *   exact matches does not withhold anything.
 *
 * DETERMINISM. Every output ordering is derived by sorting on stable keys
 * (provider id, provider match id, canonical player id), never on input
 * order or map iteration order.
 */

/* ------------------------------------------------------------------ *
 * Evidence class identity and provenance
 * ------------------------------------------------------------------ */

/**
 * This evidence class's `external_identities.match_method`. DELIBERATELY
 * distinct from S5's `afl_api_stat_vector_bootstrap` (14 tracked sample
 * matches, built against `afldb_test`) and from S5b's
 * `afl_api_name_team_season_bootstrap`: full-season DEV-bound evidence must
 * never be mislabelled as, or silently merged with, either of them.
 */
export const AFL_API_SEASON_EVIDENCE_MATCH_METHOD = 'afl_api_stat_vector_season';

/**
 * The claim comparison this milestone can and cannot make. The accepted S5/S5b
 * artefacts were built against `afldb_test`; this evidence is built against
 * `afldb_dev`. Numeric `players.id` parity between those two databases has NOT
 * been proven, so a numeric `candidate_player_id` equality across them is
 * neither a corroboration nor a contradiction — it is unproved. Reported as
 * this literal rather than guessed either way.
 */
export const EXISTING_CLAIM_COMPARISON_UNPROVED = 'unproved_cross_database_id_parity';

/** The ONE database this evidence class may be built from, by name. */
export const AFL_API_EVIDENCE_DATABASE = 'afldb_dev';

/**
 * The DSN environment variable the emitter reads. Deliberately the dedicated,
 * read-only-enforced DEV variable established by AFLDB-ISSUE-222's
 * `bridge_import_gate.py --target dev` — never `AFLDB_IMPORT_DATABASE_URL`
 * (the importer's elevated write role, whose target this reader must never
 * silently follow) and never `AFLDB_OWNER_DATABASE_URL` (migrations only).
 */
export const AFL_API_EVIDENCE_DSN_ENV = 'AFLDB_DEV_DATABASE_URL';

/* ------------------------------------------------------------------ *
 * The statistic vectors (S5 §6.3, unchanged)
 * ------------------------------------------------------------------ */

/**
 * The exact-equality core vector. Every entry is a canonical
 * `player_match_stats` column name; the AFL API projection carries the same
 * facts under camelCase names and the CLI maps them (§11.3's field-mapping
 * table).
 */
export const CORE_STAT_COLUMNS = [
  'kicks', 'handballs', 'marks', 'tackles', 'goals', 'behinds',
  'hitouts', 'frees_for', 'frees_against', 'inside_50s', 'clearances',
  'rebounds', 'goal_assists',
] as const;

/**
 * The wider comparable set, used ONLY for rule (c)'s "non-NULL agreeing
 * statistics" count on a single-match acceptance. A superset of
 * {@link CORE_STAT_COLUMNS} with the remaining columns both schemas carry.
 */
export const AGREEMENT_STAT_COLUMNS = [
  ...CORE_STAT_COLUMNS,
  'contested', 'uncontested', 'contested_marks', 'marks_inside_50',
  'one_percenters', 'bounces', 'clangers',
] as const;

export const MIN_MATCHES_FOR_LINK = 2;
export const MIN_SINGLE_MATCH_AGREEMENT = 10;

export type AflApiEvidenceStatColumn = (typeof AGREEMENT_STAT_COLUMNS)[number];

/** A partial map reads a missing column as NULL — never as agreement. */
export type AflApiEvidenceStats = Readonly<Partial<Record<AflApiEvidenceStatColumn, number | null>>>;

function statOf(stats: AflApiEvidenceStats, column: AflApiEvidenceStatColumn): number | null {
  const value = stats[column];
  return value === undefined ? null : value;
}

/* ------------------------------------------------------------------ *
 * Normalisation primitives
 * ------------------------------------------------------------------ */

/**
 * Strip accents and punctuation, uppercase. Comparison only — never a match
 * key, never a discovery key. Port of `build_afl_api_player_bridge.py`'s
 * `normalise_surname()`.
 *
 * An absent, empty or punctuation-only surname normalises to `''`. That is a
 * "no value", NOT a comparable value: rule (d) refuses an empty normalisation
 * outright rather than letting two of them compare equal.
 */
export function normaliseSurname(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
}

export type JumperNormalisation =
  /** No jumper number was published at all. */
  | { kind: 'absent' }
  /** A canonical, unambiguous jumper number. */
  | { kind: 'ok'; value: number }
  /** Present but not a canonical decimal integer — reported, never assumed. */
  | { kind: 'nonstandard'; raw: string };

const CANONICAL_JUMPER_RE = /^(0|[1-9][0-9]{0,2})$/;

/**
 * S9 hardening B. Canonical `player_match_stats.jumper_number` is free text;
 * the provider's own value arrives as an already-integral number (the S3
 * emitter's `numOrNull()` refuses a non-integral one). Both are normalised
 * through this ONE function so the two sides can never disagree about what a
 * jumper number is.
 *
 * `'07'`, `'7A'`, `'-1'` and `'1000'` are all `nonstandard`: a value this
 * function cannot render back identically is never silently reinterpreted.
 * Whitespace is trimmed first, so `' 42 '` is the canonical `42` and a
 * whitespace-only `'  '` is `absent` (the same as `''` and `null`), never
 * `nonstandard`.
 */
export function normaliseJumperNumber(raw: string | number | null | undefined): JumperNormalisation {
  if (raw === null || raw === undefined) return { kind: 'absent' };
  if (typeof raw === 'number') {
    if (!Number.isInteger(raw) || raw < 0 || raw > 999) return { kind: 'nonstandard', raw: String(raw) };
    return { kind: 'ok', value: raw };
  }
  const trimmed = raw.trim();
  if (trimmed === '') return { kind: 'absent' };
  if (!CANONICAL_JUMPER_RE.test(trimmed)) return { kind: 'nonstandard', raw };
  return { kind: 'ok', value: Number(trimmed) };
}

/* ------------------------------------------------------------------ *
 * Inputs
 * ------------------------------------------------------------------ */

/** One provider player-stat row of one match, already parsed by the S3 emitter. */
export type AflApiProviderEvidenceRow = {
  providerMatchId: string;
  providerPlayerId: string;
  /** The canonical club id the provider's `CD_T…` team resolved to (§6.2).
   * `null` when the row's `CD_T…` is neither of the match's own two teams —
   * reported as its own miss reason, never guessed at. */
  clubId: number | null;
  /** As published by the provider (already integral or null). */
  jumperNumber: number | null;
  /** Validation-only (rule (d)); never a discovery key. */
  observedGivenName: string | null;
  observedSurname: string | null;
  stats: AflApiEvidenceStats;
};

/** One canonical `player_match_stats` row of the resolved canonical match. */
export type AflApiCanonicalEvidenceRow = {
  playerId: number;
  clubId: number;
  /** Raw `player_match_stats.jumper_number` text, exactly as stored. */
  jumperNumberRaw: string | null;
  /** Validation-only (rule (d)). */
  surname: string | null;
  stats: AflApiEvidenceStats;
};

/**
 * One snapshot match. `canonicalMatchId === null` means the match itself did
 * not resolve to a canonical row — its provider rows still count towards the
 * snapshot census and are still classified, they simply contribute no
 * evidence.
 */
export type AflApiMatchEvidenceInput = {
  providerMatchId: string;
  canonicalMatchId: number | null;
  /** Non-null exactly when `canonicalMatchId` is null. */
  unresolvedReason: string | null;
  providerRows: readonly AflApiProviderEvidenceRow[];
  /** Empty when the match did not resolve. */
  canonicalRows: readonly AflApiCanonicalEvidenceRow[];
};

/* ------------------------------------------------------------------ *
 * Per-match canonical index (S9 hardening A + B)
 * ------------------------------------------------------------------ */

export type AflApiCanonicalJumperIndex = {
  /** `${clubId}|${jumperValue}` -> the one canonical row. */
  byClubJumper: ReadonlyMap<string, AflApiCanonicalEvidenceRow>;
  /** Distinct `${clubId}|${jumperValue}` keys carrying more than one row. */
  duplicateKeys: readonly string[];
  /** Canonical rows whose stored jumper text is not a canonical integer. */
  nonstandardJumpers: readonly { playerId: number; clubId: number; raw: string }[];
  /** Canonical rows with no jumper number at all. */
  absentJumpers: number;
  /** Clubs with at least one nonstandard jumper, for miss annotation. */
  clubsWithNonstandardJumper: ReadonlySet<number>;
};

function clubJumperKey(clubId: number, jumper: number): string {
  return `${clubId}|${jumper}`;
}

/**
 * Index one match's canonical rows by (club, jumper). Never last-wins: a
 * duplicated key is recorded in `duplicateKeys` and REMOVED from
 * `byClubJumper`, so an ambiguous key cannot be looked up as a candidate even
 * by a caller that forgets to check. The caller still refuses the whole match
 * — this makes the safety property intrinsic to the index rather than resting
 * on that refusal alone.
 */
export function indexCanonicalJumpers(
  rows: readonly AflApiCanonicalEvidenceRow[],
): AflApiCanonicalJumperIndex {
  const byClubJumper = new Map<string, AflApiCanonicalEvidenceRow>();
  const seenCounts = new Map<string, number>();
  const nonstandardJumpers: { playerId: number; clubId: number; raw: string }[] = [];
  const clubsWithNonstandardJumper = new Set<number>();
  let absentJumpers = 0;

  for (const row of rows) {
    const jumper = normaliseJumperNumber(row.jumperNumberRaw);
    if (jumper.kind === 'absent') {
      absentJumpers += 1;
      continue;
    }
    if (jumper.kind === 'nonstandard') {
      nonstandardJumpers.push({ playerId: row.playerId, clubId: row.clubId, raw: jumper.raw });
      clubsWithNonstandardJumper.add(row.clubId);
      continue;
    }
    const key = clubJumperKey(row.clubId, jumper.value);
    seenCounts.set(key, (seenCounts.get(key) ?? 0) + 1);
    byClubJumper.set(key, row);
  }

  const duplicateKeys = [...seenCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key]) => key)
    .sort();
  // A duplicated key identifies nobody. It stays REPORTED, but it stops being
  // available as a lookup.
  for (const key of duplicateKeys) byClubJumper.delete(key);

  return {
    byClubJumper,
    duplicateKeys,
    nonstandardJumpers: nonstandardJumpers.sort((a, b) => a.playerId - b.playerId),
    absentJumpers,
    clubsWithNonstandardJumper,
  };
}

/* ------------------------------------------------------------------ *
 * Per-row comparison
 * ------------------------------------------------------------------ */

export type AflApiVectorComparison = {
  /** All 13 core columns non-NULL on both sides and exactly equal. */
  coreAgrees: boolean;
  /** At least one of the 13 core columns is NULL on one or both sides. */
  coreIncomplete: boolean;
  /** Every one of the 13 core columns is zero on both sides. */
  allZeroCoreVector: boolean;
  /** Count over {@link AGREEMENT_STAT_COLUMNS} of non-NULL, equal pairs. */
  agreeingStatCount: number;
};

export function compareStatVectors(
  provider: AflApiEvidenceStats, canonical: AflApiEvidenceStats,
): AflApiVectorComparison {
  let coreAgrees = true;
  let coreIncomplete = false;
  let allZero = true;
  for (const column of CORE_STAT_COLUMNS) {
    const a = statOf(provider, column);
    const b = statOf(canonical, column);
    if (a === null || b === null) {
      coreIncomplete = true;
      coreAgrees = false;
      allZero = false;
      continue;
    }
    if (a !== b) coreAgrees = false;
    if (a !== 0 || b !== 0) allZero = false;
  }
  let agreeingStatCount = 0;
  for (const column of AGREEMENT_STAT_COLUMNS) {
    const a = statOf(provider, column);
    const b = statOf(canonical, column);
    if (a !== null && b !== null && a === b) agreeingStatCount += 1;
  }
  return {
    coreAgrees,
    coreIncomplete,
    allZeroCoreVector: coreAgrees && allZero,
    agreeingStatCount,
  };
}

/* ------------------------------------------------------------------ *
 * Accumulated evidence
 * ------------------------------------------------------------------ */

export type AflApiEvidenceHit = {
  providerMatchId: string;
  canonicalPlayerId: number;
  agreeingStatCount: number;
  allZeroCoreVector: boolean;
  canonicalSurname: string | null;
};

export type AflApiEvidenceMiss = {
  providerMatchId: string;
  reason: string;
};

export type AflApiProviderDisposition = 'linked' | 'unresolved' | 'contradictory';

export type AflApiProviderClassification = {
  providerId: string;
  observedName: string | null;
  observedSurname: string | null;
  /** Physical provider player-stat rows in the snapshot for this provider id. */
  snapshotRowCount: number;
  /** Matches that produced an exact core-vector hit. */
  matchedEvidenceCount: number;
  disposition: AflApiProviderDisposition;
  reason: string | null;
  candidatePlayerId: number | null;
  canonicalSurname: string | null;
  evidenceSummary: string | null;
  matches: readonly AflApiEvidenceHit[];
  unmatched: readonly AflApiEvidenceMiss[];
  /** Populated only for a `contradictory` disposition — the full competing set. */
  competingCandidates: readonly {
    canonicalPlayerId: number;
    providerMatchIds: readonly string[];
    competingProviderIds: readonly string[];
  }[];
};

export type AflApiPlayerEvidenceCounters = {
  /** Match units actually fed to this engine (a snapshot match whose bundle
   * failed to build never reaches here — the CLI counts those separately as
   * BUNDLE_BUILD_FAILURES and reports the manifest's own match census). */
  matchesEvaluated: number;
  snapshotPlayerMatchRows: number;
  snapshotDistinctProviderPlayers: number;
  canonicalMatchesResolved: number;
  canonicalMatchesUnresolved: number;
  canonicalPmsRowsRead: number;
  providersLinked: number;
  providersUnresolved: number;
  providersContradictory: number;
  playerMatchRowsCoveredByLinkedProviders: number;
  playerMatchRowsUncovered: number;
  duplicateCanonicalJumperKeys: number;
  matchesRefusedDuplicateJumperKey: number;
  nonstandardCanonicalJumpers: number;
  absentCanonicalJumpers: number;
  allZeroSingleMatchWithheld: number;
};

export type AflApiPlayerEvidenceResult = {
  counters: AflApiPlayerEvidenceCounters;
  /** Sorted by provider id. */
  providers: readonly AflApiProviderClassification[];
  /** Sorted by provider match id. */
  matches: readonly {
    providerMatchId: string;
    canonicalMatchId: number | null;
    resolution: 'resolved' | 'unresolved' | 'refused_duplicate_jumper_key';
    reason: string | null;
    canonicalRowsRead: number;
    duplicateJumperKeys: readonly string[];
    nonstandardJumpers: readonly { playerId: number; clubId: number; raw: string }[];
  }[];
};

type Accumulator = {
  providerId: string;
  observedGivenName: string | null;
  observedSurname: string | null;
  snapshotRowCount: number;
  hits: AflApiEvidenceHit[];
  misses: AflApiEvidenceMiss[];
};

function missReason(base: string, detail?: string): string {
  return detail === undefined ? base : `${base}(${detail})`;
}

/**
 * The whole engine. Deterministic: the same input always produces byte-identical
 * output, regardless of the order matches or rows are supplied in.
 */
export function buildAflApiPlayerEvidence(
  matches: readonly AflApiMatchEvidenceInput[],
): AflApiPlayerEvidenceResult {
  const accumulators = new Map<string, Accumulator>();
  const matchReports: AflApiPlayerEvidenceResult['matches'][number][] = [];

  let canonicalMatchesResolved = 0;
  let canonicalMatchesUnresolved = 0;
  let canonicalPmsRowsRead = 0;
  let duplicateCanonicalJumperKeys = 0;
  let matchesRefusedDuplicateJumperKey = 0;
  let nonstandardCanonicalJumpers = 0;
  let absentCanonicalJumpers = 0;

  const ordered = [...matches].sort((a, b) => a.providerMatchId.localeCompare(b.providerMatchId));

  for (const match of ordered) {
    const accumulatorFor = (row: AflApiProviderEvidenceRow): Accumulator => {
      let entry = accumulators.get(row.providerPlayerId);
      if (entry === undefined) {
        entry = {
          providerId: row.providerPlayerId,
          observedGivenName: row.observedGivenName,
          observedSurname: row.observedSurname,
          snapshotRowCount: 0,
          hits: [],
          misses: [],
        };
        accumulators.set(row.providerPlayerId, entry);
      } else if (entry.observedSurname === null && row.observedSurname !== null) {
        entry.observedGivenName = row.observedGivenName;
        entry.observedSurname = row.observedSurname;
      }
      entry.snapshotRowCount += 1;
      return entry;
    };

    if (match.canonicalMatchId === null) {
      canonicalMatchesUnresolved += 1;
      for (const row of match.providerRows) {
        accumulatorFor(row).misses.push({
          providerMatchId: match.providerMatchId,
          reason: missReason('match_unresolved', match.unresolvedReason ?? 'unknown'),
        });
      }
      matchReports.push({
        providerMatchId: match.providerMatchId,
        canonicalMatchId: null,
        resolution: 'unresolved',
        reason: match.unresolvedReason ?? 'unknown',
        canonicalRowsRead: 0,
        duplicateJumperKeys: [],
        nonstandardJumpers: [],
      });
      continue;
    }

    canonicalMatchesResolved += 1;
    canonicalPmsRowsRead += match.canonicalRows.length;
    const index = indexCanonicalJumpers(match.canonicalRows);
    nonstandardCanonicalJumpers += index.nonstandardJumpers.length;
    absentCanonicalJumpers += index.absentJumpers;

    if (index.duplicateKeys.length > 0) {
      // S9 hardening A: never last-wins. The whole match's evidence path is
      // refused, because a duplicated (match, club, jumper) key means this
      // match's canonical load cannot be trusted to identify anyone.
      duplicateCanonicalJumperKeys += index.duplicateKeys.length;
      matchesRefusedDuplicateJumperKey += 1;
      for (const row of match.providerRows) {
        accumulatorFor(row).misses.push({
          providerMatchId: match.providerMatchId,
          reason: missReason('duplicate_canonical_jumper_key', index.duplicateKeys.join(',')),
        });
      }
      matchReports.push({
        providerMatchId: match.providerMatchId,
        canonicalMatchId: match.canonicalMatchId,
        resolution: 'refused_duplicate_jumper_key',
        reason: `duplicate_canonical_jumper_key(${index.duplicateKeys.join(',')})`,
        canonicalRowsRead: match.canonicalRows.length,
        duplicateJumperKeys: index.duplicateKeys,
        nonstandardJumpers: index.nonstandardJumpers,
      });
      continue;
    }

    for (const row of match.providerRows) {
      const accumulator = accumulatorFor(row);
      if (row.clubId === null) {
        accumulator.misses.push({ providerMatchId: match.providerMatchId, reason: 'provider_team_id_unknown' });
        continue;
      }
      const jumper = normaliseJumperNumber(row.jumperNumber);
      if (jumper.kind === 'absent') {
        accumulator.misses.push({ providerMatchId: match.providerMatchId, reason: 'absent_provider_jumper' });
        continue;
      }
      if (jumper.kind === 'nonstandard') {
        accumulator.misses.push({
          providerMatchId: match.providerMatchId,
          reason: missReason('nonstandard_provider_jumper', jumper.raw),
        });
        continue;
      }

      const canonical = index.byClubJumper.get(clubJumperKey(row.clubId, jumper.value));
      if (canonical === undefined) {
        // S9 hardening B: a miss in a club that HAS an unparseable canonical
        // jumper is annotated as such, so a jumper-format problem can never
        // be mistaken for "this player simply did not play".
        accumulator.misses.push({
          providerMatchId: match.providerMatchId,
          reason: index.clubsWithNonstandardJumper.has(row.clubId)
            ? missReason('no_canonical_row_at_jumper', 'nonstandard_canonical_jumper_present')
            : 'no_canonical_row_at_jumper',
        });
        continue;
      }

      const comparison = compareStatVectors(row.stats, canonical.stats);
      if (!comparison.coreAgrees) {
        accumulator.misses.push({
          providerMatchId: match.providerMatchId,
          reason: comparison.coreIncomplete ? 'core_stat_incomplete' : 'core_stat_mismatch',
        });
        continue;
      }

      accumulator.hits.push({
        providerMatchId: match.providerMatchId,
        canonicalPlayerId: canonical.playerId,
        agreeingStatCount: comparison.agreeingStatCount,
        allZeroCoreVector: comparison.allZeroCoreVector,
        canonicalSurname: canonical.surname,
      });
    }

    matchReports.push({
      providerMatchId: match.providerMatchId,
      canonicalMatchId: match.canonicalMatchId,
      resolution: 'resolved',
      reason: null,
      canonicalRowsRead: match.canonicalRows.length,
      duplicateJumperKeys: [],
      nonstandardJumpers: index.nonstandardJumpers,
    });
  }

  const classifications = classifyAccumulators(accumulators);

  let providersLinked = 0;
  let providersUnresolved = 0;
  let providersContradictory = 0;
  let playerMatchRowsCoveredByLinkedProviders = 0;
  let snapshotPlayerMatchRows = 0;
  let allZeroSingleMatchWithheld = 0;

  for (const entry of classifications) {
    snapshotPlayerMatchRows += entry.snapshotRowCount;
    if (entry.disposition === 'linked') {
      providersLinked += 1;
      playerMatchRowsCoveredByLinkedProviders += entry.snapshotRowCount;
    } else if (entry.disposition === 'contradictory') {
      providersContradictory += 1;
    } else {
      providersUnresolved += 1;
      if (entry.reason?.startsWith('all_zero_single_match_vector')) allZeroSingleMatchWithheld += 1;
    }
  }

  return {
    counters: {
      matchesEvaluated: ordered.length,
      snapshotPlayerMatchRows,
      snapshotDistinctProviderPlayers: classifications.length,
      canonicalMatchesResolved,
      canonicalMatchesUnresolved,
      canonicalPmsRowsRead,
      providersLinked,
      providersUnresolved,
      providersContradictory,
      playerMatchRowsCoveredByLinkedProviders,
      playerMatchRowsUncovered: snapshotPlayerMatchRows - playerMatchRowsCoveredByLinkedProviders,
      duplicateCanonicalJumperKeys,
      matchesRefusedDuplicateJumperKey,
      nonstandardCanonicalJumpers,
      absentCanonicalJumpers,
      allZeroSingleMatchWithheld,
    },
    providers: classifications,
    matches: matchReports.sort((a, b) => a.providerMatchId.localeCompare(b.providerMatchId)),
  };
}

/* ------------------------------------------------------------------ *
 * Classification — S5 §6.3 (a)-(d), applied in the same order, plus
 * hardening C.
 * ------------------------------------------------------------------ */

function classifyAccumulators(
  accumulators: ReadonlyMap<string, Accumulator>,
): AflApiProviderClassification[] {
  const providerIds = [...accumulators.keys()].sort();

  // Pass 1 — rule (a): one provider id must map to exactly one player_id.
  const provisional = new Map<string, number>();
  const reasons = new Map<string, string>();
  const contradictory = new Set<string>();
  const competing = new Map<string, AflApiProviderClassification['competingCandidates'][number][]>();

  for (const providerId of providerIds) {
    const evidence = accumulators.get(providerId) as Accumulator;
    const candidateIds = [...new Set(evidence.hits.map((hit) => hit.canonicalPlayerId))].sort((a, b) => a - b);
    if (candidateIds.length === 0) {
      reasons.set(providerId, 'no_matching_evidence');
      continue;
    }
    if (candidateIds.length > 1) {
      reasons.set(providerId, `multiple_candidate_players(${candidateIds.join(',')})`);
      contradictory.add(providerId);
      competing.set(providerId, candidateIds.map((playerId) => ({
        canonicalPlayerId: playerId,
        providerMatchIds: evidence.hits
          .filter((hit) => hit.canonicalPlayerId === playerId)
          .map((hit) => hit.providerMatchId)
          .sort(),
        competingProviderIds: [providerId],
      })));
      continue;
    }
    provisional.set(providerId, candidateIds[0]);
  }

  // Rule (b) — one player_id must be claimed by no other provider id. A
  // shared player_id voids ALL of its claimants: both are withheld, never
  // arbitrated.
  const byPlayer = new Map<number, string[]>();
  for (const [providerId, playerId] of provisional) {
    const list = byPlayer.get(playerId);
    if (list === undefined) byPlayer.set(playerId, [providerId]);
    else list.push(providerId);
  }
  for (const [playerId, claimants] of byPlayer) {
    if (claimants.length < 2) continue;
    const sortedClaimants = [...claimants].sort();
    for (const providerId of sortedClaimants) {
      const evidence = accumulators.get(providerId) as Accumulator;
      reasons.set(providerId, `shared_player_id(${playerId}: ${sortedClaimants.join(', ')})`);
      contradictory.add(providerId);
      competing.set(providerId, [{
        canonicalPlayerId: playerId,
        providerMatchIds: evidence.hits.map((hit) => hit.providerMatchId).sort(),
        competingProviderIds: sortedClaimants,
      }]);
      provisional.delete(providerId);
    }
  }

  const out: AflApiProviderClassification[] = [];
  for (const providerId of providerIds) {
    const evidence = accumulators.get(providerId) as Accumulator;
    const observedName = [evidence.observedGivenName, evidence.observedSurname]
      .filter((part): part is string => Boolean(part))
      .join(' ') || null;
    const base = {
      providerId,
      observedName,
      observedSurname: evidence.observedSurname,
      snapshotRowCount: evidence.snapshotRowCount,
      matchedEvidenceCount: evidence.hits.length,
      matches: [...evidence.hits].sort(
        (a, b) => a.providerMatchId.localeCompare(b.providerMatchId) || a.canonicalPlayerId - b.canonicalPlayerId,
      ),
      unmatched: [...evidence.misses].sort(
        (a, b) => a.providerMatchId.localeCompare(b.providerMatchId) || a.reason.localeCompare(b.reason),
      ),
      candidatePlayerId: null as number | null,
      canonicalSurname: null as string | null,
      evidenceSummary: null as string | null,
      competingCandidates: competing.get(providerId) ?? [],
    };

    const playerId = provisional.get(providerId);
    if (playerId === undefined) {
      out.push({
        ...base,
        disposition: contradictory.has(providerId) ? 'contradictory' : 'unresolved',
        reason: reasons.get(providerId) ?? 'no_matching_evidence',
      });
      continue;
    }

    const hits = evidence.hits;
    const bestAgree = hits.reduce((best, hit) => Math.max(best, hit.agreeingStatCount), 0);
    const canonicalSurname = hits[0]?.canonicalSurname ?? null;

    // Rule (c), with S9 hardening C folded into the single-match branch only.
    if (hits.length < MIN_MATCHES_FOR_LINK) {
      if (hits.length === 1 && hits[0].allZeroCoreVector) {
        out.push({
          ...base,
          disposition: 'unresolved',
          reason: `all_zero_single_match_vector(${hits[0].providerMatchId}, `
            + `${hits[0].agreeingStatCount} agreeing stats)`,
        });
        continue;
      }
      if (bestAgree < MIN_SINGLE_MATCH_AGREEMENT) {
        out.push({
          ...base,
          disposition: 'unresolved',
          reason: `insufficient_evidence(${hits.length} match(es), best ${bestAgree} agreeing stats)`,
        });
        continue;
      }
    }

    // Rule (d) — validation only, after stat-vector resolution. FAIL-CLOSED on
    // an absent surname, on EITHER side and on BOTH: `normaliseSurname(null)`
    // is `''`, so a bare inequality test would read two missing surnames as
    // agreement and let the pair through on no validation at all. An empty
    // normalisation is never equality here; only two equal NON-EMPTY
    // normalised surnames pass.
    const canonicalKey = normaliseSurname(canonicalSurname);
    const observedKey = normaliseSurname(evidence.observedSurname);
    if (canonicalKey === '' || observedKey === '' || canonicalKey !== observedKey) {
      out.push({
        ...base,
        disposition: 'unresolved',
        reason: `surname_disagrees(observed=${JSON.stringify(evidence.observedSurname)}, `
          + `canonical=${JSON.stringify(canonicalSurname)})`,
      });
      continue;
    }

    const totalAgreeing = hits.reduce((sum, hit) => sum + hit.agreeingStatCount, 0);
    const allZeroHits = hits.filter((hit) => hit.allZeroCoreVector).length;
    out.push({
      ...base,
      disposition: 'linked',
      reason: null,
      candidatePlayerId: playerId,
      canonicalSurname,
      evidenceSummary: `${hits.length} match(es), ${totalAgreeing} total agreeing statistic(s), `
        + 'core stat vector exact on every matched game'
        + (allZeroHits > 0 ? `, ${allZeroHits} of them an all-zero vector` : ''),
    });
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * Observed player names (validation-only input)
 * ------------------------------------------------------------------ */

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * The provider's own published player names, keyed by `CD_I…`.
 *
 * `emitAflApiPlayerMatchStats()` deliberately does NOT project a player's
 * name — names are never part of the canonical player-stat projection, and
 * this milestone does not change that. Rule (d) still needs the published
 * surname for its VALIDATION-ONLY check, so it is read here, from the same
 * flat `playerStats.player.*` identity copy the emitter's own doc comment
 * pins (never the position-bearing `player.player.*` copy).
 *
 * Deliberately lenient: the payload's shape is already proven by the emitter,
 * which refuses first. A name this reader cannot find reads as `null`, which
 * rule (d) treats as a disagreement — fail-closed, never a silent pass, and
 * that holds even when the canonical side has no surname either.
 */
export function readAflApiObservedPlayerNames(
  raw: unknown,
): Map<string, { givenName: string | null; surname: string | null }> {
  const out = new Map<string, { givenName: string | null; surname: string | null }>();
  const root = asRecord(raw);
  if (root === null) return out;
  for (const sideKey of ['homeTeamPlayerStats', 'awayTeamPlayerStats'] as const) {
    const side = root[sideKey];
    if (!Array.isArray(side)) continue;
    for (const entryRaw of side) {
      const entry = asRecord(entryRaw);
      const block = entry === null ? null : asRecord(entry.playerStats);
      const player = block === null ? null : asRecord(block.player);
      if (player === null) continue;
      const playerId = asString(player.playerId);
      if (playerId === null) continue;
      const name = asRecord(player.playerName);
      out.set(playerId, {
        givenName: name === null ? null : asString(name.givenName),
        surname: name === null ? null : asString(name.surname),
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Acceptance-snapshot census gate (report-scoped, never a global AFL rule)
 * ------------------------------------------------------------------ */

export type AflApiSnapshotCensusExpectation = {
  matches: number;
  playerMatchRows: number;
  distinctProviderPlayers: number;
};

export type AflApiSnapshotCensusVerdict = {
  ok: boolean;
  mismatches: readonly string[];
};

/**
 * An acceptance snapshot's expected census (its match count, player-match row
 * count and distinct provider-player count) is a property of THAT immutable
 * snapshot, not of AFL and not of this tool. It is therefore supplied by the
 * caller per run and compared here; no expected figure is a constant in this
 * module, and a run that supplies none is not gated at all.
 */
export function checkAflApiSnapshotCensus(
  observed: { matches: number; playerMatchRows: number; distinctProviderPlayers: number },
  expected: AflApiSnapshotCensusExpectation | null,
): AflApiSnapshotCensusVerdict {
  if (expected === null) return { ok: true, mismatches: [] };
  const mismatches: string[] = [];
  if (observed.matches !== expected.matches) {
    mismatches.push(`SNAPSHOT_MATCHES ${observed.matches} != expected ${expected.matches}`);
  }
  if (observed.playerMatchRows !== expected.playerMatchRows) {
    mismatches.push(
      `SNAPSHOT_PLAYER_MATCH_ROWS ${observed.playerMatchRows} != expected ${expected.playerMatchRows}`,
    );
  }
  if (observed.distinctProviderPlayers !== expected.distinctProviderPlayers) {
    mismatches.push(
      `SNAPSHOT_DISTINCT_PROVIDER_PLAYERS ${observed.distinctProviderPlayers} `
      + `!= expected ${expected.distinctProviderPlayers}`,
    );
  }
  return { ok: mismatches.length === 0, mismatches };
}

/* ------------------------------------------------------------------ *
 * Overlap with the previously accepted (afldb_test-built) artefacts
 * ------------------------------------------------------------------ */

export type AflApiExistingClaimComparison = {
  /** Always the literal refusal-to-guess; see {@link EXISTING_CLAIM_COMPARISON_UNPROVED}. */
  idParity: typeof EXISTING_CLAIM_COMPARISON_UNPROVED;
  existingLinkedProviders: number;
  /** Provider ids this evidence links that an existing artefact also links. */
  bothLinked: number;
  /** Provider ids this evidence links that no existing artefact links. */
  newlyLinked: number;
  /** Provider ids an existing artefact links that this evidence does not. */
  existingOnly: readonly string[];
  /** Provider ids an existing artefact links that this evidence calls contradictory. */
  existingLinkedNowContradictory: readonly string[];
};

/**
 * Provider-ID-SET overlap only. This function deliberately never compares a
 * numeric `candidate_player_id` across the two artefacts: the accepted ones
 * were built from `afldb_test` evidence and this one from `afldb_dev`, and
 * numeric `players.id` parity between those databases has not been proven.
 * An equal id would not be corroboration and an unequal id would not be a
 * contradiction, so neither is claimed.
 */
export function compareAflApiExistingClaims(
  providers: readonly AflApiProviderClassification[],
  existingLinkedProviderIds: readonly string[],
): AflApiExistingClaimComparison {
  const existing = new Set(existingLinkedProviderIds);
  const linked = new Set(providers.filter((p) => p.disposition === 'linked').map((p) => p.providerId));
  const contradictory = new Set(
    providers.filter((p) => p.disposition === 'contradictory').map((p) => p.providerId),
  );
  let bothLinked = 0;
  let newlyLinked = 0;
  for (const providerId of linked) {
    if (existing.has(providerId)) bothLinked += 1;
    else newlyLinked += 1;
  }
  return {
    idParity: EXISTING_CLAIM_COMPARISON_UNPROVED,
    existingLinkedProviders: existing.size,
    bothLinked,
    newlyLinked,
    existingOnly: [...existing].filter((id) => !linked.has(id)).sort(),
    existingLinkedNowContradictory: [...existing].filter((id) => contradictory.has(id)).sort(),
  };
}

/* ------------------------------------------------------------------ *
 * Database-target guards (pure; the CLI supplies the live values)
 * ------------------------------------------------------------------ */

export class AflApiEvidenceTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AflApiEvidenceTargetError';
  }
}

/**
 * DSN shape/target check, before any connection is attempted. Never accepts a
 * DSN from argv — the caller reads {@link AFL_API_EVIDENCE_DSN_ENV} and passes
 * its value here. The DSN itself is never echoed in a refusal message.
 */
export function assertAflApiEvidenceDsn(dsn: string | undefined | null): string {
  if (!dsn || dsn.trim() === '') {
    throw new AflApiEvidenceTargetError(
      `${AFL_API_EVIDENCE_DSN_ENV} is not set — refusing to read evidence from an unknown target.`,
    );
  }
  const trimmed = dsn.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new AflApiEvidenceTargetError(`${AFL_API_EVIDENCE_DSN_ENV} is not a valid URL.`);
  }
  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new AflApiEvidenceTargetError(`${AFL_API_EVIDENCE_DSN_ENV} is not a postgresql:// DSN.`);
  }
  if (parsed.pathname.replace(/^\//, '') !== AFL_API_EVIDENCE_DATABASE) {
    throw new AflApiEvidenceTargetError(
      `${AFL_API_EVIDENCE_DSN_ENV} does not target /${AFL_API_EVIDENCE_DATABASE} — refusing.`,
    );
  }
  return trimmed;
}

/**
 * The LIVE session proof, on the very connection the evidence will be read
 * through — the established `tools/db/promotion-check.ts` `gateIdentity`
 * convention: never the DSN string, never a hostname guess. All three facts
 * must hold; any other database name (including a production one) is refused
 * identically.
 */
export function assertAflApiEvidenceSession(identity: {
  currentDatabase: unknown;
  transactionReadOnly: unknown;
  defaultTransactionReadOnly: unknown;
}): void {
  if (identity.currentDatabase !== AFL_API_EVIDENCE_DATABASE) {
    throw new AflApiEvidenceTargetError(
      `REFUSED: connected database is '${String(identity.currentDatabase)}', not `
      + `'${AFL_API_EVIDENCE_DATABASE}'. No evidence statement was executed.`,
    );
  }
  if (identity.transactionReadOnly !== 'on') {
    throw new AflApiEvidenceTargetError(
      `REFUSED: transaction_read_only is '${String(identity.transactionReadOnly)}', not 'on'.`,
    );
  }
  if (identity.defaultTransactionReadOnly !== 'on') {
    throw new AflApiEvidenceTargetError(
      `REFUSED: default_transaction_read_only is '${String(identity.defaultTransactionReadOnly)}', not 'on'.`,
    );
  }
}
