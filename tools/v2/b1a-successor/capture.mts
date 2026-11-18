/**
 * AFLDB-ISSUE-366: the read-only v2 capture (successor of run6r/b1a/b1a-accept-r6r.sql, which stays as historical evidence).
 * One REPEATABLE READ READ ONLY transaction; identity is passed, never defaulted.
 *
 *   capture.mts --dsn-env <VAR> --expect-db <db> --expect-oid <oid> --expect-sysid <sysid> --sitting <STAMP> --out <file>
 *       [--verify-before --expect-ids-md5 <32 hex>]     P3: write the BEFORE capture (mode 600), print its sha256 and, with
 *                                                       --verify-before, BEFORE-CHECK PASS|FAIL (exit 0|1)
 *   capture.mts ... --sitting <STAMP> --compare <baseline> --baseline-sha256 <hex> --expect original|repaired [--out <file>]
 *                                                       P6 acceptance AFTER: ACCEPTANCE <state> EXACT (exit 0) or
 *                                                       ACCEPTANCE NOT EXACT (exit 1)
 * Any refusal or error exits 2. Prints labelled aggregates and hashes only.
 */
import { readFileSync, writeFileSync } from 'node:fs';

import postgres from 'postgres';

import { captureLines, pinOutputSettings, readIdentity, redact } from './db';
import {
  EXPECTED_ROWS, bindBaseline, classifyState, isStamp, labelOf, parseCapture, sha256Hex, COVERAGE_KEYS,
} from './lib';

const args = process.argv.slice(2);
const arg = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const fail = (why: string, code = 2): never => { console.log(`CAPTURE REFUSED ${why}`); process.exit(code); };
const valued = ['--dsn-env', '--expect-db', '--expect-oid', '--expect-sysid', '--sitting', '--out', '--expect-ids-md5', '--compare', '--baseline-sha256', '--expect'];
const unknown = args.filter((a, i) => a.startsWith('--') && a !== '--verify-before' && !valued.includes(a) && !valued.includes(args[i - 1]));
const dsnEnv = arg('dsn-env'); const db = arg('expect-db'); const oid = arg('expect-oid'); const sysid = arg('expect-sysid');
const sitting = arg('sitting'); const out = arg('out'); const compare = arg('compare'); const expect = arg('expect');
if (unknown.length || !dsnEnv || !db || !/^\d+$/.test(oid ?? '') || !/^\d+$/.test(sysid ?? '') || !isStamp(sitting)) {
  fail(`usage: --dsn-env, --expect-db, --expect-oid, --expect-sysid and --sitting <STAMP> are required${unknown.length ? `; unknown ${unknown.join(' ')}` : ''}`);
}
if (!compare && !out) fail('usage: --out <file> (BEFORE capture) or --compare <baseline> (acceptance) is required');
if (compare && !/^(original|repaired)$/.test(expect ?? '')) fail('usage: --compare needs --expect original|repaired and --baseline-sha256');
if (args.includes('--verify-before') && !/^[0-9a-f]{32}$/.test(arg('expect-ids-md5') ?? '')) fail('usage: --verify-before needs --expect-ids-md5');
const dsn = process.env[dsnEnv!];
if (!dsn) fail(`${dsnEnv} is not set`);

let baselineLines: readonly string[] | null = null;
if (compare) {
  let bytes: Buffer;
  try { bytes = readFileSync(compare); } catch (e) { fail(`baseline unreadable: ${(e as Error).message}`); }
  const want = arg('baseline-sha256') ?? '';
  if (sha256Hex(bytes!) !== want) fail(`baseline sha256 ${sha256Hex(bytes!)} differs from --baseline-sha256`);
  const { baseline, problems } = parseCapture(bytes!.toString('utf8'));
  if (!baseline) fail(`baseline: ${problems.join('; ')}`);
  if (baseline!.sitting !== sitting) fail(`baseline is for sitting ${baseline!.sitting}`);
  baselineLines = baseline!.lines;
}

const sql = postgres(dsn!, { max: 1, onnotice: () => {}, connection: { application_name: `afldb-b1a-capture ${sitting}` } });
let lines: string[] = [];
try {
  lines = await sql.begin('isolation level repeatable read read only', async (tx) => {
    await pinOutputSettings(tx);
    const id = await readIdentity(tx);
    if (id.db !== db || id.oid !== oid || id.sysid !== sysid || id.ro !== 'on') throw new Error(`identity/read-only mismatch: ${JSON.stringify(id)}`);
    return captureLines(tx, sitting!);
  });
} catch (e) {
  fail(redact((e as Error).message));
} finally {
  await sql.end({ timeout: 5 });
}
const text = `${lines.join('\n')}\n`;
if (out) {
  writeFileSync(out, text, { mode: 0o600, flag: 'wx' });
  console.log(`CAPTURE ${out} lines ${lines.length} sha256 ${sha256Hex(Buffer.from(text))}`);
} else process.stdout.write(text);

if (args.includes('--verify-before')) {
  const f: string[] = [];
  const bound = bindBaseline(Buffer.from(text), { sha256: sha256Hex(Buffer.from(text)), sitting: sitting!, db: db!, oid: oid!, sysid: sysid!, idsMd5: arg('expect-ids-md5')! });
  f.push(...bound.problems);
  for (const k of COVERAGE_KEYS) if (!lines.includes(`cov2026|${k}|pending|f|-|-`)) f.push(`cov2026 ${k} is not pending/unrecorded/-/-`);
  const inputs = lines.find((l) => labelOf(l) === 'inputs2026') ?? '';
  if (!/^inputs2026\|complete\/0\/\d+\/.*\/0$/.test(inputs)) f.push(`${inputs || 'inputs2026 missing'}: expected complete/0/<round rows>/<entry>/0`);
  if (!/^na_pss\|(\d+)\|\d+$/.test(lines.find((l) => labelOf(l) === 'na_pss') ?? '') || Number(/^na_pss\|(\d+)/.exec(lines.find((l) => labelOf(l) === 'na_pss')!)![1]) < EXPECTED_ROWS) f.push('na_pss does not include the 669 rows');
  console.log(f.length ? `BEFORE-CHECK FAIL: ${f.join('; ')}` : 'BEFORE-CHECK PASS');
  console.log(`BASELINE-SHA256 ${sha256Hex(Buffer.from(text))}`);
  process.exitCode = f.length ? 1 : 0;
}
if (baselineLines) {
  const state = classifyState(baselineLines, lines);
  if (state.kind === expect) { console.log(`ACCEPTANCE ${state.kind} EXACT`); process.exitCode = 0; }
  else { console.log(`ACCEPTANCE NOT EXACT: state is ${state.kind}${state.kind === 'other' ? ` (${state.detail})` : ''}, expected ${expect}`); process.exitCode = 1; }
}
