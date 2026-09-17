/**
 * AFLDB-ISSUE-164 P1c — frozen label sets for the player-link backtest.
 *
 * The labelled draft population in the database is five rows
 * (`data/reference/draftguru-link-decisions.json`: six explicit human
 * decisions, five of them `linked`). That is not enough to say anything
 * about draft precision, so P1c needs a way to evaluate the scorer
 * against ground truth that is NOT stored as a link.
 *
 * This module is the pure half of that: parse a label file, validate it,
 * and surface every contradiction rather than resolving one silently.
 * It is DB-free and side-effect-free; resolving a label's natural keys to
 * AFLDB ids is the caller's job, in read-only SQL.
 *
 * Design rules, all inherited from the artefacts this file sits beside:
 *
 *   * Labels are keyed on a DURABLE NATURAL KEY, never a surrogate id.
 *     For drafts that is the DraftGuru `player_url` (migration 069), the
 *     same key `draftguru-link-decisions.json` and the Stage B3 bridge
 *     dataset use, so a label set is promotable to a bridge without
 *     re-keying anything.
 *   * A label carries its own PROVENANCE. "The scorer said so" is not a
 *     provenance and is rejected by name (see SCORER_DERIVED_PROVENANCES):
 *     ground truth that came from the thing under test measures nothing.
 *   * `expect: "unlinked"` is a first-class label. A draftee who never
 *     played senior football correctly has no AFLDB player, and a matcher
 *     that confidently links one has produced a false positive. Dropping
 *     those rows would measure only the easy half of the population.
 *   * Contradictions are findings. Two labels for one person, or two
 *     people claiming one AFLDB player, raise an error naming both; this
 *     module never picks a winner.
 */

/** The one shape a label file may take. Bumped only by a breaking change. */
export const LABEL_SET_SCHEMA_VERSION = 1;

/**
 * Provenances that would make the measurement circular.
 *
 * The scorer's own Top-1 is not evidence about the scorer, however high
 * its confidence, and a cached suggestion is the same value written down.
 * Listed explicitly so a label file cannot smuggle one in under a
 * plausible-looking name.
 */
export const SCORER_DERIVED_PROVENANCES: readonly string[] = [
  'match_suggestion',
  'match_suggestion_accepted',
  'player_link_match_candidates',
  'scorer_top1',
  'bulk_approval',
];

/**
 * Provenance ranked by how far it sits from the scorer's own evidence.
 *
 * Lower rank = stronger. The ordering is the §P1c truth-source hierarchy
 * and is used to break a duplicate label only when the two agree; it never
 * resolves a disagreement.
 */
export const PROVENANCE_RANK: Readonly<Record<string, number>> = {
  /** An explicit human decision already in `player_link_resolutions`. */
  human_link_decision: 1,
  /**
   * The DraftGuru person page's own outbound AFL Tables href, matched by
   * URL. Independent of every scored family: no name, club, draft year,
   * games, goals or era is consulted to establish it.
   */
  draftguru_person_page_afltables_bridge: 2,
  /** A curator read the sources side by side and recorded the decision. */
  manual_review: 3,
  /** Another already-confirmed source for the same person, cross-referenced. */
  confirmed_cross_source: 4,
  /**
   * A negative: the person's page exposes no AFL Tables identity AND the
   * person is in a zero-senior-game cohort, so AFLDB correctly holds no
   * player. Ranked last because the second half of that test reads the
   * draft source's own reported games, which the scorer also scores.
   */
  zero_game_no_bridge: 5,
};

export type LabelExpectation = 'linked' | 'unlinked';

export type RawLabel = {
  player_url: string;
  expect: LabelExpectation;
  /** Canonical AFL Tables path; required for `linked`, forbidden otherwise. */
  afltables_external_id?: string | null;
  provenance: string;
  /** ISO date the decision was made, when the source records one. */
  labelled_at?: string | null;
  note?: string | null;
};

export type LabelSet = {
  schemaVersion: number;
  sourceKey: string;
  labelSet: string;
  labels: Label[];
};

export type Label = {
  playerUrl: string;
  expect: LabelExpectation;
  afltablesExternalId: string | null;
  provenance: string;
  labelledAt: string | null;
  note: string | null;
};

/** The settled canonical forms. Identity is byte-exact; nothing is decoded. */
const PLAYER_URL_RE = /^https:\/\/www\.draftguru\.com\.au\/players\/[^/]+\/[1-9][0-9]*$/;
const AFLTABLES_PATH_RE = /^players\/[A-Za-z]\/[^/]+\.html$/;

export class LabelSetError extends Error {}

/**
 * AFL Tables identities are stored as a profile path, not a URL.
 *
 * A person page's href is an absolute URL; `external_identities.external_id`
 * holds `players/X/Name.html`. Accepts either and produces the stored form.
 */
export function normaliseAfltablesIdentity(identity: string): string {
  const match = identity.match(/players\/[A-Za-z]\/[^/]+\.html$/);
  if (!match) {
    throw new LabelSetError(`Not a canonical AFL Tables player identity: ${identity}`);
  }
  return match[0];
}

function fail(message: string): never {
  throw new LabelSetError(message);
}

/**
 * Parse and validate a label file.
 *
 * Everything that could make a later number wrong is refused here rather
 * than reported as a caveat further down: an unknown schema version, a
 * non-canonical key, a scorer-derived provenance, a duplicate person, two
 * people claiming one player.
 */
export function parseLabelSet(payload: unknown): LabelSet {
  const doc = payload as Record<string, unknown> | null;
  if (!doc || typeof doc !== 'object') fail('Label set is not a JSON object.');

  if (doc.schema_version !== LABEL_SET_SCHEMA_VERSION) {
    fail(
      `Unsupported label set schema_version ${String(doc.schema_version)}; `
      + `this build reads ${LABEL_SET_SCHEMA_VERSION}.`,
    );
  }
  const sourceKey = doc.source_key;
  if (typeof sourceKey !== 'string' || sourceKey.length === 0) {
    fail('Label set has no source_key.');
  }
  const setName = doc.label_set;
  if (typeof setName !== 'string' || setName.length === 0) {
    fail('Label set has no label_set name; the name is what a report cites.');
  }
  if (!Array.isArray(doc.labels)) fail('Label set has no "labels" array.');

  const labels: Label[] = [];
  const byUrl = new Map<string, Label>();
  const byIdentity = new Map<string, Label>();

  for (const entry of doc.labels as RawLabel[]) {
    const playerUrl = entry?.player_url;
    if (typeof playerUrl !== 'string' || !PLAYER_URL_RE.test(playerUrl)) {
      fail(`A label is not keyed on a canonical DraftGuru player_url: ${String(playerUrl)}`);
    }
    if (entry.expect !== 'linked' && entry.expect !== 'unlinked') {
      fail(`${playerUrl}: expect must be "linked" or "unlinked", not ${String(entry.expect)}.`);
    }
    const provenance = entry.provenance;
    if (typeof provenance !== 'string' || provenance.length === 0) {
      fail(`${playerUrl}: every label must state its provenance.`);
    }
    if (SCORER_DERIVED_PROVENANCES.includes(provenance)) {
      fail(
        `${playerUrl}: provenance "${provenance}" is derived from the matcher under test. `
        + 'A suggestion the scorer produced cannot be ground truth about the scorer.',
      );
    }
    const identity = entry.afltables_external_id ?? null;
    if (entry.expect === 'linked') {
      if (typeof identity !== 'string' || !AFLTABLES_PATH_RE.test(identity)) {
        fail(`${playerUrl}: a "linked" label needs a canonical AFL Tables path, got ${String(identity)}.`);
      }
    } else if (identity !== null) {
      fail(`${playerUrl}: an "unlinked" label must not name a target (${identity}).`);
    }

    const label: Label = {
      playerUrl,
      expect: entry.expect,
      afltablesExternalId: identity,
      provenance,
      labelledAt: entry.labelled_at ?? null,
      note: entry.note ?? null,
    };

    const priorForUrl = byUrl.get(playerUrl);
    if (priorForUrl) {
      if (
        priorForUrl.expect === label.expect
        && priorForUrl.afltablesExternalId === label.afltablesExternalId
      ) {
        fail(`${playerUrl}: the same label appears twice; de-duplicate the file at source.`);
      }
      fail(
        `${playerUrl}: contradictory labels — `
        + `${describeTarget(priorForUrl)} (${priorForUrl.provenance}) versus `
        + `${describeTarget(label)} (${label.provenance}). `
        + 'A contradiction is a finding for a curator, never something this tool resolves.',
      );
    }
    byUrl.set(playerUrl, label);

    if (identity !== null) {
      const priorForIdentity = byIdentity.get(identity);
      if (priorForIdentity) {
        fail(
          `${identity} is claimed by two DraftGuru persons `
          + `(${priorForIdentity.playerUrl} and ${playerUrl}). `
          + 'That is a finding, never an instruction to merge.',
        );
      }
      byIdentity.set(identity, label);
    }

    labels.push(label);
  }

  if (labels.length === 0) fail('Label set is empty.');

  labels.sort((a, b) => (a.playerUrl < b.playerUrl ? -1 : a.playerUrl > b.playerUrl ? 1 : 0));
  return { schemaVersion: LABEL_SET_SCHEMA_VERSION, sourceKey, labelSet: setName, labels };
}

function describeTarget(label: Label): string {
  return label.expect === 'unlinked' ? 'unlinked' : `linked -> ${label.afltablesExternalId}`;
}

/**
 * How independent this label set is of the evidence the scorer reads.
 *
 * Reported beside every metric so a number is never quoted without the
 * standing of the truth it was measured against. The families listed are
 * the scorer's own (`score-candidate.ts`): name, club, era, career span,
 * draft timing, draft games/goals.
 */
export type LeakageAssessment = {
  provenance: string;
  count: number;
  rank: number | null;
  /** Scored families consulted to establish the label. Empty is the goal. */
  sharedEvidenceFamilies: string[];
  admissible: boolean;
  reason: string;
};

const LEAKAGE_BY_PROVENANCE: Readonly<Record<string, Omit<LeakageAssessment, 'provenance' | 'count' | 'rank'>>> = {
  human_link_decision: {
    sharedEvidenceFamilies: [],
    admissible: true,
    reason:
      'A curator\'s recorded decision in player_link_resolutions. The curator may have read '
      + 'the same facts the scorer reads, but the decision is an independent human judgement '
      + 'and is the standard AFLDB already treats as authoritative.',
  },
  draftguru_person_page_afltables_bridge: {
    sharedEvidenceFamilies: [],
    admissible: true,
    reason:
      'The DraftGuru person page\'s own outbound AFL Tables href, matched byte-exactly by URL. '
      + 'No name, club, draft year, games, goals or era is consulted, so no scored family is '
      + 'reused to establish the label.',
  },
  manual_review: {
    sharedEvidenceFamilies: ['name', 'club', 'draft_timing', 'draft_stats'],
    admissible: true,
    reason:
      'A curator read the same facts the scorer scores. Legitimate as truth because the human '
      + 'weighs them jointly against external sources, but rows labelled this way must be '
      + 'recorded as scorer-adjacent and kept out of any weight grid.',
  },
  confirmed_cross_source: {
    sharedEvidenceFamilies: ['name'],
    admissible: true,
    reason:
      'Another already-confirmed AFLDB link for the same person. The name string is shared with '
      + 'the scorer\'s name family, so a namesake error in the other source propagates here; '
      + 'admissible only when the cross-reference is on a non-name key.',
  },
  zero_game_no_bridge: {
    sharedEvidenceFamilies: ['draft_stats'],
    admissible: true,
    reason:
      'A true negative: no AFL Tables identity on the person page, and the person reports no '
      + 'senior games, so AFLDB correctly holds no player. The zero-games half of that test '
      + 'reads the same reported_games the scorer scores as draft_stats, so these rows are '
      + 'scorer-adjacent. They stay admissible because draft_stats can never contradict '
      + '(safety invariant 8) and what is measured on a negative is whether the scorer links '
      + 'at all — but they are counted separately and kept out of any weight grid.',
  },
};

export function assessLeakage(set: LabelSet): LeakageAssessment[] {
  const counts = new Map<string, number>();
  for (const label of set.labels) {
    counts.set(label.provenance, (counts.get(label.provenance) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([provenance, count]) => {
      const known = LEAKAGE_BY_PROVENANCE[provenance];
      return {
        provenance,
        count,
        rank: PROVENANCE_RANK[provenance] ?? null,
        sharedEvidenceFamilies: known?.sharedEvidenceFamilies ?? ['unknown'],
        admissible: Boolean(known),
        reason:
          known?.reason
          ?? 'Unrecognised provenance: its independence from the scorer has not been assessed, '
            + 'so no precision claim may be made from these rows.',
      };
    });
}

/**
 * The one-sided 95% upper bound on the failure rate given zero failures.
 *
 * The "rule of three": (1 - p)^n = 0.05 solved for p. Returned as a
 * fraction, so 253 rows bound the rate at 0.0118 — not at 0.001, and the
 * difference is the whole reason §9.1 exists.
 */
export function zeroFailureUpperBound(n: number, confidence = 0.95): number | null {
  if (n <= 0) return null;
  return 1 - Math.pow(1 - confidence, 1 / n);
}

/**
 * How many zero-failure rows a given upper bound needs.
 *
 * The inverse of the above. `requiredZeroFailureSample(0.001)` is 2,995,
 * which is what a literal "99.9% precision, proven" claim costs; the 253
 * of §9.1 is a parity rule with the weakest already-admitted class, and
 * bounds the rate at 1.19%.
 */
export function requiredZeroFailureSample(bound: number, confidence = 0.95): number {
  if (bound <= 0 || bound >= 1) throw new LabelSetError('bound must be in (0, 1).');
  return Math.ceil(Math.log(1 - confidence) / Math.log(1 - bound));
}

/**
 * How the 95% zero-failure bound should be reported for a given population.
 *
 * Three cases, and conflating them misreports the run. An empty population
 * has no bound because there is nothing to bound — which is exactly what a
 * suspended class (D-9) produces, and it must not read as "a failure was
 * observed". A population with failures has no *zero-failure* bound because
 * the rule's premise is false. Only a non-empty population with zero
 * failures yields a number.
 */
export function describeZeroFailureBound(
  n: number,
  failures: number,
  confidence = 0.95,
): string {
  if (n <= 0) return 'n/a (no bulk-eligible labelled rows in this population)';
  if (failures > 0) {
    return `n/a (${failures} false positive${failures === 1 ? '' : 's'} observed, `
      + 'so the zero-failure rule does not apply)';
  }
  const bound = zeroFailureUpperBound(n, confidence)!;
  return `${(bound * 100).toFixed(3)}%`;
}

/**
 * The smallest population in which an observed precision can even reach a
 * target while carrying one error.
 *
 * With 253 rows, one false positive is 99.60% — the figure 99.9% is not
 * expressible at that population except as a perfect score, which is why
 * an observed rate and a confidence bound must never be quoted as if they
 * were the same statement.
 */
export function smallestSampleExpressing(precision: number, errors = 1): number {
  if (precision <= 0 || precision >= 1) throw new LabelSetError('precision must be in (0, 1).');
  return Math.ceil(errors / (1 - precision));
}
