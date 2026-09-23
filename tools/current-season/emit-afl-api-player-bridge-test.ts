#!/usr/bin/env node
/**
 * AFLDB-ISSUE-228 S9 — the FULL-SEASON AFL API player-identity evidence
 * emitter, `afldb_test`-NATIVE.
 *
 * Why this exists (S9 tooling gap, 2026-09-23). The 2026 Brownlow backtest
 * into `afldb_test` needs the full-season `afl_api` player bridge there. The
 * only full-season emitter (`emit-afl-api-player-bridge.ts`) is deliberately
 * pinned to `afldb_dev`, and its `candidate_player_id` values are `afldb_dev`
 * ids — the importer refuses that artefact for `--target afldb_test`, because
 * numeric `players.id` parity between the two databases is unproved. The only
 * `afldb_test`-native builder (`build_afl_api_player_bridge.py`) covers the
 * fixed 14-match sample only.
 *
 * This entry point is the SAME emitter body (same snapshot load, same match
 * identity/resolution, same pure evidence engine, same artefact shape) with a
 * DIFFERENT pinned target, fixed here in code:
 *
 *   database   afldb_test               (proven live via current_database())
 *   DSN        AFLDB_TEST_DATABASE_URL  (env only; never argv)
 *   session    default_transaction_read_only=on, proven live
 *
 * Every `candidate_player_id` it emits is read from `afldb_test`'s own
 * `player_match_stats`; nothing is copied from any other artefact
 * (`--compare-artefact` compares provider-id SETS only). The artefact records
 * `built_from_database: "afldb_test"` and this file's path as `tool`, which is
 * exactly what the importer's `--target afldb_test` season-evidence gate
 * requires; a DEV-built artefact still fails that gate.
 *
 * Usage:
 *   npm run emit:afl-api-player-bridge-test -- --label <snapshot> --validate-only
 *   npm run emit:afl-api-player-bridge-test -- --label <snapshot> --out <path>
 */
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AFL_API_TEST_EVIDENCE_TARGET } from '../../src/lib/acquisition/afl-api-player-evidence';
import {
  runEmitAflApiPlayerBridgeFor,
  type AflApiPlayerBridgeEmitterTarget,
  type EmitAflApiPlayerBridgeDeps,
  type EmitAflApiPlayerBridgeOutcome,
} from './emit-afl-api-player-bridge';
import { loadEnv } from './load-env';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROJECT_ROOT = join(__dirname, '..', '..');

export const TEST_TOOL = 'tools/current-season/emit-afl-api-player-bridge-test.ts';

export const TEST_EMITTER_TARGET: AflApiPlayerBridgeEmitterTarget = Object.freeze({
  evidence: AFL_API_TEST_EVIDENCE_TARGET,
  tool: TEST_TOOL,
  applicationName: 'afldb-emit-afl-api-player-bridge-test',
});

/** The `afldb_test` emitter: pinned to `afldb_test` in code. */
export async function runEmitAflApiPlayerBridgeTestCli(
  argv: readonly string[], deps: EmitAflApiPlayerBridgeDeps = {},
): Promise<EmitAflApiPlayerBridgeOutcome> {
  return runEmitAflApiPlayerBridgeFor(TEST_EMITTER_TARGET, argv, deps);
}

const invokedDirectly = process.argv[1] !== undefined
  && relative(resolve(process.argv[1]), fileURLToPath(import.meta.url)) === '';

if (invokedDirectly) {
  loadEnv(DEFAULT_PROJECT_ROOT);
  runEmitAflApiPlayerBridgeTestCli(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
