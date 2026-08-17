/**
 * Shared runtime for the stress harness's two runners: environment
 * loading, the database-name guard, the parsing/execution engine, and
 * the worker pool. Extracted from stress-test.ts when V2 support arrived
 * so both corpus formats drive the identical engine -- a scoring
 * difference between V1 and V2 runs must never be an engine difference.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ------------------------------------------------------------------ options

export function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

export function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

export function options(name: string): string[] {
  const values: string[] = [];
  process.argv.forEach((arg, index) => {
    if (arg === `--${name}` && process.argv[index + 1]) values.push(process.argv[index + 1]);
  });
  return values;
}

// --------------------------------------------------------------------- env

/** Same loader tools/db/migrate.ts uses: an already-exported variable always wins. */
export function loadEnv(): void {
  let contents: string;
  try {
    contents = readFileSync(join(PROJECT_ROOT, '.env'), 'utf8');
  } catch {
    return;
  }
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...rest] = trimmed.split('=');
    const name = key.trim();
    if (!process.env[name]) process.env[name] = rest.join('=').trim();
  }
}

/**
 * A corpus run is sustained load. It must land on a database whose name
 * says it exists to be hammered, the same allowlist rule tests/setup.ts
 * applies -- refusing only a name that looks like production would leave
 * every other database acceptable by default.
 */
export function guardDatabase(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set. Run this from the project root on a server with a .env, or export it.');
  }
  let database: string;
  try {
    database = new URL(url).pathname.replace(/^\//, '');
  } catch {
    throw new Error('DATABASE_URL is not a valid connection URL.');
  }
  if (!/_(dev|test)$/.test(database) && !flag('allow-any-database')) {
    throw new Error(
      `DATABASE_URL points at '${database}', which is not a _dev or _test database. `
      + 'Refusing to run a stress corpus against it. Pass --allow-any-database if that is genuinely what you want.',
    );
  }
  return database;
}

// ------------------------------------------------------------------ engine

export function normaliseKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export type StressEngine = Awaited<ReturnType<typeof loadEngine>>;

/**
 * Imports the engine after the environment is settled.
 *
 * src/db/client.ts builds its pool at module evaluation time, so a static
 * import would run before loadEnv() and throw "DATABASE_URL is not set".
 * Player resolution is memoised on the way through: a corpus asks about a
 * few dozen players across thousands of questions, and the same trigram
 * search repeated ten thousand times is the single largest avoidable cost
 * in a run.
 */
export async function loadEngine() {
  // Every query module is marked `server-only`, whose default export
  // throws to stop a Client Component importing database code. Node
  // resolves that package's harmless entry under the react-server
  // condition, which `npm run nl:stress` sets -- hence the reminder
  // rather than the package's own message, which would be baffling here.
  const loaded = await Promise.all([
    import('@/db/queries/nl/resolve'),
    import('@/db/queries/nl/execute'),
    import('@/search/nl/plan'),
    import('@/search/nl/parser'),
    import('@/db/client'),
  ]).catch((error: unknown) => {
    if (error instanceof Error && /Client Component/.test(error.message)) {
      throw new Error(
        'Run this through `npm run nl:stress -- <options>`, or add '
        + '--conditions=react-server to tsx. Without it Node resolves the '
        + 'server-only guard to the copy that throws.',
      );
    }
    throw error;
  });
  const [{ buildNlParseContext }, { executePlan }, plan, { parseNlQuestion }, { sql }] = loaded;

  const ctx = await buildNlParseContext();
  const memo = new Map<string, ReturnType<typeof ctx.resolvePlayer>>();
  const resolvePlayer = (name: string) => {
    const cached = memo.get(name);
    if (cached) return cached;
    const pending = ctx.resolvePlayer(name);
    memo.set(name, pending);
    return pending;
  };

  // The scoring layers compare club and venue identity, not names, and
  // get both from the directories the parser itself resolves against --
  // so "GWS Giants" and "Greater Western Sydney" are one club here for
  // exactly the reason they are one club to the parser.
  const clubByName = new Map<string, number>();
  for (const club of ctx.clubs) {
    for (const name of [club.name, ...club.names]) clubByName.set(normaliseKey(name), club.organizationId);
  }
  const venueByName = new Map<string, number>();
  for (const venue of ctx.venues) {
    for (const name of [venue.name, ...venue.names]) venueByName.set(normaliseKey(name), venue.id);
  }

  return {
    ctx: { ...ctx, resolvePlayer },
    clubByName,
    venueByName,
    parseNlQuestion,
    executePlan,
    validatePlan: plan.validatePlan,
    NL_COVERAGE: plan.NL_COVERAGE,
    BROWNLOW_GAME_VOTE_NOTE: plan.BROWNLOW_GAME_VOTE_NOTE,
    PARSER_VERSION: plan.PARSER_VERSION,
    sql,
  };
}

// -------------------------------------------------------------------- pool

/** Fixed-size worker pool: `concurrency` items in flight, next one started as each finishes. */
export async function runPool<T>(
  items: readonly T[],
  worker: (item: T) => Promise<void>,
  concurrency: number,
): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      await worker(items[index]);
    }
  });
  await Promise.all(runners);
}

/**
 * The same pool over an async source, for a corpus too large to hold in
 * memory: `concurrency` workers pull from one shared iterator, so exactly
 * one row is materialised per in-flight worker.
 */
export async function runPoolStream<T>(
  source: AsyncIterator<T>,
  worker: (item: T) => Promise<void>,
  concurrency: number,
): Promise<void> {
  const runners = Array.from({ length: Math.max(1, concurrency) }, async () => {
    for (;;) {
      const next = await source.next();
      if (next.done) return;
      await worker(next.value);
    }
  });
  await Promise.all(runners);
}
