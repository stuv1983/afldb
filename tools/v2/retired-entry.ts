/**
 * AFLDB V2 Stage 4 -- retired entry point refusal (plan D10, ADR 0010, R-006).
 *
 *   npx tsx tools/v2/retired-entry.ts <script-name>
 *
 * A `package.json` script whose tool was quarantined under `legacy/offline/` points here instead.
 * It prints what was retired, why, where the offline tool now lives and which document governs it,
 * then exits 1. An unknown name exits 1 as well. No database, no network, no file access: the
 * registry is the pure constant in @afldb/domain, which tests/v2-module-boundaries.test.ts reads.
 */
import { findRetiredEntry, renderRetiredEntryRefusal, renderUnknownRetiredEntry } from '@afldb/domain';

function main(argv: readonly string[]): number {
  const name = argv[0] ?? '';
  const entry = name ? findRetiredEntry(name) : null;
  console.error(entry ? renderRetiredEntryRefusal(entry) : renderUnknownRetiredEntry(name));
  return 1;
}

process.exit(main(process.argv.slice(2)));
