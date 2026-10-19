/**
 * AFLDB V2 Launch F — cutover preflight: refuse the release while a legacy production writer can run.
 *
 *   npx tsx tools/v2/cutover-preflight.ts legacy-writers            (on the production host)
 *   npx tsx tools/v2/cutover-preflight.ts legacy-writers --facts <file.json>
 *
 * Read-only. On the host it runs exactly one command, `systemctl show <the four legacy units>
 * --property=Id,LoadState,UnitFileState,ActiveState` (spawned without a shell), and lists
 * /etc/polkit-1/rules.d. It never starts, stops, enables or disables anything, opens no database
 * and makes no network request. `--facts` judges facts gathered elsewhere (a rehearsal) instead.
 *
 * Exit 0 = PASS (one release precondition, never the go), 1 = REFUSE, 2 = the facts could not be
 * gathered or read (also a refusal).
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LEGACY_WRITER_UNITS,
  assessLegacyWriterPreflight,
  parseSystemctlShow,
  renderLegacyWriterPreflight,
  type LegacyWriterFacts,
} from '@afldb/domain';

export type PreflightDeps = {
  platform?: NodeJS.Platform;
  systemctlShow?: () => { status: number | null; stdout: string };
  listPolkitRules?: () => string[] | null;
  readFacts?: (path: string) => string;
  log?: (line: string) => void;
};

export function gatherLegacyWriterFacts(deps: PreflightDeps = {}): LegacyWriterFacts | string {
  if ((deps.platform ?? process.platform) !== 'linux') return 'not a Linux host: run this on the production host, or pass --facts';
  const show = (deps.systemctlShow ?? (() => {
    const r = spawnSync('systemctl', ['show', ...LEGACY_WRITER_UNITS, '--property=Id,LoadState,UnitFileState,ActiveState'],
      { encoding: 'utf8', shell: false });
    return { status: r.status, stdout: r.stdout ?? '' };
  }))();
  if (show.status !== 0) return `systemctl show exited ${String(show.status)}`;
  const polkit = (deps.listPolkitRules ?? (() => {
    try { return readdirSync('/etc/polkit-1/rules.d'); } catch { return null; }
  }))();
  return { units: parseSystemctlShow(show.stdout), polkitRules: polkit };
}

export function runCutoverPreflight(argv: readonly string[], deps: PreflightDeps = {}): number {
  const log = deps.log ?? ((line: string) => console.log(line));
  if (argv[0] !== 'legacy-writers' || (argv.length !== 1 && !(argv.length === 3 && argv[1] === '--facts'))) {
    log('usage: cutover-preflight.ts legacy-writers [--facts <file.json>]');
    return 2;
  }
  let facts: LegacyWriterFacts | string;
  if (argv.length === 3) {
    try {
      facts = JSON.parse((deps.readFacts ?? ((p: string) => readFileSync(p, 'utf8')))(argv[2])) as LegacyWriterFacts;
      if (!Array.isArray(facts.units)) facts = '--facts has no units array';
    } catch (error) {
      facts = `--facts could not be read: ${error instanceof Error ? error.message : String(error)}`;
    }
  } else {
    facts = gatherLegacyWriterFacts(deps);
  }
  if (typeof facts === 'string') {
    log(`Legacy production writers: CANNOT DETERMINE (${facts}). The release is refused.`);
    return 2;
  }
  const result = assessLegacyWriterPreflight(facts);
  log(renderLegacyWriterPreflight(result));
  return result.verdict === 'PASS' ? 0 : 1;
}

const invokedDirectly = process.argv[1] !== undefined
  && relative(resolve(process.argv[1]), fileURLToPath(import.meta.url)) === '';
if (invokedDirectly) process.exit(runCutoverPreflight(process.argv.slice(2)));
