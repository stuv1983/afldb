#!/usr/bin/env node
/**
 * AFL API cutover — readiness report (issues/open/AFLDB-ISSUE-316.md §6).
 *
 *   node node_modules/tsx/dist/cli.mjs tools/current-season/afl-api-cutover-readiness.ts \
 *     --season 2027 --season-feed <path to that season's 00-season-matches.json>
 *
 * Reads four tracked files under data/reference/ and the season's own matches
 * feed, prints PASS/FAIL per repository and feed precondition, then the host and
 * database checks an operator runs separately. Without --season-feed the venue,
 * team and round coverage checks FAIL: they cannot be shown without the matches
 * they must cover. Opens no database, makes no network request, runs no host
 * command, writes nothing. Exit 0 = REPOSITORY READY (never the cutover go),
 * 1 = NOT READY, 2 = bad arguments or an unreadable --season-feed.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assessAflApiCutoverReadiness,
  renderAflApiCutoverReadiness,
  type CutoverReadiness,
} from '../../src/lib/acquisition/afl-api-cutover-readiness';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROJECT_ROOT = join(__dirname, '..', '..');

function readJsonOrUndefined(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

/** What only the host can answer. Printed, never run. */
export const HOST_CHECKS: readonly string[] = [
  'systemctl show afldb-settle-afl-api.service afldb-settle-afl-api-brownlow.service --property=Id,LoadState',
  'systemctl is-enabled afldb-settle-afl-api.timer afldb-settle-afl-api-brownlow.timer afldb-settle-afltables.timer',
  "psql \"$DATABASE_URL\" -XAtc \"SELECT key, value FROM site_settings WHERE key LIKE 'acquisition.%' ORDER BY key\"",
  'ls /etc/polkit-1/rules.d/ | grep afldb ; grep -c "^AFLDB_SETTLE_TRIGGER=" .env',
];

/**
 * The database half of venue coverage: every mapped feed venue's `legacy_name`
 * must name a `venues` row. Only from a readiness whose `venue_coverage`
 * PASSED: a partial list would print an "expect N" that a database could meet
 * while venues the feed needs were never checked.
 */
export function venueRowsCheck(readiness: CutoverReadiness): string | null {
  const venueCoverage = readiness.checks.find((c) => c.id === 'venue_coverage');
  if (venueCoverage?.ok !== true) return null;
  const legacyNames = readiness.feedVenueLegacyNames;
  if (legacyNames.length === 0) return null;
  const list = legacyNames.map((n) => `'${n.replace(/'/g, "''")}'`).join(', ');
  return `SELECT count(*) FROM venues WHERE legacy_name IN (${list});  -- expect ${legacyNames.length}`;
}

export function runAflApiCutoverReadiness(
  argv: readonly string[],
  projectRoot: string = DEFAULT_PROJECT_ROOT,
): { readiness: CutoverReadiness | null; lines: string[]; exitCode: number } {
  const usage = 'Usage: afl-api-cutover-readiness.ts --season <YYYY> --season-feed <00-season-matches.json>';
  const valueOf = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const season = Number(valueOf('--season'));
  if (!Number.isInteger(season) || season < 1897) {
    return { readiness: null, lines: [usage], exitCode: 2 };
  }
  let seasonFeed: { path: string; text: string } | undefined;
  if (argv.includes('--season-feed')) {
    const feedPath = valueOf('--season-feed');
    if (feedPath === undefined || feedPath.startsWith('--')) {
      return { readiness: null, lines: [usage], exitCode: 2 };
    }
    try {
      seasonFeed = { path: feedPath, text: readFileSync(resolve(projectRoot, feedPath), 'utf8') };
    } catch (error) {
      return { readiness: null, lines: [`Cannot read --season-feed ${feedPath}: ${String(error)}`, usage], exitCode: 2 };
    }
  }
  const ref = (name: string) => readJsonOrUndefined(join(projectRoot, 'data', 'reference', name));
  const readiness = assessAflApiCutoverReadiness(season, {
    seasons: ref('seasons.json'),
    identities: ref('afl-api-identities.json'),
    sourceFamilies: ref('source-families.json'),
    afltablesNetwork: ref('afltables-network.json'),
    seasonFeed,
  });
  const venueSql = venueRowsCheck(readiness);
  const lines = [
    ...renderAflApiCutoverReadiness(readiness),
    '',
    'Host checks (operator-run on the target host; not run by this tool):',
    ...HOST_CHECKS.map((c) => `  ${c}`),
    venueSql === null
      ? '  (venues rows: not printed, because venue_coverage did not pass; fix it and re-run)'
      : `  in psql on the target database: ${venueSql}`,
  ];
  return { readiness, lines, exitCode: readiness.ready ? 0 : 1 };
}

const invokedDirectly = process.argv[1] !== undefined
  && relative(resolve(process.argv[1]), fileURLToPath(import.meta.url)) === '';

if (invokedDirectly) {
  const { lines, exitCode } = runAflApiCutoverReadiness(process.argv.slice(2));
  for (const line of lines) console.log(line);
  process.exitCode = exitCode;
}
