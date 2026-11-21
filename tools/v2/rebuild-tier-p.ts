/** ISSUE-363, owner decision Q9 "S + P-full" (22 Nov 2026): the OPT-IN tier P of the isolated rebuild.
 *
 * Tier S (the source-only rebuild, `tools/db/rebuild-test.ts`: 30 stages / 91 checks, plus the documented DraftGuru bridge step) stays the
 * default and is NOT changed by this tool. Tier P is a post-rebuild overlay built from tracked, reviewed GAP-029 curation evidence only, on a
 * FRESH `--template` copy of tier S (never the template, never the shared `afldb_test`):
 *
 *   1. LABELS. The tracked match-event evidence (`docs/v2/evidence/gap-029-match-event-correction-2026-11-01-r2.json`) names PRODUCTION match
 *      ids. They are rekeyed to the target by natural key (season, date, round, home club, away club, both scores); an entry is kept only when
 *      exactly ONE match carries that key, and ANY entry with 0 or >1 matches refuses the whole run. The rekeyed file is written under `--out`,
 *      then the EXISTING audited applier `tools/v2/apply-gap029-match-events.ts --apply` runs on it UNCHANGED (child process).
 *   2. ROOKIE SELECTIONS. The 8 reviewed entries of `data/players/rookie-relisting-outcomes.csv` (`buildEntries`, the production tool's own
 *      derivation). Each player is resolved on the target by AFL Tables profile (exactly one, else refuse); one clone-local Super Admin with
 *      placeholder credentials is created ONLY inside the target (a source-only rebuild holds no `auth_users` rows); all 8 are written by the
 *      audited `createManualPickInTransaction` in ONE `afldb_import` transaction after `assert_viable_super_admin_actor`. Any refusal rolls
 *      the whole transaction back.
 *
 * Refuses unless: the DSNs are loopback on the isolated port; the database is `afldb_v2_rb_*_overlay_test`; the live server proves the
 * isolated cluster name and the isolated-pg marker; the target is not a template and not the `--template-name` it was copied from (which must
 * itself be a marked isolated database); and the target holds ZERO `auth_users` rows. A failure after the first write leaves a partial
 * overlay: drop the copy and rebuild it from the template (there is no repair path, by design).
 *
 * The report records the tool revision, the target and template names, the rekeyed-evidence and applier-report digests, counts, and a
 * CONTENT FINGERPRINT over every base table in public/staging/afldb_meta that excludes a DECLARED list of volatile columns (see
 * VOLATILE_COLUMNS and NORMALISED_COLUMNS): two builds from the same template must produce the same digest. No DSN is ever printed or written.
 *
 *   node tools/v2/isolated-pg.ts run afldb_v2_rb_<x>_overlay_test -- node --conditions=react-server --import tsx tools/v2/rebuild-tier-p.ts \
 *        --template-name <template> --out <dir> [--apply]
 *
 * Without --apply it runs every refusal check, the rekey and the rookie resolution read-only and prints the plan; nothing is written to the
 * database. See docs/v2/isolated-rebuild.md ("Tier P").
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

import { ISOLATED_DATABASE_MARKER, ISOLATED_DATABASE_NAME_PATTERN, checkIsolatedTestDsn, checkIsolatedTestServer, isolatedDatabaseOf } from '@afldb/domain';
import { loadRookieRelistingOutcomes } from '../../tests/rookie-relisting-outcomes';
import { lfSha256 } from './gap029-common';
import { OUTCOMES_PATH, buildEntries } from './gap029-rookie-selections-production';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const TOOL_PATH = 'tools/v2/rebuild-tier-p.ts';
export const EVIDENCE_PATH = 'docs/v2/evidence/gap-029-match-event-correction-2026-11-01-r2.json';
export const APPLIER_PATH = 'tools/v2/apply-gap029-match-events.ts';
export const EDITOR_PATH = 'src/db/queries/admin-draft.ts';
/** Tier P databases only: a fresh copy of a tier S template, named for what it is. */
export const TIER_P_DATABASE_PATTERN = /^afldb_v2_rb_[a-z0-9]+(?:_[a-z0-9]+)*_overlay_test$/;
/** The clone-local actor: a non-reserved domain (migration 105), placeholder credentials, created only inside the target. */
export const ACTOR_EMAIL = 'tier-p-overlay@tier-p-overlay.net';
const ACTOR_PLACEHOLDER_HASH = 'x$1$1$1$x';
const ACTOR_PLACEHOLDER_TOTP = 'JBSWY3DPEHPK3PXP';
export const EXPECTED_ROOKIES = 8;

export class TierPRefusal extends Error {}
const refuse = (message: string): never => { throw new TierPRefusal(message); };

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* Target refusals (pure)                                                                                                             */
/* ---------------------------------------------------------------------------------------------------------------------------------- */

export interface TargetFacts {
  /** The owner DSN named by AFLDB_TEST_DATABASE_URL (never printed). */
  dsn: string;
  /** The import-role DSN named by AFLDB_IMPORT_DATABASE_URL (never printed). */
  importDsn: string;
  port: number;
  clusterName: string | null;
  databaseComment: string | null;
  currentDatabase: string | null;
  /** pg_database.datistemplate of the target, null when it could not be read. */
  isTemplate: boolean | null;
  /** From --template-name; null when absent. */
  templateName: string | null;
  /** The template's isolated-pg marker comment, null when the template does not exist or is unmarked. */
  templateMarker: string | null;
  /** count(*) of auth_users on the target, null when it could not be read. */
  authUsers: number | null;
}

/** Every reason the target is not an acceptable tier P base; empty means proceed. The messages never contain a host, role or password. */
export function targetProblems(f: TargetFacts): string[] {
  const out: string[] = [];
  for (const [label, dsn] of [['owner', f.dsn], ['import', f.importDsn]] as const) {
    for (const x of checkIsolatedTestDsn(dsn, f.port)) out.push(`${label} DSN ${x.check}: ${x.detail}`);
  }
  const database = isolatedDatabaseOf(f.dsn);
  if (isolatedDatabaseOf(f.importDsn) !== database) out.push('the import DSN does not name the same database as the owner DSN');
  if (database === null || !TIER_P_DATABASE_PATTERN.test(database) || !ISOLATED_DATABASE_NAME_PATTERN.test(database)) {
    out.push(`database name ${database ?? '(none)'} is not afldb_v2_rb_*_overlay_test`);
  }
  for (const x of checkIsolatedTestServer(database ?? '', { clusterName: f.clusterName, databaseComment: f.databaseComment, currentDatabase: f.currentDatabase })) {
    out.push(`server ${x.check}: ${x.detail}`);
  }
  if (f.isTemplate !== false) out.push(f.isTemplate === true ? 'the target is a template database (datistemplate)' : 'could not prove the target is not a template database');
  if (f.templateName === null || f.templateName === '') out.push('--template-name is required (the tier S template this copy was made from)');
  else {
    if (f.templateName === database || f.templateName === f.currentDatabase) out.push('the target IS the template: tier P is applied to a fresh copy, never the template');
    if (!ISOLATED_DATABASE_NAME_PATTERN.test(f.templateName)) out.push(`template name ${f.templateName} is not an afldb_v2_*_test name`);
    else if (f.templateMarker !== ISOLATED_DATABASE_MARKER) out.push(`template ${f.templateName} does not exist or does not carry the isolated-test marker`);
  }
  if (f.authUsers === null) out.push('could not count auth_users on the target');
  else if (f.authUsers !== 0) out.push(`the target already holds ${f.authUsers} auth_users row(s): tier P needs a fresh copy of a source-only rebuild (zero accounts)`);
  return out;
}

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* Label rekey (pure)                                                                                                                 */
/* ---------------------------------------------------------------------------------------------------------------------------------- */

export interface LabelExpect { season: number; matchDate: string; roundCode: string; venueRaw: string | null; homeClub: string; awayClub: string; homeScore: number; awayScore: number }
export interface LabelEntry { family: string; label: string; year: number; matchId: number; expect: LabelExpect; [key: string]: unknown }
export interface RekeyedEntry extends LabelEntry { sourceMatchId: number }
export const REKEY_KEY = 'season,date,round,homeClub,awayClub,homeScore,awayScore';

/** The natural key's match ids on the target for one entry (read-only; parameterised). */
export async function candidateMatchIds(sql: postgres.Sql, x: LabelExpect): Promise<number[]> {
  const rows = await sql<{ id: number }[]>`
    SELECT m.id::int AS id FROM matches m JOIN clubs hc ON hc.id = m.home_club_id JOIN clubs ac ON ac.id = m.away_club_id
     WHERE m.season = ${x.season} AND m.match_date = ${x.matchDate}::date AND m.round_code = ${x.roundCode}
       AND hc.name = ${x.homeClub} AND ac.name = ${x.awayClub} AND m.home_score = ${x.homeScore} AND m.away_score = ${x.awayScore}
     ORDER BY m.id`;
  return rows.map((r) => r.id);
}

/**
 * Rekey every entry to the id the target holds for its natural key. `candidates[i]` are the ids matching entry i. ANY entry with 0 or
 * more than one candidate refuses the WHOLE run (nothing is dropped or guessed), as does two entries landing on one target match.
 */
export function rekeyEntries(entries: readonly LabelEntry[], candidates: ReadonlyArray<readonly number[]>): { entries: RekeyedEntry[]; idChanged: number } {
  if (entries.length === 0) refuse('the label evidence holds no entries');
  if (candidates.length !== entries.length) refuse('internal: candidates and entries differ in length');
  const bad: string[] = [];
  entries.forEach((e, i) => { if (candidates[i].length !== 1) bad.push(`${e.year} ${e.family} (source match ${e.matchId}): ${candidates[i].length} matches`); });
  if (bad.length) refuse(`the natural key must match exactly one match; refusing the whole run: ${bad.join('; ')}`);
  const out = entries.map((e, i) => ({ ...e, matchId: candidates[i][0], sourceMatchId: e.matchId }));
  if (new Set(out.map((e) => e.matchId)).size !== out.length) refuse('two evidence entries resolve to the same target match; refusing the whole run');
  return { entries: out, idChanged: out.filter((e) => e.matchId !== e.sourceMatchId).length };
}

/** The deterministic rekeyed evidence document: a pure function of the tracked evidence and the target's match ids (no clock, host or path). */
export function rekeyedDocument(evidence: Record<string, unknown>, rekeyed: { entries: RekeyedEntry[]; idChanged: number }, sourceSha256: string): string {
  const counts: Record<string, number> = {};
  for (const e of rekeyed.entries) counts[e.label] = (counts[e.label] ?? 0) + 1;
  return `${JSON.stringify({
    ...evidence, entries: rekeyed.entries, counts,
    rekeyed: { note: 'ISSUE-363 tier P: the tracked evidence rekeyed to the target by natural key (reviewed once); the applier re-validates every entry before its first write',
      source: EVIDENCE_PATH, sourceSha256, key: REKEY_KEY, kept: rekeyed.entries.length, idChanged: rekeyed.idChanged },
  }, null, 1)}\n`;
}

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* Rookie resolution (pure part)                                                                                                      */
/* ---------------------------------------------------------------------------------------------------------------------------------- */

/** The single player id an AFL Tables profile resolves to on the target; anything else refuses. */
export function soleResolution(profile: string, ids: readonly number[]): number {
  const distinct = [...new Set(ids)];
  if (distinct.length !== 1) refuse(`${profile}: resolves to ${distinct.length} players on this target, not exactly one`);
  return distinct[0];
}

/** The production tool's own `readLive` identity query (AFL Tables profile, trusted link), resolved by natural key instead of a pinned id. */
export async function resolveProfile(s: postgres.Sql | postgres.TransactionSql, profile: string): Promise<number> {
  const rows = await s<{ id: number }[]>`SELECT DISTINCT ei.player_id::int AS id FROM external_identities ei JOIN sources so ON so.id = ei.source_id
    WHERE so.key = 'afltables' AND ei.match_method = 'afltables_profile_url' AND ei.status::text IN ('unique','resolved')
      AND ei.player_id IS NOT NULL AND ei.external_id = ${profile}`;
  return soleResolution(profile, rows.map((r) => r.id));
}

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* Content fingerprint                                                                                                                */
/* ---------------------------------------------------------------------------------------------------------------------------------- */

/**
 * DECLARED volatile columns: values that differ between two otherwise identical tier P builds because they record WHEN a row was written
 * (now() defaults and updated_at stamps). Only tables the overlay writes carry an entry; every other table is hashed whole (x::text), exactly
 * as docs/v2/evidence/issue363-20261121/host-scripts/fp.sql does, so an untouched table's line equals that script's line.
 */
export const VOLATILE_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  'public.auth_users': ['created_at'],
  'public.data_edits': ['created_at'],
  'public.data_overrides': ['created_at', 'updated_at'],
  'public.draft_picks': ['created_at', 'updated_at'],
};
/**
 * DECLARED normalised columns: two values that differ between builds although the CONTENT is the same, replaced by a fixed text before
 * hashing, in these columns only.
 *   - the audited editor stamps each manual selection with a random UUID (`manual_admin_edit:<uuid>`, `manual:<uuid>`, `pick_token` in the
 *     audit payload): replaced by `<token>`;
 *   - the UNCHANGED label applier writes the path of the evidence file it was given into each `data_edits.note` ("... see <path>"), and that
 *     path is under the run's --out directory: replaced by `<rekeyed-evidence>`.
 * Patterns use character classes only (no backslashes), so they mean the same in a SQL string and in a template literal.
 */
export interface Normalisation { column: string; pattern: string; replacement: string }
export const TOKEN_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const EVIDENCE_PATH_PATTERN = 'see [^ ]*evidence-rekeyed[.]json';
export const NORMALISED_COLUMNS: Readonly<Record<string, readonly Normalisation[]>> = {
  'public.data_edits': [
    { column: 'new_values', pattern: TOKEN_PATTERN, replacement: '<token>' },
    { column: 'old_values', pattern: TOKEN_PATTERN, replacement: '<token>' },
    { column: 'note', pattern: EVIDENCE_PATH_PATTERN, replacement: 'see <rekeyed-evidence>' },
  ],
  'public.data_overrides': [{ column: 'entity_key', pattern: TOKEN_PATTERN, replacement: '<token>' }],
  'public.draft_picks': [
    { column: 'source_record_id', pattern: TOKEN_PATTERN, replacement: '<token>' },
    { column: 'player_url', pattern: TOKEN_PATTERN, replacement: '<token>' },
  ],
};
export const FINGERPRINT_SCHEMAS = ['public', 'staging', 'afldb_meta'] as const;

const ident = (name: string): string => `"${name.replace(/"/g, '""')}"`;
const lit = (value: string): string => `'${value.replace(/'/g, "''")}'`;

/** The per-table fingerprint query: `<rows>` and an order-independent content hash with the declared volatile columns removed. */
export function fingerprintSql(schema: string, table: string,
  volatile: Readonly<Record<string, readonly string[]>> = VOLATILE_COLUMNS, normalised: Readonly<Record<string, readonly Normalisation[]>> = NORMALISED_COLUMNS): string {
  const key = `${schema}.${table}`;
  const drop = volatile[key] ?? [];
  const norm = normalised[key] ?? [];
  let expr = 'x::text';
  if (drop.length || norm.length) {
    expr = `to_jsonb(x)`;
    if (drop.length) expr = `(${expr} - ARRAY[${drop.map(lit).join(', ')}]::text[])`;
    if (norm.length) expr = `(${expr} || jsonb_build_object(${norm.map((n) => `${lit(n.column)}, regexp_replace(to_jsonb(x) ->> ${lit(n.column)}, ${lit(n.pattern)}, ${lit(n.replacement)}, 'g')`).join(', ')}))`;
    expr = `${expr}::text`;
  }
  return `SELECT count(*)::text AS n, coalesce(sum(hashtextextended(${expr}, 0)::numeric), 0)::text AS h FROM ${ident(schema)}.${ident(table)} x`;
}

export interface Fingerprint { digest: string; tables: Record<string, string> }

export function fingerprintDigest(tables: Readonly<Record<string, string>>): string {
  const lines = Object.keys(tables).sort().map((k) => `${k}=${tables[k]}`);
  return createHash('sha256').update(`${lines.join('\n')}\n`).digest('hex');
}

export async function contentFingerprint(sql: postgres.Sql): Promise<Fingerprint> {
  const list = await sql<{ s: string; t: string }[]>`SELECT table_schema AS s, table_name AS t FROM information_schema.tables
    WHERE table_type = 'BASE TABLE' AND table_schema IN ${sql([...FINGERPRINT_SCHEMAS])} ORDER BY 1, 2`;
  const tables: Record<string, string> = {};
  for (const { s, t } of list) {
    const [r] = await sql.unsafe<{ n: string; h: string }[]>(fingerprintSql(s, t));
    tables[`${s}.${t}`] = `${r.n}:${r.h}`;
  }
  return { digest: fingerprintDigest(tables), tables };
}

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* The run                                                                                                                            */
/* ---------------------------------------------------------------------------------------------------------------------------------- */

const sha256Of = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');
const strip = (s: string): string => s.replace(/postgres(?:ql)?:\/\/\S+/g, '<dsn>');

function parseArgs(argv: readonly string[]): { templateName: string | null; out: string | null; apply: boolean } {
  const opt = (name: string): string | null => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : null; };
  const known = new Set(['--template-name', '--out', '--apply']);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--') && !known.has(argv[i])) refuse(`unknown option ${argv[i]}`);
  }
  return { templateName: opt('--template-name'), out: opt('--out'), apply: argv.includes('--apply') };
}

function gitHead(): string | null {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

type CreateManualPick = typeof import('../../src/db/queries/admin-draft').createManualPickInTransaction;

async function run(argv: readonly string[]): Promise<void> {
  const args = parseArgs(argv);
  if (process.env.AFLDB_V2_ISOLATED_PG !== '1') refuse('run inside `tools/v2/isolated-pg.ts run <db> --`');
  const dsn = process.env.AFLDB_TEST_DATABASE_URL ?? '';
  const importDsn = process.env.AFLDB_IMPORT_DATABASE_URL ?? '';
  const port = Number(process.env.AFLDB_V2_ISOLATED_PORT);
  if (!args.out) refuse('--out <directory> is required');
  const out = resolve(args.out as string);

  const sql = postgres(dsn, { max: 1, onnotice: () => {}, connect_timeout: 5 });
  try {
    // 1. Refusals, before anything is read from the evidence or written anywhere.
    const [facts] = await sql<{ cluster: string; comment: string | null; db: string; is_template: boolean; auth_users: number }[]>`
      SELECT current_setting('cluster_name') AS cluster, shobj_description(d.oid, 'pg_database') AS comment, current_database() AS db,
             d.datistemplate AS is_template, (SELECT count(*)::int FROM auth_users) AS auth_users
        FROM pg_database d WHERE d.datname = current_database()`;
    const tpl = args.templateName === null ? [] : await sql<{ comment: string | null }[]>`SELECT shobj_description(oid, 'pg_database') AS comment FROM pg_database WHERE datname = ${args.templateName}`;
    const problems = targetProblems({
      dsn, importDsn, port, clusterName: facts?.cluster ?? null, databaseComment: facts?.comment ?? null, currentDatabase: facts?.db ?? null,
      isTemplate: facts ? facts.is_template : null, templateName: args.templateName, templateMarker: tpl[0]?.comment ?? null, authUsers: facts ? facts.auth_users : null,
    });
    if (problems.length) refuse(`not an acceptable tier P target: ${problems.join('; ')}`);
    const database = facts.db;

    // 2. Labels: the rekey (read-only) and the rookie resolution (read-only): every refusal that can be known before a write is raised now.
    const evidenceRaw = readFileSync(join(REPO_ROOT, EVIDENCE_PATH)).toString('utf8').replace(/\r\n/g, '\n');
    const evidence = JSON.parse(evidenceRaw) as { entries: LabelEntry[] } & Record<string, unknown>;
    const candidates: number[][] = [];
    for (const e of evidence.entries) candidates.push(await candidateMatchIds(sql, e.expect));
    const rekeyed = rekeyEntries(evidence.entries, candidates);
    const rookies = buildEntries(loadRookieRelistingOutcomes(readFileSync(join(REPO_ROOT, OUTCOMES_PATH), 'utf8').replace(/\r\n/g, '\n')));
    if (rookies.length !== EXPECTED_ROOKIES) refuse(`expected ${EXPECTED_ROOKIES} reviewed rookie selections, found ${rookies.length}`);
    for (const e of rookies) await resolveProfile(sql, e.afltablesProfile);
    console.log(`tier P plan: labels=${rekeyed.entries.length} (ids changed from production: ${rekeyed.idChanged}); rookie selections=${rookies.length} (every player resolves exactly once)`);
    if (!args.apply) { console.log('dry run: nothing written (add --apply to build tier P on this copy)'); return; }

    mkdirSync(out, { recursive: true });
    const rekeyedPath = join(out, 'evidence-rekeyed.json');
    const applierReportPath = join(out, 'applier-report.json');
    const rekeyedText = rekeyedDocument(evidence, rekeyed, sha256Of(evidenceRaw));
    writeFileSync(rekeyedPath, rekeyedText, { flag: 'wx' });

    // The editor module needs the react-server condition (server-only). Import it BEFORE the first database write so a missing flag
    // refuses with nothing written. (isolated-pg already points every DSN variable at this verified database.)
    let createManualPickInTransaction: CreateManualPick;
    try { ({ createManualPickInTransaction } = await import('../../src/db/queries/admin-draft')); } catch { return refuse('could not load the audited editor module; run with `node --conditions=react-server --import tsx`'); }

    // 3. Labels, through the existing audited applier, unchanged.
    const applier = spawnSync(process.execPath, ['--conditions=react-server', '--import', 'tsx', APPLIER_PATH, '--apply', `--evidence=${rekeyedPath}`, `--report=${applierReportPath}`],
      { cwd: REPO_ROOT, env: process.env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (applier.status !== 0) refuse(`the audited label applier refused or failed (exit ${applier.status}); the copy is partially built, drop it: ${strip(`${applier.stderr}`).slice(-500).trim()}`);
    const applierReport = JSON.parse(readFileSync(applierReportPath, 'utf8')) as { verified: boolean | null; planned: number; auditRows: number | null; activeOverrides: number | null };
    if (applierReport.verified !== true || applierReport.planned !== rekeyed.entries.length) refuse('the label applier report does not verify every rekeyed label; the copy is partially built, drop it');
    console.log(`labels: ${applierReport.planned} written and verified by the audited applier`);

    // 4. Rookie selections: one clone-local Super Admin (placeholder credentials), then all 8 in ONE afldb_import transaction.
    const [actor] = await sql<{ id: number }[]>`INSERT INTO auth_users (email, role, password_hash, totp_secret)
      VALUES (${ACTOR_EMAIL}, 'super_admin', ${ACTOR_PLACEHOLDER_HASH}, ${ACTOR_PLACEHOLDER_TOTP}) RETURNING id::int AS id`;
    const [before] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM draft_picks`;
    const writer = postgres(importDsn, { max: 1, onnotice: () => {}, connect_timeout: 5 });
    let differsFromProduction = 0;
    try {
      await writer.begin(async (tx) => {
        const [who] = await tx<{ u: string }[]>`SELECT current_user AS u`;
        if (who.u !== 'afldb_import') refuse('the write connection must be the afldb_import role');
        await tx`SELECT public.assert_viable_super_admin_actor(${actor.id}::int)`;
        for (const e of rookies) {
          const playerId = await resolveProfile(tx, e.afltablesProfile);
          const r = await createManualPickInTransaction(tx, { playerId, adminUserId: actor.id, draftYear: e.draftEventYear, draftType: e.draftType,
            draftKind: e.draftKind, pickNumber: e.pick, clubSlug: e.clubSlug, detail: e.detail, note: e.correctionNote });
          if (!r.ok) refuse(`the audited editor path refused ${e.afltablesProfile}; the rookie transaction was rolled back: ${'error' in r ? r.error : 'confirmation required'}`);
          if (playerId !== e.expectedPlayerId) differsFromProduction++;
        }
      });
    } finally { await writer.end({ timeout: 5 }); }
    console.log(`rookie selections: ${rookies.length} written in one transaction`);

    // 5. Counts and the content fingerprint.
    const [after] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM draft_picks`;
    const overrides = await sql<{ g: string; n: number }[]>`SELECT entity_type || '/' || field_group AS g, count(*)::int AS n FROM data_overrides WHERE is_active GROUP BY 1 ORDER BY 1`;
    const [edits] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM data_edits`;
    const [labelled] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM matches WHERE match_event IS NOT NULL`;
    if (after.n !== before.n + rookies.length) refuse(`draft_picks grew by ${after.n - before.n}, expected ${rookies.length}`);
    if (labelled.n !== rekeyed.entries.length) refuse(`${labelled.n} matches carry an event label, expected ${rekeyed.entries.length}`);
    const [users] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM auth_users`;
    const fingerprint = await contentFingerprint(sql);

    const files = Object.fromEntries([TOOL_PATH, APPLIER_PATH, EDITOR_PATH, EVIDENCE_PATH, OUTCOMES_PATH].map((p) => [p, lfSha256(join(REPO_ROOT, p))]));
    const report = {
      format: 'afldb.v2.tier-p-report.1', decision: 'ISSUE-363 Q9 S + P-full',
      tool: { gitHead: gitHead(), fileSha256: files },
      target: { database, templateName: args.templateName },
      rekeyedEvidenceSha256: sha256Of(rekeyedText), applierReportSha256: sha256Of(readFileSync(applierReportPath)),
      counts: {
        labels: rekeyed.entries.length, labelIdsChangedFromProduction: rekeyed.idChanged, labelAuditRows: applierReport.auditRows, labelActiveOverrides: applierReport.activeOverrides,
        rookieSelections: rookies.length, rookiePlayerIdsDifferingFromProduction: differsFromProduction, draftPicksBefore: before.n, draftPicksAfter: after.n,
        activeOverridesByGroup: Object.fromEntries(overrides.map((r) => [r.g, r.n])), dataEdits: edits.n, authUsers: users.n,
      },
      fingerprint: {
        algorithm: 'per base table in public/staging/afldb_meta: <rows>:<sum of hashtextextended(row text, 0)>; sha256 over the sorted "<schema.table>=<value>" lines',
        volatileColumns: VOLATILE_COLUMNS, normalisedColumns: NORMALISED_COLUMNS, digest: fingerprint.digest, tables: fingerprint.tables,
      },
    };
    writeFileSync(join(out, 'tier-p-report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    console.log(`tier P built on ${database}: report ${join(out, 'tier-p-report.json')}; content fingerprint ${fingerprint.digest}`);
  } finally { await sql.end({ timeout: 5 }); }
}

if (process.argv[1] && /rebuild-tier-p\.ts$/.test(process.argv[1].replace(/\\/g, '/'))) {
  run(process.argv.slice(2)).catch((error: unknown) => {
    console.error(`tier P ${error instanceof TierPRefusal ? 'refused' : 'failed'}: ${strip(error instanceof Error ? error.message : 'unexpected failure')}`);
    process.exitCode = 1;
  });
}
