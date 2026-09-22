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
import { describe, expect, it } from 'vitest';

import {
  BACKUP_SHA256_RE,
  parseArgs,
  resolveTarget,
  type TargetName,
} from '../tools/rebuild/draftguru/register_issue224_s9_players';

const VALID_SHA = 'a'.repeat(64);
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

  it('no PROD target exists: an unrecognised --target value is refused', () => {
    expect(() => parseArgs([...ADMIN_ARGS, '--target', 'prod']))
      .toThrow(/--target must be 'test' or 'dev'/);
  });

  it('DEV read-only preflight (no --apply) is unaffected by the gate: no flags required', () => {
    expect(() => parseArgs([...ADMIN_ARGS, '--target', 'dev'])).not.toThrow();
    expect(() => parseArgs([...ADMIN_ARGS, '--target', 'dev', '--dev-import-role'])).not.toThrow();
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
