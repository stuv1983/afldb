/**
 * AFLDB-ISSUE-316 — the EXPLICIT predecessor state of the 2026 -> 2027 rollover, for tests that
 * simulate that rollover or exercise mechanics on "a state with 2026 in progress".
 *
 * Before the rollover these tests read the tracked reference files, which then happened to BE the
 * predecessor. The rollover rewrites them, so a test that means "the predecessor" must say so:
 * tests/fixtures/rollover/predecessor-2026/ holds the exact bytes of the seven reference documents
 * of the reviewed transition base (`PREDECESSOR_BASE_SHA256`, the base column of the G-pinned change
 * set). `tools/db/rebuild-test.ts` is not copied: the transition changes only its successor tuple
 * table, so its predecessor text is the tracked source with that one literal emptied.
 *
 * A test about the CURRENT tracked state reads the tracked files; never this module.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readSuccessorLadderTuplesJson } from '../src/lib/rollover/ladder-successor';

export const PREDECESSOR_ROOT = join(__dirname, 'fixtures', 'rollover', 'predecessor-2026');

/** The reviewed transition base (APPLICATION_SPEC §2, base column), one entry per fixture file. */
export const PREDECESSOR_BASE_SHA256: Readonly<Record<string, string>> = Object.freeze({
  'data/reference/afltables-network.json': '19721801ac4df60e78299b461c97e87d252ad65d5fd394643448be54c3b5c838',
  'tools/rebuild/afl_api/afl-api-contract.json': '8ed96ed4cca6fe4fb8da63c05a383af4dc8bbdc4b9dacfca5c490cf74ea5e208',
  'tools/rebuild/afltables/afltables-contract.json': '5d29e7d255de2b49d38d06eafe1841bf66fe936a63ec7dd0db167d8580debeca',
  'data/reference/fitzroy-accepted-baselines.json': 'c68083aed64e894566054404b93032698e9664d79db377080ad795724d032eef',
  'data/reference/seasons.json': '8c6462713cb0489d0aa2938c6b735ad65e9f7794f0665fccc3a951065a0004f9',
  'tools/rebuild/fitzroy/fitzroy-contract.json': '39689ddfd252a358026fb9e3b0d32f1f2383cc00116016f89ee8366b7f773de2',
  'data/reference/stat-availability.json': 'e2900084ebd7e9505239b82aef8f8665fcf7939e7b84b94b13e110fa6cfcc2b8',
});

const REBUILD = 'tools/db/rebuild-test.ts';

/** The predecessor text of a repository path: a fixture document, the emptied rebuild table, or the tracked file. */
export function predecessorText(repoPath: string): string {
  // Callers may pass a platform-joined path; the fixture keys are repository-relative with forward slashes.
  const path = repoPath.replace(/\\/g, '/');
  if (Object.hasOwn(PREDECESSOR_BASE_SHA256, path)) return readFileSync(join(PREDECESSOR_ROOT, path), 'utf8');
  const tracked = readFileSync(join(__dirname, '..', path), 'utf8');
  if (path !== REBUILD) return tracked;
  const table = readSuccessorLadderTuplesJson(tracked);
  return table === '{}' ? tracked : tracked.replace(`SUCCESSOR_LADDER_TUPLES_JSON = '${table}'`, "SUCCESSOR_LADDER_TUPLES_JSON = '{}'");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const predecessorJson = (path: string): any => JSON.parse(predecessorText(path));
