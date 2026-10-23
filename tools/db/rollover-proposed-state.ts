/**
 * AFLDB-ISSUE-316 C2 — semantic validation of a PROPOSED successor state.
 *
 * WHY. A transition change set pins hashes, and the planner's gates prove the successor
 * fitzRoy contract and register against the acquired data. Neither judges the contract blocks the
 * REBUILD itself reads: the ladder rebuild_expectation and its selector, the height block, and the
 * measured counts in the AFL API and AFL Tables source contracts. A proposal in which every hash is
 * consistent can still carry a ladder tuple the rebuild would refuse, a height block bound to the
 * wrong baseline, or a count that is not an integer. Those refusals used to appear only at the next
 * `db:test:rebuild`, after the files had been written.
 *
 * HOW. This module hands the PROPOSED bytes of the six documents the rebuild reads to the
 * rebuild's own validators, unchanged: `resolveLadderRebuildExpectation` (selector, fingerprint,
 * range, census scope), and `finalValidationChecks` (which builds the height, birth-date, coach,
 * roster and club-season checks from the contract blocks). Both take their documents by injection,
 * so nothing is written to the working tree and no temporary file is needed; the verdict describes
 * exactly the bytes that were passed in.
 *
 * WHAT IT DOES NOT DO. It executes no SQL, so the measured counts remain CLAIMS until the isolated
 * rebuild measures them; they are returned as `pendingDatabase`, never reported as proven. Continuity
 * (`profile_url_continuity`) and the ladder witness are judged by the executed gates against the same
 * successor contract bytes, not here. The rehearsal-only ladder profile is refused outright: it is
 * valid only inside an isolated, provenance-bound rehearsal and can never be an active profile.
 */
import { RolloverRefused, readClubSeasonsExpectedRows } from '../../src/lib/rollover/season-rollover';
import {
  LadderSuccessorRefused, parseSuccessorLadderTuples, readSuccessorLadderTuplesJson,
  type SuccessorLadderTuple,
} from '../../src/lib/rollover/ladder-successor';
import type { RehearsalPair } from '../v2/rehearsal-package.mjs';
import {
  RebuildRefused,
  finalValidationChecks,
  resolveLadderRebuildExpectation,
  selectAcceptedBaseline,
  type FitzroySource,
  type ResolvedTarget,
} from './rebuild-test';

export type ProposedDocuments = {
  register: string;
  seasons: string;
  contract: string;
  aflApi: string;
  afltables: string;
  /**
   * `tools/db/rebuild-test.ts`: the CLUB_SEASONS_EXPECTED constant and the SUCCESSOR_LADDER_TUPLES_JSON
   * literal are read from it, so a successor profile is judged against the table the PROPOSED code would carry.
   */
  rebuild: string;
  /**
   * The CURRENT `tools/db/rebuild-test.ts` bytes the apply would replace. Required for a successor profile:
   * its CLUB_SEASONS_EXPECTED.rows must be left exactly as the base declares it (the superseded predecessor's
   * fingerprint-bound count), because stage 9 reads a successor's rows from its tuple.
   */
  baseRebuild?: string;
  /** The proposed ladder witness manifest, for a successor's independent row derivation. */
  witnessManifest?: string;
};

export type ProposedStateVerdict = {
  acceptedLabel: string;
  ladderProfile: string;
  expectedRows: number;
  /** The rebuild's final-validation checks built from the proposal (SQL not run). */
  finalChecks: Array<{ key: string; expected: number }>;
  /** What this module cannot prove without a database, named so it is never read as passed. */
  pendingDatabase: string[];
};

type Json = Record<string, unknown>;

function parse(text: string, what: string): Json {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (error) {
    throw new RolloverRefused(`The proposed ${what} is not valid JSON: ${String(error)}`);
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    throw new RolloverRefused(`The proposed ${what} must be a JSON object.`);
  }
  return doc as Json;
}

/** Not an isolated rehearsal target: an active contract is never judged as one. */
const ACTIVE_TARGET: ResolvedTarget = {
  database: '', adminDsn: '', importDsn: '', importIsOwnerSubstitution: false,
};

/**
 * Judge a proposed successor state with the rebuild's own validators. Refuses with a
 * `RolloverRefused` naming the failing rule; returns what was judged and what is still pending.
 * `pairs` is the closed table of reviewed ladder tuples; only a test supplies another. `successors` is the
 * closed table of reviewed successor tuples; by default it is the one the PROPOSED `rebuild` text carries, never
 * the running module's, so an unadopted tuple cannot be judged against code that does not contain it.
 */
export function validateProposedRebuildState(
  docs: ProposedDocuments,
  pairs?: Readonly<Record<string, RehearsalPair>>,
  successors?: Readonly<Record<string, SuccessorLadderTuple>>,
): ProposedStateVerdict {
  const register = parse(docs.register, 'acceptance register');
  const seasons = parse(docs.seasons, 'seasons reference');
  const contract = parse(docs.contract, 'fitzRoy contract');
  const aflApi = parse(docs.aflApi, 'AFL API contract');
  const afltables = parse(docs.afltables, 'AFL Tables contract');

  try {
    const label = selectAcceptedBaseline(register).label;
    const source: FitzroySource = {
      label, accepted: true, fullHistory: true, acknowledgedPartial: false,
      selection: 'accepted-baseline',
    };

    const profile = (((contract.datasets as Json | undefined)?.ladder as Json | undefined)
      ?.rebuild_expectation as Json | undefined)?.profile;
    if (typeof profile === 'string' && /rehearsal-only/.test(profile)) {
      throw new RebuildRefused(
        `The proposed ladder rebuild_expectation names the profile ${JSON.stringify(profile)}. A `
        + 'rehearsal-only profile is valid only inside an isolated, provenance-bound rehearsal and '
        + 'can never be an active contract profile.');
    }

    // Selector, fingerprint tuple, row count, completed range and census scope, from the
    // proposed documents. An absent or unreviewed profile name is refused here.
    let proposedSuccessors = successors;
    if (proposedSuccessors === undefined) {
      try {
        proposedSuccessors = parseSuccessorLadderTuples(readSuccessorLadderTuplesJson(docs.rebuild));
      } catch (error) {
        if (error instanceof LadderSuccessorRefused) throw new RebuildRefused(error.message);
        throw error;
      }
    }
    if (typeof profile === 'string' && Object.hasOwn(proposedSuccessors, profile)
        && docs.witnessManifest === undefined) {
      throw new RebuildRefused(
        `The proposed ladder profile ${JSON.stringify(profile)} is a successor tuple, which needs the proposed `
        + 'witness manifest bytes for its independent row derivation; the working tree is never read instead.');
    }
    const ladder = resolveLadderRebuildExpectation(
      source, ACTIVE_TARGET,
      { register, contract, seasons } as Parameters<typeof resolveLadderRebuildExpectation>[2],
      undefined, undefined, pairs, proposedSuccessors, docs.witnessManifest,
    );

    const constantRows = readClubSeasonsExpectedRows(docs.rebuild);
    const isSuccessor = typeof profile === 'string' && Object.hasOwn(proposedSuccessors, profile);
    if (isSuccessor) {
      // Stage 9 takes a successor's count from its tuple (already bound to the contract and re-derived from
      // the witness manifest above). CLUB_SEASONS_EXPECTED.rows stays the predecessor's reviewed count.
      if (docs.baseRebuild === undefined) {
        throw new RebuildRefused(
          'A successor profile is judged against the base tools/db/rebuild-test.ts, whose CLUB_SEASONS_EXPECTED.rows '
          + 'it must leave unchanged; the base bytes were not supplied.');
      }
      const baseRows = readClubSeasonsExpectedRows(docs.baseRebuild);
      if (constantRows !== baseRows) {
        throw new RebuildRefused(
          `The proposed tools/db/rebuild-test.ts expects ${constantRows} club_seasons rows in CLUB_SEASONS_EXPECTED, `
          + `but the base declares ${baseRows}. That constant is the superseded predecessor's fingerprint-bound count; `
          + `a successor transition never rewrites it (stage 9 reads ${ladder.expectedRows} from the successor tuple).`);
      }
    } else if (constantRows !== ladder.expectedRows) {
      throw new RebuildRefused(
        `The proposed tools/db/rebuild-test.ts expects ${constantRows} club_seasons rows, but the proposed `
        + `ladder rebuild_expectation resolves to ${ladder.expectedRows}. The two must be the same reviewed number.`);
    }

    // The real check builders, reading the contract blocks from the PROPOSED bytes.
    const checks = finalValidationChecks(register, undefined, () => contract, ladder, {
      aflApi: () => aflApi,
      afltables: () => afltables,
    });

    return {
      acceptedLabel: label,
      ladderProfile: ladder.pair.profile,
      expectedRows: ladder.expectedRows,
      finalChecks: checks.map((c) => ({ key: c.key, expected: c.expected })),
      pendingDatabase: [
        `${checks.length} final-validation SQL checks built from the proposal were NOT executed; every `
        + 'measured count in them is a claim until the isolated rebuild measures it',
        'the ladder witness --compare cross-check against the rebuilt club_seasons',
        `club_seasons = ${ladder.expectedRows} rows and the completed-scope season status/grand-final checks`,
      ],
    };
  } catch (error) {
    if (error instanceof RebuildRefused) {
      throw new RolloverRefused(
        `The proposed successor state fails the rebuild's own validators: ${error.message}`);
    }
    throw error;
  }
}
