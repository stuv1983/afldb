/**
 * AFLDB V2 Stage 3 — AFL API pipeline stage-map generator (docs/v2/plan.md §3 D1).
 *
 *   npx tsx tools/v2/acquisition-stage-map.ts --write   replaces ONLY the text between
 *                                                        <!-- stage-map:begin --> and
 *                                                        <!-- stage-map:end --> in docs/v2/architecture.md
 *   npx tsx tools/v2/acquisition-stage-map.ts --check   exits 1 when that section is stale
 *
 * The table is rendered from the `@afldb/acquisition` stage contract; every cited `path:line` is
 * read from the repository (current directory), so a symbol that is not exported where it is cited
 * refuses the run. The rest of the document is never touched and its line endings are preserved.
 * No database, no network.
 *
 * Exit status: 0 ok; 1 --check found the section stale; 2 usage error or the contract does not hold.
 */
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  StageMapError, extractStageMap, renderAflApiStageMap, spliceStageMap,
} from '@afldb/acquisition';

export const ARCHITECTURE_DOC = 'docs/v2/architecture.md';

function readRepoFile(root: string, path: string): string | null {
  try {
    const full = join(root, path);
    return statSync(full).isFile() ? readFileSync(full, 'utf8') : null;
  } catch {
    return null;
  }
}

export function runCli(argv: readonly string[], root: string = process.cwd()): { code: number; lines: string[] } {
  const modes = argv.filter((arg) => arg === '--write' || arg === '--check');
  if (argv.length !== 1 || modes.length !== 1) {
    return { code: 2, lines: ['usage: npx tsx tools/v2/acquisition-stage-map.ts --write | --check'] };
  }
  try {
    const table = renderAflApiStageMap((path) => readRepoFile(root, path));
    const document = readRepoFile(root, ARCHITECTURE_DOC);
    if (document === null) return { code: 2, lines: [`${ARCHITECTURE_DOC} does not exist.`] };
    if (modes[0] === '--write') {
      writeFileSync(join(root, ARCHITECTURE_DOC), spliceStageMap(document, table));
      return { code: 0, lines: [`written: ${ARCHITECTURE_DOC} (stage map)`] };
    }
    const stale = extractStageMap(document) !== table;
    return stale
      ? { code: 1, lines: [`STALE: the stage map in ${ARCHITECTURE_DOC} differs from the pipeline contract; run --write.`] }
      : { code: 0, lines: [`ok: the stage map in ${ARCHITECTURE_DOC} matches the pipeline contract.`] };
  } catch (error) {
    if (error instanceof StageMapError) return { code: 2, lines: [`REFUSED: ${error.message}`] };
    throw error;
  }
}

if (process.argv[1] && /acquisition-stage-map\.ts$/.test(process.argv[1])) {
  const { code, lines } = runCli(process.argv.slice(2));
  for (const line of lines) console.log(line);
  process.exit(code);
}
