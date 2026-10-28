// D-V2-CURRENT-SHADOW-FOLLOWUP-1 item 7 (bounded): aggregate drift of this archive's baseline against the only
// retained 7fefcd9b figures available under existing authority, the committed sanitised record
// docs/v2/evidence/fresh-production-rehearsal-2026-10-21.json. Files only; writes one new JSON (exclusive).
// It is NOT the archive-to-archive report: the 7fefcd9b archive and its restricted preservation snapshot are
// not on streamanator, so per-table and per-row drift cannot be measured here.
//   node drift-summary.mjs <before.preservation.json> <brownlowMeta.json> <out>
import { readFileSync, writeFileSync } from 'node:fs';

const [prePath, brownlowMetaPath, out] = process.argv.slice(2);
if (!out) throw new Error('usage: drift-summary.mjs <before.preservation.json> <brownlowMeta.json> <out>');
const pre = JSON.parse(readFileSync(prePath, 'utf8'));
const bm = JSON.parse(readFileSync(brownlowMetaPath, 'utf8'));
const perTable = Object.fromEntries(Object.entries(pre.tables).map(([k, v]) => [k, v.rows.length]).sort());
const total = Object.values(perTable).reduce((n, x) => n + x, 0);
// Committed 7fefcd9b figures (the record's own wording in brackets).
const REF = { source: 'docs/v2/evidence/fresh-production-rehearsal-2026-10-21.json', archiveSha256: '7fefcd9b791520ccc939f7f9d0ca1ddacd5fe99d2cca33d53ea1aa9c6dea6599',
  baselineTables: 99, baselineRowsIncludingLedger: 1659904, ledger: 110, storedBrownlowSeasons: 98 };
const current = { archiveSha256: pre.scope?.backupSha256 ?? null, scope: pre.scope, baselineTables: Object.keys(perTable).length,
  baselineRowsIncludingLedger: total, ledger: perTable['afldb_meta.schema_migrations'] ?? null, storedBrownlowSeasons: bm.seasons };
const record = {
  decision: 'D-V2-CURRENT-SHADOW-FOLLOWUP-1', item: '7 bounded aggregate drift (NOT the archive-to-archive report)',
  reference7fefcd9b: REF, current,
  deltas: { baselineTables: current.baselineTables - REF.baselineTables, baselineRowsIncludingLedger: total - REF.baselineRowsIncludingLedger,
    ledger: current.ledger - REF.ledger, storedBrownlowSeasons: current.storedBrownlowSeasons - REF.storedBrownlowSeasons },
  currentPerTableRows: perTable,
  limits: [
    'Aggregate counts only. A zero net delta would not prove zero drift: inserts and deletes can cancel, and content changes are invisible to counts.',
    'Per-table and per-row drift against 7fefcd9b needs that archive (production and the restricted Windows folder only) or its restricted preservation snapshot (WSL rehearsal store); neither is on streamanator under this authority.',
    'The 98-season stored-report hash of 7fefcd9b (fea86e5d...) was produced by a different, unretained script and source revision; it is not byte-comparable with this run\'s report.',
  ],
};
writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ current: { ...current, scope: undefined }, deltas: record.deltas }));
