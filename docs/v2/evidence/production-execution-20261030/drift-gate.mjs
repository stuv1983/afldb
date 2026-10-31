// AFLDB V2 release: evidence-based attribution of a preservation difference (D-V2-PROD-EXEC-1 package,
// gates D and V3). It decides nothing on table names alone: every difference the file comparator reports
// is re-derived row by row from the two restored databases, and each changed row must match its writer's
// signature or the gate stops.
//
// Run from the private src tree (so `postgres` resolves) through isolated-pg, which supplies the SUBJECT
// database as AFLDB_OWNER_DATABASE_URL; the REFERENCE database is named and must be in the same isolated
// cluster:
//   isolated-pg.ts run <subject_db> -- node --input-type=module - <mode> <compare.json> <manifest_exit> \
//       <reference_db> <reference_time_iso> <out.json> < drift-gate.mjs
//   mode drift : subject = clone A of the frozen dump, reference = the a4641ca0 restore (gate D)
//   mode after : subject = clone C of the post-A-REL dump, reference = clone A after the A-REL sequence (V3)
//
// READ ONLY: one REPEATABLE READ READ ONLY transaction per database. No row value is written to the report
// except writer signatures (import_batches.tool/notes) and timestamps; auth tables contribute keys counts only.
//
// Exit: 0 NO_DIFFERENCE or LEDGER_TIMING_ONLY (mode after only); 3 ATTRIBUTED_ONLY (continue only on the owner's GO); 1 STOP; 2 invalid input or
// tool failure (never a pass).
import postgres from 'postgres';
import { readFileSync, writeFileSync } from 'node:fs';

const [mode, comparePath, manifestExitArg, referenceDb, referenceTimeArg, outPath] = process.argv.slice(2);
const fail = (m) => { process.stderr.write(`drift-gate: ${m}\n`); process.exit(2); };
if (!['drift', 'after'].includes(mode) || !comparePath || !outPath) fail('usage: <drift|after> <compare.json> <manifest_exit> <reference_db> <reference_time_iso> <out.json>');
if (!/^afldb_v2_shadow_[a-z0-9_]+_test$/.test(referenceDb ?? '')) fail('reference database must be an afldb_v2_shadow_*_test name');
const referenceTime = new Date(referenceTimeArg);
if (!/^\d{4}-\d\d-\d\dT/.test(referenceTimeArg ?? '') || Number.isNaN(referenceTime.getTime())) fail('reference time must be ISO-8601');
if (!/^\d+$/.test(manifestExitArg ?? '')) fail('manifest exit must be a number');
if (process.env.AFLDB_V2_ISOLATED_PG !== '1' || !process.env.AFLDB_OWNER_DATABASE_URL) fail('run only through isolated-pg.ts run');
const subjectUrl = new URL(process.env.AFLDB_OWNER_DATABASE_URL);
if (subjectUrl.hostname !== '127.0.0.1' || subjectUrl.port !== process.env.AFLDB_V2_ISOLATED_PORT) fail('subject is not the isolated loopback cluster');
const referenceUrl = new URL(subjectUrl.href);
referenceUrl.pathname = `/${referenceDb}`;
if (subjectUrl.pathname === referenceUrl.pathname) fail('subject and reference are the same database');

let compare;
try { compare = JSON.parse(readFileSync(comparePath, 'utf8')); } catch (e) { fail(`compare report unreadable: ${e.message}`); }
if (compare?.format !== 'afldb.v2.snapshot-compare.1' || compare.mode !== 'preservation' || !Array.isArray(compare.findings)) fail('not a snapshot-compare preservation report');

// Tables whose rows the A-REL sequence creates, alters or indexes, and the ledger. A row change in any of
// them between the accepted shadow and the freeze would invalidate the accepted rehearsal: always STOP.
const MIGRATION_SENSITIVE = new Set([
  'afldb_meta.schema_migrations', 'staging.afl_api_brownlow_vote', 'public.afl_api_identity_adjudications',
  'public.award_proposals', 'public.award_proposal_decisions', 'public.derived_award_results',
  'public.brownlow_eligibility_decisions', 'public.derived_award_projections', 'public.brownlow_correction_receipts',
]);
const SETTLE_NOTES = /^AFLDB-ISSUE-099 settle; snapshot=[^;]*; season=\d{4}; mode=apply$/;
// Writers that keep running while the admin-edit freeze holds (O-FREEZE a). `update` lists the only
// columns an update may touch. Each class is reported separately; none is canonical or public-query data.
// Column names are the applied catalogue's (read from the a4641ca0 restore, 2026-10-30).
//
// The settle footprint is the ff100dc2 writer's, read from its code (settle-afltables.ts:1845-1966, 2740,
// 2827, 3528, 3588-3613; observation-store.ts:104-224): one import_batches row per run; source_records
// inserted, head-refreshed or absence-marked; source_record_versions appended and closed; content-addressed
// payloads; the two projections, rejections and pending promotion candidates, each stamped with its batch.
// `time` is the row's own insert timestamp, `bind` the batch columns an insert must point at an attributed
// settle batch, `check` re-derives an update from the row before and after (null = consistent with settle).
const SETTLE = { cls: 'settle-bookkeeping', modes: ['drift'] };
const RULES = {
  'public.import_batches': { ...SETTLE, ops: ['insert'], time: 'started_at',
    row: (r) => r.tool === 'settle-afltables.ts' && r.target_table === 'staging.source_record_versions' && SETTLE_NOTES.test(r.notes ?? '') },
  'staging.source_records': { ...SETTLE, ops: ['insert', 'update'], time: 'first_seen_at', bind: ['last_batch_id'],
    update: { drift: ['scope_key', 'last_seen_at', 'last_batch_id', 'absent_since', 'current_version_seq', 'current_payload_hash'] },
    // A head refresh (unchanged or new version) moves last_batch_id to the run's batch; an absence mark
    // (markMissingObservationsAbsent) sets only absent_since and leaves last_batch_id alone.
    check: (b, a, t, x) => (a.last_batch_id !== b.last_batch_id
      ? (x.bound(a.last_batch_id) && x.since(a.last_seen_at) ? null : 'head refresh not bound to an attributed settle batch after the reference time')
      : (t.size === 1 && t.has('absent_since') && x.since(a.absent_since) ? null : 'change without a new batch is not an absence mark after the reference time')) },
  'staging.source_record_versions': { ...SETTLE, ops: ['insert', 'update'], time: 'observed_from', bind: ['opened_by_batch_id'],
    update: { drift: ['observed_to', 'closed_by_batch_id'] },
    check: (b, a, t, x) => (b.observed_to === null && b.closed_by_batch_id === null && x.bound(a.closed_by_batch_id) && x.since(a.observed_to)
      ? null : 'version close not bound to an attributed settle batch after the reference time') },
  // Content-addressed, no batch column: a new payload is always referenced by the version the same run opened.
  'staging.source_payloads': { ...SETTLE, ops: ['insert'], time: 'first_stored_at', needsBatch: true,
    refBy: { table: 'staging.source_record_versions', cols: ['source_id', 'family', 'payload_hash'], batch: 'opened_by_batch_id' } },
  // Every present record is re-projected on every run (settle-afltables.ts:2028): ON CONFLICT DO UPDATE re-stamps
  // projected_by_batch_id and projected_at, and may rewrite any projected value. '*' = every non-key column.
  'staging.afltables_match': { ...SETTLE, ops: ['insert', 'update'], time: 'projected_at', bind: ['projected_by_batch_id'], update: { drift: '*' },
    check: (b, a, t, x) => (x.bound(a.projected_by_batch_id) && x.since(a.projected_at) ? null : 'projection not re-stamped by an attributed settle batch after the reference time') },
  'staging.afltables_player_match': { ...SETTLE, ops: ['insert', 'update'], time: 'projected_at', bind: ['projected_by_batch_id'], update: { drift: '*' },
    check: (b, a, t, x) => (x.bound(a.projected_by_batch_id) && x.since(a.projected_at) ? null : 'projection not re-stamped by an attributed settle batch after the reference time') },
  'public.import_rejections': { ...SETTLE, ops: ['insert'], time: 'rejected_at', bind: ['import_batch_id'] },
  // A proposal queue for curated review, never canonical: reported as its own class so the owner sees it.
  'public.promotion_candidates': { cls: 'settle-candidates', modes: ['drift'], ops: ['insert', 'update'], time: 'created_at', bind: ['created_by_batch_id'],
    update: { drift: ['source_version_seq', 'verb', 'target_id', 'proposed_fields', 'baseline_canonical_hash', 'agreeing_groups', 'disagreeing_groups', 'created_by_batch_id'] },
    check: (b, a, t, x) => (b.status === 'pending' && x.bound(a.created_by_batch_id) ? null : 'candidate refresh not a pending row re-stamped by an attributed settle batch') },
  'public.auth_sessions': { cls: 'auth-activity', modes: ['drift', 'after'], ops: ['insert', 'delete', 'update'], update: { drift: ['expires_at', 'revoked_at'], after: ['expires_at', 'revoked_at'] } },
  'public.auth_audit_log': { cls: 'auth-activity', modes: ['drift', 'after'], ops: ['insert'] },
  // A sign-in advances totp_last_step; a password change (owner, before the freeze only) touches the rest.
  'public.auth_users': { cls: 'auth-activity', modes: ['drift', 'after'], ops: ['update'],
    update: { drift: ['totp_last_step', 'password_hash', 'password_changed_at', 'must_change_password'], after: ['totp_last_step'] } },
  'public.beta_login_tokens': { cls: 'auth-activity', modes: ['drift', 'after'], ops: ['insert', 'delete', 'update'], update: { drift: ['used_at'], after: ['used_at'] } },
  'public.app_health_events': { cls: 'runtime-telemetry', modes: ['drift', 'after'], ops: ['insert'] },
  'public.nl_search_log': { cls: 'runtime-telemetry', modes: ['drift', 'after'], ops: ['insert'] },
  'public.nl_search_feedback': { cls: 'runtime-telemetry', modes: ['drift', 'after'], ops: ['insert'] },
};
// Settle rows are attributed only through the explicit table rules above, each bound to an attributed settle
// batch. Thirty-eight tables reference import_batches, canonical ones included (matches, player_match_stats,
// award_winners, canonical_applications ...): a batch reference never makes any other table bookkeeping.
// Fallback insert-time columns for the non-settle rules (auth, telemetry), which name no `time`.
const TIME_COLUMNS = ['created_at', 'started_at', 'at', 'occurred_at', 'recorded_at', 'requested_at', 'logged_at', 'observed_at'];
const SECRET_SAFE = new Set(['public.import_batches']);
// A public query whose output may change only because of attributed writer rows: the query text is
// re-read from the reviewed contract and must be exactly this projection of its one source table. Every
// other public query joins canonical tables, so a change there always stops.
const QUERY_SOURCES = { audit_history: { sql: 'SELECT * FROM public.auth_audit_log', tables: ['public.auth_audit_log'] } };
const CONTRACT = 'docs/v2/preservation-queries.json';

const stops = [];
const tables = [];
const stop = (subject, reason) => stops.push({ subject, reason });

if (Number(manifestExitArg) !== 0) stop('historical-manifest', `sealed-scope comparison exit ${manifestExitArg} (must be 0, sealed-scope-identical)`);
const deferredQueries = [];
for (const f of compare.findings) {
  if (f.kind === 'QUERY_CHANGED' && Object.hasOwn(QUERY_SOURCES, f.query)) deferredQueries.push(f.query);
  else if (f.kind !== 'ROWS_CHANGED') stop(f.table ?? f.query, `${f.kind}: canonical, public-query or schema change`);
}
let contract = null;
if (deferredQueries.length) {
  try { contract = JSON.parse(readFileSync(CONTRACT, 'utf8')); } catch (e) { fail(`query contract unreadable: ${e.message}`); }
}
const changed = compare.findings.filter((f) => f.kind === 'ROWS_CHANGED').map((f) => f.table);

const open = (url) => postgres(url.href, { max: 1, onnotice: () => {}, connect_timeout: 10 });
const subject = open(subjectUrl);
const reference = open(referenceUrl);
const qid = (s) => `"${s.replace(/"/g, '""')}"`;

async function readOnly(sql, fn) {
  return sql.begin('ISOLATION LEVEL REPEATABLE READ READ ONLY', fn);
}

async function catalogue(tx, name) {
  const [ns, rel] = name.split('.');
  const cols = await tx`SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ${ns} AND c.relname = ${rel} AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`;
  const pk = await tx`SELECT a.attname AS name FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
    WHERE n.nspname = ${ns} AND c.relname = ${rel} AND i.indisprimary ORDER BY array_position(i.indkey::int2[], a.attnum)`;
  const fks = await tx`SELECT a.attname AS name FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(k.conkey)
    WHERE n.nspname = ${ns} AND c.relname = ${rel} AND k.contype = 'f' AND k.confrelid = 'public.import_batches'::regclass
      AND cardinality(k.conkey) = 1`;
  return { cols: cols.map((c) => c.name), types: Object.fromEntries(cols.map((c) => [c.name, c.type])), pk: pk.map((p) => p.name), fks: fks.map((f) => f.name) };
}

async function digests(tx, name, pk, exclude = []) {
  const [ns, rel] = name.split('.');
  const body = exclude.length ? `to_jsonb(t) - ARRAY[${exclude.map((c) => `'${c}'`).join(',')}]::text[]` : 'to_jsonb(t)';
  const rows = await tx.unsafe(`SELECT jsonb_build_array(${pk.map((c) => `t.${qid(c)}::text`).join(',')})::text AS k, md5((${body})::text) AS h FROM ${qid(ns)}.${qid(rel)} t`);
  return new Map(rows.map((r) => [r.k, r.h]));
}

async function rowsFor(tx, name, pk, keys, columns) {
  if (!keys.length || !columns.length) return [];
  const [ns, rel] = name.split('.');
  return tx.unsafe(`SELECT jsonb_build_array(${pk.map((c) => `t.${qid(c)}::text`).join(',')})::text AS k, ${columns.map((c) => `t.${qid(c)}`).join(', ')}
    FROM ${qid(ns)}.${qid(rel)} t WHERE jsonb_build_array(${pk.map((c) => `t.${qid(c)}::text`).join(',')})::text = ANY($1::text[])`, [keys]);
}

async function changedColumns(tx, name, pk, keys) {
  if (!keys.length) return new Map();
  const [ns, rel] = name.split('.');
  const rows = await tx.unsafe(`SELECT jsonb_build_array(${pk.map((c) => `t.${qid(c)}::text`).join(',')})::text AS k, to_jsonb(t) AS j
    FROM ${qid(ns)}.${qid(rel)} t WHERE jsonb_build_array(${pk.map((c) => `t.${qid(c)}::text`).join(',')})::text = ANY($1::text[])`, [keys]);
  return new Map(rows.map((r) => [r.k, r.j]));
}

const settleBatchIds = new Set();
try {
  await readOnly(subject, async (s) => {
    await readOnly(reference, async (r) => {
      // Settle bookkeeping first, so the staging tables can be bound to the attributed batches.
      const order = [...changed].sort((a, b) => (a === 'public.import_batches' ? -1 : b === 'public.import_batches' ? 1 : a.localeCompare(b)));
      for (const name of order) {
        const entry = { table: name, cls: null, inserted: 0, deleted: 0, updated: 0, evidence: {}, verdict: 'STOP' };
        tables.push(entry);
        const cs = await catalogue(s, name);
        const cr = await catalogue(r, name);
        if (JSON.stringify(cs) !== JSON.stringify(cr)) { stop(name, 'catalogue shape differs between subject and reference'); continue; }
        if (!cs.pk.length) { stop(name, 'no primary key: row-level evidence impossible'); continue; }
        const ledger = name === 'afldb_meta.schema_migrations';
        if (MIGRATION_SENSITIVE.has(name) && !(ledger && mode === 'after')) { stop(name, 'row change in a migration-sensitive table'); continue; }
        // In V3 the ledger rows written by the window's own migrate run carry production timestamps; only
        // applied_at/duration_ms may differ, and names, checksums and every other row must be identical.
        const exclude = ledger ? ['applied_at', 'duration_ms'] : [];
        const ds = await digests(s, name, cs.pk, exclude);
        const dr = await digests(r, name, cs.pk, exclude);
        const inserted = [...ds.keys()].filter((k) => !dr.has(k));
        const deleted = [...dr.keys()].filter((k) => !ds.has(k));
        const updated = [...ds.keys()].filter((k) => dr.has(k) && dr.get(k) !== ds.get(k));
        Object.assign(entry, { inserted: inserted.length, deleted: deleted.length, updated: updated.length });
        if (ledger) {
          entry.cls = 'migration-ledger-timing';
          if (inserted.length || deleted.length || updated.length) { stop(name, 'ledger differs beyond applied_at/duration_ms'); continue; }
          entry.evidence = { comparedExcluding: exclude, rows: ds.size };
          entry.verdict = 'ATTRIBUTED';
          continue;
        }
        if (!inserted.length && !deleted.length && !updated.length) { stop(name, 'comparator reported ROWS_CHANGED but no row differs: inconsistent evidence'); continue; }
        const rule = RULES[name];
        if (!rule || !rule.modes.includes(mode)) { stop(name, `no attributable writer for this table in mode ${mode}`); continue; }
        entry.cls = rule.cls;
        const ops = { insert: inserted.length, delete: deleted.length, update: updated.length };
        const badOps = Object.entries(ops).filter(([op, n]) => n && !rule.ops.includes(op)).map(([op]) => op);
        if (badOps.length) { stop(name, `operation(s) ${badOps.join(', ')} not produced by ${rule.cls}`); continue; }
        const missing = [rule.time, ...(rule.bind ?? [])].filter((c) => c && !cs.cols.includes(c));
        if (missing.length) { stop(name, `rule column(s) ${missing.join(', ')} absent from the catalogue`); continue; }
        if (rule.needsBatch && !settleBatchIds.size) { stop(name, 'settle rows without any attributed settle batch in this run'); continue; }
        const timeCol = rule.time ?? TIME_COLUMNS.find((c) => cs.cols.includes(c) && /^timestamp/.test(cs.types[c]));
        if (inserted.length) {
          if (!timeCol || !/^timestamp/.test(cs.types[timeCol])) { stop(name, 'inserted rows carry no timestamp column: time evidence impossible'); continue; }
          const sig = SECRET_SAFE.has(name) ? ['tool', 'target_table', 'notes'].filter((c) => cs.cols.includes(c)) : [];
          const rows = await rowsFor(s, name, cs.pk, inserted, [timeCol, ...sig, ...(rule.bind ?? [])]);
          if (rows.length !== inserted.length) { stop(name, 'could not re-read every inserted row'); continue; }
          const early = rows.filter((x) => !(x[timeCol] instanceof Date) || x[timeCol] < referenceTime);
          if (early.length) { stop(name, `${early.length} inserted row(s) dated before the reference capture or undated`); continue; }
          if (rule.row && !rows.every(rule.row)) { stop(name, 'an inserted row does not match the writer signature'); continue; }
          if (rule.bind) {
            // Every bind column must name an attributed settle batch (never null).
            const unbound = rows.filter((x) => !rule.bind.every((c) => x[c] !== null && x[c] !== undefined && settleBatchIds.has(String(x[c]))));
            if (unbound.length) { stop(name, `${unbound.length} inserted row(s) not bound to an attributed settle batch`); continue; }
          }
          if (rule.refBy) {
            const r = rule.refBy;
            const orphans = await s.unsafe(`SELECT jsonb_build_array(${r.cols.map((c) => `p.${qid(c)}::text`).join(',')})::text AS k
              FROM ${name.split('.').map(qid).join('.')} p WHERE jsonb_build_array(${cs.pk.map((c) => `p.${qid(c)}::text`).join(',')})::text = ANY($1::text[])
               AND NOT EXISTS (SELECT 1 FROM ${r.table.split('.').map(qid).join('.')} v WHERE ${r.cols.map((c) => `v.${qid(c)} = p.${qid(c)}`).join(' AND ')}
                 AND v.${qid(r.batch)}::text = ANY($2::text[]))`, [inserted, [...settleBatchIds]]);
            if (orphans.length) { stop(name, `${orphans.length} inserted row(s) not referenced by a ${r.table} row of an attributed settle batch`); continue; }
          }
          if (name === 'public.import_batches') for (const x of rows) settleBatchIds.add(JSON.parse(x.k)[0]);
          const times = rows.map((x) => x[timeCol].toISOString()).sort();
          entry.evidence.inserted = { timeColumn: timeCol, earliest: times[0], latest: times.at(-1) };
          if (sig.length) entry.evidence.signatures = [...new Set(rows.map((x) => `${x.tool} | ${x.target_table} | ${x.notes}`))];
        }
        if (updated.length) {
          const a = await changedColumns(s, name, cs.pk, updated);
          const b = await changedColumns(r, name, cs.pk, updated);
          const touched = new Set();
          for (const k of updated) for (const c of cs.cols) if (JSON.stringify(a.get(k)?.[c]) !== JSON.stringify(b.get(k)?.[c])) touched.add(c);
          const allowed = rule.update?.[mode] === '*' ? cs.cols.filter((c) => !cs.pk.includes(c)) : (rule.update?.[mode] ?? []);
          const outside = [...touched].filter((c) => !allowed.includes(c));
          entry.evidence.updatedColumns = [...touched].sort();
          if (outside.length) { stop(name, `update touched column(s) outside the writer's set: ${outside.sort().join(', ')}`); continue; }
          if (rule.check) {
            // Per row: the columns that row changed, and the writer's own consistency rule over before/after.
            const x = { bound: (v) => v !== null && v !== undefined && settleBatchIds.has(String(v)),
              since: (v) => v !== null && v !== undefined && !Number.isNaN(new Date(v).getTime()) && new Date(v) >= referenceTime };
            const bad = updated.filter((k) => {
              const rowTouched = new Set(cs.cols.filter((c) => JSON.stringify(a.get(k)?.[c]) !== JSON.stringify(b.get(k)?.[c])));
              return rule.check(b.get(k) ?? {}, a.get(k) ?? {}, rowTouched, x) !== null;
            });
            if (bad.length) { stop(name, `${bad.length} updated row(s) inconsistent with ${rule.cls}: ${rule.check(b.get(bad[0]) ?? {}, a.get(bad[0]) ?? {}, new Set(), x)}`); continue; }
          }
        }
        entry.verdict = 'ATTRIBUTED';
      }
    });
  });
} catch (e) {
  await Promise.allSettled([subject.end({ timeout: 5 }), reference.end({ timeout: 5 })]);
  fail(`database read failed: ${e.message}`);
}
await Promise.allSettled([subject.end({ timeout: 5 }), reference.end({ timeout: 5 })]);

// A deferred public-query change holds only when its contract text is the pinned projection and every
// source table changed with an ATTRIBUTED verdict in this run.
const queries = [];
for (const q of deferredQueries) {
  const src = QUERY_SOURCES[q];
  const textOk = contract?.[q] === src.sql;
  const explained = src.tables.every((t) => tables.some((e) => e.table === t && e.verdict === 'ATTRIBUTED'));
  queries.push({ query: q, sources: src.tables, contractTextPinned: textOk, explainedByAttributedRows: explained });
  if (!textOk) stop(q, 'QUERY_CHANGED: the contract text is not the pinned single-table projection');
  else if (!explained) stop(q, 'QUERY_CHANGED: not explained by attributed changes in its source table');
}

// The window's own migrate run necessarily stamps production applied_at values; when that is the only
// difference (names, checksums and every other row identical), V3 holds without an owner decision.
const timingOnly = tables.length > 0 && tables.every((t) => t.cls === 'migration-ledger-timing');
const verdict = stops.length ? 'STOP' : timingOnly ? 'LEDGER_TIMING_ONLY' : tables.length ? 'ATTRIBUTED_ONLY' : 'NO_DIFFERENCE';
const report = {
  format: 'afldb.v2.drift-gate.1', mode, compare: comparePath, compareVerdict: compare.verdict,
  manifestExit: Number(manifestExitArg), referenceDatabase: referenceDb, referenceTime: referenceTime.toISOString(),
  verdict, stops, tables, queries,
  classes: [...new Set(tables.filter((t) => t.verdict === 'ATTRIBUTED').map((t) => t.cls))].sort(),
  rule: 'O-DRIFT (b) as proposed: stop on any definition, scope, public-query, sealed-scope or migration-sensitive change; every remaining row change is re-derived from both databases and bound to a writer signature. NOT an owner approval.',
};
try { writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 }); } catch (e) { fail(`cannot create ${outPath}: ${e.message}`); }
console.log(`drift-gate ${mode}: ${verdict}${stops.length ? ` (${stops.length} stop reason(s))` : ''}`);
process.exit({ NO_DIFFERENCE: 0, LEDGER_TIMING_ONLY: 0, ATTRIBUTED_ONLY: 3, STOP: 1 }[verdict]);
