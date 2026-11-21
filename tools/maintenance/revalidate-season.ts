/**
 * Attended, operator-run cross-worker ISR refresh of one season
 * (AFLDB-ISSUE-372 option A step, kept under option B; ISSUE-350 procedure 01).
 *
 *   npx tsx tools/maintenance/revalidate-season.ts --season 2027
 *
 * Posts the existing fan-out (`/api/internal/revalidate-season`, AFLDB-ISSUE-134)
 * until every worker of the running site has answered, so `/seasons/<y>`,
 * `/brownlow/<y>` and every award-season page are expired on ALL workers. Its
 * use: right after the I350 opening creates the 2027 `seasons` row, so no worker
 * keeps a cached `/seasons/2027` 404 whose background regeneration would persist
 * the not-found head over the new page (ISSUE-371 README §3).
 *
 * The URL and the secret come from the environment, or from the checkout's
 * `.env` for names not already set; NEVER from argv (command lines are logged).
 *
 * D-232-3 (the nightly invalidates nothing) is preserved: this is an attended
 * tool. It refuses to run under systemd (`INVOCATION_ID` is set for every unit
 * process), and `tests/settle-season-revalidation.test.ts` asserts that no
 * `deploy/` file references it and that the AFL API units still unset the secret.
 *
 * Exit: 0 every worker reached; 1 incomplete cluster; 2 usage, unconfigured,
 * half-configured or refused. "Unconfigured" is a failure here (unlike the web
 * path, where it means "acting worker only"): an operator who runs this step
 * must not believe a refresh happened when nothing was posted.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  isPlausibleSeason,
  readRevalidateConfig,
  revalidateSeason,
  REVALIDATE_SECRET_ENV,
  REVALIDATE_URL_ENV,
  type RevalidateConfig,
  type RevalidateOutcome,
} from '../../src/lib/acquisition/season-revalidation';

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Only the two revalidation names are taken from `.env`; nothing else is loaded. */
export function revalidateEnvFromDotEnv(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...rest] = trimmed.split('=');
    const name = key.trim();
    if (name === REVALIDATE_URL_ENV || name === REVALIDATE_SECRET_ENV) out[name] = rest.join('=').trim();
  }
  return out;
}

export type RevalidateSeasonCliDeps = {
  env?: Record<string, string | undefined>;
  readDotEnv?: () => string | null;
  revalidate?: (config: RevalidateConfig, season: number) => Promise<RevalidateOutcome>;
  log?: (line: string) => void;
};

export async function main(args: readonly string[], deps: RevalidateSeasonCliDeps = {}): Promise<number> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const env = deps.env ?? process.env;

  if (env.INVOCATION_ID) {
    log('REFUSED: revalidate-season is an attended operator tool and does not run under systemd '
      + '(D-232-3: the scheduled jobs invalidate nothing).');
    return 2;
  }

  const index = args.indexOf('--season');
  const raw = index === -1 ? undefined : args[index + 1];
  const season = raw !== undefined && /^\d{4}$/.test(raw) ? Number(raw) : NaN;
  if (!isPlausibleSeason(season)) {
    log('usage: revalidate-season.ts --season <yyyy>');
    return 2;
  }

  const readDotEnv = deps.readDotEnv ?? (() => {
    try {
      return readFileSync(join(PROJECT_ROOT, '.env'), 'utf8');
    } catch {
      return null;
    }
  });
  const fromFile = revalidateEnvFromDotEnv(readDotEnv() ?? '');
  const merged: Record<string, string | undefined> = {
    [REVALIDATE_URL_ENV]: env[REVALIDATE_URL_ENV] || fromFile[REVALIDATE_URL_ENV],
    [REVALIDATE_SECRET_ENV]: env[REVALIDATE_SECRET_ENV] || fromFile[REVALIDATE_SECRET_ENV],
  };

  let config: RevalidateConfig | null;
  try {
    config = readRevalidateConfig(merged);
  } catch (error) {
    log(`NOT CONFIGURED: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  if (!config) {
    log(`NOT CONFIGURED: neither ${REVALIDATE_URL_ENV} nor ${REVALIDATE_SECRET_ENV} is set; nothing was posted.`);
    return 2;
  }

  const outcome = await (deps.revalidate ?? revalidateSeason)(config, season);
  const of = outcome.workerCount > 0 ? `/${outcome.workerCount}` : '';
  if (outcome.ok) {
    log(`REVALIDATED season ${season}: ${outcome.workersReached.length}${of} worker(s) reached `
      + `(${outcome.workersReached.join(',') || 'single'}) in ${outcome.attempts} request(s).`);
    return 0;
  }
  log(`INCOMPLETE season ${season}: ${outcome.workersReached.length}${of} worker(s) reached in `
    + `${outcome.attempts} request(s)`
    + (outcome.failures.length > 0 ? `: ${outcome.failures.slice(0, 5).join('; ')}` : '') + '.');
  return 1;
}

if (process.argv[1] && /[\\/]revalidate-season\.ts$/.test(process.argv[1])) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (error) => {
    console.error(error);
    process.exit(2);
  });
}
