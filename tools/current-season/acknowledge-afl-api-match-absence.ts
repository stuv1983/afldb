#!/usr/bin/env node
/**
 * AFLDB-ISSUE-231 D-231-3 — acknowledge ONE `afl_api` match disappearance.
 *
 * A complete season feed that omits an unacknowledged provider id HALTs the
 * afl_api settle (D-231-1 tolerance 0) and leaves one open
 * `afl_api_match_absence` finding per id. This tool is the only way past that
 * halt short of the provider listing the id again. It is deliberately narrow:
 *
 *   - Validate-only by default. Nothing is written unless `--apply` is given
 *     with `--acknowledge <database>` naming the live `current_database()`.
 *   - One finding, one provider id, one season per run. There is no
 *     "acknowledge everything" mode.
 *   - The finding alone is never enough. `--label` names a retained full
 *     acquisition snapshot; its manifest re-hashes every file, and its season
 *     feed must be COMPLETE by the settle's own completeness parser and must
 *     still omit the id. A feed that lists the id again is refused.
 *   - On apply, in one transaction: `staging.source_records.absent_since` is set
 *     to the finding's first-detected time, and that finding is resolved
 *     `source_absence_acknowledged`. No canonical row, no `source_record_id`,
 *     no other finding is touched, and nothing is rekeyed. The next settle
 *     against a complete feed then proceeds, and any retired-identity rekey
 *     stays subject to every existing ambiguity and F010 withholding rule.
 *
 * It opens `AFLDB_IMPORT_DATABASE_URL` (the settle's own `afldb_import` role)
 * and prints the database it reached. The finding records that PostgreSQL role
 * as the database actor: operational attribution, not authenticated human
 * identity (D-231-3 actor decision, option c).
 *
 *   npx tsx tools/current-season/acknowledge-afl-api-match-absence.ts \
 *     --label <snapshot> --season 2026 --external-record-id CD_M… --finding-id <id>
 *   … the same … --apply --acknowledge <database>
 */
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

import { parseAflApiIdentities } from '../../src/lib/acquisition/afl-api-bundle';
import {
  AFL_API_MATCH_ABSENCE_ACTOR_NOTE,
  AFL_API_MATCH_ABSENCE_RESOLUTION,
  acknowledgeAflApiMatchAbsence,
  type AflApiMatchAbsenceAckOutcome,
} from '../../src/lib/acquisition/afl-api-match-absence';
import { AFL_API_SEASON_FEED_FILE } from '../../src/lib/acquisition/afl-api-season-enumeration';
import {
  aflApiSeasonFeedTextFrom,
  aflApiSnapshotRoot,
  verifyAflApiSnapshotManifest,
} from '../../src/lib/acquisition/afl-api-snapshot';
import { loadEnv } from './load-env';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROJECT_ROOT = join(__dirname, '..', '..');

export type AcknowledgeAbsenceArgs = {
  label: string;
  season: number;
  externalRecordId: string;
  findingId: string;
  apply: boolean;
  acknowledgeDatabase: string | null;
};

const VALUE_FLAGS = new Set(['--label', '--season', '--external-record-id', '--finding-id', '--acknowledge']);
const KNOWN_FLAGS = new Set([...VALUE_FLAGS, '--apply', '--validate-only']);

function valueFor(argv: readonly string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

export function parseAcknowledgeAbsenceArgs(argv: readonly string[]): AcknowledgeAbsenceArgs {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!KNOWN_FLAGS.has(arg)) throw new Error(`Unknown argument '${arg}'.`);
    if (argv.indexOf(arg) !== i) throw new Error(`'${arg}' is given more than once.`);
    if (VALUE_FLAGS.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value.`);
      i += 1;
    }
  }
  if (argv.includes('--apply') && argv.includes('--validate-only')) {
    throw new Error('--apply and --validate-only are mutually exclusive; choose one.');
  }
  const label = valueFor(argv, '--label');
  const rawSeason = valueFor(argv, '--season');
  const externalRecordId = valueFor(argv, '--external-record-id');
  const findingId = valueFor(argv, '--finding-id');
  if (!label || !rawSeason || !externalRecordId || !findingId) {
    throw new Error('--label, --season, --external-record-id and --finding-id are all required; '
      + 'this tool acknowledges exactly one finding and never guesses which.');
  }
  const season = Number(rawSeason);
  if (!Number.isInteger(season) || season < 1897 || season > 2200) {
    throw new Error(`--season '${rawSeason}' is not a plausible season year.`);
  }
  if (!/^CD_M[0-9A-Za-z]+$/.test(externalRecordId)) {
    throw new Error(`--external-record-id '${externalRecordId}' is not an AFL API match provider id.`);
  }
  if (!/^[1-9][0-9]*$/.test(findingId)) throw new Error(`--finding-id '${findingId}' is not a data_issues id.`);
  const apply = argv.includes('--apply');
  const acknowledgeDatabase = valueFor(argv, '--acknowledge');
  if (apply && !acknowledgeDatabase) {
    throw new Error('--apply requires --acknowledge <database>, naming the database you mean to write.');
  }
  if (!apply && acknowledgeDatabase) {
    throw new Error('--acknowledge only accompanies --apply.');
  }
  return { label, season, externalRecordId, findingId, apply, acknowledgeDatabase };
}

export type AcknowledgeAbsenceDeps = {
  projectRoot?: string;
  sql?: postgres.Sql;
  log?: (line: string) => void;
};

export async function runAcknowledgeAflApiMatchAbsence(
  argv: readonly string[], deps: AcknowledgeAbsenceDeps = {},
): Promise<AflApiMatchAbsenceAckOutcome> {
  const projectRoot = deps.projectRoot ?? DEFAULT_PROJECT_ROOT;
  const log = deps.log ?? ((line: string) => console.log(line));
  const args = parseAcknowledgeAbsenceArgs(argv);

  // Offline and fail-closed: the snapshot is re-hashed before any connection opens.
  const snapshotDir = join(aflApiSnapshotRoot(projectRoot), args.label);
  const { manifest, files } = verifyAflApiSnapshotManifest(snapshotDir);
  if (manifest.season !== args.season) {
    throw new Error(`Snapshot '${args.label}' is season ${String(manifest.season)}, not ${args.season}.`);
  }
  const feedEntry = files.find((entry) => entry.file === AFL_API_SEASON_FEED_FILE);
  const seasonFeedText = aflApiSeasonFeedTextFrom(snapshotDir, files);
  if (feedEntry === undefined || seasonFeedText === null) {
    throw new Error(`Snapshot '${args.label}' retained no ${AFL_API_SEASON_FEED_FILE}, so it proves nothing about absence.`);
  }
  const identities = parseAflApiIdentities(
    JSON.parse(readFileSync(join(projectRoot, 'data', 'reference', 'afl-api-identities.json'), 'utf8')),
  );
  const seasonIdentity = identities.seasons.get(args.season);
  if (seasonIdentity === undefined) {
    throw new Error(`afl-api-identities.json declares no compSeason for ${args.season}.`);
  }

  const ownsClient = deps.sql === undefined;
  const dsn = process.env.AFLDB_IMPORT_DATABASE_URL;
  if (ownsClient && !dsn) throw new Error('AFLDB_IMPORT_DATABASE_URL is not set.');
  const sql = deps.sql ?? postgres(dsn as string, { max: 1, onnotice: () => {}, transform: { undefined: null } });
  try {
    const outcome = await acknowledgeAflApiMatchAbsence(sql, {
      season: args.season,
      compSeasonProviderId: seasonIdentity.providerId,
      externalRecordId: args.externalRecordId,
      findingId: args.findingId,
      snapshotLabel: args.label,
      seasonFeedText,
      seasonFeedSha256: feedEntry.sha256,
      apply: args.apply,
      acknowledgeDatabase: args.acknowledgeDatabase,
    });
    log(`acknowledge-afl-api-match-absence — database '${outcome.database}', database actor '${outcome.role}' `
      + `(${AFL_API_MATCH_ABSENCE_ACTOR_NOTE}), ${outcome.applied ? 'APPLY' : 'validate-only'}.`);
    log(`  finding ${outcome.findingId} (${outcome.issueKey}): open, and ${args.externalRecordId} is absent from `
      + `the complete feed of '${args.label}' (sha256 ${feedEntry.sha256}).`);
    if (outcome.applied) {
      log(`  staging.source_records.absent_since = ${outcome.absentSince} (first detection); finding resolved `
        + `'${AFL_API_MATCH_ABSENCE_RESOLUTION.acknowledged}'. No canonical row was touched and nothing was rekeyed.`);
    } else {
      log(`  would set absent_since = ${outcome.absentSince} (spine first_seen_at ${outcome.spineFirstSeenAt}) and resolve `
        + `the finding '${AFL_API_MATCH_ABSENCE_RESOLUTION.acknowledged}'. Nothing was written. Re-run with `
        + `--apply --acknowledge ${outcome.database} to commit exactly this.`);
    }
    return outcome;
  } finally {
    if (ownsClient) await sql.end({ timeout: 5 });
  }
}

async function main(): Promise<void> {
  loadEnv(DEFAULT_PROJECT_ROOT);
  await runAcknowledgeAflApiMatchAbsence(process.argv.slice(2));
}

const invokedDirectly = process.argv[1] !== undefined
  && relative(resolve(process.argv[1]), fileURLToPath(import.meta.url)) === '';

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
