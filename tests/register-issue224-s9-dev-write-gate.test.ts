/**
 * AFLDB-ISSUE-224 S9 — DB-free coverage for the explicit DEV write authorisation gate in
 * `tools/rebuild/draftguru/register_issue224_s9_players.ts`.
 *
 * `parseArgs` and `resolveTarget` never open a database connection (a DSN is only ever parsed as
 * a URL, never connected to) and never perform I/O beyond `readFileSync` on the pinned artefacts
 * (`loadAndValidateArtefacts`, exercised indirectly via `main`, is NOT invoked here). The module
 * guards its own `main()` invocation behind an entrypoint check, so importing it here for its
 * exported functions never runs the CLI against this test process's real argv/environment.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type postgres from 'postgres';
import { describe, expect, it } from 'vitest';

import { RESERVED_EXAMPLE_DOMAINS, RESERVED_TEST_TLDS } from '../tools/db/promotion-inventory';
import {
  assertExactFirstApplyShape,
  assertNoAflApiIdentityWritten,
  assertProdBoundary,
  assertProdCheckoutIntegrity,
  assertViableActorInTransaction,
  assertViableProdActor,
  BACKUP_SHA256_RE,
  type CheckoutIntegrityFacts,
  EXPECTED_ROW_COUNT,
  gatherCheckoutIntegrityFacts,
  judgeCheckoutIntegrity,
  loadAndValidateArtefacts,
  loadNameParts,
  loadPinnedProdNameParts,
  parseArgs,
  PROD_ALLOWED_UNTRACKED_RE,
  PROD_HOSTNAME,
  PROD_REVISION_RE,
  resolveNameParts,
  resolveProdAuthTarget,
  resolveProdTarget,
  resolveTarget,
  runDevPostWriteChecks,
  type Classification,
  type ProdActorRow,
  type TargetName,
} from '../tools/rebuild/draftguru/register_issue224_s9_players';

const VALID_SHA = 'a'.repeat(64);
const VALID_REVISION = 'a'.repeat(40);
const ADMIN_ARGS = ['--admin-user-id', '4'];

describe('register_issue224_s9_players — parseArgs DEV write gate (ISSUE-224 S9)', () => {
  it('DEV --apply without --allow-dev-write refuses', () => {
    expect(() => parseArgs([
      ...ADMIN_ARGS, '--target', 'dev', '--dev-import-role', '--apply', '--backup-sha256', VALID_SHA,
    ])).toThrow(/--allow-dev-write/);
  });

  it('DEV --apply without --dev-import-role refuses', () => {
    expect(() => parseArgs([
      ...ADMIN_ARGS, '--target', 'dev', '--apply', '--allow-dev-write', '--backup-sha256', VALID_SHA,
    ])).toThrow(/--dev-import-role/);
  });

  it('DEV --apply without --backup-sha256 refuses', () => {
    expect(() => parseArgs([
      ...ADMIN_ARGS, '--target', 'dev', '--dev-import-role', '--apply', '--allow-dev-write',
    ])).toThrow(/--backup-sha256/);
  });

  it.each([
    'not-hex-at-all-not-hex-at-all-not-hex-at-all-not-hex-at-all-000',
    VALID_SHA.slice(0, 63),
    `${VALID_SHA}f`,
    'g'.repeat(64),
    '',
  ])('malformed --backup-sha256 %s refuses', (malformed) => {
    expect(() => parseArgs([
      ...ADMIN_ARGS, '--target', 'dev', '--dev-import-role', '--apply', '--allow-dev-write',
      '--backup-sha256', malformed,
    ])).toThrow(/64 hexadecimal characters/);
  });

  it('accepts a well-formed 64-hex --backup-sha256 (format only; BACKUP_SHA256_RE matches it directly)', () => {
    expect(BACKUP_SHA256_RE.test(VALID_SHA)).toBe(true);
    expect(BACKUP_SHA256_RE.test(VALID_SHA.toUpperCase())).toBe(true);
  });

  it('the full valid DEV apply flag combination parses cleanly (reaches the normal execution path)', () => {
    const args = parseArgs([
      ...ADMIN_ARGS, '--target', 'dev', '--dev-import-role', '--apply', '--allow-dev-write',
      '--backup-sha256', VALID_SHA,
    ]);
    expect(args).toMatchObject({
      target: 'dev', apply: true, devImportRole: true, allowDevWrite: true, backupSha256: VALID_SHA,
    });
  });

  it('--allow-dev-write is invalid/irrelevant for --target test and is refused', () => {
    expect(() => parseArgs([...ADMIN_ARGS, '--target', 'test', '--allow-dev-write']))
      .toThrow(/--allow-dev-write is only valid with --target dev/);
  });

  it('--backup-sha256 is invalid/irrelevant for --target test and is refused', () => {
    expect(() => parseArgs([...ADMIN_ARGS, '--target', 'test', '--backup-sha256', VALID_SHA]))
      .toThrow(/--backup-sha256 is only valid with --target dev/);
  });

  it('test mode retains its existing unconditional --apply behaviour', () => {
    const args = parseArgs([...ADMIN_ARGS, '--target', 'test', '--apply']);
    expect(args).toMatchObject({
      target: 'test', apply: true, devImportRole: false, allowDevWrite: false, backupSha256: null,
    });
  });

  it('test mode with no flags at all still defaults to read-only classification', () => {
    const args = parseArgs(ADMIN_ARGS);
    expect(args).toMatchObject({ target: 'test', apply: false });
  });

  it('an unrecognised --target value is refused', () => {
    expect(() => parseArgs([...ADMIN_ARGS, '--target', 'staging']))
      .toThrow(/--target must be 'test', 'dev' or 'prod'/);
  });

  it('--target prod is recognised but requires --prod-import-role', () => {
    expect(() => parseArgs([...ADMIN_ARGS, '--target', 'prod']))
      .toThrow(/--prod-import-role/);
  });

  it('DEV read-only preflight (no --apply) is unaffected by the gate: no flags required', () => {
    expect(() => parseArgs([...ADMIN_ARGS, '--target', 'dev'])).not.toThrow();
    expect(() => parseArgs([...ADMIN_ARGS, '--target', 'dev', '--dev-import-role'])).not.toThrow();
  });

  it('--name-parts defaults to null and is carried through when supplied', () => {
    expect(parseArgs(ADMIN_ARGS).namePartsPath).toBeNull();
    expect(parseArgs([...ADMIN_ARGS, '--name-parts', 'a/b.json']).namePartsPath).toBe('a/b.json');
  });

  it('--name-parts with no path refuses', () => {
    expect(() => parseArgs([...ADMIN_ARGS, '--name-parts', ''])).toThrow(/requires a path/);
  });
});

describe('register_issue224_s9_players — resolveTarget DEV write gate (ISSUE-224 S9)', () => {
  const originalEnv = { ...process.env };
  function restoreEnv(): void {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  }

  it('DEV import-role connection is read-only when writeAuthorized=false (unauthorised preflight)', () => {
    process.env.AFLDB_DEV_IMPORT_DATABASE_URL = 'postgresql://afldb_import:x@localhost:5432/afldb_dev';
    try {
      const cfg = resolveTarget('dev', true, false);
      expect(cfg).toMatchObject({
        requiredDatabase: 'afldb_dev', requiredUser: 'afldb_import', readOnly: true, canApply: false,
      });
    } finally {
      restoreEnv();
    }
  });

  it('DEV import-role connection is writable ONLY when writeAuthorized=true (the gate having already passed)', () => {
    process.env.AFLDB_DEV_IMPORT_DATABASE_URL = 'postgresql://afldb_import:x@localhost:5432/afldb_dev';
    try {
      const cfg = resolveTarget('dev', true, true);
      expect(cfg).toMatchObject({
        requiredDatabase: 'afldb_dev', requiredUser: 'afldb_import', readOnly: false, canApply: true,
      });
    } finally {
      restoreEnv();
    }
  });

  it('ordinary (non-import-role) DEV connection stays read-only regardless of writeAuthorized', () => {
    process.env.AFLDB_DEV_DATABASE_URL = 'postgresql://afldb_app:x@localhost:5432/afldb_dev';
    try {
      const cfg = resolveTarget('dev', false, true);
      expect(cfg).toMatchObject({ requiredUser: 'afldb_app', readOnly: true, canApply: false });
    } finally {
      restoreEnv();
    }
  });

  it('test target is always writable, unaffected by writeAuthorized', () => {
    process.env.AFLDB_TEST_IMPORT_DATABASE_URL = 'postgresql://afldb_import:x@localhost:5432/afldb_test';
    try {
      expect(resolveTarget('test', false, false)).toMatchObject({ readOnly: false, canApply: true });
      expect(resolveTarget('test', false, true)).toMatchObject({ readOnly: false, canApply: true });
    } finally {
      restoreEnv();
    }
  });

  it('no PROD target exists: resolveTarget refuses any target name outside the closed test|dev list', () => {
    expect(() => resolveTarget('prod' as TargetName, false, false)).toThrow(/no PROD target/);
  });

  it('refuses a DSN whose path looks like a production database, even for the DEV target', () => {
    process.env.AFLDB_DEV_IMPORT_DATABASE_URL = 'postgresql://afldb_import:x@localhost:5432/afldb_prod';
    try {
      expect(() => resolveTarget('dev', true, true)).toThrow(/production database/);
    } finally {
      restoreEnv();
    }
  });
});

/**
 * `runDevPostWriteChecks` — the DEV first-apply postcondition battery. This suite covers only
 * the data_edits postcondition redesign (the fix for the observed DEV apply refusal: afldb_import
 * has INSERT-only on data_edits (migration 066), so the previous SELECT-based check could never
 * pass under that role's real grant). Every other postcondition (identities, slugs, player count,
 * career stats, data_overrides) is unchanged and is exercised here only enough to reach the
 * data_edits check; it is not the subject of this regression.
 *
 * The fake `tx` is a plain call-counting stand-in for `postgres.TransactionSql`: it answers each
 * successive tagged-template call with the next canned row set, in the fixed order
 * `runDevPostWriteChecks` issues its queries. `queryCount()` proves how many queries actually ran,
 * which is what demonstrates "no SELECT on data_edits was attempted" — a call-count assertion, not
 * a query-content assertion, since the fake does not parse SQL text.
 */
describe('register_issue224_s9_players — runDevPostWriteChecks data_edits postcondition (ISSUE-224 S9)', () => {
  const targets = Array.from({ length: EXPECTED_ROW_COUNT }, (_, i) => ({
    profilePath: `players/T/Test_Player${i}.html`,
    displayName: `Test Player${i}`,
    givenName: 'Test',
    surname: `Player${i}`,
    aflApiProviderId: `provider-${i}`,
    draftguruPlayerUrl: `https://draftguru.example/player/${i}`,
  }));
  const created = targets.map((t, i) => ({ profilePath: t.profilePath, playerId: i + 1 }));
  const beforePlayerCount = 1000;

  function makeFakeTx(
    playerRows: unknown[] = created.map((c, i) => ({
      id: c.playerId,
      slug: `slug-${c.playerId}`,
      givenName: targets[i].givenName,
      surname: targets[i].surname,
      sortName: `${targets[i].surname}, ${targets[i].givenName}`,
    })),
    overrideRows: unknown[] = created.map((c, i) => ({
      playerId: c.playerId,
      hasPath: true,
      givenName: targets[i].givenName,
      surname: targets[i].surname,
    })),
  ): { tx: postgres.TransactionSql; queryCount: () => number } {
    const responses: unknown[][] = [
      // 1. external_identities resolution
      created.map((c) => ({ externalId: c.profilePath, playerId: c.playerId })),
      // 2. player rows — one distinct slug each, plus the persisted name parts
      playerRows,
      // 3. player count (before + EXPECTED_ROW_COUNT)
      [{ count: String(beforePlayerCount + EXPECTED_ROW_COUNT) }],
      // 4. player_career_stats count
      [{ count: String(EXPECTED_ROW_COUNT) }],
      // 5. data_overrides durability rows — the attached path AND the payload name parts
      overrideRows,
    ];
    let i = 0;
    const tag = (async () => {
      if (i >= responses.length) {
        throw new Error(`fake tx received an unexpected extra query (call #${i + 1})`);
      }
      const r = responses[i];
      i += 1;
      return r;
    }) as unknown as postgres.TransactionSql;
    return { tx: tag, queryCount: () => i };
  }

  it('passes with exactly EXPECTED_ROW_COUNT confirmed audit writes, issuing no data_edits query', async () => {
    const { tx, queryCount } = makeFakeTx();
    const results = await runDevPostWriteChecks(tx, targets, created, beforePlayerCount, EXPECTED_ROW_COUNT);
    expect(results.some((r) => /data_edits audit writes confirmed/.test(r))).toBe(true);
    // Exactly 5 queries ran (identities, slugs, player count, career stats, data_overrides) —
    // no 6th query against data_edits, which afldb_import cannot SELECT.
    expect(queryCount()).toBe(5);
  });

  it('refuses before commit on a confirmed audit-write count mismatch, without querying data_edits', async () => {
    const { tx, queryCount } = makeFakeTx();
    await expect(
      runDevPostWriteChecks(tx, targets, created, beforePlayerCount, EXPECTED_ROW_COUNT - 1),
    ).rejects.toThrow(/data_edits audit writes were confirmed/);
    // The mismatch is caught by a plain number comparison, after the same 5 real queries and
    // with no attempt to SELECT data_edits to adjudicate the mismatch.
    expect(queryCount()).toBe(5);
  });

  it('still refuses when the created-row count itself is wrong, before any query runs', async () => {
    const { tx, queryCount } = makeFakeTx();
    await expect(
      runDevPostWriteChecks(tx, targets, created.slice(0, -1), beforePlayerCount, EXPECTED_ROW_COUNT),
    ).rejects.toThrow(/player\(s\) were created, expected exactly/);
    expect(queryCount()).toBe(0);
  });

  it('refuses before commit when a persisted row carries a last-token-split surname', async () => {
    // Exactly the observed DEV defect, reproduced: "Alex Van Wyk" persisted as
    // given_name "Alex Van" / surname "Wyk". No other postcondition notices it.
    const rows = created.map((c, i) => ({
      id: c.playerId,
      slug: `slug-${c.playerId}`,
      givenName: i === 7 ? 'Test Player' : targets[i].givenName,
      surname: i === 7 ? '7' : targets[i].surname,
      sortName: i === 7 ? '7, Test Player' : `${targets[i].surname}, ${targets[i].givenName}`,
    }));
    const { tx } = makeFakeTx(rows);
    await expect(
      runDevPostWriteChecks(tx, targets, created, beforePlayerCount, EXPECTED_ROW_COUNT),
    ).rejects.toThrow(/do not carry the resolved name parts/);
  });

  it('refuses before commit on a stale sort_name even when given_name and surname are right', async () => {
    const rows = created.map((c, i) => ({
      id: c.playerId,
      slug: `slug-${c.playerId}`,
      givenName: targets[i].givenName,
      surname: targets[i].surname,
      sortName: i === 3 ? 'Stale, Value' : `${targets[i].surname}, ${targets[i].givenName}`,
    }));
    const { tx } = makeFakeTx(rows);
    await expect(
      runDevPostWriteChecks(tx, targets, created, beforePlayerCount, EXPECTED_ROW_COUNT),
    ).rejects.toThrow(/do not carry the resolved name parts/);
  });

  it('refuses when the players row is right but the DURABLE payload carries the split', async () => {
    // AFLDB-ISSUE-224 §21.3.2: the payload is what a rebuild re-creates the row FROM, so a
    // last-token split surviving there outlives the correct `players` row. Every other
    // postcondition passes on this state.
    const overrides = created.map((c, i) => ({
      playerId: c.playerId,
      hasPath: true,
      givenName: i === 11 ? 'Test Player' : targets[i].givenName,
      surname: i === 11 ? '11' : targets[i].surname,
    }));
    const { tx, queryCount } = makeFakeTx(undefined, overrides);
    await expect(
      runDevPostWriteChecks(tx, targets, created, beforePlayerCount, EXPECTED_ROW_COUNT),
    ).rejects.toThrow(/durable identity payload\(s\) do not carry the resolved name parts/);
    // Still the same five queries: the payload parts come back on the data_overrides query
    // that already ran, not on a sixth.
    expect(queryCount()).toBe(5);
  });
});

/**
 * AFLDB-ISSUE-224 S9 recurrence fix. `createPlayerInTransaction` last-token-splits a display name
 * when the caller supplies neither part; this runner never lets that fire. These cover the
 * resolver in isolation, then end-to-end against the real pinned artefacts, which carry exactly
 * two multipart names ("Alex Van Wyk", "Hussien El Achkar").
 */
describe('register_issue224_s9_players — resolveNameParts (ISSUE-224 S9)', () => {
  const PATH = 'players/A/Alex_Van_Wyk.html';

  it('splits an unambiguous two-token name', () => {
    expect(resolveNameParts('players/T/T.html', 'Jane Smith'))
      .toEqual({ givenName: 'Jane', surname: 'Smith' });
  });

  it('treats a mononym as surname-only, with no given name invented', () => {
    expect(resolveNameParts('players/T/T.html', 'Ablett'))
      .toEqual({ givenName: null, surname: 'Ablett' });
  });

  it.each([
    'Alex Van Wyk',
    'Hussien El Achkar',
    'Jan van der Berg',
  ])('REFUSES the multipart name %s rather than guessing where it divides', (name) => {
    expect(() => resolveNameParts(PATH, name)).toThrow(/multipart display name/);
    expect(() => resolveNameParts(PATH, name)).toThrow(/--name-parts/);
  });

  it('refuses an empty display name', () => {
    expect(() => resolveNameParts(PATH, '   ')).toThrow(/empty display name/);
  });

  it('accepts an authoritative override that recomposes to the display name', () => {
    expect(resolveNameParts(PATH, 'Alex Van Wyk', { givenName: 'Alex', surname: 'Van Wyk' }))
      .toEqual({ givenName: 'Alex', surname: 'Van Wyk' });
    expect(resolveNameParts(PATH, 'Hussien El Achkar', { givenName: 'Hussien', surname: 'El Achkar' }))
      .toEqual({ givenName: 'Hussien', surname: 'El Achkar' });
  });

  it('refuses an override that does not recompose to the display name', () => {
    expect(() => resolveNameParts(PATH, 'Alex Van Wyk', { givenName: 'Alexander', surname: 'Van Wyk' }))
      .toThrow(/does not recompose/);
    expect(() => resolveNameParts(PATH, 'Alex Van Wyk', { givenName: 'Alex', surname: 'Wyk' }))
      .toThrow(/does not recompose/);
  });

  it('refuses an override with an empty surname', () => {
    expect(() => resolveNameParts(PATH, 'Alex Van Wyk', { givenName: 'Alex Van Wyk', surname: '  ' }))
      .toThrow(/empty surname/);
  });
});

describe('register_issue224_s9_players — registration runner over the real pinned artefacts', () => {
  const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
  const MANIFESTS = join(REPO_ROOT, 'docs', 'rebuild-manifests', 'draftguru');
  const TARGET_SET = join(MANIFESTS, 'issue224-s9-target-set-20260922.json');
  const DECISION = join(MANIFESTS, 'issue224-d7-registration-decision-20260922.json');
  const NAME_PARTS = join(MANIFESTS, 'issue224-s9-name-parts-20260922.json');

  it('refuses the whole batch when the two multipart rows have no authoritative division', () => {
    expect(() => loadAndValidateArtefacts(TARGET_SET, DECISION))
      .toThrow(/multipart display name/);
  });

  it('resolves all 92 rows with the retained --name-parts artefact, and no surname is a bare suffix', () => {
    const targets = loadAndValidateArtefacts(TARGET_SET, DECISION, loadNameParts(NAME_PARTS));
    expect(targets).toHaveLength(EXPECTED_ROW_COUNT);
    for (const t of targets) {
      expect(t.surname.length).toBeGreaterThan(0);
      const recomposed = [t.givenName, t.surname].filter(Boolean).join(' ');
      expect(recomposed).toBe(t.displayName);
    }
    const vanWyk = targets.find((t) => t.profilePath === 'players/A/Alex_Van_Wyk.html');
    expect(vanWyk).toMatchObject({ givenName: 'Alex', surname: 'Van Wyk' });
    const elAchkar = targets.find((t) => t.profilePath === 'players/H/Hussien_El_Achkar.html');
    expect(elAchkar).toMatchObject({ givenName: 'Hussien', surname: 'El Achkar' });
  });

  it('the retained --name-parts artefact covers exactly the rows that need it', () => {
    expect([...loadNameParts(NAME_PARTS).keys()].sort()).toEqual([
      'players/A/Alex_Van_Wyk.html',
      'players/H/Hussien_El_Achkar.html',
    ]);
  });

  // The two genuinely-needed divisions, so each negative case below isolates ITS defect instead
  // of tripping the multipart refusal first.
  const VALID_ROWS = [
    {
      afltables_external_id: 'players/A/Alex_Van_Wyk.html',
      display_name: 'Alex Van Wyk',
      given_name: 'Alex',
      surname: 'Van Wyk',
    },
    {
      afltables_external_id: 'players/H/Hussien_El_Achkar.html',
      display_name: 'Hussien El Achkar',
      given_name: 'Hussien',
      surname: 'El Achkar',
    },
  ];

  function writeNameParts(rows: unknown[]): string {
    const file = join(mkdtempSync(join(tmpdir(), 'afldb-i224-')), 'name-parts.json');
    writeFileSync(file, JSON.stringify({ rows }));
    return file;
  }

  it('refuses a --name-parts row naming a path outside the pinned target set', () => {
    const file = writeNameParts([...VALID_ROWS, {
      afltables_external_id: 'players/Z/Not_In_Set.html',
      display_name: 'Not InSet',
      given_name: 'Not',
      surname: 'InSet',
    }]);
    expect(() => loadAndValidateArtefacts(TARGET_SET, DECISION, loadNameParts(file)))
      .toThrow(/not in the pinned target set/);
  });

  it('refuses a --name-parts row whose display_name disagrees with the pinned target set', () => {
    const file = writeNameParts([
      { ...VALID_ROWS[0], display_name: 'Alexander Van Wyk', given_name: 'Alexander' },
      VALID_ROWS[1],
    ]);
    expect(() => loadAndValidateArtefacts(TARGET_SET, DECISION, loadNameParts(file)))
      .toThrow(/the pinned target set carries/);
  });

  it('refuses a --name-parts row that does not recompose to its own display_name', () => {
    const file = writeNameParts([{ ...VALID_ROWS[0], surname: 'Wyk' }, VALID_ROWS[1]]);
    expect(() => loadAndValidateArtefacts(TARGET_SET, DECISION, loadNameParts(file)))
      .toThrow(/does not recompose/);
  });

  it('refuses a --name-parts artefact naming the same path twice', () => {
    const file = writeNameParts([...VALID_ROWS, VALID_ROWS[0]]);
    expect(() => loadNameParts(file)).toThrow(/more than once/);
  });
});

/**
 * AFLDB-ISSUE-251 — the separately guarded PROD adoption mode. PROD is not a third value bolted
 * onto the DEV write gate: it has its own flags, its own resolveProdTarget/resolveProdAuthTarget
 * (never resolveTarget/assertNotProdLike), its own DB-free boundary check (assertProdBoundary) and
 * its own actor eligibility rule (assertViableProdActor, built on the existing
 * src/lib/auth/admin-lifecycle.ts isViableSuperAdmin predicate — never a parallel actor model).
 */
describe('register_issue224_s9_players — PROD parseArgs gate (AFLDB-ISSUE-251)', () => {
  const PROD_BASE = [...ADMIN_ARGS, '--target', 'prod', '--prod-import-role'];
  const PROD_APPLY_FULL = [
    ...PROD_BASE, '--apply', '--allow-prod-write', '--backup-sha256', VALID_SHA,
    '--expected-host', 'afldb-prod', '--expected-revision', VALID_REVISION,
  ];

  it('--target prod requires --prod-import-role even for read-only preflight', () => {
    expect(() => parseArgs([...ADMIN_ARGS, '--target', 'prod']))
      .toThrow(/--prod-import-role/);
  });

  it('PROD read-only preflight (no --apply) needs nothing beyond --prod-import-role', () => {
    expect(() => parseArgs(PROD_BASE)).not.toThrow();
  });

  it('the full valid PROD apply flag combination parses cleanly', () => {
    const args = parseArgs(PROD_APPLY_FULL);
    expect(args).toMatchObject({
      target: 'prod', apply: true, prodImportRole: true, allowProdWrite: true,
      backupSha256: VALID_SHA, expectedHost: 'afldb-prod', expectedRevision: VALID_REVISION,
      namePartsPath: null,
    });
  });

  it('PROD --apply without --allow-prod-write refuses', () => {
    expect(() => parseArgs(PROD_APPLY_FULL.filter((a) => a !== '--allow-prod-write')))
      .toThrow(/--allow-prod-write/);
  });

  it('PROD --apply without --backup-sha256 refuses', () => {
    const idx = PROD_APPLY_FULL.indexOf('--backup-sha256');
    expect(() => parseArgs([...PROD_APPLY_FULL.slice(0, idx), ...PROD_APPLY_FULL.slice(idx + 2)]))
      .toThrow(/--backup-sha256/);
  });

  it('PROD --apply without --expected-host refuses', () => {
    const idx = PROD_APPLY_FULL.indexOf('--expected-host');
    expect(() => parseArgs([...PROD_APPLY_FULL.slice(0, idx), ...PROD_APPLY_FULL.slice(idx + 2)]))
      .toThrow(/--expected-host/);
  });

  it('PROD --apply without --expected-revision refuses', () => {
    const idx = PROD_APPLY_FULL.indexOf('--expected-revision');
    expect(() => parseArgs([...PROD_APPLY_FULL.slice(0, idx), ...PROD_APPLY_FULL.slice(idx + 2)]))
      .toThrow(/--expected-revision/);
  });

  it.each([
    'not-forty-hex',
    VALID_REVISION.slice(0, 39),
    `${VALID_REVISION}f`,
    VALID_REVISION.toUpperCase(),
    '',
  ])('malformed --expected-revision %s refuses', (malformed) => {
    const idx = PROD_APPLY_FULL.indexOf('--expected-revision');
    const args = [...PROD_APPLY_FULL.slice(0, idx + 1), malformed];
    expect(() => parseArgs(args)).toThrow(/40 hexadecimal characters/);
  });

  it('malformed --backup-sha256 refuses for PROD exactly as it does for DEV', () => {
    const idx = PROD_APPLY_FULL.indexOf('--backup-sha256');
    const args = [...PROD_APPLY_FULL.slice(0, idx + 1), 'not-a-valid-sha'];
    expect(() => parseArgs(args)).toThrow(/64 hexadecimal characters/);
  });

  it('PROD_REVISION_RE matches only exactly 40 lower-case hex characters', () => {
    expect(PROD_REVISION_RE.test(VALID_REVISION)).toBe(true);
    expect(PROD_REVISION_RE.test(VALID_REVISION.toUpperCase())).toBe(false);
    expect(PROD_REVISION_RE.test(VALID_REVISION.slice(0, 39))).toBe(false);
  });

  it('--allow-prod-write is invalid/irrelevant for --target dev and is refused (DEV ack does not satisfy PROD)', () => {
    expect(() => parseArgs([
      ...ADMIN_ARGS, '--target', 'dev', '--dev-import-role', '--allow-prod-write',
    ])).toThrow(/--allow-prod-write is only valid with --target prod/);
  });

  it('--allow-dev-write cannot satisfy the PROD apply gate (only valid with --target dev)', () => {
    expect(() => parseArgs([
      ...PROD_BASE, '--apply', '--allow-dev-write', '--backup-sha256', VALID_SHA,
      '--expected-host', 'afldb-prod', '--expected-revision', VALID_REVISION,
    ])).toThrow(/--allow-dev-write is only valid with --target dev/);
  });

  it('--allow-prod-write cannot satisfy the DEV apply gate (only valid with --target prod)', () => {
    expect(() => parseArgs([
      ...ADMIN_ARGS, '--target', 'dev', '--dev-import-role', '--apply', '--allow-prod-write',
      '--backup-sha256', VALID_SHA,
    ])).toThrow(/--allow-prod-write is only valid with --target prod/);
  });

  it('--expected-host is invalid/irrelevant for --target test and --target dev', () => {
    expect(() => parseArgs([...ADMIN_ARGS, '--target', 'test', '--expected-host', 'x']))
      .toThrow(/--expected-host is only valid with --target prod/);
    expect(() => parseArgs([...ADMIN_ARGS, '--target', 'dev', '--expected-host', 'x']))
      .toThrow(/--expected-host is only valid with --target prod/);
  });

  it('--expected-revision is invalid/irrelevant for --target test and --target dev', () => {
    expect(() => parseArgs([...ADMIN_ARGS, '--target', 'test', '--expected-revision', VALID_REVISION]))
      .toThrow(/--expected-revision is only valid with --target prod/);
  });

  it('--backup-sha256 is now valid for --target prod as well as --target dev', () => {
    expect(() => parseArgs([...PROD_BASE, '--backup-sha256', VALID_SHA])).not.toThrow();
  });

  it('--name-parts is refused outright for --target prod: no alternate file is ever accepted', () => {
    expect(() => parseArgs([...PROD_BASE, '--name-parts', 'some/path.json']))
      .toThrow(/--name-parts is not accepted for --target prod/);
  });

  it('--prod-import-role is invalid/irrelevant for --target dev and --target test', () => {
    expect(() => parseArgs([...ADMIN_ARGS, '--target', 'dev', '--prod-import-role']))
      .toThrow(/--prod-import-role is only valid with --target prod/);
    expect(() => parseArgs([...ADMIN_ARGS, '--target', 'test', '--prod-import-role']))
      .toThrow(/--prod-import-role is only valid with --target prod/);
  });
});

describe('register_issue224_s9_players — resolveProdTarget / resolveProdAuthTarget (AFLDB-ISSUE-251)', () => {
  const originalEnv = { ...process.env };
  function restoreEnv(): void {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  }

  it('AFLDB_PROD_IMPORT_DATABASE_URL unset refuses', () => {
    delete process.env.AFLDB_PROD_IMPORT_DATABASE_URL;
    expect(() => resolveProdTarget(false)).toThrow(/AFLDB_PROD_IMPORT_DATABASE_URL is not set/);
  });

  it('a wrong database name refuses even though it does not look prod-like at all', () => {
    process.env.AFLDB_PROD_IMPORT_DATABASE_URL = 'postgresql://afldb_import:x@localhost:5432/afldb_dev';
    try {
      expect(() => resolveProdTarget(false)).toThrow(/does not target \/afldb_prod/);
    } finally {
      restoreEnv();
    }
  });

  it('read-only when writeAuthorized=false, writable only when writeAuthorized=true', () => {
    process.env.AFLDB_PROD_IMPORT_DATABASE_URL = 'postgresql://afldb_import:x@localhost:5432/afldb_prod';
    try {
      expect(resolveProdTarget(false)).toMatchObject({
        requiredDatabase: 'afldb_prod', requiredUser: 'afldb_import', readOnly: true, canApply: false,
      });
      expect(resolveProdTarget(true)).toMatchObject({
        requiredDatabase: 'afldb_prod', requiredUser: 'afldb_import', readOnly: false, canApply: true,
      });
    } finally {
      restoreEnv();
    }
  });

  it('AFLDB_PROD_AUTH_DATABASE_URL unset refuses', () => {
    delete process.env.AFLDB_PROD_AUTH_DATABASE_URL;
    expect(() => resolveProdAuthTarget()).toThrow(/AFLDB_PROD_AUTH_DATABASE_URL is not set/);
  });

  it('resolveProdAuthTarget refuses a DSN naming the wrong database', () => {
    process.env.AFLDB_PROD_AUTH_DATABASE_URL = 'postgresql://afldb_auth:x@localhost:5432/afldb_dev';
    try {
      expect(() => resolveProdAuthTarget()).toThrow(/does not target \/afldb_prod/);
    } finally {
      restoreEnv();
    }
  });

  it('resolveProdAuthTarget resolves the afldb_auth role against afldb_prod', () => {
    process.env.AFLDB_PROD_AUTH_DATABASE_URL = 'postgresql://afldb_auth:x@localhost:5432/afldb_prod';
    try {
      expect(resolveProdAuthTarget()).toMatchObject({ requiredDatabase: 'afldb_prod', requiredUser: 'afldb_auth' });
    } finally {
      restoreEnv();
    }
  });
});

describe('register_issue224_s9_players — assertProdBoundary (AFLDB-ISSUE-251, DB-free via injected `actual`)', () => {
  const ARGS = { expectedHost: 'afldb-prod', expectedRevision: VALID_REVISION };

  it('PROD_HOSTNAME is the exact literal both sides of the boundary check are pinned to', () => {
    expect(PROD_HOSTNAME).toBe('afldb-prod');
  });

  it('passes when the injected host and revision both match', () => {
    expect(() => assertProdBoundary(ARGS, { host: 'afldb-prod', revision: VALID_REVISION })).not.toThrow();
  });

  it('refuses a wrong revision', () => {
    expect(() => assertProdBoundary(ARGS, { host: 'afldb-prod', revision: 'b'.repeat(40) }))
      .toThrow(/--expected-revision/);
  });

  // AFLDB-ISSUE-251 finding: actual.host === args.expectedHost is NOT sufficient on its own, since
  // an operator running this tool on some OTHER machine could supply that machine's own hostname
  // as --expected-host and have the two sides agree. The three cases below are the exact ones the
  // finding names.
  it('refuses when running on a non-PROD host, even if --expected-host names that SAME non-PROD host', () => {
    expect(() => assertProdBoundary({ expectedHost: 'devbox', expectedRevision: VALID_REVISION },
      { host: 'devbox', revision: VALID_REVISION }))
      .toThrow(/running host 'devbox' is not the production host 'afldb-prod'/);
  });

  it('refuses when running on the real PROD host but --expected-host names something else', () => {
    expect(() => assertProdBoundary({ expectedHost: 'other', expectedRevision: VALID_REVISION },
      { host: 'afldb-prod', revision: VALID_REVISION }))
      .toThrow(/--expected-host 'other' does not equal the production host 'afldb-prod'/);
  });

  it('accepts running on the real PROD host with --expected-host also naming it, subject to the revision guard', () => {
    expect(() => assertProdBoundary({ expectedHost: 'afldb-prod', expectedRevision: VALID_REVISION },
      { host: 'afldb-prod', revision: VALID_REVISION }))
      .not.toThrow();
    expect(() => assertProdBoundary({ expectedHost: 'afldb-prod', expectedRevision: VALID_REVISION },
      { host: 'afldb-prod', revision: 'b'.repeat(40) }))
      .toThrow(/--expected-revision/);
  });

  it('a wrong host is refused even before --expected-host is inspected (no partial trust of either side alone)', () => {
    expect(() => assertProdBoundary(ARGS, { host: 'some-other-host', revision: VALID_REVISION }))
      .toThrow(/running host 'some-other-host' is not the production host/);
  });

  // AFLDB-ISSUE-251 review finding: --expected-revision pins HEAD but does not prove the checkout
  // being executed is free of local code drift. These two properties are unchanged by the fix
  // below (assertProdBoundary itself is untouched) — pinned here so a future edit cannot silently
  // regress them while working on the new checkout-integrity boundary.
  it('wrong HEAD still REFUSEs (unchanged) and the full 40-hex revision requirement remains (unchanged)', () => {
    expect(() => assertProdBoundary(ARGS, { host: 'afldb-prod', revision: 'f'.repeat(40) }))
      .toThrow(/--expected-revision/);
    expect(PROD_REVISION_RE.test(VALID_REVISION)).toBe(true);
    expect(PROD_REVISION_RE.test(VALID_REVISION.slice(0, 39))).toBe(false);
  });
});

describe('register_issue224_s9_players — judgeCheckoutIntegrity (AFLDB-ISSUE-251 checkout-integrity finding, pure)', () => {
  const CLEAN: CheckoutIntegrityFacts = {
    isOwnRepoToplevel: true, hasNoTrackedDrift: true, untrackedPaths: [],
  };

  it('PROD_ALLOWED_UNTRACKED_RE matches exactly the settle-manifest family and nothing else', () => {
    const path = 'docs/rebuild-manifests/afltables_fitzroy_core/settle-20260926-213225.json';
    expect(PROD_ALLOWED_UNTRACKED_RE.test(path)).toBe(true);
    // not merely "under docs/":
    expect(PROD_ALLOWED_UNTRACKED_RE.test('docs/rebuild-manifests/afltables_fitzroy_core/other.json')).toBe(false);
    expect(PROD_ALLOWED_UNTRACKED_RE.test('docs/rebuild-manifests/afltables_fitzroy_core/settle-x.ts')).toBe(false);
    expect(PROD_ALLOWED_UNTRACKED_RE.test('docs/rebuild-manifests/other_family/settle-x.json')).toBe(false);
    expect(PROD_ALLOWED_UNTRACKED_RE.test('docs/settle-x.json')).toBe(false);
    // no extra path segment under the exact directory:
    expect(PROD_ALLOWED_UNTRACKED_RE.test('docs/rebuild-manifests/afltables_fitzroy_core/sub/settle-x.json')).toBe(false);
    expect(PROD_ALLOWED_UNTRACKED_RE.test('scripts/settle-x.json')).toBe(false);
  });

  it('correct HEAD + no tracked drift + no untracked files -> PASS', () => {
    expect(() => judgeCheckoutIntegrity(CLEAN)).not.toThrow();
  });

  it('correct HEAD + permitted settle manifest(s) only -> PASS', () => {
    expect(() => judgeCheckoutIntegrity({
      ...CLEAN,
      untrackedPaths: [
        'docs/rebuild-manifests/afltables_fitzroy_core/settle-20260926-213225.json',
        'docs/rebuild-manifests/afltables_fitzroy_core/settle-20260101-000000.json',
      ],
    })).not.toThrow();
  });

  it('tracked drift (unstaged/staged/deleted/renamed, collapsed to one fact by git diff HEAD) -> REFUSE', () => {
    expect(() => judgeCheckoutIntegrity({ ...CLEAN, hasNoTrackedDrift: false }))
      .toThrow(/tracked working-tree drift detected relative to HEAD/);
  });

  it('unexpected untracked .ts file -> REFUSE', () => {
    expect(() => judgeCheckoutIntegrity({ ...CLEAN, untrackedPaths: ['tools/scratch.ts'] }))
      .toThrow(/unexpected untracked file\(s\).*tools\/scratch\.ts/s);
  });

  it('unexpected untracked JSON outside the exact settle-manifest path -> REFUSE', () => {
    expect(() => judgeCheckoutIntegrity({
      ...CLEAN, untrackedPaths: ['docs/rebuild-manifests/other_family/settle-1.json'],
    })).toThrow(/unexpected untracked file\(s\)/);
  });

  it('permitted settle manifest plus one unexpected file -> REFUSE (the permitted one does not launder the other)', () => {
    expect(() => judgeCheckoutIntegrity({
      ...CLEAN,
      untrackedPaths: [
        'docs/rebuild-manifests/afltables_fitzroy_core/settle-20260926-213225.json',
        'docs/scratch.json',
      ],
    })).toThrow(/unexpected untracked file\(s\).*docs\/scratch\.json/s);
  });

  it('not proven to be the repository containing the running tool -> REFUSE', () => {
    expect(() => judgeCheckoutIntegrity({ ...CLEAN, isOwnRepoToplevel: false }))
      .toThrow(/does not resolve to the directory containing the running tool/);
  });
});

describe('register_issue224_s9_players — gatherCheckoutIntegrityFacts / assertProdCheckoutIntegrity (AFLDB-ISSUE-251, real git in a scratch repo)', () => {
  function git(args: string[], cwd: string): void {
    const result = spawnSync('git', args, { cwd, stdio: ['ignore', 'ignore', 'ignore'] });
    if (result.error || result.status !== 0) {
      throw new Error(`test setup: git ${args.join(' ')} failed (status=${String(result.status)})`);
    }
  }

  /** A fresh, isolated scratch git repo — never this session's own (currently dirty) worktree. */
  function makeCleanRepo(): string {
    const repoRoot = mkdtempSync(join(tmpdir(), 'issue251-checkout-integrity-'));
    git(['init', '--quiet'], repoRoot);
    git(['config', 'user.email', 'scratch@example.invalid'], repoRoot);
    git(['config', 'user.name', 'Scratch'], repoRoot);
    writeFileSync(join(repoRoot, 'tracked.txt'), 'original\n');
    git(['add', '-A'], repoRoot);
    git(['commit', '--quiet', '-m', 'init'], repoRoot);
    return repoRoot;
  }

  it('correct HEAD + no tracked drift + no untracked files -> PASS (real git)', () => {
    const repoRoot = makeCleanRepo();
    try {
      expect(() => assertProdCheckoutIntegrity(repoRoot)).not.toThrow();
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('correct HEAD + permitted settle manifest(s) only -> PASS (real git)', () => {
    const repoRoot = makeCleanRepo();
    try {
      const manifestDir = join(repoRoot, 'docs', 'rebuild-manifests', 'afltables_fitzroy_core');
      mkdirSync(manifestDir, { recursive: true });
      writeFileSync(join(manifestDir, 'settle-20260926-213225.json'), '{}\n');
      expect(() => assertProdCheckoutIntegrity(repoRoot)).not.toThrow();
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('unstaged tracked modification -> REFUSE', () => {
    const repoRoot = makeCleanRepo();
    try {
      writeFileSync(join(repoRoot, 'tracked.txt'), 'modified, not staged\n');
      expect(() => assertProdCheckoutIntegrity(repoRoot)).toThrow(/tracked working-tree drift/);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('staged tracked modification -> REFUSE', () => {
    const repoRoot = makeCleanRepo();
    try {
      writeFileSync(join(repoRoot, 'tracked.txt'), 'modified and staged\n');
      git(['add', '-A'], repoRoot);
      expect(() => assertProdCheckoutIntegrity(repoRoot)).toThrow(/tracked working-tree drift/);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('tracked deletion -> REFUSE', () => {
    const repoRoot = makeCleanRepo();
    try {
      rmSync(join(repoRoot, 'tracked.txt'));
      expect(() => assertProdCheckoutIntegrity(repoRoot)).toThrow(/tracked working-tree drift/);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('unexpected untracked .ts file -> REFUSE', () => {
    const repoRoot = makeCleanRepo();
    try {
      writeFileSync(join(repoRoot, 'scratch.ts'), '// not tracked\n');
      expect(() => assertProdCheckoutIntegrity(repoRoot)).toThrow(/unexpected untracked file\(s\).*scratch\.ts/s);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('unexpected untracked JSON outside the exact settle-manifest path -> REFUSE', () => {
    const repoRoot = makeCleanRepo();
    try {
      const dir = join(repoRoot, 'docs', 'rebuild-manifests', 'other_family');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'settle-1.json'), '{}\n');
      expect(() => assertProdCheckoutIntegrity(repoRoot)).toThrow(/unexpected untracked file\(s\)/);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('permitted settle manifest plus one unexpected file -> REFUSE', () => {
    const repoRoot = makeCleanRepo();
    try {
      const manifestDir = join(repoRoot, 'docs', 'rebuild-manifests', 'afltables_fitzroy_core');
      mkdirSync(manifestDir, { recursive: true });
      writeFileSync(join(manifestDir, 'settle-20260926-213225.json'), '{}\n');
      writeFileSync(join(repoRoot, 'unexpected.txt'), 'x\n');
      expect(() => assertProdCheckoutIntegrity(repoRoot)).toThrow(/unexpected untracked file\(s\).*unexpected\.txt/s);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('not a git repository -> REFUSE', () => {
    const plainDir = mkdtempSync(join(tmpdir(), 'issue251-not-a-repo-'));
    try {
      expect(() => assertProdCheckoutIntegrity(plainDir)).toThrow(/git rev-parse --show-toplevel.*failed/s);
    } finally {
      rmSync(plainDir, { recursive: true, force: true });
    }
  });

  it('git command failure (repoRoot does not exist at all) -> REFUSE', () => {
    const missing = join(tmpdir(), 'issue251-does-not-exist-', String(Date.now()));
    expect(() => assertProdCheckoutIntegrity(missing)).toThrow();
  });

  it('a git repository nested under a different toplevel is refused (not proven to be the running tool\'s own repo)', () => {
    const outerRoot = makeCleanRepo();
    try {
      const nested = join(outerRoot, 'nested-dir');
      mkdirSync(nested, { recursive: true });
      // gatherCheckoutIntegrityFacts is called with the NESTED directory as repoRoot: git still
      // finds the SAME outer toplevel, which does not resolve to `nested` itself.
      const facts = gatherCheckoutIntegrityFacts(nested);
      expect(facts.isOwnRepoToplevel).toBe(false);
      expect(() => assertProdCheckoutIntegrity(nested, facts))
        .toThrow(/does not resolve to the directory containing the running tool/);
    } finally {
      rmSync(outerRoot, { recursive: true, force: true });
    }
  });
});

describe('register_issue224_s9_players — checkout-integrity assertion runs before the PROD write connection (source-order pin)', () => {
  const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
  const source = readFileSync(
    join(REPO_ROOT, 'tools', 'rebuild', 'draftguru', 'register_issue224_s9_players.ts'), 'utf8',
  );
  const bodyStart = source.indexOf('async function runProdMain(');
  const bodyEnd = source.indexOf('\n// ---', bodyStart);
  const body = source.slice(bodyStart, bodyEnd);

  it('finds runProdMain exactly once', () => {
    expect(bodyStart).toBeGreaterThan(-1);
    expect(bodyEnd).toBeGreaterThan(bodyStart);
  });

  it('calls assertProdBoundary, then assertProdCheckoutIntegrity, then resolveProdTarget (the write DSN), in that order', () => {
    const boundaryAt = body.indexOf('assertProdBoundary(args);');
    const integrityAt = body.indexOf('assertProdCheckoutIntegrity();');
    const resolveAt = body.indexOf('resolveProdTarget(prodWriteAuthorized)');
    expect(boundaryAt).toBeGreaterThan(-1);
    expect(integrityAt).toBeGreaterThan(boundaryAt);
    expect(resolveAt).toBeGreaterThan(integrityAt);
  });

  it('both checks are gated behind prodWriteAuthorized (a read-only PROD preflight never runs them)', () => {
    const gateAt = body.indexOf('if (prodWriteAuthorized) {');
    const closeAt = body.indexOf('}', body.indexOf('assertProdCheckoutIntegrity();'));
    expect(gateAt).toBeGreaterThan(-1);
    expect(body.indexOf('assertProdBoundary(args);')).toBeGreaterThan(gateAt);
    expect(closeAt).toBeGreaterThan(body.indexOf('assertProdCheckoutIntegrity();'));
  });

  it('assertProdCheckoutIntegrity is called nowhere outside runProdMain (TEST/DEV paths are untouched)', () => {
    const callSites = source.split('assertProdCheckoutIntegrity();').length - 1;
    expect(callSites).toBe(1);
  });
});

describe('register_issue224_s9_players — assertViableProdActor (AFLDB-ISSUE-251)', () => {
  const VIABLE: ProdActorRow = { id: 4, role: 'super_admin', isActive: true, hasPassword: true, hasTotp: true };

  it('accepts an enabled, fully-enrolled super_admin', () => {
    expect(() => assertViableProdActor(VIABLE)).not.toThrow();
  });

  it('refuses when no row was found', () => {
    expect(() => assertViableProdActor(undefined)).toThrow(/names no auth_users row/);
  });

  it('refuses a disabled actor', () => {
    expect(() => assertViableProdActor({ ...VIABLE, isActive: false })).toThrow(/active=false/);
  });

  it('refuses an unenrolled actor (no TOTP)', () => {
    expect(() => assertViableProdActor({ ...VIABLE, hasTotp: false })).toThrow(/hasTotp=false/);
  });

  it('refuses an unenrolled actor (no password)', () => {
    expect(() => assertViableProdActor({ ...VIABLE, hasPassword: false })).toThrow(/hasPassword=false/);
  });

  it('refuses a non-super-admin actor', () => {
    expect(() => assertViableProdActor({ ...VIABLE, role: 'admin' })).toThrow(/role=admin/);
  });

  it('refuses an unrecognised role string', () => {
    expect(() => assertViableProdActor({ ...VIABLE, role: 'bogus' })).toThrow(/not a recognised lifecycle role/);
  });

  it('refuses the exact ISSUE-224/245 recovery/fixture actor shape (disabled, super_admin, no credentials)', () => {
    // insertAttributionOnlyActor (tools/migration/rebuild_manual_registrations.ts) always writes
    // exactly this shape: disabled at creation, NULL password_hash, NULL totp_secret. Confirmed by
    // the retained ISSUE-251 candidate census (issues/open/AFLDB-ISSUE-251.md §4.2).
    expect(() => assertViableProdActor({
      id: 99, role: 'super_admin', isActive: false, hasPassword: false, hasTotp: false,
    })).toThrow(/active=false, hasPassword=false, hasTotp=false/);
  });
});

describe('register_issue224_s9_players — loadPinnedProdNameParts (AFLDB-ISSUE-251 D-251-5)', () => {
  it('loads the tracked artefact and matches its pinned sha256 (would throw otherwise)', () => {
    const nameParts = loadPinnedProdNameParts();
    expect([...nameParts.keys()].sort()).toEqual([
      'players/A/Alex_Van_Wyk.html',
      'players/H/Hussien_El_Achkar.html',
    ]);
    expect(nameParts.get('players/A/Alex_Van_Wyk.html')).toMatchObject({ givenName: 'Alex', surname: 'Van Wyk' });
  });

  it('the pinned PROD artefact resolves all 92 rows exactly as the DEV/test path does', () => {
    const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
    const MANIFESTS = join(REPO_ROOT, 'docs', 'rebuild-manifests', 'draftguru');
    const targets = loadAndValidateArtefacts(
      join(MANIFESTS, 'issue224-s9-target-set-20260922.json'),
      join(MANIFESTS, 'issue224-d7-registration-decision-20260922.json'),
      loadPinnedProdNameParts(),
    );
    expect(targets).toHaveLength(EXPECTED_ROW_COUNT);
  });
});

describe('register_issue224_s9_players — assertExactFirstApplyShape (shared DEV/PROD first-apply gate)', () => {
  function classificationOf(create: number, satisfied: number, conflict: number): Classification[] {
    const target = {
      profilePath: 'players/T/T.html', displayName: 'T', givenName: null, surname: 'T',
      aflApiProviderId: 'p', draftguruPlayerUrl: 'u',
    };
    return [
      ...Array.from({ length: create }, () => ({ kind: 'CREATE' as const, target })),
      ...Array.from({ length: satisfied }, () => ({ kind: 'ALREADY_SATISFIED' as const, target, playerId: 1 })),
      ...Array.from({ length: conflict }, () => ({ kind: 'CONFLICT' as const, target, detail: 'x' })),
    ];
  }

  it('accepts exactly CREATE=92/ALREADY_SATISFIED=0/CONFLICT=0', () => {
    expect(() => assertExactFirstApplyShape(classificationOf(EXPECTED_ROW_COUNT, 0, 0), 'PROD')).not.toThrow();
  });

  it('refuses when ALREADY_SATISFIED is nonzero, even with zero conflicts (a bare retry is not automatic)', () => {
    expect(() => assertExactFirstApplyShape(classificationOf(EXPECTED_ROW_COUNT - 1, 1, 0), 'PROD'))
      .toThrow(/requires exactly CREATE=92, ALREADY_SATISFIED=0, CONFLICT=0/);
  });

  it('refuses when the total row count is wrong', () => {
    expect(() => assertExactFirstApplyShape(classificationOf(EXPECTED_ROW_COUNT - 1, 0, 0), 'DEV'))
      .toThrow(/requires exactly CREATE=92/);
  });
});

describe('register_issue224_s9_players — assertNoAflApiIdentityWritten (AFLDB-ISSUE-251)', () => {
  function makeFakeTx(count: string): postgres.TransactionSql {
    return (async () => [{ count }]) as unknown as postgres.TransactionSql;
  }

  it('passes when zero afl_api identities exist for the created players', async () => {
    await expect(assertNoAflApiIdentityWritten(makeFakeTx('0'), [1, 2, 3])).resolves.toBeUndefined();
  });

  it('refuses when any afl_api identity exists for the created players', async () => {
    await expect(assertNoAflApiIdentityWritten(makeFakeTx('2'), [1, 2, 3]))
      .rejects.toThrow(/2 afl_api external_identities row\(s\)/);
  });
});

describe('register_issue224_s9_players — assertViableActorInTransaction (AFLDB-ISSUE-251 finding)', () => {
  it('calls public.assert_viable_super_admin_actor with exactly the given actor id, on the given tx', async () => {
    const calls: unknown[][] = [];
    const fakeTx = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push([strings.join('?'), ...values]);
      return Promise.resolve([{ assert_viable_super_admin_actor: null }]);
    }) as unknown as postgres.TransactionSql;

    await expect(assertViableActorInTransaction(fakeTx, 4)).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toContain('assert_viable_super_admin_actor');
    expect(calls[0]).toContain(4);
  });

  it('propagates the database refusal (an assertion failure aborts before row 1)', async () => {
    const refusingTx = ((): Promise<never> => Promise.reject(
      new Error('assert_viable_super_admin_actor: auth_users.id 4 is disabled'),
    )) as unknown as postgres.TransactionSql;

    await expect(assertViableActorInTransaction(refusingTx, 4))
      .rejects.toThrow(/assert_viable_super_admin_actor: auth_users.id 4 is disabled/);
  });
});

describe('register_issue224_s9_players — runProdAdoptionWrite calls the assertion before any write (source-order pin)', () => {
  const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
  const source = readFileSync(
    join(REPO_ROOT, 'tools', 'rebuild', 'draftguru', 'register_issue224_s9_players.ts'), 'utf8',
  );
  const bodyStart = source.indexOf('export async function runProdAdoptionWrite(');
  const bodyEnd = source.indexOf('\nexport async function runDevPostWriteChecks(');
  const body = source.slice(bodyStart, bodyEnd);

  it('finds the function exactly once, before its shared postcondition sibling', () => {
    expect(bodyStart).toBeGreaterThan(-1);
    expect(bodyEnd).toBeGreaterThan(bodyStart);
  });

  it('asserts the actor before classify(), before createPlayerInTransaction(), and before attachAflTablesIdentityInTransaction()', () => {
    const assertAt = body.indexOf('await assertViableActorInTransaction(tx, params.adminUserId);');
    const classifyAt = body.indexOf('await classify(tx, params.targets, warnings);');
    const createAt = body.indexOf('await createPlayerInTransaction(tx, input, { adminUserId: params.adminUserId });');
    const attachAt = body.indexOf('await attachAflTablesIdentityInTransaction(tx, {');
    expect(assertAt).toBeGreaterThan(-1);
    expect(classifyAt).toBeGreaterThan(assertAt);
    expect(createAt).toBeGreaterThan(assertAt);
    expect(attachAt).toBeGreaterThan(assertAt);
  });

  it('no pre-fetched actor row is accepted by this function: only adminUserId is in its params type', () => {
    expect(body).toMatch(/params: \{ targets: Target\[\]; adminUserId: number \}/);
    expect(body).not.toMatch(/actor: ProdActorRow/);
  });
});

describe('migration 105 — public.assert_viable_super_admin_actor() (AFLDB-ISSUE-251)', () => {
  const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
  const migration = readFileSync(
    join(REPO_ROOT, 'src', 'db', 'migrations', '105_prod_actor_lifecycle_assertion.sql'), 'utf8',
  );
  const fnStart = migration.indexOf('CREATE FUNCTION public.assert_viable_super_admin_actor');
  const fnBodyStart = migration.indexOf('AS $fn$', fnStart) + 'AS $fn$'.length;
  const fnBodyEnd = migration.indexOf('$fn$;', fnBodyStart);
  const fnBody = migration.slice(fnBodyStart, fnBodyEnd);
  const header = migration.slice(fnStart, fnBodyStart);

  it('is found exactly once, RETURNS void', () => {
    expect(fnStart).toBeGreaterThan(-1);
    expect(migration.indexOf('CREATE FUNCTION public.assert_viable_super_admin_actor', fnStart + 1)).toBe(-1);
    expect(header).toMatch(/RETURNS void/);
  });

  it('is SECURITY DEFINER with a fixed, minimal search_path', () => {
    expect(header).toMatch(/SECURITY DEFINER/);
    expect(header).toMatch(/SET search_path = pg_catalog, pg_temp/);
  });

  it('fully qualifies auth_users as public.auth_users', () => {
    expect(fnBody).toMatch(/FROM public\.auth_users/);
    expect(fnBody).not.toMatch(/FROM auth_users\b/);
  });

  it('accepts only the one actor id the caller needs, nothing else', () => {
    expect(header).toMatch(/\(p_actor_id integer\)/);
  });

  it('takes a FOR SHARE row lock before any viability check runs', () => {
    const lockAt = fnBody.indexOf('FOR SHARE');
    const firstCheckAt = fnBody.indexOf("IF v_role <> 'super_admin'");
    expect(lockAt).toBeGreaterThan(-1);
    expect(firstCheckAt).toBeGreaterThan(lockAt);
  });

  it('raises if the actor does not exist', () => {
    expect(fnBody).toMatch(/IF NOT FOUND THEN/);
    expect(fnBody).toMatch(/RAISE EXCEPTION 'assert_viable_super_admin_actor: auth_users\.id % does not exist'/);
  });

  it('checks exactly isViableSuperAdmin’s four conditions', () => {
    expect(fnBody).toMatch(/v_role <> 'super_admin'/);
    expect(fnBody).toMatch(/v_disabled_at IS NOT NULL/);
    expect(fnBody).toMatch(/v_password_hash IS NULL/);
    expect(fnBody).toMatch(/v_totp_secret IS NULL/);
  });

  it('refuses a reserved fixture/example email domain using the SAME rule TEST_FIXTURE_EMAIL_SQL applies', () => {
    // tools/db/promotion-inventory.ts is the single source of truth for these two lists; this
    // pins the migration's inlined SQL (a migration file cannot import a TypeScript module)
    // against the SAME literal values so the two can never silently diverge.
    for (const tld of RESERVED_TEST_TLDS) expect(fnBody).toContain(tld);
    for (const domain of RESERVED_EXAMPLE_DOMAINS) expect(fnBody).toContain(domain.replace('.', '\\.'));
    expect(fnBody).toMatch(/position\('@' in v_email\) <= 1/);
    expect(fnBody).toMatch(/position\('@' in v_email\) = length\(v_email\)/);
  });

  it('never copies or exposes password_hash or totp_secret as data — only IS NULL checks', () => {
    expect(fnBody).not.toMatch(/RETURN.*password_hash/i);
    expect(fnBody).not.toMatch(/RETURN.*totp_secret/i);
    expect(migration).not.toMatch(/RETURNS TABLE/);
  });

  it('contains no dynamic SQL inside the function body (EXECUTE/format() are ownership/grant setup only, outside $fn$)', () => {
    expect(fnBody).not.toMatch(/\bEXECUTE\b/);
    expect(fnBody).not.toMatch(/\bformat\s*\(/);
  });

  it('never hard-codes current_database() = \'afldb_prod\' (the CLI, not this function, owns the environment boundary)', () => {
    expect(fnBody).not.toMatch(/current_database/);
    expect(fnBody).not.toMatch(/afldb_prod/);
  });

  it('PUBLIC execute is revoked and EXECUTE is granted to afldb_import only', () => {
    const revokeAt = migration.indexOf('REVOKE ALL ON FUNCTION public.assert_viable_super_admin_actor(integer) FROM PUBLIC');
    const grantAt = migration.indexOf("GRANT EXECUTE ON FUNCTION public.assert_viable_super_admin_actor(integer) TO afldb_import");
    expect(revokeAt).toBeGreaterThan(-1);
    expect(grantAt).toBeGreaterThan(revokeAt);
    expect(migration).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.assert_viable_super_admin_actor.*TO afldb_auth/);
    expect(migration).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.assert_viable_super_admin_actor.*TO afldb_app/);
  });

  it('owner is reconciled to afldb_owner', () => {
    expect(migration).toMatch(/ALTER FUNCTION public\.assert_viable_super_admin_actor\(integer\) OWNER TO afldb_owner/);
  });

  it('never grants afldb_import SELECT on auth_users', () => {
    const code = migration.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
    expect(code).not.toMatch(/GRANT[^;]*auth_users[^;]*afldb_import/is);
    expect(code).not.toMatch(/GRANT[^;]*afldb_import[^;]*auth_users/is);
  });
});

describe('privileges.sql — reconciles assert_viable_super_admin_actor() (AFLDB-ISSUE-251)', () => {
  const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
  const privileges = readFileSync(join(REPO_ROOT, 'tools', 'maintenance', 'privileges.sql'), 'utf8');
  const sectionStart = privileges.indexOf('AFLDB-ISSUE-251 — the second function grant');
  const section = privileges.slice(sectionStart);

  it('the section exists exactly once, after the migration-081 function section', () => {
    expect(sectionStart).toBeGreaterThan(-1);
    expect(sectionStart).toBeGreaterThan(privileges.indexOf('AFLDB-ISSUE-119 — the one function grant'));
    expect(privileges.indexOf('AFLDB-ISSUE-251 — the second function grant', sectionStart + 1)).toBe(-1);
  });

  it('reconciles owner, PUBLIC revoke and the afldb_import grant, in that order', () => {
    const ownerAt = section.indexOf(
      'ALTER FUNCTION public.assert_viable_super_admin_actor(integer) OWNER TO afldb_owner',
    );
    const revokeAt = section.indexOf(
      'REVOKE ALL ON FUNCTION public.assert_viable_super_admin_actor(integer) FROM PUBLIC',
    );
    const grantAt = section.indexOf(
      'GRANT EXECUTE ON FUNCTION public.assert_viable_super_admin_actor(integer) TO afldb_import',
    );
    expect(ownerAt).toBeGreaterThan(-1);
    expect(revokeAt).toBeGreaterThan(ownerAt);
    expect(grantAt).toBeGreaterThan(revokeAt);
  });

  it('guards the grant behind its OWN afldb_import existence check, immediately above it', () => {
    const guardAt = section.indexOf("IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_import') THEN");
    const grantAt = section.indexOf(
      'GRANT EXECUTE ON FUNCTION public.assert_viable_super_admin_actor(integer) TO afldb_import',
    );
    expect(guardAt).toBeGreaterThan(-1);
    expect(grantAt).toBeGreaterThan(guardAt);
    expect(section.slice(guardAt, grantAt)).not.toMatch(/END\s*\$\$;/);
  });

  it('never reconciles afldb_import with a direct auth_users grant anywhere in this file', () => {
    // Comment-stripped: this file's prose freely discusses "auth_users" and "afldb_import" in
    // the same paragraph (that IS the point being documented), so only actual SQL statements are
    // checked here, not commentary about them.
    const code = privileges.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
    expect(code).not.toMatch(/GRANT[^;]*auth_users[^;]*afldb_import/is);
    expect(code).not.toMatch(/GRANT[^;]*afldb_import[^;]*auth_users/is);
  });
});
