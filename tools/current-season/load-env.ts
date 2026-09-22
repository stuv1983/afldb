/**
 * AFLDB-ISSUE-244 I244-F029 — the ONE `.env` loader the systemd-invoked
 * current-season CLIs share.
 *
 * The settle/acquisition units deliberately narrow what the process may see:
 *
 *   EnvironmentFile=/home/arm/projects/afldb/.env
 *   UnsetEnvironment=AFLDB_OWNER_DATABASE_URL AFLDB_AUTH_DATABASE_URL ...
 *
 * systemd loads the file, then strips the credentials the job has no business
 * holding. Every one of those CLIs then called its own private `loadEnv()`,
 * which re-opened the SAME `.env` and repopulated anything currently unset —
 * so a variable systemd had just removed came straight back, in-process,
 * before the first line of work. `UnsetEnvironment=` was decorative.
 *
 * The fix is one process-environment policy flag. When `AFLDB_SKIP_DOTENV` is
 * `'1'` this loader returns BEFORE the file is opened, read, parsed or applied
 * to `process.env`; the systemd wrappers export it once they have been handed
 * the already-narrowed environment (see `deploy/afldb-settle-*.sh`, gated on
 * systemd's own `INVOCATION_ID`). Outside systemd nothing sets it and the
 * previous manual/dev convenience is unchanged.
 *
 * The flag is read from the PROCESS environment only. Reading it out of `.env`
 * would mean opening `.env` to decide whether `.env` may be opened, which is
 * not a boundary at all.
 *
 * LIMITATION (recorded, not closed): this stops `.env` being rehydrated
 * through the normal application path. It does NOT make `<repo>/.env`
 * unreadable to the Unix account the unit runs as — a compromised process
 * running as that user can still open the file itself. Real filesystem-level
 * isolation needs per-unit environment fragments, separate service accounts,
 * a secret manager or file permissions, none of which are in F029's scope.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Set to `'1'` by a systemd wrapper once systemd has applied
 * `EnvironmentFile=` and `UnsetEnvironment=`. Never written by this module:
 * it is policy handed down by the caller, not state this loader owns.
 */
export const SKIP_DOTENV_ENV = 'AFLDB_SKIP_DOTENV';

/**
 * Populate `process.env` from `<projectRoot>/.env`, preserving the semantics
 * every current-season CLI relied on before F029 consolidated them:
 *
 *   - a missing or unreadable `.env` is not an error, it is a no-op;
 *   - blank lines, and lines whose first non-space character is `#`, are
 *     skipped;
 *   - a line without `=` is skipped;
 *   - the name is everything before the FIRST `=`, the value everything
 *     after it (so `DSN=postgres://u:p@h/db?a=b` keeps its `=`);
 *   - name and value are both trimmed, which is also what strips the `\r` of
 *     a CRLF checkout;
 *   - an already-set variable is NEVER overwritten. This is what keeps
 *     I244-F016's control/writer same-database safety intact: a DSN systemd
 *     supplied wins over the file.
 */
export function loadEnv(projectRoot: string): void {
  // Before the open, not after: the whole point is that a stripped secret is
  // never read back into this process.
  if (process.env[SKIP_DOTENV_ENV] === '1') return;

  let contents: string;
  try {
    contents = readFileSync(join(projectRoot, '.env'), 'utf8');
  } catch {
    return;
  }
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const name = trimmed.slice(0, eq).trim();
    if (!process.env[name]) process.env[name] = trimmed.slice(eq + 1).trim();
  }
}
